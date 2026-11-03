import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { db } from "~/server/db";
import { cronRuns } from "~/server/db/schema";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type ActivityStage =
  | "preheat"
  | "initial"
  | "mid"
  | "final"
  | "prewake"
  | "alarm"
  | "off"
  | "vacation"
  | "manual";

/** Who called: read from the request headers Vercel adds */
export interface CallerInfo {
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  userAgent?: string;
  host?: string;
}

export function callerFromHeaders(h: Headers): CallerInfo {
  const pick = (name: string) => {
    const v = h.get(name);
    if (!v) return undefined;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  return {
    ip: pick("x-forwarded-for")?.split(",")[0]?.trim() ?? pick("x-real-ip"),
    city: pick("x-vercel-ip-city"),
    region: pick("x-vercel-ip-country-region"),
    country: pick("x-vercel-ip-country"),
    userAgent: pick("user-agent")?.slice(0, 200),
    host: pick("x-forwarded-host") ?? pick("host"),
  };
}

export interface ActivityEntry {
  stage: ActivityStage;
  /** e.g. turned_on, set_level, turned_off, no_change, error, preset_applied, schedule_saved… */
  action: string;
  /** cron = the cron URL was called; check = "Run schedule check now"; auto = re-check after a change; app = a change made in the app */
  source?: "cron" | "check" | "auto" | "app";
  level?: number | null;
  message?: string | null;
  podWasOn?: boolean | null;
  levelBefore?: number | null;
  targetBefore?: number | null;
  durationMs?: number | null;
  caller?: CallerInfo | null;
  side?: "left" | "right" | "both" | null;
}

/** Writes one activity row and prunes that user's rows older than 7 days. Never throws; returns the error instead. */
export async function recordActivity(email: string, entry: ActivityEntry): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.insert(cronRuns).values({
      email,
      stage: entry.stage,
      action: entry.action,
      source: entry.source ?? "cron",
      level: entry.level ?? null,
      message: entry.message?.slice(0, 500) ?? null,
      podWasOn: entry.podWasOn ?? null,
      levelBefore: entry.levelBefore ?? null,
      targetBefore: entry.targetBefore ?? null,
      durationMs: entry.durationMs ?? null,
      meta: entry.caller ? JSON.stringify(entry.caller) : null,
      side: entry.side ?? null,
    });
    await db
      .delete(cronRuns)
      .where(and(eq(cronRuns.email, email), lt(cronRuns.ranAt, new Date(Date.now() - RETENTION_MS))));
    return { ok: true };
  } catch (error) {
    console.error(`Could not record activity for ${email}:`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
