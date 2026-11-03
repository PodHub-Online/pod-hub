import "server-only";
import { lt, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { dailyCounters, events } from "~/server/db/schema";

/**
 * Owner statistics: usage only (visits, which features are used, how the app is running),
 * never sleep or health data. Writes never throw and never slow down the caller much.
 */

const KEEP_DAYS = 90;
const today = () => new Date().toISOString().slice(0, 10);

/** One usage event: "visit", "feature:nap", "tour_done", "slow:user.getAccount"… */
export function track(email: string | null, kind: string, meta?: string | null) {
  void db
    .insert(events)
    .values({ email: email?.toLowerCase() ?? null, kind: kind.slice(0, 40), meta: meta?.slice(0, 300) ?? null })
    .catch((e) => console.error("track failed:", e instanceof Error ? e.message : e));
}

/** Adds to today's counter ("eight_calls", "eight_error_429", "push_sent", "email_failed"…). */
export function bump(key: string, n = 1) {
  void db
    .insert(dailyCounters)
    .values({ day: today(), key: key.slice(0, 40), n })
    .onConflictDoUpdate({ target: [dailyCounters.day, dailyCounters.key], set: { n: sql`${dailyCounters.n} + ${n}` } })
    .catch((e) => console.error("bump failed:", e instanceof Error ? e.message : e));
}

/** Drops events older than 90 days and counters older than a year (called by the daily owner summary). */
export async function pruneStats() {
  await db.delete(events).where(lt(events.at, new Date(Date.now() - KEEP_DAYS * 86_400_000)));
  await db.delete(dailyCounters).where(lt(dailyCounters.day, new Date(Date.now() - 366 * 86_400_000).toISOString().slice(0, 10)));
}
