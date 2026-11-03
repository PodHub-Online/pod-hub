import "server-only";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { ownerEmail } from "~/server/access";
import { notify, type NotifyKind } from "~/server/push";

/**
 * Sends a notification once per "occasion": the same key with the same value never goes out
 * twice (key "bedtime:left" + value "2026-10-28" = once that night). Remembered in the
 * person's notifyState, next to the health checks.
 */
export async function notifyOnce(email: string, kind: NotifyKind, key: string, value: string, title: string, body: string) {
  const u = await db.query.users.findFirst({ where: eq(users.email, email), columns: { notifyState: true } });
  if (!u) return false;
  let state: Record<string, unknown> = {};
  try {
    state = JSON.parse(u.notifyState ?? "{}") as Record<string, unknown>;
  } catch {
    // start over
  }
  const k = `once:${key}`;
  if (state[k] === value) return false;
  // mark first so a slow send can't make it go out twice
  state[k] = value;
  await db.update(users).set({ notifyState: JSON.stringify(state) }).where(eq(users.email, email));
  const r = await notify(email, kind, title, body);
  return r.sent > 0;
}

/** The same, to the owner (requests, feedback, the schedule check stopping, errors, the daily summary). */
export async function notifyOwner(kind: NotifyKind, key: string, value: string, title: string, body: string) {
  const owner = await ownerEmail();
  if (!owner) return false;
  const row = await db.query.users.findFirst({ where: eq(users.email, owner), columns: { email: true } });
  return row ? notifyOnce(row.email, kind, key, value, title, body) : false;
}
