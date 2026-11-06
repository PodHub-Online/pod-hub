import "server-only";
import { sql } from "drizzle-orm";
import { db } from "~/server/db";
import { dailyCounters, events } from "~/server/db/schema";

/**
 * Owner statistics: usage only (visits, which features are used, how the app is running),
 * never sleep or health data. Kept forever: nothing here is ever deleted. Writes never throw and never slow down the caller much.
 */

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
