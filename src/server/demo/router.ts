import { TRPCError, type inferRouterInputs, type inferRouterOutputs } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { appRouter, type AppRouter } from "~/server/api/root";
import { type userTemperatureProfile } from "~/server/db/schema";
import { convertRawBedTempToDegrees } from "~/server/eight/user";
import { type ScheduleValues } from "~/lib/presets";
import { clearAuthCookieForDemo, setDemoCookie } from "~/server/demo/cookies";
import { DEMO_EMAIL } from "~/server/demo/session";
import { prefsOf } from "~/server/push";
import {
  DEFAULT_PRESETS,
  changeSide,
  clearState,
  currentLevel,
  demoTimezone,
  freshState,
  holdEnd,
  loadState,
  logChange,
  profileOf,
  saveState,
  scheduledAt,
  seeded,
  tzOffsetMinutes,
  type DemoProfile,
  type DemoState,
  type PodSide,
  type ScheduleSide,
} from "~/server/demo/data";

/**
 * Answers every app call for a demo session with pretend data. It never calls Eight Sleep or
 * WHOOP and never reads or writes the database. Typed against the real router, so a new
 * procedure there fails the build until the demo answers it too.
 */
type In = inferRouterInputs<AppRouter>;
type Out = inferRouterOutputs<AppRouter>;
interface Ctx {
  headers: Headers;
  state: DemoState;
  save: () => void;
}
type Handlers<R extends keyof Out> = {
  [P in keyof Out[R] & keyof In[R]]: (input: In[R][P], ctx: Ctx) => Out[R][P] | Promise<Out[R][P]>;
};

const MIN = 60_000;
const DAY = 86_400_000;
const SIDES = ["left", "right"] as const;
const notInDemo = (what: string) =>
  new TRPCError({ code: "FORBIDDEN", message: `${what} isn't available in the demo.` });

const tempF = (level: number) => {
  try {
    return Math.round(convertRawBedTempToDegrees(level, "f") * 10) / 10;
  } catch {
    return null;
  }
};

const hhmmss = (t: string) => `${t.slice(0, 5)}:00`;

type ProfileRow = typeof userTemperatureProfile.$inferSelect;
function profileRow(state: DemoState, side: ScheduleSide, tz: string): ProfileRow | null {
  const p = profileOf(state, side);
  if (!p) return null;
  return {
    email: DEMO_EMAIL,
    side,
    scheduleEnabled: p.enabled,
    manualHoldUntil: p.hold && p.hold > Date.now() ? new Date(p.hold) : null,
    bedTime: hhmmss(p.bedTime),
    wakeupTime: hhmmss(p.wakeupTime),
    initialSleepLevel: p.initialSleepLevel,
    midStageSleepLevel: p.midStageSleepLevel,
    midStageSleepLevelStartTime: hhmmss(p.midStageSleepLevelStartTime),
    finalSleepLevel: p.finalSleepLevel,
    finalSleepLevelStartTime: hhmmss(p.finalSleepLevelStartTime),
    wakeupAlarmEnabled: p.wakeupAlarmEnabled,
    wakeupAlarmLevel: p.wakeupAlarmLevel,
    wakeupAlarmLeadMinutes: p.wakeupAlarmLeadMinutes,
    preWakeEnabled: p.preWakeEnabled ?? false,
    preWakeLevel: p.preWakeLevel ?? 10,
    preWakeLeadMinutes: p.preWakeLeadMinutes ?? 60,
    preheatLeadMinutes: p.preheatLeadMinutes,
    offStages: p.offStages ?? 0,
    createdAt: new Date(state.started - 30 * DAY),
    updatedAt: new Date(state.started - 2 * DAY),
    timezoneTZ: tz,
    activeDays: p.days,
    weekendDays: p.wDays ?? 0,
    weekendBedTime: p.wBed ? hhmmss(p.wBed) : null,
    weekendWakeupTime: p.wWake ? hhmmss(p.wWake) : null,
  };
}

type ValuesIn = Omit<ScheduleValues, "preheatLeadMinutes"> & { preheatLeadMinutes?: number };
const valuesOf = (v: ValuesIn): ScheduleValues => ({
  bedTime: v.bedTime.slice(0, 5),
  wakeupTime: v.wakeupTime.slice(0, 5),
  midStageSleepLevelStartTime: v.midStageSleepLevelStartTime.slice(0, 5),
  finalSleepLevelStartTime: v.finalSleepLevelStartTime.slice(0, 5),
  initialSleepLevel: v.initialSleepLevel,
  midStageSleepLevel: v.midStageSleepLevel,
  finalSleepLevel: v.finalSleepLevel,
  wakeupAlarmEnabled: v.wakeupAlarmEnabled,
  wakeupAlarmLevel: v.wakeupAlarmLevel,
  wakeupAlarmLeadMinutes: v.wakeupAlarmLeadMinutes,
  preWakeEnabled: v.preWakeEnabled ?? false,
  preWakeLevel: v.preWakeLevel ?? 10,
  preWakeLeadMinutes: v.preWakeLeadMinutes ?? 60,
  preheatLeadMinutes: v.preheatLeadMinutes ?? 60,
  offStages: v.offStages,
});

function setProfile(state: DemoState, side: ScheduleSide, values: ValuesIn, days?: number) {
  const cur = profileOf(state, side);
  const next = valuesOf(values);
  state.prof[side] = {
    ...next,
    // left out = unchanged, like the real save
    offStages: next.offStages ?? cur?.offStages ?? 0,
    enabled: cur?.enabled ?? side !== "both",
    days: days ?? cur?.days ?? 127,
    hold: null,
    wDays: cur?.wDays,
    wBed: cur?.wBed,
    wWake: cur?.wWake,
  };
}

const presetsOf = (state: DemoState) => state.presets ?? DEFAULT_PRESETS;

function sideStatus(state: DemoState, side: PodSide) {
  const p = state.pod[side];
  const level = currentLevel(p);
  const f = tempF(level);
  return {
    isOn: p.on,
    isHeating: p.on,
    heatingLevel: level,
    targetHeatingLevel: p.target,
    temperatureF: f,
    temperatureC: f !== null ? Math.round((((f - 32) * 5) / 9) * 10) / 10 : null,
    side,
  };
}

const controlSides = (state: DemoState, side: "left" | "right" | "both" | undefined): PodSide[] =>
  side === "both" || (!side && state.whole) ? ["left", "right"] : [side ?? "left"];

/** Manual change: pause the schedule(s) it disagrees with until their next stage. */
function startHold(state: DemoState, sides: PodSide[], tz: string): Date | null {
  const whole = profileOf(state, "both");
  const targets: ScheduleSide[] = whole?.enabled ? ["both"] : sides;
  let until: number | null = null;
  for (const t of targets) {
    const p = profileOf(state, t);
    const end = holdEnd(p, tz);
    if (p && end) {
      state.prof[t] = { ...p, hold: end };
      until = end;
    }
  }
  return until ? new Date(until) : null;
}

/** The schedule each side follows (the whole-bed one when it's on). */
function followed(state: DemoState, side: PodSide): DemoProfile | null {
  const whole = profileOf(state, "both");
  if (whole?.enabled) return whole;
  const own = profileOf(state, side);
  return own?.enabled ? own : null;
}

type CronRow = Out["user"]["getCronHistory"][number];

/** Every 5-minute schedule check for the last few days, as the cron would have logged it. */
function cronRows(state: DemoState, days: number, tz: string): CronRow[] {
  const now = Date.now();
  const offset = tzOffsetMinutes(tz);
  const step = 5 * MIN;
  const last = Math.floor(now / step) * step;
  const first = Math.max(last - days * DAY, state.started - 7 * DAY);
  const rows: CronRow[] = [];
  let id = 1;
  for (const side of SIDES) {
    const profile = followed(state, side);
    let prev: { stage: string; level: number | null } | null = null;
    for (let t = first; t <= last; t += step) {
      const minuteOfDay = Math.floor((t / MIN + offset) % 1440 + 1440) % 1440;
      const want = profile ? scheduledAt(profile, minuteOfDay) : { stage: "off" as const, level: null };
      // during the demo visit the pod does what the visitor set, so the checks change nothing
      if (t > state.started) {
        const pod = state.pod[side];
        rows.push({ id: id++, ranAt: new Date(t + (side === "right" ? 1200 : 0)), stage: want.stage, action: "no_change", level: pod.on ? pod.target : null, message: null, source: "cron", podWasOn: pod.on, levelBefore: currentLevel(pod, t), targetBefore: pod.target, durationMs: 900, meta: null, side });
        continue;
      }
      const wasOn = prev ? prev.level !== null : false;
      const action =
        prev && prev.level !== want.level
          ? want.level === null
            ? "turned_off"
            : !wasOn
              ? "turned_on"
              : "set_level"
          : "no_change";
      rows.push({
        id: id++,
        ranAt: new Date(t + (side === "right" ? 1200 : 0) + Math.round(seeded(`${t}`) * 3000)),
        stage: want.stage,
        action,
        level: want.level,
        message: null,
        source: "cron",
        podWasOn: wasOn,
        levelBefore: prev?.level ?? null,
        targetBefore: prev?.level ?? null,
        durationMs: 700 + Math.round(seeded(`${t}${side}`) * 900),
        meta: null,
        side,
      });
      prev = want;
    }
  }
  // one manual nudge in the middle of last night, so the history shows what that looks like
  const nudge = last - ((((last / MIN + offset) % 1440) + 1440) % 1440) * MIN + 2.5 * 60 * MIN;
  if (nudge < state.started && nudge > first) {
    rows.push({ id: id++, ranAt: new Date(nudge), stage: "manual", action: "set_level", level: -20, message: null, source: "app", podWasOn: true, levelBefore: -10, targetBefore: -10, durationMs: null, meta: null, side: "right" });
  }
  for (const e of state.log) {
    rows.push({ id: id++, ranAt: new Date(e.at), stage: "manual", action: e.action, level: e.level, message: e.message, source: "app", podWasOn: null, levelBefore: null, targetBefore: null, durationMs: null, meta: null, side: e.side });
  }
  return rows.sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
}

/** A date in the visitor's zone at a wall-clock time, e.g. ("2026-10-25", 22.6) = 22:36. */
function zoned(day: string, hours: number, tz: string) {
  const [y = 2026, m = 1, d = 1] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d) + hours * 60 * MIN;
  return new Date(guess - tzOffsetMinutes(tz, guess) * MIN);
}
const dayKey = (t: number, tz: string) => new Date(t).toLocaleDateString("en-CA", { timeZone: tz });

/** One pretend night (the morning of `day`), the same every time for that day. */
function night(day: string) {
  const r = (k: string) => seeded(`${day}${k}`);
  const bed = 22.4 + r("bed") * 0.9; // ~22:25 – 23:20
  const inBed = (7.4 + r("len") * 1.1) * 3600;
  const awake = (18 + r("awake") * 30) * 60;
  const sleep = inBed - awake;
  const deep = sleep * (0.16 + r("deep") * 0.07);
  const rem = sleep * (0.2 + r("rem") * 0.06);
  return {
    bed,
    inBed,
    awake,
    sleep,
    deep,
    rem,
    light: sleep - deep - rem,
    score: Math.round(72 + r("score") * 22),
    hr: Math.round(52 + r("hr") * 8),
    hrv: Math.round(48 + r("hrv") * 30),
    breath: Math.round((13.5 + r("br") * 2.5) * 10) / 10,
    tosses: Math.round(8 + r("toss") * 18),
    recovery: Math.round(38 + r("rec") * 58),
    strain: Math.round((6 + r("strain") * 11) * 10) / 10,
  };
}

const userHandlers: Handlers<"user"> = {
  checkLoginState: () => ({ loginRequired: false }),
  login: () => {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Leave the demo first (Settings → Demo)." });
  },
  startDemo: (_input, ctx) => {
    setDemoCookie();
    ctx.state = freshState();
    ctx.save();
    return { success: true };
  },
  // no device token: the demo ends when the browser forgets the cookie
  refreshSession: () => ({ deviceToken: "" }),
  resumeSession: () => {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Device token invalid." });
  },
  logout: () => {
    clearAuthCookieForDemo();
    clearState();
    return { success: true };
  },

  getPodStatus: (input, { state }) => sideStatus(state, input?.side ?? "left"),
  setPodPower: (input, ctx) => {
    const sides = controlSides(ctx.state, input.side);
    for (const s of sides) changeSide(ctx.state, s, { on: input.isOn });
    const side = sides.length === 2 ? "both" : sides[0]!;
    logChange(ctx.state, input.isOn ? "turned_on" : "turned_off", null, side);
    const holdUntil = startHold(ctx.state, sides, (ctx.state.tz ?? demoTimezone(ctx.headers)));
    if (holdUntil) logChange(ctx.state, "hold_started", null, side, holdUntil.toISOString());
    ctx.save();
    return { success: true, isOn: input.isOn, holdUntil };
  },
  setPodTargetLevel: (input, ctx) => {
    const sides = controlSides(ctx.state, input.side);
    for (const s of sides) changeSide(ctx.state, s, { on: input.turnOn, level: input.level });
    const side = sides.length === 2 ? "both" : sides[0]!;
    logChange(ctx.state, input.turnOn ? "turned_on" : "set_level", input.level, side);
    const holdUntil = startHold(ctx.state, sides, (ctx.state.tz ?? demoTimezone(ctx.headers)));
    if (holdUntil) logChange(ctx.state, "hold_started", null, side, holdUntil.toISOString());
    ctx.save();
    return { success: true, level: input.level, holdUntil };
  },

  getUserTemperatureProfile: (input, ctx) => profileRow(ctx.state, input.side, (ctx.state.tz ?? demoTimezone(ctx.headers))),
  updateUserTemperatureProfile: (input, ctx) => {
    // setProfile keeps only the schedule fields
    const { side, activeDays } = input;
    setProfile(ctx.state, side, input, activeDays);
    logChange(ctx.state, "schedule_saved", null, side);
    ctx.save();
    return { success: true };
  },
  deleteUserTemperatureProfile: (input, ctx) => {
    if (!profileOf(ctx.state, input.side)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Temperature profile not found for this user." });
    }
    ctx.state.prof[input.side] = null;
    logChange(ctx.state, "schedule_cleared", null, input.side);
    ctx.save();
    return { success: true, message: "User temperature profile deleted successfully" };
  },

  listPresets: (_input, { state }) => presetsOf(state),
  createPreset: (input, ctx) => {
    const list = presetsOf(ctx.state);
    if (list.length >= 4) throw new TRPCError({ code: "BAD_REQUEST", message: "The demo keeps up to 4 presets." });
    const id = Math.max(0, ...list.map((p) => p.id)) + 1;
    ctx.state.presets = [...list, { id, name: input.name, description: input.description ?? "", values: valuesOf(input.values) }];
    logChange(ctx.state, "preset_created", null, null, input.name);
    ctx.save();
    return { id };
  },
  updatePreset: (input, ctx) => {
    const list = presetsOf(ctx.state);
    const p = list.find((x) => x.id === input.id);
    if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Preset not found." });
    ctx.state.presets = list.map((x) =>
      x.id === input.id
        ? { ...x, name: input.name ?? x.name, description: input.description ?? x.description, values: input.values ? valuesOf(input.values) : x.values }
        : x,
    );
    logChange(ctx.state, "preset_updated", null, null, input.name ?? p.name);
    ctx.save();
    return { success: true };
  },
  deletePreset: (input, ctx) => {
    const list = presetsOf(ctx.state);
    ctx.state.presets = list.filter((x) => x.id !== input.id);
    logChange(ctx.state, "preset_deleted", null, null, list.find((x) => x.id === input.id)?.name ?? null);
    ctx.save();
    return { success: true };
  },
  applyPreset: (input, ctx) => {
    const preset = presetsOf(ctx.state).find((p) => p.id === input.id);
    if (!preset) throw new TRPCError({ code: "NOT_FOUND", message: "Preset not found." });
    setProfile(ctx.state, input.side, preset.values);
    logChange(ctx.state, "preset_applied", null, input.side, preset.name);
    ctx.save();
    return { success: true, name: preset.name };
  },

  getAccount: (_input, ctx) => {
    const { state } = ctx;
    const zone = state.tz ?? demoTimezone(ctx.headers);
    const now = Date.now();
    const lastRun = new Date(Math.floor(now / (5 * MIN)) * 5 * MIN + 1500);
    const sides = Object.fromEntries(
      (["left", "right", "both"] as const).map((side) => {
        const p = profileOf(state, side);
        return [side, { hasSchedule: !!p, scheduleEnabled: !!p?.enabled || (side !== "both" && !p), manualHoldUntil: p?.hold && p.hold > now ? new Date(p.hold) : null, timezone: p ? zone : null }];
      }),
    ) as Out["user"]["getAccount"]["sides"];
    return {
      demo: true,
      lastLoggedCronAt: lastRun,
      email: DEMO_EMAIL,
      eightUserId: "demo-0000",
      eightTokenExpiresAt: new Date(now + 6 * 60 * MIN),
      vacationMode: state.vac,
      vacationUntil: state.vacUntil ? new Date(state.vacUntil) : null,
      lastCronRunAt: lastRun,
      sides,
      eightBackoffUntil: null,
      authError: false,
      wholeBed: state.whole,
      memberSince: new Date(state.started - 90 * DAY),
      isOwner: false,
      pendingRequests: 0,
      // the demo shows the plain app name
      displayName: null,
    };
  },
  setScheduleTimezone: (input, ctx) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That time zone isn't known." });
    }
    ctx.state.tz = input.timezone;
    logChange(ctx.state, "timezone_set", null, null, input.timezone);
    ctx.save();
    return { success: true, timezone: input.timezone };
  },
  setVacationMode: (input, ctx) => {
    ctx.state.vac = input.enabled;
    ctx.state.vacUntil = input.enabled && input.until ? input.until.getTime() : null;
    if (input.enabled) for (const s of SIDES) changeSide(ctx.state, s, { on: false });
    logChange(ctx.state, input.enabled ? "vacation_on" : "vacation_off");
    ctx.save();
    return { success: true, awaySynced: true, awayError: null };
  },
  setEightAwayMode: (input, ctx) => {
    logChange(ctx.state, input.on ? "eight_away_on" : "eight_away_off");
    ctx.save();
    return { success: true };
  },
  getAppConfig: (_input, ctx) => {
    const host = ctx.headers.get("x-forwarded-host") ?? ctx.headers.get("host") ?? "localhost:3000";
    return {
      cronUrl: `https://${host}/api/temperatureCron`,
      cronSecret: "hidden-in-demo",
      cronHeaderName: "Authorization",
      cronHeaderValue: "Bearer hidden-in-demo",
      cronIntervalHint: "Every 5 minutes",
      approvedEmails: [DEMO_EMAIL],
    };
  },

  setScheduleEnabled: (input, ctx) => {
    const p = profileOf(ctx.state, input.side);
    if (p) ctx.state.prof[input.side] = { ...p, enabled: input.enabled, hold: null };
    logChange(ctx.state, input.enabled ? "schedule_on" : "schedule_off", null, input.side);
    ctx.save();
    return { success: true };
  },
  resumeSchedule: (input, ctx) => {
    for (const side of input?.side ? [input.side] : (["left", "right", "both"] as const)) {
      const p = profileOf(ctx.state, side);
      if (p?.hold) ctx.state.prof[side] = { ...p, hold: null };
    }
    logChange(ctx.state, "hold_ended", null, input?.side ?? null);
    ctx.save();
    return { success: true };
  },

  getCronHistory: (input, ctx) => cronRows(ctx.state, input?.days ?? 3, (ctx.state.tz ?? demoTimezone(ctx.headers))),
  getLogDiagnostics: (_input, ctx) => ({
    signedInAs: DEMO_EMAIL,
    accountFound: true,
    hasSchedule: true,
    lastCronRunAt: new Date(Math.floor(Date.now() / (5 * MIN)) * 5 * MIN),
    latestEntry: { ranAt: new Date(), source: "cron", action: "no_change" },
    rowsBySource: [
      { who: "you", source: "cron", rows: cronRows(ctx.state, 3, (ctx.state.tz ?? demoTimezone(ctx.headers))).length },
      { who: "you", source: "app", rows: ctx.state.log.length },
    ],
    serverTime: new Date().toISOString(),
    dbTime: new Date().toISOString(),
  }),

  getSleepData: (input) => {
    const days = [];
    for (let i = (input.days ?? 7) - 1; i >= 0; i--) {
      const day = dayKey(Date.now() - i * DAY, input.timezone);
      const n = night(day);
      const prevDay = dayKey(Date.now() - (i + 1) * DAY, input.timezone);
      const start = zoned(prevDay, n.bed, input.timezone);
      days.push({
        day,
        score: n.score,
        sleepSeconds: Math.round(n.sleep),
        inBedSeconds: Math.round(n.inBed),
        lightSeconds: Math.round(n.light),
        deepSeconds: Math.round(n.deep),
        remSeconds: Math.round(n.rem),
        presenceStart: start.toISOString(),
        presenceEnd: new Date(start.getTime() + n.inBed * 1000).toISOString(),
        heartRate: n.hr,
        hrv: n.hrv,
        breathRate: n.breath,
        bedTempC: 26 + Math.round(seeded(`${day}bt`) * 30) / 10,
        roomTempC: 20 + Math.round(seeded(`${day}rt`) * 25) / 10,
        tossAndTurns: n.tosses,
        processing: false,
      });
    }
    return {
      available: true as const,
      days,
      debug: { trendsDays: days.length, trendsDayKeys: days.map((d) => d.day), trendsError: null, intervals: 0, intervalKeys: [], intervalsError: null, source: "trends" as const },
    };
  },

  getPodHealth: (_input, { state }) => {
    const now = Date.now();
    const priming = !!state.primedAt && now - state.primedAt < 10 * MIN;
    return {
      deviceId: "demo-pod",
      side: "left",
      online: true,
      lastSeen: new Date(now - 40_000).toISOString(),
      needsPriming: false,
      priming,
      hasWater: true,
      lastPrime: new Date(state.primedAt ?? now - 3 * DAY - 5 * 60 * MIN).toISOString(),
      ledBrightnessLevel: state.led,
      firmwareVersion: "2.6.31.0 (demo)",
      features: ["cooling", "heating", "elevation", "alarms"],
      wifiStrength: 78,
      wifiSsid: "Demo Wi-Fi",
      sides: SIDES.map((side) => {
        const p = state.pod[side];
        return { side, level: currentLevel(p), target: p.target, active: p.on, isYou: side === "left", tempF: tempF(currentLevel(p)), targetTempF: tempF(p.target) };
      }),
      priorityReading: null,
      leftUserId: "demo-0000",
      rightUserId: "demo-0001",
      isAway: state.vac,
    };
  },
  primePod: (_input, ctx) => {
    ctx.state.primedAt = Date.now();
    logChange(ctx.state, "priming_started");
    ctx.save();
    return { success: true };
  },
  setLedBrightness: (input, ctx) => {
    ctx.state.led = input.level;
    logChange(ctx.state, "led_set", null, null, `${input.level}%`);
    ctx.save();
    return { success: true };
  },
  getQuickModes: (_input, { state }) => ({
    nap: { supported: true, active: state.nap },
    hotFlash: { supported: true, active: state.hot },
  }),
  setQuickMode: (input, ctx) => {
    const on = input.action !== "deactivate";
    if (input.mode === "nap-mode") ctx.state.nap = on;
    else ctx.state.hot = on;
    logChange(ctx.state, `${input.mode === "nap-mode" ? "nap" : "hot_flash"}_${input.action}`);
    ctx.save();
    return { success: true };
  },

  getBedMode: (_input, { state }) => ({ side: "left", wholeBed: state.whole, solo: false, homeSide: "left", otherSaved: true }),
  setWholeBed: (input, ctx) => {
    ctx.state.whole = input.enabled;
    if (input.enabled) {
      const mine = ctx.state.pod.left;
      changeSide(ctx.state, "right", mine.on ? { on: true, level: mine.target } : { on: false });
    }
    logChange(ctx.state, input.enabled ? "whole_bed_on" : "whole_bed_off", null, null, input.enabled ? "both" : null);
    ctx.save();
    return { success: true, note: null };
  },
  restoreOtherAccount: () => ({ ok: true, log: ["demo: nothing to restore"] }),
  getGuestSide: () => ({
    supported: true,
    side: "right",
    guestId: "demo-0001",
    kind: "account",
    on: null,
    level: null,
    host: null,
  }),
  setGuestSide: () => {
    throw notInDemo("The guest side");
  },
  getCapabilities: () => [
    { key: "sleep", label: "Sleep data & trends", state: "available" },
    { key: "away", label: "Away mode", state: "available" },
    { key: "nap", label: "Nap mode", state: "available" },
    { key: "hotflash", label: "Hot-flash mode", state: "available" },
    { key: "alarms", label: "Native vibration alarms", state: "subscription" },
    { key: "autopilot", label: "Autopilot", state: "subscription" },
    { key: "base", label: "Adjustable base", state: "unsupported" },
    { key: "speaker", label: "Pod speaker", state: "unsupported" },
  ],
  setDisplayName: () => ({ success: true }),
  // invites are the owner's; the demo never sees them
  getInvites: () => ({ invites: [], requests: [] }),
  addInvite: () => {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not in the demo." });
  },
  removeInvite: () => {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not in the demo." });
  },
  answerRequest: () => {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not in the demo." });
  },
  // the demo has no account to delete; it just ends the visit's data
  deleteAccount: () => ({ success: true }),
  runCronNow: (_input, { state }) => ({
    success: true,
    ranAt: new Date(),
    mine: SIDES.map((side) => ({ email: DEMO_EMAIL, side, stage: "off" as const, action: "no_change" as const, level: state.pod[side].on ? state.pod[side].target : null, message: "demo", logged: false })),
  }),
};

const whoopHandlers: Handlers<"whoop"> = {
  getStatus: (_input, ctx) => {
    const host = ctx.headers.get("x-forwarded-host") ?? ctx.headers.get("host") ?? "localhost:3000";
    return {
      configured: true,
      redirectUrl: `https://${host}/api/whoop/callback`,
      webhookUrl: `https://${host}/api/whoop/webhook`,
      clientId: null,
      connected: true,
      connectedAt: new Date(ctx.state.started - 40 * DAY),
      lastSyncAt: new Date(Date.now() - 12 * MIN),
      lastWebhookAt: new Date(Date.now() - 3 * 60 * MIN),
    };
  },
  saveSetup: () => {
    throw notInDemo("WHOOP setup");
  },
  getExtras: (_input, ctx) => {
    const tz = (ctx.state.tz ?? demoTimezone(ctx.headers));
    const cycles = [];
    const workouts = [];
    for (let i = 0; i < 14; i++) {
      const day = dayKey(Date.now() - i * DAY, tz);
      const n = night(day);
      const start = zoned(day, 6.8, tz);
      cycles.push({
        id: 1000 + i,
        start: start.toISOString(),
        end: i === 0 ? null : new Date(start.getTime() + DAY).toISOString(),
        score_state: "SCORED",
        score: { strain: n.strain, kilojoule: Math.round(7600 + n.strain * 420), average_heart_rate: 64 + Math.round(n.strain), max_heart_rate: 128 + Math.round(n.strain * 3) },
      });
      if (seeded(`${day}w`) > 0.55) {
        const ws = zoned(day, 17.5 + seeded(`${day}wt`) * 2, tz);
        const sports = ["running", "cycling", "functional-fitness", "walking", "yoga"];
        workouts.push({
          id: `w${i}`,
          start: ws.toISOString(),
          end: new Date(ws.getTime() + (30 + seeded(`${day}wl`) * 45) * MIN).toISOString(),
          sport_name: sports[Math.floor(seeded(`${day}ws`) * sports.length)],
          score_state: "SCORED",
          score: { strain: Math.round((7 + seeded(`${day}wx`) * 8) * 10) / 10, kilojoule: Math.round(1300 + seeded(`${day}wk`) * 1600), average_heart_rate: Math.round(118 + seeded(`${day}wh`) * 30) },
        });
      }
    }
    return {
      cycles,
      workouts,
      body: { height_meter: 1.78, weight_kilogram: 76.4, max_heart_rate: 189 },
      profile: { first_name: "Demo", last_name: "Sleeper" },
    };
  },
  revealSecret: () => {
    throw notInDemo("The WHOOP secret");
  },
  sync: () => ({ count: 14 }),
  disconnect: () => {
    throw notInDemo("Disconnecting WHOOP");
  },
  getNights: (input, ctx) => {
    const tz = (ctx.state.tz ?? demoTimezone(ctx.headers));
    const out = [];
    for (let i = 0; i < (input?.days ?? 14); i++) {
      const day = dayKey(Date.now() - i * DAY, tz);
      const n = night(day);
      const start = zoned(dayKey(Date.now() - (i + 1) * DAY, tz), n.bed + 0.05, tz);
      const end = new Date(start.getTime() + n.inBed * 1000);
      if (end.getTime() > Date.now()) continue;
      const ms = (s: number) => Math.round(s * 1000);
      out.push({
        id: `demo-${day}`,
        start,
        end,
        nap: false,
        sleep: {
          score_state: "SCORED",
          score: {
            stage_summary: {
              total_in_bed_time_milli: ms(n.inBed),
              total_awake_time_milli: ms(n.awake),
              total_light_sleep_time_milli: ms(n.light),
              total_slow_wave_sleep_time_milli: ms(n.deep),
              total_rem_sleep_time_milli: ms(n.rem),
              sleep_cycle_count: 4 + Math.round(seeded(`${day}c`) * 2),
              disturbance_count: 6 + Math.round(seeded(`${day}d`) * 8),
            },
            sleep_needed: {
              baseline_milli: ms(7.6 * 3600),
              need_from_sleep_debt_milli: ms(seeded(`${day}debt`) * 1800),
              need_from_recent_strain_milli: ms(seeded(`${day}st`) * 1200),
              need_from_recent_nap_milli: 0,
            },
            respiratory_rate: n.breath,
            sleep_performance_percentage: Math.min(100, n.score + 3),
            sleep_consistency_percentage: Math.round(70 + seeded(`${day}cons`) * 25),
            sleep_efficiency_percentage: Math.round((n.sleep / n.inBed) * 1000) / 10,
          },
        },
        recovery: {
          score_state: "SCORED",
          score: {
            recovery_score: n.recovery,
            resting_heart_rate: n.hr,
            hrv_rmssd_milli: n.hrv,
            spo2_percentage: Math.round((95 + seeded(`${day}o2`) * 3) * 10) / 10,
            skin_temp_celsius: Math.round((33.4 + seeded(`${day}sk`) * 1.2) * 10) / 10,
          },
        },
      });
    }
    return out;
  },
};

const funHandlers: Handlers<"fun"> = {
  getExtras: (_input, { state }) => ({
    hot: state.hotUntil && state.hotUntil > Date.now() ? { until: new Date(state.hotUntil), side: "left" } : null,
    nap: state.napUntil && state.napUntil > Date.now() ? { until: new Date(state.napUntil), side: "left" } : null,
    accent: (state.accent ?? "classic") as Out["fun"]["getExtras"]["accent"],
    hasHome: state.home ?? false,
    weatherEnabled: state.weather ?? false,
    // a warm pretend night, so the weather card has something to say
    weather: state.weather && state.home
      ? { fetchedAt: new Date().toISOString(), evening: 26, warmest: 27.5, humidity: 70, hot: true }
      : null,
    travelEnabled: state.travel ?? true,
    notify: prefsOf(null),
    phones: 0,
  }),
  // pretend weather for the sky behind the 3D bed: a mild, partly cloudy day (the demo never calls a weather service)
  getSky: (_input, ctx) => {
    const tz = ctx.state.tz ?? demoTimezone(ctx.headers);
    const days = [-1, 0, 1].map((o) => dayKey(Date.now() + o * DAY, tz));
    return {
      fetchedAt: new Date().toISOString(),
      tempC: 21,
      code: 2,
      lowC: 14,
      rainPct: 10,
      rise: days.map((d) => new Date(zoned(d, 6.75, tz)).toISOString()),
      set: days.map((d) => new Date(zoned(d, 19.5, tz)).toISOString()),
      humidity: 64,
      // 9 pm … 7 am around tonight, pretend numbers
      hours: [21, 23, 25, 27, 29, 31].map((h, i) => ({ at: new Date(zoned(days[1]!, h, tz)).toISOString(), tempC: [18, 17, 15, 14, 14, 15][i]!, code: [2, 2, 1, 1, 3, 2][i]! })),
      tomorrow: { hiC: 24, loC: 14, code: 1 },
    };
  },
  imHot: (input, ctx) => {
    if (ctx.state.hotUntil && ctx.state.hotUntil > Date.now()) return { level: null as number | null, until: new Date(ctx.state.hotUntil), already: true };
    const side: PodSide = input.side === "right" ? "right" : "left";
    const level = Math.max(-100, ctx.state.pod[side].target - 40);
    const targets: PodSide[] = input.side === "both" ? [...SIDES] : [side];
    ctx.state.hotPrev = Object.fromEntries(targets.map((s) => [s, { on: ctx.state.pod[s].on, level: ctx.state.pod[s].target }]));
    for (const s of targets) changeSide(ctx.state, s, { on: true, level });
    ctx.state.hotUntil = Date.now() + 20 * MIN;
    logChange(ctx.state, "im_hot", level, input.side ?? "left", new Date(ctx.state.hotUntil).toISOString());
    ctx.save();
    return { level: level as number | null, until: new Date(ctx.state.hotUntil), already: false };
  },
  stopHot: (_input, ctx) => {
    for (const [s, p] of Object.entries(ctx.state.hotPrev ?? {})) changeSide(ctx.state, s as PodSide, p.on ? { on: true, level: p.level } : { on: false });
    ctx.state.hotUntil = null;
    ctx.state.hotPrev = undefined;
    logChange(ctx.state, "hot_ended");
    ctx.save();
    return { success: true };
  },
  startNap: (input, ctx) => {
    const napSides: PodSide[] = input.side === "both" ? [...SIDES] : [input.side === "right" ? "right" : "left"];
    for (const s of napSides) changeSide(ctx.state, s, { on: true, level: input.level });
    ctx.state.napUntil = Date.now() + input.minutes * MIN;
    logChange(ctx.state, "nap_started", input.level, input.side ?? "left", String(input.minutes));
    ctx.save();
    return { until: new Date(ctx.state.napUntil) };
  },
  stopNap: (_input, ctx) => {
    ctx.state.napUntil = null;
    logChange(ctx.state, "nap_ended");
    ctx.save();
    return { success: true };
  },
  setAccent: (input, ctx) => {
    ctx.state.accent = input.accent;
    ctx.save();
    return { success: true };
  },
  setHome: (input, ctx) => {
    ctx.state.home = !!input;
    if (!input) {
      ctx.state.weather = false;
      ctx.state.travel = false;
    }
    ctx.save();
    return { success: true };
  },
  setWeather: (input, ctx) => {
    ctx.state.weather = input.enabled;
    ctx.save();
    return { success: true };
  },
  setTravel: (input, ctx) => {
    ctx.state.travel = input.enabled;
    ctx.save();
    return { success: true };
  },
  // the demo is always at home
  checkTravel: (_input, { state }) => ({ away: false, km: state.travel ? 0 : null, vacation: state.vac }),
  getNightLevels: (input) => {
    const out: Out["fun"]["getNightLevels"] = [];
    for (let i = 1; i <= (input.days ?? 60); i++) {
      const evening = dayKey(Date.now() - i * DAY, input.timezone);
      const morning = dayKey(Date.now() - (i - 1) * DAY, input.timezone);
      // colder nights line up with more deep sleep in the pretend WHOOP data
      const deep = seeded(`${morning}deep`);
      const r = (k: string) => seeded(`${evening}${k}`);
      const avg = Math.round(-(1 + deep * 4) * 10 + (r("n") - 0.5) * 6);
      const skipped = r("skip") < 0.08;
      for (const side of SIDES) {
        out.push({
          night: evening,
          side,
          avgLevel: skipped ? null : side === "left" ? avg : Math.round(avg / 3 + 10),
          minLevel: skipped ? null : (side === "left" ? avg : Math.round(avg / 3 + 10)) - 10,
          maxLevel: skipped ? null : 30,
          onMinutes: skipped ? 0 : 480 + Math.round(r("len") * 60),
          manualChanges: r("man") < 0.2 ? 1 : 0,
          scheduleRan: !skipped,
          firstOn: skipped ? null : zoned(evening, 21.5 + r("on"), input.timezone),
          // falling asleep a step or two colder than deep sleep, late sleep warmer
          stageLevels: skipped
            ? null
            : {
                initial: Math.round((avg - 10 - Math.round(r("i") * 2) * 10) / 10) * 10,
                mid: Math.round(avg / 10) * 10,
                final: Math.round((avg + 10 + Math.round(r("f") * 2) * 10) / 10) * 10,
              },
        });
      }
    }
    return out;
  },
  getBothSidesSleep: (input) => {
    const mine = [];
    const theirs = [];
    for (let i = 6; i >= 0; i--) {
      const day = dayKey(Date.now() - i * DAY, input.timezone);
      const n = night(day);
      mine.push({ day, score: n.score, sleepSeconds: Math.round(n.sleep) });
      const o = night(`${day}r`);
      theirs.push({ day, score: o.score, sleepSeconds: Math.round(o.sleep) });
    }
    return { own: "left" as const, mine, theirs };
  },
  getPushKey: () => ({ key: "" }),
  subscribePush: () => {
    throw notInDemo("Phone notifications");
  },
  unsubscribePush: () => ({ success: true }),
  setNotify: (input) => ({ ...prefsOf(null), [input.kind]: input.enabled }),
  testPush: () => {
    throw notInDemo("Phone notifications");
  },
};

const moreHandlers: Handlers<"more"> = {
  setWeekend: (input, ctx) => {
    const p = profileOf(ctx.state, input.side);
    if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Save a schedule for this side first." });
    const on = input.days > 0 && !!input.bedTime && !!input.wakeupTime;
    ctx.state.prof[input.side] = { ...p, wDays: on ? input.days : 0, wBed: on ? input.bedTime : null, wWake: on ? input.wakeupTime : null };
    logChange(ctx.state, on ? "weekend_on" : "weekend_off", null, input.side);
    ctx.save();
    return { success: true };
  },
  // a warm pretend bedroom last night
  getRoom: (_input, ctx) => ({
    enabled: ctx.state.room ?? false,
    threshold: ctx.state.roomC ?? 26.5,
    lastC: 27.4,
    lastAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  }),
  setRoom: (input, ctx) => {
    ctx.state.room = input.enabled;
    ctx.state.roomC = input.threshold;
    ctx.save();
    return { success: true };
  },
  sendFeedback: (input, ctx) => {
    ctx.state.fb = [{ kind: input.kind, text: input.text.slice(0, 140), at: Date.now() }, ...(ctx.state.fb ?? [])].slice(0, 3);
    ctx.save();
    return { success: true };
  },
  myFeedback: (_input, ctx) => [
    ...(ctx.state.fb ?? []).map((f, i) => ({ id: 1000 + i, kind: f.kind, text: f.text, status: "new", createdAt: new Date(f.at), reply: null, repliedAt: null })),
    {
      id: 2,
      kind: "bug",
      text: "In settings my temp is set to C, but in nightstand it reads F.",
      status: "fixed",
      createdAt: new Date(Date.now() - 2 * DAY),
      reply: "Thanks for catching that! The nightstand follows your °F / °C setting now.",
      repliedAt: new Date(Date.now() - 1.5 * DAY),
    },
    { id: 1, kind: "idea", text: "Auto-tune without WHOOP would be great.", status: "fixed", createdAt: new Date(Date.now() - 3 * DAY), reply: null, repliedAt: null },
  ],
  listFeedback: () => {
    throw notInDemo("The owner's pages");
  },
  setFeedbackStatus: () => {
    throw notInDemo("The owner's pages");
  },
  replyFeedback: () => {
    throw notInDemo("The owner's pages");
  },
  getUsage: () => {
    throw notInDemo("The owner's pages");
  },
  getMailSetup: () => {
    throw notInDemo("The owner's pages");
  },
  saveMailSetup: () => {
    throw notInDemo("Approval emails");
  },
  removeMailSetup: () => {
    throw notInDemo("Approval emails");
  },
  // what a typical Eight Sleep app schedule looks like
  getEightSchedule: () => ({
    available: true as const,
    bedTime: "23:00",
    wakeupTime: "07:00",
    levels: { initial: -20, mid: -40, final: -10 },
    eightScheduleOn: true,
  }),
};

// the demo records nothing: visits and taps are simply accepted
const statsHandlers: Handlers<"stats"> = {
  heartbeat: () => ({ ok: true }),
  track: () => ({ ok: true }),
  todayCount: () => ({ n: 2 }),
  getStats: () => {
    throw notInDemo("The owner's pages");
  },
  getPerson: () => {
    throw notInDemo("The owner's pages");
  },
  messagePerson: () => {
    throw notInDemo("Messaging people");
  },
};

/** Builds a router with the real one's procedure names, kinds and input checks, answered by `handlers`. */
function mirror<R extends "user" | "whoop" | "fun" | "more" | "stats">(name: R, handlers: Handlers<R>) {
  const record: Record<string, unknown> = {};
  const procedures = appRouter._def.procedures as unknown as Record<string, { _def: { type: string; inputs: unknown[] } }>;
  for (const [key, handler] of Object.entries(handlers) as [string, (input: unknown, ctx: Ctx) => unknown][]) {
    const real = procedures[`${name}.${key}`];
    if (!real) continue;
    // reuse the real input checks (and their defaults)
    let builder = publicProcedure as unknown as { input: (p: unknown) => typeof builder; query: (r: unknown) => unknown; mutation: (r: unknown) => unknown };
    for (const parser of real._def.inputs) builder = builder.input(parser);
    const resolve = async ({ input, ctx }: { input: unknown; ctx: { headers: Headers } }) => {
      const c: Ctx = { headers: ctx.headers, state: loadState(ctx.headers), save: () => saveState(c.state) };
      return handler(input, c);
    };
    record[key] = real._def.type === "mutation" ? builder.mutation(resolve) : builder.query(resolve);
  }
  return record;
}

export const demoRouter = createTRPCRouter({
  user: createTRPCRouter(mirror("user", userHandlers) as Parameters<typeof createTRPCRouter>[0]),
  whoop: createTRPCRouter(mirror("whoop", whoopHandlers) as Parameters<typeof createTRPCRouter>[0]),
  fun: createTRPCRouter(mirror("fun", funHandlers) as Parameters<typeof createTRPCRouter>[0]),
  more: createTRPCRouter(mirror("more", moreHandlers) as Parameters<typeof createTRPCRouter>[0]),
  stats: createTRPCRouter(mirror("stats", statsHandlers) as Parameters<typeof createTRPCRouter>[0]),
});
