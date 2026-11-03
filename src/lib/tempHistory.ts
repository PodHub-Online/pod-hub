// "Your temperatures over time": which stage temperatures went with the best nights.
// Pure (no screens, no server) so it can be tested. Levels are in whole app steps (-10…+10).

export type HistStage = "initial" | "mid" | "final";
export const HIST_STAGES: HistStage[] = ["initial", "mid", "final"];

/** nights at one temperature needed before it counts as a pattern */
export const MIN_NIGHTS_AT_TEMP = 3;

export interface HistNight {
  /** evening date, YYYY-MM-DD */
  night: string;
  /** each stage's level in whole steps; null = off / not recorded */
  stages: Record<HistStage, number | null>;
  /** sleep score, or WHOOP recovery, 0–100 */
  result: number | null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface BestAt {
  level: number;
  avg: number;
  nights: number;
}

/** For one stage: the temperature with the best average result (needs enough nights at it). */
export function bestForStage(nights: HistNight[], stage: HistStage, min = MIN_NIGHTS_AT_TEMP): BestAt | null {
  const groups = new Map<number, number[]>();
  for (const n of nights) {
    const l = n.stages[stage];
    if (l === null || n.result === null) continue;
    const k = Math.round(l);
    groups.set(k, [...(groups.get(k) ?? []), n.result]);
  }
  let best: BestAt | null = null;
  for (const [level, xs] of groups) {
    if (xs.length < min) continue;
    const a = mean(xs);
    // a tie goes to the temperature with more nights behind it
    if (!best || a > best.avg || (a === best.avg && xs.length > best.nights)) best = { level, avg: a, nights: xs.length };
  }
  return best;
}

export interface BestCombo {
  levels: Record<HistStage, number>;
  avg: number;
  nights: number;
}

/** The three stage temperatures that, together, gave the best average result (all three must be known). */
export function bestCombo(nights: HistNight[], min = MIN_NIGHTS_AT_TEMP): BestCombo | null {
  const groups = new Map<string, { levels: Record<HistStage, number>; xs: number[] }>();
  for (const n of nights) {
    const { initial, mid, final } = n.stages;
    if (initial === null || mid === null || final === null || n.result === null) continue;
    const levels = { initial: Math.round(initial), mid: Math.round(mid), final: Math.round(final) };
    const key = `${levels.initial}|${levels.mid}|${levels.final}`;
    const g = groups.get(key) ?? { levels, xs: [] };
    g.xs.push(n.result);
    groups.set(key, g);
  }
  let best: BestCombo | null = null;
  for (const g of groups.values()) {
    if (g.xs.length < min) continue;
    const a = mean(g.xs);
    if (!best || a > best.avg || (a === best.avg && g.xs.length > best.nights)) best = { levels: g.levels, avg: a, nights: g.xs.length };
  }
  return best;
}

/** The night with the highest result, to mark in the list. */
export function bestNight(nights: HistNight[]): string | null {
  let best: HistNight | null = null;
  for (const n of nights) if (n.result !== null && (!best || n.result > best.result!)) best = n;
  return best?.night ?? null;
}

const csvCell = (v: string | number | null) => (v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** CSV of the history; levels are written as the app's steps (-10…+10), "off" when a stage didn't run. */
export function historyCsv(nights: HistNight[], resultName: string): string {
  const head = ["night", "falling_asleep", "deep_sleep", "late_sleep", resultName];
  const rows = nights.map((n) => [n.night, ...HIST_STAGES.map((s) => (n.stages[s] ?? "off")), n.result === null ? null : Math.round(n.result)]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
