import { cookies } from "next/headers";
import { getNextEvent, getScheduleEvents } from "~/lib/schedule";
import { type ScheduleValues } from "~/lib/presets";
import { DEMO_MAX_AGE_SECONDS, DEMO_STATE_COOKIE, readCookie } from "~/server/demo/session";

/**
 * The demo's pretend pod: what each side is doing, the schedules, presets and the visitor's
 * own changes. It lives in a cookie (so it survives page loads but never touches the
 * database) and starts over with every new demo visit.
 */
export type PodSide = "left" | "right";
export type ScheduleSide = PodSide | "both";

export interface DemoPodSide {
  on: boolean;
  target: number;
  /** level it was at when the last change was made, and when (ms) */
  from: number;
  at: number;
}

export interface DemoProfile extends ScheduleValues {
  enabled: boolean;
  days: number;
  hold: number | null;
  /** weekend nights: weekdays (bit 0 = Sunday) with their own bedtime and wake-up */
  wDays?: number;
  wBed?: string | null;
  wWake?: string | null;
}

export interface DemoPreset {
  id: number;
  name: string;
  description: string;
  values: ScheduleValues;
}

export interface DemoLogEntry {
  at: number;
  action: string;
  level: number | null;
  side: ScheduleSide | null;
  message: string | null;
}

export interface DemoState {
  pod: Record<PodSide, DemoPodSide>;
  /** only the schedules the visitor changed; null = deleted */
  prof: Partial<Record<ScheduleSide, DemoProfile | null>>;
  whole: boolean;
  vac: boolean;
  vacUntil: number | null;
  led: number;
  nap: boolean;
  hot: boolean;
  primedAt: number | null;
  /** only once the visitor changed them */
  presets?: DemoPreset[];
  /** the extras (nap, accent, weather, travel), only once the visitor touched them */
  napUntil?: number | null;
  hotUntil?: number | null;
  hotPrev?: Record<string, { on: boolean; level: number }>;
  accent?: string;
  weather?: boolean;
  travel?: boolean;
  home?: boolean;
  /** the schedules' time zone, once the visitor picked one (otherwise the visitor's own) */
  tz?: string;
  /** room-aware cooling, once the visitor touched it */
  room?: boolean;
  roomC?: number;
  /** the visitor's own feedback notes (kept short: the state lives in a cookie) */
  fb?: { kind: string; text: string; at: number }[];
  log: DemoLogEntry[];
  started: number;
}

const MIN = 60_000;

export const DEFAULT_PROFILES: Record<ScheduleSide, DemoProfile> = {
  left: {
    bedTime: "22:30",
    wakeupTime: "06:45",
    midStageSleepLevelStartTime: "01:00",
    finalSleepLevelStartTime: "04:30",
    initialSleepLevel: -40,
    midStageSleepLevel: -20,
    finalSleepLevel: 0,
    wakeupAlarmEnabled: true,
    wakeupAlarmLevel: 20,
    wakeupAlarmLeadMinutes: 15,
    preWakeEnabled: true,
    preWakeLevel: 10,
    preWakeLeadMinutes: 60,
    preheatLeadMinutes: 60,
    enabled: true,
    days: 127,
    hold: null,
    wDays: (1 << 5) | (1 << 6),
    wBed: "23:45",
    wWake: "08:30",
  },
  right: {
    bedTime: "23:00",
    wakeupTime: "07:15",
    midStageSleepLevelStartTime: "01:30",
    finalSleepLevelStartTime: "05:00",
    initialSleepLevel: 10,
    midStageSleepLevel: -10,
    finalSleepLevel: 20,
    wakeupAlarmEnabled: false,
    wakeupAlarmLevel: 0,
    wakeupAlarmLeadMinutes: 30,
    preheatLeadMinutes: 30,
    enabled: true,
    days: 127,
    hold: null,
  },
  both: {
    bedTime: "22:45",
    wakeupTime: "07:00",
    midStageSleepLevelStartTime: "01:15",
    finalSleepLevelStartTime: "04:45",
    initialSleepLevel: -20,
    midStageSleepLevel: -10,
    finalSleepLevel: 10,
    wakeupAlarmEnabled: false,
    wakeupAlarmLevel: 0,
    wakeupAlarmLeadMinutes: 30,
    preheatLeadMinutes: 45,
    // the whole-bed schedule is only used when switched on
    enabled: false,
    days: 127,
    hold: null,
  },
};

export const DEFAULT_PRESETS: DemoPreset[] = [
  {
    id: 1,
    name: "Hot summer night",
    description: "Extra cool all night, gentle warm-up",
    values: {
      bedTime: "22:30",
      wakeupTime: "06:30",
      midStageSleepLevelStartTime: "00:30",
      finalSleepLevelStartTime: "04:00",
      initialSleepLevel: -70,
      midStageSleepLevel: -50,
      finalSleepLevel: -30,
      wakeupAlarmEnabled: true,
      wakeupAlarmLevel: 20,
      wakeupAlarmLeadMinutes: 15,
      preWakeEnabled: true,
      preWakeLevel: 10,
      preWakeLeadMinutes: 60,
      preheatLeadMinutes: 60,
    },
  },
];

export function freshState(now = Date.now()): DemoState {
  return {
    // both sides on, as if turned on a little while ago, still on their way to the target
    pod: {
      left: { on: true, target: -30, from: 0, at: now - 6 * MIN },
      right: { on: true, target: 20, from: 0, at: now - 25 * MIN },
    },
    prof: {},
    whole: false,
    vac: false,
    vacUntil: null,
    led: 60,
    nap: false,
    hot: false,
    primedAt: null,
    log: [
      { at: now - 25 * MIN, action: "turned_on", level: 20, side: "right", message: null },
      { at: now - 6 * MIN, action: "turned_on", level: -30, side: "left", message: null },
    ],
    started: now,
  };
}

// ---- cookie encoding: schedules as short tuples, so the whole state stays well under 4 KB ----

// the last three (Pre-wake level, minutes, on) are missing in visits saved before Pre-wake existed
// the last one (stages set to Off) is missing in visits saved before Off existed
type ValuesTuple = [string, string, string, string, number, number, number, 0 | 1, number, number, number, number?, number?, (0 | 1)?, number?];
const packValues = (v: ScheduleValues): ValuesTuple => [
  v.bedTime,
  v.wakeupTime,
  v.midStageSleepLevelStartTime,
  v.finalSleepLevelStartTime,
  v.initialSleepLevel,
  v.midStageSleepLevel,
  v.finalSleepLevel,
  v.wakeupAlarmEnabled ? 1 : 0,
  v.wakeupAlarmLevel,
  v.wakeupAlarmLeadMinutes,
  v.preheatLeadMinutes,
  v.preWakeLevel ?? 10,
  v.preWakeLeadMinutes ?? 60,
  v.preWakeEnabled ? 1 : 0,
  v.offStages ?? 0,
];
const unpackValues = (t: ValuesTuple): ScheduleValues => ({
  bedTime: t[0],
  wakeupTime: t[1],
  midStageSleepLevelStartTime: t[2],
  finalSleepLevelStartTime: t[3],
  initialSleepLevel: t[4],
  midStageSleepLevel: t[5],
  finalSleepLevel: t[6],
  wakeupAlarmEnabled: t[7] === 1,
  wakeupAlarmLevel: t[8],
  wakeupAlarmLeadMinutes: t[9],
  preheatLeadMinutes: t[10],
  preWakeLevel: t[11] ?? 10,
  preWakeLeadMinutes: t[12] ?? 60,
  preWakeEnabled: t[13] === 1,
  offStages: t[14] ?? 0,
});

interface Packed extends Omit<DemoState, "prof" | "presets"> {
  prof: Partial<Record<ScheduleSide, [ValuesTuple, boolean, number, number | null] | null>>;
  presets?: [number, string, string, ValuesTuple][];
}

function pack(s: DemoState): string {
  const p: Packed = {
    ...s,
    prof: Object.fromEntries(
      Object.entries(s.prof).map(([k, v]) => [k, v ? [packValues(v), v.enabled, v.days, v.hold] : null]),
    ),
    presets: s.presets?.map((x) => [x.id, x.name, x.description, packValues(x.values)]),
  };
  return Buffer.from(JSON.stringify(p)).toString("base64url");
}

function unpack(raw: string): DemoState | null {
  try {
    const p = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Packed;
    if (!p?.pod?.left || !p.pod.right) return null;
    return {
      ...p,
      prof: Object.fromEntries(
        Object.entries(p.prof ?? {}).map(([k, v]) => [
          k,
          v ? { ...unpackValues(v[0]), enabled: v[1], days: v[2], hold: v[3] } : null,
        ]),
      ),
      presets: p.presets?.map(([id, name, description, values]) => ({ id, name, description, values: unpackValues(values) })),
      log: p.log ?? [],
    };
  } catch {
    return null;
  }
}

export function loadState(headers: Headers): DemoState {
  const raw = readCookie(headers.get("cookie"), DEMO_STATE_COOKIE);
  return (raw ? unpack(raw) : null) ?? freshState();
}

export function saveState(s: DemoState) {
  // keep the cookie small: only the newest changes are remembered
  s.log = s.log.slice(-12);
  let value = pack(s);
  while (value.length > 3600 && s.log.length > 0) {
    s.log = s.log.slice(1);
    value = pack(s);
  }
  cookies().set(DEMO_STATE_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: DEMO_MAX_AGE_SECONDS,
    path: "/",
  });
}

export function clearState() {
  cookies().set(DEMO_STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" });
}

// ---- reading the pretend pod ----

export const profileOf = (s: DemoState, side: ScheduleSide): DemoProfile | null => {
  const p = s.prof[side];
  return p === undefined ? DEFAULT_PROFILES[side] : p;
};

/** Where a side's level is now: it eases toward the target (or back to neutral when off). */
export function currentLevel(p: DemoPodSide, now = Date.now()) {
  const goal = p.on ? p.target : 0;
  const eased = goal + (p.from - goal) * Math.exp(-(now - p.at) / (9 * MIN));
  return Math.round(eased);
}

export function changeSide(s: DemoState, side: PodSide, change: { on?: boolean; level?: number }) {
  const cur = s.pod[side];
  s.pod[side] = {
    on: change.on ?? cur.on,
    target: change.level ?? cur.target,
    from: currentLevel(cur),
    at: Date.now(),
  };
}

export function logChange(s: DemoState, action: string, level: number | null = null, side: ScheduleSide | null = null, message: string | null = null) {
  s.log.push({ at: Date.now(), action, level, side, message });
}

/** The visitor's time zone (Vercel tells us from the IP), for schedule times. */
export function demoTimezone(headers: Headers) {
  const tz = headers.get("x-vercel-ip-timezone");
  try {
    if (tz) {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    }
  } catch {
    // unknown zone name
  }
  return "America/New_York";
}

/** Minutes the time zone is ahead of UTC right now. */
export function tzOffsetMinutes(tz: string, at = Date.now()) {
  const local = new Date(new Date(at).toLocaleString("en-US", { timeZone: tz }));
  const utc = new Date(new Date(at).toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((local.getTime() - utc.getTime()) / MIN);
}

export type CronStage = "preheat" | "initial" | "mid" | "final" | "prewake" | "alarm" | "off";

/** What the schedule asks for at a time of day (minutes since midnight). */
export function scheduledAt(values: ScheduleValues, minuteOfDay: number): { stage: CronStage; level: number | null } {
  const events = getScheduleEvents(values);
  const start = events[0]!.minutes;
  const rel = (m: number) => (m - start + 1440) % 1440;
  const now = rel(minuteOfDay);
  let current = events[0]!;
  for (const e of events) if (rel(e.minutes) <= now && rel(e.minutes) >= rel(current.minutes)) current = e;
  const stage: CronStage =
    current.key === "bed" ? "initial" : current.key === "preheat" ? "preheat" : current.key;
  return { stage, level: current.level };
}

/** When the next schedule stage starts (the end of a manual pause), or null. */
export function holdEnd(profile: DemoProfile | null, tz: string): number | null {
  if (!profile?.enabled) return null;
  const userNow = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const next = getNextEvent(profile, userNow);
  return next ? Date.now() + next.inMinutes * MIN : null;
}

/** A steady pseudo-random number in [0, 1) for a key, so the same night always looks the same. */
export function seeded(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}
