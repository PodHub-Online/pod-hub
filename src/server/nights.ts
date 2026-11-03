import "server-only";
import { and, desc, gte, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { cronRuns, nightLevels } from "~/server/db/schema";

const HOUR = 3_600_000;
const CHANGES = new Set(["turned_on", "set_level", "turned_off"]);

/** "YYYY-MM-DD" of a moment in a time zone. */
const dayIn = (t: number, tz: string) => new Date(t).toLocaleDateString("en-CA", { timeZone: tz });

/** The UTC moment of a wall-clock time in a time zone (accurate to the zone's offset that day). */
function zonedTime(day: string, hour: number, tz: string) {
  const guess = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`).getTime();
  const shown = new Date(new Date(guess).toLocaleString("en-US", { timeZone: tz })).getTime();
  const utc = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return guess - (shown - utc);
}

/**
 * Writes one summary per night (18:00 → 12:00) and side from the activity log, so streaks,
 * the monthly report and auto-tune keep working after the 7-day log is pruned. Finished nights
 * only; re-running is harmless.
 */
export async function summarizeNights(email: string, tz: string) {
  const since = new Date(Date.now() - 7 * 24 * HOUR);
  const rows = await db
    .select({ ranAt: cronRuns.ranAt, stage: cronRuns.stage, action: cronRuns.action, level: cronRuns.level, source: cronRuns.source, side: cronRuns.side, podWasOn: cronRuns.podWasOn, targetBefore: cronRuns.targetBefore })
    .from(cronRuns)
    .where(and(sql`lower(${cronRuns.email}) = lower(${email})`, gte(cronRuns.ranAt, since)))
    .orderBy(cronRuns.ranAt);
  if (!rows.length) return;
  const nights = new Set<string>();
  for (const r of rows) nights.add(dayIn(r.ranAt.getTime() - 12 * HOUR, tz));
  for (const night of nights) {
    const start = zonedTime(night, 18, tz);
    const end = start + 18 * HOUR;
    if (end > Date.now() || start < since.getTime()) continue; // not over yet, or only half in the log
    for (const side of ["left", "right"] as const) {
      const mine = rows.filter((r) => r.side === side || r.side === "both");
      const inNight = mine.filter((r) => r.ranAt.getTime() >= start && r.ranAt.getTime() < end);
      if (!inNight.length) continue;
      // the level when the night began
      const before = [...mine].reverse().find((r) => r.ranAt.getTime() < start && CHANGES.has(r.action));
      let level: number | null = before ? (before.action === "turned_off" ? null : before.level) : null;
      if (!before && inNight[0]?.podWasOn) level = inNight[0].targetBefore;
      let t = start;
      let onMs = 0;
      let weighted = 0;
      let min: number | null = null;
      let max: number | null = null;
      let firstOn: Date | null = level !== null ? new Date(start) : null;
      let manual = 0;
      let scheduleRan = false;
      const step = (until: number) => {
        if (level !== null) {
          onMs += until - t;
          weighted += level * (until - t);
          min = min === null ? level : Math.min(min, level);
          max = max === null ? level : Math.max(max, level);
        }
        t = until;
      };
      for (const r of inNight) {
        if (r.source === "cron" && r.action !== "idle" && r.action !== "backed_off" && r.action !== "error") scheduleRan = true;
        if (!CHANGES.has(r.action)) continue;
        step(r.ranAt.getTime());
        if (r.source === "app") manual++;
        level = r.action === "turned_off" ? null : r.level ?? level ?? 0;
        if (level !== null && !firstOn) firstOn = r.ranAt;
      }
      step(end);
      // the level the schedule aimed for in each stage (falling asleep, deep, late)
      const byStage: Record<"initial" | "mid" | "final", number[]> = { initial: [], mid: [], final: [] };
      for (const r of inNight) {
        if (r.source !== "cron" || r.level === null) continue;
        const k = r.stage === "preheat" ? "initial" : r.stage;
        if (k === "initial" || k === "mid" || k === "final") byStage[k].push(r.level);
      }
      const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
      const values = {
        stageLevels: JSON.stringify({ initial: mean(byStage.initial), mid: mean(byStage.mid), final: mean(byStage.final) }),
        avgLevel: onMs ? Math.round((weighted / onMs) * 10) / 10 : null,
        minLevel: min,
        maxLevel: max,
        onMinutes: Math.round(onMs / 60_000),
        manualChanges: manual,
        scheduleRan,
        firstOn,
        updatedAt: new Date(),
      };
      await db
        .insert(nightLevels)
        .values({ email, night, side, ...values })
        .onConflictDoUpdate({ target: [nightLevels.email, nightLevels.night, nightLevels.side], set: values });
    }
  }
}

export async function getNightLevels(email: string, days: number) {
  const since = new Date(Date.now() - days * 24 * HOUR).toISOString().slice(0, 10);
  return db
    .select()
    .from(nightLevels)
    .where(and(sql`lower(${nightLevels.email}) = lower(${email})`, gte(nightLevels.night, since)))
    .orderBy(desc(nightLevels.night));
}
