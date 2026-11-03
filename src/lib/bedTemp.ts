// Bed temperature ↔ the Pod's raw level (-100..100). Shared by the screens and the server.
// The tables are Eight Sleep's (from the open-source integrations); the range shown follows
// Eight Sleep's published 55–110°F / 13–43°C, and the top step sends the Pod's real maximum.

export type TempUnit = "f" | "c";

export const RAW_TO_CELSIUS_MAP: Record<number, number> = {
  '-100': 13,
  '-97': 14,
  '-94': 15,
  '-91': 16,
  '-83': 17,
  '-75': 18,
  '-67': 19,
  '-58': 20,
  '-50': 21,
  '-42': 22,
  '-33': 23,
  '-25': 24,
  '-17': 25,
  '-8': 26,
  '0': 27,
  '6': 28,
  '11': 29,
  '17': 30,
  '22': 31,
  '28': 32,
  '33': 33,
  '39': 34,
  '44': 35,
  '50': 36,
  '56': 37,
  '61': 38,
  '67': 39,
  '72': 40,
  '78': 41,
  '83': 42,
  '89': 43,
  '100': 44,
};

export const RAW_TO_FAHRENHEIT_MAP: Record<number, number> = {
  '-100': 55,
  '-99': 56,
  '-97': 57,
  '-95': 58,
  '-94': 59,
  '-92': 60,
  '-90': 61,
  '-86': 62,
  '-81': 63,
  '-77': 64,
  '-72': 65,
  '-68': 66,
  '-63': 67,
  '-58': 68,
  '-54': 69,
  '-49': 70,
  '-44': 71,
  '-40': 72,
  '-35': 73,
  '-31': 74,
  '-26': 75,
  '-21': 76,
  '-17': 77,
  '-12': 78,
  '-7': 79,
  '-3': 80,
  '1': 81,
  '4': 82,
  '7': 83,
  '10': 84,
  '14': 85,
  '17': 86,
  '20': 87,
  '23': 88,
  '26': 89,
  '29': 90,
  '32': 91,
  '35': 92,
  '38': 93,
  '41': 94,
  '44': 95,
  '48': 96,
  '51': 97,
  '54': 98,
  '57': 99,
  '60': 100,
  '63': 101,
  '66': 102,
  '69': 103,
  '72': 104,
  '75': 105,
  '78': 106,
  '81': 107,
  '85': 108,
  '88': 109,
  '92': 110,
  '100': 111,
};

/** Shown limits (Eight Sleep's published range). */
export const TEMP_LIMITS: Record<TempUnit, { min: number; max: number }> = { f: { min: 55, max: 110 }, c: { min: 13, max: 43 } };

// [raw, degrees] sorted by raw (object keys don't keep numeric order for negative numbers)
const sorted = (map: Record<number, number>) =>
  Object.entries(map)
    .map(([raw, deg]) => [Number(raw), deg] as const)
    .sort((a, b) => a[0] - b[0]);
const TABLES: Record<TempUnit, (readonly [number, number])[]> = { c: sorted(RAW_TO_CELSIUS_MAP), f: sorted(RAW_TO_FAHRENHEIT_MAP) };

/** The table's temperature for a raw level, interpolated between entries (not rounded). */
export function rawToDegrees(raw: number, unit: TempUnit): number {
  const t = TABLES[unit];
  const r = Math.max(-100, Math.min(100, raw));
  for (let i = 1; i < t.length; i++) {
    const [r1, d1] = t[i]!;
    if (r <= r1) {
      const [r0, d0] = t[i - 1]!;
      return d0 + ((r - r0) / (r1 - r0)) * (d1 - d0);
    }
  }
  return t[t.length - 1]![1];
}

/** Whole degrees as shown in the app, within Eight Sleep's published range. */
export function displayDegrees(raw: number, unit: TempUnit): number {
  const { min, max } = TEMP_LIMITS[unit];
  return Math.max(min, Math.min(max, Math.round(rawToDegrees(raw, unit))));
}

/** Every whole degree the stepper offers, coldest first, each with the raw level it sends. */
export function degreeSteps(unit: TempUnit): { deg: number; raw: number }[] {
  const { min, max } = TEMP_LIMITS[unit];
  const steps: { deg: number; raw: number }[] = [];
  for (const [raw, deg] of TABLES[unit]) {
    if (deg >= min && deg < max && !steps.some((s) => s.deg === deg)) steps.push({ deg, raw });
  }
  // the warmest step sends the Pod's real maximum
  steps.push({ deg: max, raw: 100 });
  return steps;
}

/** One degree warmer (+1) or cooler (-1) than this raw level; the same level at either end. */
export function stepDegree(raw: number, unit: TempUnit, dir: 1 | -1): number {
  const steps = degreeSteps(unit);
  const now = displayDegrees(raw, unit);
  const next = dir > 0 ? steps.find((s) => s.deg > now) : [...steps].reverse().find((s) => s.deg < now);
  return next ? next.raw : raw;
}

/** One Pod level warmer or cooler (the -10..+10 scale), landing on whole levels. */
export function stepLevel(raw: number, dir: 1 | -1): number {
  const level = dir > 0 ? Math.floor(raw / 10) + 1 : Math.ceil(raw / 10) - 1;
  return Math.max(-100, Math.min(100, level * 10));
}
