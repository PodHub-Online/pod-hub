// The sky behind the 3D bed: time of day, weather and the moon, from your real clock and forecast.
// Pure (no screens, no server) so it can be tested.

export type Condition = "clear" | "partly" | "cloudy" | "rain" | "thunder" | "snow" | "fog";
export type Phase = "dawn" | "day" | "dusk" | "night";
export type Extreme = "hot" | "cold" | null;

export const CONDITIONS: Condition[] = ["clear", "partly", "cloudy", "rain", "thunder", "snow", "fog"];

/** Open-Meteo weather codes (WMO) → what the sky draws. */
export function conditionFromCode(code: number | null | undefined): Condition {
  if (code === null || code === undefined) return "clear";
  if (code <= 1) return "clear";
  if (code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "thunder";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  return "cloudy";
}

const SYNODIC_DAYS = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon

/** Where the moon is in its cycle: 0 = new, 0.5 = full, back to 1 = new. */
export function moonPhase(at: Date): number {
  const days = (at.getTime() - NEW_MOON) / 86_400_000;
  return (((days / SYNODIC_DAYS) % 1) + 1) % 1;
}

export function moonName(f: number): string {
  if (f < 0.03 || f >= 0.97) return "New moon";
  if (f < 0.22) return "Waxing crescent";
  if (f < 0.28) return "First quarter";
  if (f < 0.47) return "Waxing gibbous";
  if (f < 0.53) return "Full moon";
  if (f < 0.72) return "Waning gibbous";
  if (f < 0.78) return "Last quarter";
  return "Waning crescent";
}

/** The moon's lit part, 0…1. */
export const moonLit = (f: number) => (1 - Math.cos(2 * Math.PI * f)) / 2;

export interface SkyInput {
  now: Date;
  /** sunrise and sunset of yesterday, today and tomorrow (real moments); null = unknown */
  sun: { rise: Date[]; set: Date[] } | null;
  code: number | null;
  tempC: number | null;
  lowC: number | null;
  rainPct: number | null;
}

export interface SkyState {
  phase: Phase;
  condition: Condition;
  extreme: Extreme;
  body: "sun" | "moon";
  /** where the sun or moon is on its way across: 0 = rising … 1 = setting */
  progress: number;
  moon: number;
  tempC: number | null;
  lowC: number | null;
  rainPct: number | null;
  /** there is a real forecast behind this (not just the clock) */
  hasWeather: boolean;
}

const MIN = 60_000;
const HOT_C = 35;
const COLD_C = -7;

export const extremeFor = (tempC: number | null): Extreme => (tempC === null ? null : tempC >= HOT_C ? "hot" : tempC <= COLD_C ? "cold" : null);

/** The sky for this moment. Without sunrise/sunset times it uses 06:30–19:30 on the phone's clock. */
export function computeSky(i: SkyInput): SkyState {
  const t = i.now.getTime();
  let rise: number[];
  let set: number[];
  if (i.sun && i.sun.rise.length === 3 && i.sun.set.length === 3) {
    rise = i.sun.rise.map((d) => d.getTime());
    set = i.sun.set.map((d) => d.getTime());
  } else {
    const d = new Date(i.now);
    const at = (dayOffset: number, h: number, m: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, h, m).getTime();
    rise = [-1, 0, 1].map((o) => at(o, 6, 30));
    set = [-1, 0, 1].map((o) => at(o, 19, 30));
  }
  // which sunrise→sunset we are in (if any)
  let phase: Phase = "night";
  let body: "sun" | "moon" = "moon";
  let progress = 0.5;
  for (let k = 0; k < 3; k++) {
    const r = rise[k]!;
    const s = set[k]!;
    if (t >= r - 30 * MIN && t < s + 30 * MIN) {
      body = "sun";
      progress = Math.min(1, Math.max(0, (t - r) / (s - r)));
      phase = t < r + 40 * MIN ? "dawn" : t >= s - 40 * MIN ? "dusk" : "day";
      // before sunrise / after sunset the light is already changing but the body is on the horizon
      if (t < r) progress = 0;
      if (t >= s) progress = 1;
      break;
    }
  }
  if (phase === "night") {
    // the night between the last sunset and the next sunrise
    const prevSet = [...set].reverse().find((s) => s <= t) ?? set[0]!;
    const nextRise = rise.find((r) => r > t) ?? rise[2]!;
    progress = Math.min(1, Math.max(0, (t - prevSet) / (nextRise - prevSet)));
  }
  const hasWeather = i.code !== null || i.tempC !== null;
  return {
    phase,
    condition: conditionFromCode(i.code),
    extreme: extremeFor(i.tempC),
    body,
    progress,
    moon: moonPhase(i.now),
    tempC: i.tempC,
    lowC: i.lowC,
    rainPct: i.rainPct,
    hasWeather,
  };
}

const C_TO_F = (c: number) => (c * 9) / 5 + 32;
export const celsiusToF = C_TO_F;

/** The weather number: the temperature now by day, tonight's low after sunset. */
export function skyNumberC(s: SkyState): number | null {
  return s.phase === "night" ? s.lowC ?? s.tempC : s.tempC;
}

export const CONDITION_EMOJI: Record<Condition, string> = { clear: "☀️", partly: "⛅", cloudy: "☁️", rain: "🌧", thunder: "⛈", snow: "❄️", fog: "🌫" };

/** The small emoji in front of the chip. */
export function skyEmoji(s: SkyState): string {
  if (s.extreme === "hot") return "🔥";
  if (s.extreme === "cold") return "🥶";
  if (s.condition === "clear") return s.phase === "night" ? "🌙" : "☀️";
  return CONDITION_EMOJI[s.condition];
}

export const CONDITION_LABEL: Record<Condition, string> = { clear: "Clear", partly: "Partly cloudy", cloudy: "Cloudy", rain: "Rain", thunder: "Thunderstorm", snow: "Snow", fog: "Fog" };

/** The forecast details behind the pop-up: your sleeping hours, humidity, sun times and tomorrow. */
export interface SkyDetail {
  hours: { at: Date; tempC: number; code: number }[];
  humidity: number | null;
  sunrise: Date | null;
  sunset: Date | null;
  tomorrow: { hiC: number; loC: number; code: number } | null;
}

/** Today's sunrise and sunset from the three-day list (yesterday, today, tomorrow). */
export function todaySun(rise: Date[], set: Date[]): { sunrise: Date | null; sunset: Date | null } {
  return { sunrise: rise[1] ?? null, sunset: set[1] ?? null };
}
