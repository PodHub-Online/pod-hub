// Extra Eight Sleep endpoints (sleep data, pod health, away/nap/hot-flash modes,
// capability probing). The API is unofficial, so responses are parsed leniently.
import { z } from "zod";
import { type Token } from "./types";
import { APP_API_URL, CLIENT_API_URL, DEFAULT_API_HEADERS } from "./constants";
import { fetchWithAuth, setHeatingLevel, turnOffSide, turnOnSide } from "./eight";
import { convertRawBedTempToDegrees, getUserProfile } from "./user";

const anyJson = z.unknown();

type Json = Record<string, unknown>;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Json)) return (acc as Json)[key];
    return undefined;
  }, obj);
}

function num(obj: unknown, ...paths: string[]): number | null {
  for (const path of paths) {
    const v = get(obj, path);
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function str(obj: unknown, ...paths: string[]): string | null {
  for (const path of paths) {
    const v = get(obj, path);
    if (typeof v === "string") return v;
  }
  return null;
}

function bool(obj: unknown, ...paths: string[]): boolean | null {
  for (const path of paths) {
    const v = get(obj, path);
    if (typeof v === "boolean") return v;
  }
  return null;
}

/** Raw request that reports the HTTP status instead of throwing. */
async function requestStatus(url: string, token: Token, init: RequestInit = {}): Promise<number> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { ...DEFAULT_API_HEADERS, ...init.headers, authorization: `Bearer ${token.eightAccessToken}` },
    });
    return response.status;
  } catch {
    return 0;
  }
}

/** fetchWithAuth throws "API request failed: <status>" */
export function statusFromError(error: unknown): number | null {
  const match = error instanceof Error ? /API request failed: (\d{3})/.exec(error.message) : null;
  return match ? Number(match[1]) : null;
}

const clampLevel = (level: number) => Math.max(-100, Math.min(100, Math.round(level)));

// ---------- Sleep data ----------

export interface SleepDay {
  day: string;
  score: number | null;
  sleepSeconds: number | null;
  inBedSeconds: number | null;
  lightSeconds: number | null;
  deepSeconds: number | null;
  remSeconds: number | null;
  presenceStart: string | null;
  presenceEnd: string | null;
  heartRate: number | null;
  hrv: number | null;
  breathRate: number | null;
  bedTempC: number | null;
  roomTempC: number | null;
  tossAndTurns: number | null;
  processing: boolean;
}

export interface SleepDebug {
  trendsDays: number;
  trendsDayKeys: string[];
  trendsError: string | null;
  intervals: number;
  intervalKeys: string[];
  intervalsError: string | null;
  source: "trends" | "intervals" | "both" | "none";
}

type Stage = { stage?: unknown; duration?: unknown };

/** Sum stage durations from a `stages: [{stage, duration}]` array (sessions/intervals) */
function stageTotals(stages: unknown) {
  const t = { light: 0, deep: 0, rem: 0, awake: 0, out: 0 };
  if (!Array.isArray(stages)) return null;
  for (const s of stages as Stage[]) {
    const name = typeof s.stage === "string" ? s.stage : "";
    const dur = typeof s.duration === "number" ? s.duration : 0;
    if (name in t) t[name as keyof typeof t] += dur;
  }
  return t;
}

/** Average of a `[[timestamp, value], ...]` series */
function seriesAvg(series: unknown): number | null {
  if (!Array.isArray(series) || series.length === 0) return null;
  const values = (series as unknown[])
    .map((p): unknown => (Array.isArray(p) ? (p as unknown[])[1] : null))
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function seriesLast(series: unknown): number | null {
  if (!Array.isArray(series) || series.length === 0) return null;
  const last = series[series.length - 1] as unknown;
  return Array.isArray(last) && typeof last[1] === "number" ? last[1] : null;
}

function localDay(iso: string, timezone: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: timezone });
}

function emptyDay(day: string): SleepDay {
  return {
    day,
    score: null,
    sleepSeconds: null,
    inBedSeconds: null,
    lightSeconds: null,
    deepSeconds: null,
    remSeconds: null,
    presenceStart: null,
    presenceEnd: null,
    heartRate: null,
    hrv: null,
    breathRate: null,
    bedTempC: null,
    roomTempC: null,
    tossAndTurns: null,
    processing: false,
  };
}

function parseTrendDay(d: unknown): SleepDay {
  // Durations may sit on the day or only inside its sessions
  const sessions = (get(d, "sessions") as unknown[] | undefined) ?? [];
  const fromSessions = sessions.reduce<{ light: number; deep: number; rem: number } | null>((acc, s) => {
    const t = stageTotals(get(s, "stages"));
    if (!t) return acc;
    const a = acc ?? { light: 0, deep: 0, rem: 0 };
    return { light: a.light + t.light, deep: a.deep + t.deep, rem: a.rem + t.rem };
  }, null);
  const firstTs = sessions.length ? get(sessions[0], "timeseries") : undefined;

  const light = num(d, "lightDuration") ?? fromSessions?.light ?? null;
  const deep = num(d, "deepDuration") ?? fromSessions?.deep ?? null;
  const rem = num(d, "remDuration") ?? fromSessions?.rem ?? null;
  const stagesSum = light !== null || deep !== null || rem !== null ? (light ?? 0) + (deep ?? 0) + (rem ?? 0) : null;

  return {
    day: str(d, "day") ?? "",
    score: num(d, "score", "sleepScore", "sleepQualityScore.total"),
    sleepSeconds: num(d, "sleepDuration", "sleepDurationSeconds", "sleepQualityScore.sleepDurationSeconds.current") ?? stagesSum,
    inBedSeconds: num(d, "presenceDuration", "presenceDurationSeconds"),
    lightSeconds: light,
    deepSeconds: deep,
    remSeconds: rem,
    presenceStart: str(d, "presenceStart"),
    presenceEnd: str(d, "presenceEnd"),
    heartRate:
      num(d, "sleepQualityScore.heartRate.average", "sleepQualityScore.heartRate.current", "sleepRoutineScore.heartRate.current") ??
      seriesAvg(get(firstTs, "heartRate")),
    hrv: num(d, "sleepQualityScore.hrv.current", "sleepQualityScore.hrv.average"),
    breathRate:
      num(d, "sleepQualityScore.respiratoryRate.current", "sleepQualityScore.respiratoryRate.average") ??
      seriesAvg(get(firstTs, "respiratoryRate")),
    bedTempC: num(d, "sleepQualityScore.tempBedC.average") ?? seriesAvg(get(firstTs, "tempBedC")),
    roomTempC: num(d, "sleepQualityScore.tempRoomC.average") ?? seriesAvg(get(firstTs, "tempRoomC")),
    tossAndTurns: num(d, "tnt"),
    processing: bool(d, "processing") ?? false,
  };
}

/** One sleep session from /intervals → a day keyed by the local date it ended */
function parseInterval(i: unknown, timezone: string): SleepDay | null {
  const ts = str(i, "ts");
  const t = stageTotals(get(i, "stages"));
  if (!ts || !t) return null;
  const inBed = t.light + t.deep + t.rem + t.awake;
  const end = new Date(new Date(ts).getTime() + (inBed + t.out) * 1000).toISOString();
  const series = get(i, "timeseries");
  const tnt = get(series, "tnt");
  return {
    ...emptyDay(localDay(end, timezone)),
    score: num(i, "score"),
    sleepSeconds: t.light + t.deep + t.rem,
    inBedSeconds: inBed,
    lightSeconds: t.light,
    deepSeconds: t.deep,
    remSeconds: t.rem,
    presenceStart: ts,
    presenceEnd: end,
    heartRate: seriesAvg(get(series, "heartRate")),
    breathRate: seriesAvg(get(series, "respiratoryRate")),
    bedTempC: seriesAvg(get(series, "tempBedC")),
    roomTempC: seriesAvg(get(series, "tempRoomC")),
    tossAndTurns: Array.isArray(tnt) ? tnt.length : seriesLast(tnt),
    processing: bool(i, "incomplete") ?? false,
  };
}

const hasSleep = (d: SleepDay) => (d.sleepSeconds ?? 0) > 0;

/**
 * Sleep history for the last days. Uses /trends, and falls back to (or fills gaps
 * from) the per-session /intervals endpoint, which some accounts populate instead.
 */
export async function getSleepNights(
  token: Token,
  timezone: string,
  from: string,
  to: string,
): Promise<{ days: SleepDay[]; debug: SleepDebug }> {
  const debug: SleepDebug = {
    trendsDays: 0,
    trendsDayKeys: [],
    trendsError: null,
    intervals: 0,
    intervalKeys: [],
    intervalsError: null,
    source: "none",
  };

  let trendDays: SleepDay[] = [];
  try {
    const params = new URLSearchParams({
      tz: timezone,
      from,
      to,
      "include-main": "false",
      "include-all-sessions": "true",
      "model-version": "v2",
    });
    const data = await fetchWithAuth(
      `${CLIENT_API_URL}/users/${token.eightUserId}/trends?${params.toString()}`,
      token,
      anyJson,
    );
    const raw = (get(data, "days") ?? get(data, "result.days") ?? []) as unknown[];
    debug.trendsDays = raw.length;
    debug.trendsDayKeys = raw[0] && typeof raw[0] === "object" ? Object.keys(raw[0]).slice(0, 25) : [];
    trendDays = raw.map(parseTrendDay);
  } catch (error) {
    debug.trendsError = error instanceof Error ? error.message : String(error);
  }

  let intervalDays: SleepDay[] = [];
  if (trendDays.filter(hasSleep).length < trendDays.length || trendDays.length === 0) {
    try {
      const data = await fetchWithAuth(`${CLIENT_API_URL}/users/${token.eightUserId}/intervals`, token, anyJson);
      const raw = (get(data, "intervals") ?? get(data, "result.intervals") ?? []) as unknown[];
      debug.intervals = raw.length;
      debug.intervalKeys = raw[0] && typeof raw[0] === "object" ? Object.keys(raw[0]).slice(0, 25) : [];
      intervalDays = raw
        .map((i) => parseInterval(i, timezone))
        .filter((d): d is SleepDay => !!d && d.day >= from && d.day <= to);
    } catch (error) {
      debug.intervalsError = error instanceof Error ? error.message : String(error);
    }
  }

  // Merge: keep trend days that have sleep, otherwise use the longest session for that date
  const byDay = new Map<string, SleepDay>();
  for (const d of trendDays) if (d.day) byDay.set(d.day, d);
  let usedIntervals = false;
  for (const d of intervalDays) {
    const existing = byDay.get(d.day);
    if (!existing || !hasSleep(existing)) {
      const keep = existing && !hasSleep(existing) ? { ...d, score: existing.score ?? d.score, hrv: existing.hrv ?? d.hrv } : d;
      const prev = byDay.get(d.day);
      if (!prev || !hasSleep(prev) || (d.sleepSeconds ?? 0) > (prev.sleepSeconds ?? 0)) {
        byDay.set(d.day, keep);
        usedIntervals = true;
      }
    }
  }

  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const fromTrends = trendDays.some(hasSleep);
  debug.source = fromTrends && usedIntervals ? "both" : fromTrends ? "trends" : usedIntervals ? "intervals" : "none";
  return { days, debug };
}

// ---------- Pod health ----------

const toF = (raw: number | null) => {
  if (raw === null) return null;
  try {
    return convertRawBedTempToDegrees(Math.max(-100, Math.min(100, raw)), "f");
  } catch {
    return null;
  }
};

export interface PodHealth {
  deviceId: string;
  side: string;
  online: boolean | null;
  lastSeen: string | null;
  needsPriming: boolean | null;
  priming: boolean | null;
  hasWater: boolean | null;
  lastPrime: string | null;
  ledBrightnessLevel: number | null;
  firmwareVersion: string | null;
  features: string[];
  wifiStrength: number | null;
  wifiSsid: string | null;
  sides: {
    side: "left" | "right";
    level: number | null;
    target: number | null;
    active: boolean | null;
    isYou: boolean;
    tempF: number | null;
    targetTempF: number | null;
  }[];
  priorityReading: string | null;
  /** which account the pod assigns to each side (a guest shows up as guest-<pod>-<side>) */
  leftUserId: string | null;
  rightUserId: string | null;
}

async function getCurrentDevice(token: Token) {
  const profile = await getUserProfile(token);
  return { deviceId: profile.currentDevice.id, side: profile.currentDevice.side };
}

export async function getPodHealth(token: Token): Promise<PodHealth> {
  const { deviceId, side } = await getCurrentDevice(token);
  const data = await fetchWithAuth(`${CLIENT_API_URL}/devices/${deviceId}`, token, anyJson);
  const r = get(data, "result") ?? data;

  let online: boolean | null = null;
  try {
    const o = await fetchWithAuth(`${CLIENT_API_URL}/devices/${deviceId}/online`, token, anyJson);
    online = bool(o, "result.online", "online", "result");
  } catch {
    // fall back to lastSeen below
  }
  const lastSeen = str(r, "lastHeard", "lastSeen");
  if (online === null && lastSeen) {
    online = Date.now() - new Date(lastSeen).getTime() < 15 * 60 * 1000;
  }

  const features = get(r, "features");
  return {
    deviceId,
    side,
    online,
    lastSeen,
    needsPriming: bool(r, "needsPriming"),
    priming: bool(r, "priming"),
    hasWater: bool(r, "hasWater"),
    lastPrime: str(r, "lastPrime"),
    ledBrightnessLevel: num(r, "ledBrightnessLevel"),
    firmwareVersion: str(r, "firmwareVersion"),
    features: Array.isArray(features) ? features.filter((f): f is string => typeof f === "string") : [],
    wifiStrength: num(r, "wifiInfo.strength", "wifiStrength"),
    wifiSsid: str(r, "wifiInfo.ssid"),
    sides: (["left", "right"] as const).map((sideName) => ({
      side: sideName,
      level: num(r, `${sideName}HeatingLevel`),
      target: num(r, `${sideName}TargetHeatingLevel`),
      active: bool(r, `${sideName}NowHeating`),
      isYou: side === sideName || side === "solo",
      tempF: toF(num(r, `${sideName}HeatingLevel`)),
      targetTempF: toF(num(r, `${sideName}TargetHeatingLevel`)),
    })),
    priorityReading: str(r, "sensorInfo.label", "modelString", "hubInfo"),
    leftUserId: str(r, "leftUserId", "awaySides.leftUserId"),
    rightUserId: str(r, "rightUserId", "awaySides.rightUserId"),
  };
}

export async function startPriming(token: Token): Promise<void> {
  const { deviceId } = await getCurrentDevice(token);
  await fetchWithAuth(`${APP_API_URL}v1/devices/${deviceId}/priming/tasks`, token, anyJson, {
    method: "POST",
    body: JSON.stringify({ notifications: { users: [token.eightUserId], meta: "rePriming" } }),
  });
}

export async function setLedBrightness(token: Token, level: number): Promise<void> {
  const { deviceId } = await getCurrentDevice(token);
  await fetchWithAuth(`${CLIENT_API_URL}/devices/${deviceId}`, token, anyJson, {
    method: "PUT",
    body: JSON.stringify({ ledBrightnessLevel: Math.max(0, Math.min(100, Math.round(level))) }),
  });
}

// ---------- Whole bed (solo) ----------

export type BedSide = "left" | "right" | "solo";

export async function getBedSide(token: Token): Promise<BedSide> {
  const { side } = await getCurrentDevice(token);
  return side === "left" || side === "right" ? side : "solo";
}

/** Assigns this account to a side, or to the whole bed with "solo" (same as the official app). */
export async function setBedSideMode(token: Token, side: BedSide): Promise<void> {
  const { deviceId } = await getCurrentDevice(token);
  await fetchWithAuth(`${CLIENT_API_URL}/users/${token.eightUserId}/current-device`, token, anyJson, {
    method: "PUT",
    body: JSON.stringify({ id: deviceId, side }),
  });
}

// ---------- Guest side ----------
// The official app controls a guest on the other side through a synthetic user id,
// "guest-<deviceId>-<side>", using the owner's token. Seen in an iOS traffic capture
// (mezz64/pyEight#38); not documented, so every call reports what actually happened.

export interface GuestSide {
  supported: boolean;
  /** why it isn't available, when supported is false */
  reason?: string;
  side: "left" | "right" | null;
  /** user id we send commands to: the account the pod assigns to that side, or the guest id */
  guestId: string | null;
  /** "account" = another Eight Sleep account owns that side; "guest" = official-app guest */
  kind: "account" | "guest" | null;
  on: boolean | null;
  level: number | null;
  host: "app" | "client" | null;
}

const otherSide = (side: string) => (side === "left" ? "right" : side === "right" ? "left" : null);

async function guestRequest(
  token: Token,
  guestId: string,
  init: RequestInit = {},
): Promise<{ host: "app" | "client"; data: unknown }> {
  // Try the app API first (where our own temperature calls go), then the client API
  const urls: ["app" | "client", string][] = [
    ["app", `${APP_API_URL}v1/users/${guestId}/temperature`],
    ["client", `${CLIENT_API_URL}/users/${guestId}/temperature`],
  ];
  let lastError: unknown = null;
  for (const [host, url] of urls) {
    try {
      return { host, data: await fetchWithAuth(url, token, anyJson, init) };
    } catch (error) {
      lastError = error;
      const status = statusFromError(error);
      if (status !== 404 && status !== 403 && status !== 401 && status !== 400) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Guest side not reachable");
}

export async function getGuestSide(token: Token): Promise<GuestSide> {
  const { deviceId, side } = await getCurrentDevice(token);
  const guestSide = otherSide(side);
  if (!guestSide) {
    return { supported: false, reason: "Whole bed is on. Turn it off to use a guest side.", side: null, guestId: null, kind: null, on: null, level: null, host: null };
  }
  // Prefer the account the pod actually assigns to the other side (a partner's login);
  // the owner's token can control it. Fall back to the official app's guest id.
  let assigned: string | null = null;
  let deviceOn: boolean | null = null;
  let deviceLevel: number | null = null;
  try {
    const d = await fetchWithAuth(`${CLIENT_API_URL}/devices/${deviceId}`, token, anyJson);
    const r = get(d, "result") ?? d;
    assigned = str(r, `${guestSide}UserId`, `awaySides.${guestSide}UserId`);
    // what the pod is really doing on that side (the account's record can say otherwise)
    deviceOn = bool(r, `${guestSide}NowHeating`);
    deviceLevel = num(r, `${guestSide}TargetHeatingLevel`);
  } catch {
    // fall through to the guest id
  }
  const kind: "account" | "guest" = assigned && assigned !== token.eightUserId && !assigned.startsWith("guest-") ? "account" : "guest";
  const guestId = kind === "account" ? assigned! : `guest-${deviceId}-${guestSide}`;
  try {
    const { host, data } = await guestRequest(token, guestId);
    const r = get(data, "result") ?? data;
    const state = str(r, "currentState.type");
    return {
      supported: true,
      side: guestSide,
      guestId,
      kind,
      on: deviceOn ?? (state === null ? null : state !== "off"),
      level: deviceLevel ?? num(r, "currentLevel", "currentDeviceLevel"),
      host,
    };
  } catch (error) {
    const status = statusFromError(error);
    return {
      supported: false,
      reason: status ? `Eight Sleep refused the guest side (HTTP ${status}).` : "Couldn't reach the guest side.",
      side: guestSide,
      guestId,
      kind,
      on: null,
      level: null,
      host: null,
    };
  }
}

export interface GuestWriteResult {
  /** which request actually changed the pod, e.g. "app power+level" */
  used: string;
  attempts: string[];
}

type GuestAttempt = { host: "app" | "client"; label: string; bodies: unknown[] };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the pod itself reports for one side (not the guest record, which always looks updated). */
async function readDeviceSide(token: Token, side: "left" | "right") {
  const h = await getPodHealth(token);
  const s = h.sides.find((x) => x.side === side);
  return { active: s?.active ?? null, target: s?.target ?? null };
}

/**
 * Sends each request shape in turn and checks the pod's own reading for the guest
 * side after each one. Eight Sleep accepts several shapes into the guest record
 * without the pod acting on them, so only the device reading counts as success.
 */
async function writeGuest(
  token: Token,
  guestId: string,
  side: "left" | "right",
  attempts: GuestAttempt[],
  applied: (s: { active: boolean | null; target: number | null }) => boolean,
): Promise<GuestWriteResult> {
  const log: string[] = [];
  for (const a of attempts) {
    const url =
      a.host === "client"
        ? `${CLIENT_API_URL}/users/${guestId}/temperature`
        : `${APP_API_URL}v1/users/${guestId}/temperature`;
    let failed = false;
    for (const body of a.bodies) {
      try {
        await fetchWithAuth(url, token, anyJson, { method: "PUT", body: JSON.stringify(body) });
      } catch (error) {
        log.push(`${a.host} ${a.label}: HTTP ${statusFromError(error) ?? "error"}`);
        failed = true;
        break;
      }
    }
    if (failed) continue;
    // the pod takes a few seconds to report the change
    for (const wait of [1500, 2500, 3500]) {
      await sleep(wait);
      const state = await readDeviceSide(token, side).catch(() => null);
      if (state && applied(state)) {
        log.push(`${a.host} ${a.label}: pod confirmed`);
        return { used: `${a.host} ${a.label}`, attempts: log };
      }
    }
    log.push(`${a.host} ${a.label}: accepted, pod didn't change`);
  }
  throw new Error(`The pod's ${side} side didn't respond. Tried: ${log.join("; ")}`);
}

export async function setGuestSide(
  token: Token,
  change: { on?: boolean; level?: number },
): Promise<GuestWriteResult> {
  const g = await getGuestSide(token);
  if (!g.supported || !g.guestId || !g.side) throw new Error(g.reason ?? "Guest side not available");
  const side = g.side;

  // Same requests that work for your own side: power via currentState, level via
  // timeBased + currentLevel, on the app API first, then the client API.
  const on = { currentState: { type: "smart" } };
  const off = { currentState: { type: "off" } };
  const level = change.level !== undefined ? clampLevel(change.level) : null;
  const levelBody = level !== null ? { timeBased: { level, durationSeconds: 0 }, currentLevel: level } : null;

  if (change.on === false) {
    return writeGuest(
      token,
      g.guestId,
      side,
      [
        { host: "app", label: "power off", bodies: [off] },
        { host: "client", label: "power off", bodies: [off] },
      ],
      (s) => s.active === false,
    );
  }

  const bodies = [on, ...(levelBody ? [levelBody] : [])];
  return writeGuest(
    token,
    g.guestId,
    side,
    [
      { host: "app", label: levelBody ? "power+level" : "power on", bodies },
      { host: "client", label: levelBody ? "power+level" : "power on", bodies },
    ],
    (s) => s.active === true && (level === null || (s.target !== null && Math.abs(s.target - level) <= 2)),
  );
}

/** Who the pod assigns to each side right now. */
export async function getSideAccounts(token: Token) {
  const h = await getPodHealth(token);
  return { deviceId: h.deviceId, left: h.leftUserId, right: h.rightUserId };
}

/**
 * Tries to put another account back on its side of the pod (Eight Sleep's "solo" removes it).
 * Tries each known request with the owner's login and checks the pod after each one.
 */
export async function assignAccountToSide(
  token: Token,
  userId: string,
  side: "left" | "right",
): Promise<{ ok: boolean; log: string[] }> {
  const { deviceId } = await getCurrentDevice(token);
  const tries: [string, string, unknown][] = [
    ["client current-device", `${CLIENT_API_URL}/users/${userId}/current-device`, { id: deviceId, side }],
    ["app current-device", `${APP_API_URL}v1/users/${userId}/current-device`, { id: deviceId, side }],
    ["device field", `${CLIENT_API_URL}/devices/${deviceId}`, { [`${side}UserId`]: userId }],
  ];
  const log: string[] = [];
  for (const [label, url, body] of tries) {
    try {
      await fetchWithAuth(url, token, anyJson, { method: "PUT", body: JSON.stringify(body) });
    } catch (error) {
      log.push(`${label}: HTTP ${statusFromError(error) ?? "error"}`);
      continue;
    }
    const now = await getSideAccounts(token).catch(() => null);
    if (now?.[side] === userId) {
      log.push(`${label}: restored`);
      return { ok: true, log };
    }
    log.push(`${label}: accepted, pod unchanged`);
  }
  return { ok: false, log };
}

export type PodSide = "left" | "right";

export interface SideState {
  isOn: boolean;
  level: number;
  target: number;
  tempF: number | null;
}

/**
 * Everything needed to drive either side, from one profile + one device read:
 * which side is yours, who to send each side's commands to, and what each side is doing.
 */
export async function getSides(token: Token): Promise<{
  own: PodSide;
  /** Eight Sleep's own whole-bed mode is on (old way; removes the other account) */
  solo: boolean;
  ids: Record<PodSide, string>;
  state: Record<PodSide, SideState>;
}> {
  const { deviceId, side } = await getCurrentDevice(token);
  const d = await fetchWithAuth(`${CLIENT_API_URL}/devices/${deviceId}`, token, anyJson);
  const r = get(d, "result") ?? d;
  // "solo" (old whole-bed mode): treat it as the left side
  const own: PodSide = side === "right" ? "right" : "left";
  const idFor = (s: PodSide) => {
    if (s === own) return token.eightUserId;
    const assigned = str(r, `${s}UserId`);
    return assigned && assigned !== token.eightUserId && !assigned.startsWith("guest-") ? assigned : `guest-${deviceId}-${s}`;
  };
  const stateFor = (s: PodSide): SideState => {
    const level = num(r, `${s}HeatingLevel`) ?? 0;
    return {
      isOn: bool(r, `${s}NowHeating`) ?? false,
      level,
      target: num(r, `${s}TargetHeatingLevel`) ?? level,
      tempF: toF(level),
    };
  };
  return {
    own,
    solo: side === "solo",
    ids: { left: idFor("left"), right: idFor("right") },
    state: { left: stateFor("left"), right: stateFor("right") },
  };
}

/** Turns one side on/off and/or sets its level (no read-back; the device shows it a few seconds later). */
export async function applyToSide(token: Token, userId: string, change: { on?: boolean; level?: number }): Promise<void> {
  if (change.on === false) {
    await turnOffSide(token, userId);
    return;
  }
  if (change.on) await turnOnSide(token, userId);
  if (change.level !== undefined) await setHeatingLevel(token, userId, clampLevel(change.level));
}

/** Who gets the other side's commands: the account on that side, or the official guest id. */
export async function otherSideTarget(token: Token): Promise<{ id: string; side: "left" | "right" } | null> {
  const { deviceId, side } = await getCurrentDevice(token);
  const o = otherSide(side);
  if (!o) return null;
  let assigned: string | null = null;
  try {
    const d = await fetchWithAuth(`${CLIENT_API_URL}/devices/${deviceId}`, token, anyJson);
    assigned = str(get(d, "result") ?? d, `${o}UserId`);
  } catch {
    // use the guest id
  }
  const id = assigned && assigned !== token.eightUserId && !assigned.startsWith("guest-") ? assigned : `guest-${deviceId}-${o}`;
  return { id, side: o };
}

/** Whole bed: sends the same change to the other side. Returns an error message, or null if it worked. */
export async function mirrorToOtherSide(token: Token, change: { on?: boolean; level?: number }): Promise<string | null> {
  try {
    const t = await otherSideTarget(token);
    if (!t) return null;
    if (change.on === false) {
      await turnOffSide(token, t.id);
      return null;
    }
    if (change.on) await turnOnSide(token, t.id);
    if (change.level !== undefined) await setHeatingLevel(token, t.id, clampLevel(change.level));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ---------- Away / nap / hot-flash ----------

/**
 * Starts or ends Eight Sleep's Away mode. Tries the known request shapes in turn and
 * reports each answer, since Eight Sleep has refused the usual one (HTTP 403).
 */
export async function setAwayModeChecked(token: Token, action: "start" | "end"): Promise<string> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const id = token.eightUserId;
  const tries: [string, string, unknown][] = [
    ["app", `${APP_API_URL}v1/users/${id}/away-mode`, { awayPeriod: { [action]: yesterday } }],
    ["app now", `${APP_API_URL}v1/users/${id}/away-mode`, { awayPeriod: { [action]: now } }],
    ["client", `${CLIENT_API_URL}/users/${id}/away-mode`, { awayPeriod: { [action]: yesterday } }],
  ];
  const log: string[] = [];
  for (const [label, url, body] of tries) {
    try {
      await fetchWithAuth(url, token, anyJson, { method: "PUT", body: JSON.stringify(body) });
      return label;
    } catch (error) {
      log.push(`${label}: HTTP ${statusFromError(error) ?? "error"}`);
    }
  }
  const all403 = log.every((l) => l.endsWith("403"));
  throw new Error(
    all403
      ? `Eight Sleep refuses Away mode for this account (HTTP 403 every time), most likely because it needs the subscription. Vacation mode here still works: the schedule pauses and the pod turns off. (${log.join("; ")})`
      : `Eight Sleep didn't accept Away mode. Tried: ${log.join("; ")}`,
  );
}

export async function getAwayState(token: Token): Promise<boolean | null> {
  const data = await fetchWithAuth(`${APP_API_URL}v1/users/${token.eightUserId}/away-mode`, token, anyJson);
  return bool(data, "isAway", "result.isAway");
}

export type QuickMode = "nap-mode" | "hot-flash-mode";

export async function getQuickModeStatus(token: Token, mode: QuickMode): Promise<boolean | null> {
  const path = mode === "nap-mode" ? "nap-mode/status" : "hot-flash-mode";
  const data = await fetchWithAuth(
    `${APP_API_URL}v1/users/${token.eightUserId}/temperature/${path}`,
    token,
    anyJson,
  );
  return bool(data, "active", "isActive", "enabled", "result.active", "result.isActive", "result.enabled");
}

export async function setQuickMode(
  token: Token,
  mode: QuickMode,
  action: "activate" | "deactivate" | "extend",
): Promise<void> {
  await fetchWithAuth(
    `${APP_API_URL}v1/users/${token.eightUserId}/temperature/${mode}/${action}`,
    token,
    anyJson,
    { method: "POST", body: JSON.stringify({}) },
  );
}

// ---------- Capabilities ----------

export type CapabilityState = "available" | "subscription" | "unsupported" | "unknown";

export interface Capability {
  key: string;
  label: string;
  state: CapabilityState;
  detail?: string;
}

function stateFromStatus(status: number): CapabilityState {
  if (status >= 200 && status < 300) return "available";
  if (status === 402 || status === 403) return "subscription";
  if (status === 404) return "unsupported";
  return "unknown";
}

/** Probes read-only endpoints to see which pod features this account can use. */
export async function probeCapabilities(token: Token): Promise<Capability[]> {
  const id = token.eightUserId;
  const today = new Date().toISOString().slice(0, 10);
  const probes: { key: string; label: string; url: string }[] = [
    { key: "sleep", label: "Sleep data & trends", url: `${CLIENT_API_URL}/users/${id}/trends?tz=UTC&from=${today}&to=${today}&model-version=v2` },
    { key: "away", label: "Away mode", url: `${APP_API_URL}v1/users/${id}/away-mode` },
    { key: "nap", label: "Nap mode", url: `${APP_API_URL}v1/users/${id}/temperature/nap-mode/status` },
    { key: "hotflash", label: "Hot-flash mode", url: `${APP_API_URL}v1/users/${id}/temperature/hot-flash-mode` },
    { key: "alarms", label: "Native vibration alarms", url: `${APP_API_URL}v2/users/${id}/alarms` },
    { key: "autopilot", label: "Autopilot", url: `${CLIENT_API_URL}/users/${id}/autopilotDetails` },
    { key: "base", label: "Adjustable base", url: `${APP_API_URL}v1/users/${id}/base` },
    { key: "speaker", label: "Pod speaker", url: `${APP_API_URL}v1/users/${id}/audio/player` },
  ];

  const results = await Promise.all(
    probes.map(async (p) => {
      const status = await requestStatus(p.url, token);
      return { key: p.key, label: p.label, state: stateFromStatus(status), detail: status ? `HTTP ${status}` : "No response" };
    }),
  );

  let health: PodHealth | null = null;
  try {
    health = await getPodHealth(token);
  } catch {
    // reported below
  }
  results.push(
    {
      key: "priming",
      label: "Priming & water status",
      state: health && health.needsPriming !== null ? "available" : "unknown",
      detail: health ? "From device info" : "Device info unavailable",
    },
    {
      key: "led",
      label: "LED brightness",
      state: health && health.ledBrightnessLevel !== null ? "available" : "unknown",
      detail: health ? "From device info" : "Device info unavailable",
    },
  );

  try {
    const guest = await getGuestSide(token);
    results.push({
      key: "guest",
      label: "Guest side control",
      state: guest.supported ? "available" : guest.side === null ? "unknown" : "unsupported",
      detail: guest.supported ? `via ${guest.host} API` : guest.reason ?? "Not available",
    });
  } catch {
    results.push({ key: "guest", label: "Guest side control", state: "unknown", detail: "Check failed" });
  }

  // A base is only real if the device advertises it
  const base = results.find((r) => r.key === "base");
  if (base && health && !health.features.includes("elevation") && base.state === "available") {
    base.state = "unsupported";
    base.detail = "No elevation feature on this pod";
  }
  return results;
}

export { clampLevel };

// ---------- The schedule set in the Eight Sleep app ----------

export interface EightSchedule {
  /** HH:MM, or null when Eight Sleep didn't say */
  bedTime: string | null;
  wakeupTime: string | null;
  /** API units (−100…100): falling asleep, deep sleep, late sleep */
  levels: { initial: number | null; mid: number | null; final: number | null };
  /** true while Eight Sleep's own schedule (Autopilot) is driving the bed */
  eightScheduleOn: boolean | null;
}

const hhmm = (v: unknown) => (typeof v === "string" && /^\d{1,2}:\d{2}/.test(v) ? v.slice(0, 5).padStart(5, "0") : null);

/**
 * Reads the bedtime routine and the three Autopilot levels from the Eight Sleep app's
 * settings, so a new person can start from the schedule they already have. Two calls,
 * only when they ask; anything missing comes back as null.
 */
export async function getEightSchedule(token: Token): Promise<EightSchedule> {
  const id = token.eightUserId;
  const [routines, temp] = await Promise.all([
    fetchWithAuth(`${APP_API_URL}v2/users/${id}/routines`, token, anyJson).catch(() => null),
    fetchWithAuth(`${APP_API_URL}v1/users/${id}/temperature`, token, anyJson).catch(() => null),
  ]);
  const list = (get(routines, "settings.routines") ?? get(routines, "routines") ?? []) as unknown[];
  const today = new Date().getDay();
  const routine =
    list.find((r) => Array.isArray(get(r, "days")) && (get(r, "days") as unknown[]).includes(today) && get(r, "enabled") !== false) ??
    list.find((r) => get(r, "enabled") !== false) ??
    list[0];
  const alarms = (get(routine, "alarms") ?? get(routine, "override.alarms") ?? []) as unknown[];
  const firstAlarm = alarms.find((a) => get(a, "enabled") !== false) ?? alarms[0];
  const level = (k: string) => num(temp, `smart.${k}`);
  const stateType = str(temp, "currentState.type");
  return {
    bedTime: hhmm(get(routine, "bedtime.time") ?? get(routine, "bedtime")),
    wakeupTime: hhmm(get(firstAlarm, "time") ?? get(routine, "wakeup.time")),
    levels: { initial: level("bedTimeLevel"), mid: level("initialSleepLevel"), final: level("finalSleepLevel") },
    eightScheduleOn: stateType ? stateType === "smart" : null,
  };
}
