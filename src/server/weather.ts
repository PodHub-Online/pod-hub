import "server-only";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";

/**
 * Tonight's weather at home, from Open-Meteo (free, no key). Kept for 3 hours per person, so the
 * 5-minute cron asks at most 8 times a day.
 */
export interface NightWeather {
  fetchedAt: string;
  /** °C at bedtime-ish (22:00) and the warmest hour between 21:00 and 03:00 */
  evening: number | null;
  warmest: number | null;
  humidity: number | null;
  /** a hot night: cool earlier and one step colder */
  hot: boolean;
}

const CACHE_MS = 3 * 3600_000;
// a night this warm (°C) makes it hard to cool the bed down in time; each person can raise it
// (Settings → Smart features → Hot nights), and the room sensor uses the same number
const HOT_C = 26.5;
/** Hot when the evening reaches the threshold, or the warmest hour goes 1.5° past it. */
const hotFor = (w: { evening: number | null; warmest: number | null }, threshold: number) =>
  (w.evening ?? -99) >= threshold || (w.warmest ?? -99) >= threshold + 1.5;

export async function nightWeather(user: {
  email: string;
  homeLat: number | null;
  homeLon: number | null;
  weatherCache: string | null;
  roomAwareC?: number | null;
}): Promise<NightWeather | null> {
  const threshold = user.roomAwareC ?? HOT_C;
  if (user.homeLat === null || user.homeLon === null) return null;
  try {
    const cached = user.weatherCache ? (JSON.parse(user.weatherCache) as NightWeather) : null;
    if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MS) return { ...cached, hot: hotFor(cached, threshold) };
  } catch {
    // fetch again
  }
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${user.homeLat.toFixed(2)}&longitude=${user.homeLon.toFixed(2)}` +
    "&hourly=temperature_2m,relative_humidity_2m&forecast_days=2&timezone=auto";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      hourly?: { time: string[]; temperature_2m: number[]; relative_humidity_2m: number[] };
    };
    const h = data.hourly;
    if (!h) return null;
    // tonight: today's 21:00 to tomorrow's 03:00 (times are local to the home)
    const today = h.time[0]!.slice(0, 10);
    const idx = h.time
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => (t.slice(0, 10) === today && t.slice(11, 13) >= "21") || (t.slice(0, 10) > today && t.slice(11, 13) <= "03"))
      .map(({ i }) => i)
      .slice(0, 7);
    const temps = idx.map((i) => h.temperature_2m[i]!).filter((n) => typeof n === "number");
    const evening = h.temperature_2m[h.time.indexOf(`${today}T22:00`)] ?? null;
    const warmest = temps.length ? Math.max(...temps) : null;
    const humidity = h.relative_humidity_2m[h.time.indexOf(`${today}T22:00`)] ?? null;
    const w: NightWeather = {
      fetchedAt: new Date().toISOString(),
      evening,
      warmest,
      humidity,
      hot: hotFor({ evening, warmest }, threshold),
    };
    await db.update(users).set({ weatherCache: JSON.stringify(w) }).where(eq(users.email, user.email));
    return w;
  } catch (error) {
    console.error("Weather unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Distance in km between two points (for "you're away from home"). */
export function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLon = r(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}


/** What the sky behind the 3D bed needs: the weather now, tonight's low, and sunrise/sunset. */
export interface SkyWeather {
  fetchedAt: string;
  tempC: number | null;
  /** Open-Meteo (WMO) weather code now */
  code: number | null;
  /** the coldest hour between sunset and the next sunrise */
  lowC: number | null;
  /** the highest chance of rain in the next 12 hours, % */
  rainPct: number | null;
  /** sunrise and sunset of yesterday, today and tomorrow, as real moments (ISO) */
  rise: string[];
  set: string[];
  /** relative humidity now, % */
  humidity: number | null;
  /** your sleeping hours: every 2 hours (9 pm, 11 pm, 1 am, 3 am, 5 am, 7 am) from now to the next sunrise */
  hours: { at: string; tempC: number; code: number }[];
  /** tomorrow's weather */
  tomorrow: { hiC: number; loC: number; code: number } | null;
}

const SKY_CACHE_MS = 30 * 60_000;
// kept in memory per person: a few lines of weather, rebuilt after a restart
const skyCache = new Map<string, SkyWeather>();

export async function skyWeather(user: { email: string; homeLat: number | null; homeLon: number | null }): Promise<SkyWeather | null> {
  if (user.homeLat === null || user.homeLon === null) return null;
  const hit = skyCache.get(user.email);
  if (hit && Date.now() - new Date(hit.fetchedAt).getTime() < SKY_CACHE_MS) return hit;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${user.homeLat.toFixed(2)}&longitude=${user.homeLon.toFixed(2)}` +
    "&current=temperature_2m,weather_code,relative_humidity_2m&hourly=temperature_2m,precipitation_probability,weather_code&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,weather_code&past_days=1&forecast_days=2&timezone=auto";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      utc_offset_seconds?: number;
      current?: { temperature_2m?: number; weather_code?: number; relative_humidity_2m?: number };
      hourly?: { time: string[]; temperature_2m: number[]; precipitation_probability: (number | null)[]; weather_code: number[] };
      daily?: { sunrise: string[]; sunset: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[] };
    };
    const offset = (data.utc_offset_seconds ?? 0) * 1000;
    // Open-Meteo times are local to the place with no zone: turn them into real moments
    const real = (local: string) => new Date(Date.parse(`${local}:00Z`) - offset);
    const rise = (data.daily?.sunrise ?? []).slice(0, 3).map((t) => real(t));
    const set = (data.daily?.sunset ?? []).slice(0, 3).map((t) => real(t));
    if (rise.length < 3 || set.length < 3) return null;
    const now = Date.now();
    const hours = (data.hourly?.time ?? []).map((t, i) => ({ at: real(t).getTime(), temp: data.hourly!.temperature_2m[i]!, rain: data.hourly!.precipitation_probability[i] ?? 0, code: data.hourly!.weather_code?.[i] ?? 0, hour: Number(t.slice(11, 13)) }));
    // tonight: from the sunset still ahead (or the one just passed) to the next sunrise
    const tonightSet = set.find((s) => s.getTime() + 6 * 3_600_000 > now) ?? set[1]!;
    const nextRise = rise.find((r) => r.getTime() > tonightSet.getTime()) ?? rise[2]!;
    const night = hours.filter((h) => h.at >= tonightSet.getTime() && h.at <= nextRise.getTime()).map((h) => h.temp);
    const next12 = hours.filter((h) => h.at >= now && h.at <= now + 12 * 3_600_000).map((h) => h.rain);
    // the sleeping-hours strip: 9 pm, 11 pm, 1 am, 3 am, 5 am, 7 am (local to home) from an hour ago to just after the next sunrise
    const SLEEP_HOURS = new Set([21, 23, 1, 3, 5, 7]);
    const strip = hours
      .filter((h) => SLEEP_HOURS.has(h.hour) && h.at >= now - 3_600_000 && h.at <= nextRise.getTime() + 3_600_000)
      .slice(0, 6)
      .map((h) => ({ at: new Date(h.at).toISOString(), tempC: h.temp, code: h.code }));
    const tmw = data.daily;
    const w: SkyWeather = {
      humidity: data.current?.relative_humidity_2m ?? null,
      hours: strip,
      tomorrow: tmw?.temperature_2m_max[2] !== undefined ? { hiC: tmw.temperature_2m_max[2], loC: tmw.temperature_2m_min[2]!, code: tmw.weather_code?.[2] ?? 0 } : null,
      fetchedAt: new Date().toISOString(),
      tempC: data.current?.temperature_2m ?? null,
      code: data.current?.weather_code ?? null,
      lowC: night.length ? Math.min(...night) : null,
      rainPct: next12.length ? Math.max(...next12) : null,
      rise: rise.map((d) => d.toISOString()),
      set: set.map((d) => d.toISOString()),
    };
    skyCache.set(user.email, w);
    return w;
  } catch (error) {
    console.error("Sky weather unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}
