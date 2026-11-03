import "server-only";
import crypto from "node:crypto";
import { and, asc, count, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { accessRequests, invites, signInAttempts, users } from "~/server/db/schema";

let ownerCache: { email: string | null; at: number } | null = null;

/**
 * The owner of this copy of the app: OWNER_EMAIL if set, otherwise the first account
 * that ever signed in. Only the owner sees the cron secret, the WHOOP app keys,
 * the invite list and other people's activity.
 */
export async function ownerEmail(): Promise<string | null> {
  const fromEnv = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (fromEnv) return fromEnv;
  if (ownerCache && Date.now() - ownerCache.at < 60_000) return ownerCache.email;
  const first = await db.select({ email: users.email }).from(users).orderBy(asc(users.createdAt)).limit(1);
  ownerCache = { email: first[0]?.email.toLowerCase() ?? null, at: Date.now() };
  return ownerCache.email;
}

export async function isOwner(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  return (await ownerEmail()) === email.toLowerCase();
}

/** Emails in the old APPROVED_EMAILS setting; copied into the invite list once. */
export function approvedEmails(): string[] {
  return (process.env.APPROVED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

let seeded = false;
/** Copies APPROVED_EMAILS into the invite list the first time it's needed (once, ever). */
export async function seedInvitesFromSetting() {
  if (seeded) return;
  const done = await db.execute(sql`select 1 from "8slp_appMigrations" where "name" = 'seed_invites_from_env'`);
  if ((done as unknown[]).length === 0) {
    const emails = approvedEmails();
    if (emails.length) await db.insert(invites).values(emails.map((email) => ({ email }))).onConflictDoNothing();
    await db.execute(sql`insert into "8slp_appMigrations" ("name") values ('seed_invites_from_env') on conflict do nothing`);
  }
  seeded = true;
}

export async function isInvited(email: string): Promise<boolean> {
  await seedInvitesFromSetting();
  const row = await db.query.invites.findFirst({ where: eq(invites.email, email.toLowerCase()) });
  return !!row;
}

/** Whether this email may use the app: the owner, or someone on the invite list. */
export async function canSignIn(email: string): Promise<boolean> {
  const e = email.toLowerCase();
  // nobody has signed in yet: the first person becomes the owner
  const owner = await ownerEmail();
  if (owner === null || owner === e) return true;
  return isInvited(e);
}

/**
 * Checked on every request: a session only works while the account exists and is still
 * allowed in, so removing someone (or deleting their account) signs them out right away.
 */
export async function isActiveAccount(email: string): Promise<boolean> {
  const row = await db.query.users.findFirst({ where: eq(users.email, email), columns: { email: true } });
  return !!row && (await canSignIn(email));
}

// ---------- Access requests ----------

const REQUEST_DAYS = 30;
const MAX_PENDING = 20;

export async function pendingRequests() {
  await db.delete(accessRequests).where(lt(accessRequests.requestedAt, new Date(Date.now() - REQUEST_DAYS * 86_400_000)));
  return db.select().from(accessRequests).orderBy(asc(accessRequests.requestedAt));
}

/** Saves a request (email and first name only). False when too many are already waiting. */
export async function addAccessRequest(email: string, firstName: string | null): Promise<boolean> {
  const e = email.toLowerCase();
  const waiting = await pendingRequests();
  if (!waiting.some((r) => r.email === e) && waiting.length >= MAX_PENDING) return false;
  await db
    .insert(accessRequests)
    .values({ email: e, firstName: firstName?.slice(0, 80) ?? null })
    .onConflictDoUpdate({ target: accessRequests.email, set: { requestedAt: new Date(), firstName: firstName?.slice(0, 80) ?? null } });
  return true;
}

// ---------- Sign-in rate limit ----------

const LIMIT = 5;
const WINDOW_MS = 10 * 60_000;
// IPs and emails are hashed before they're stored, and the rows are dropped after a day
const keyOf = (kind: "ip" | "email", value: string) =>
  `${kind}:${crypto.createHash("sha256").update(`${kind}:${value.toLowerCase()}`).digest("hex").slice(0, 40)}`;

/** True when this IP or email has had too many failed sign-ins or requests lately. */
export async function signInBlocked(ip: string | undefined, email: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  for (const key of [ip ? keyOf("ip", ip) : null, keyOf("email", email)]) {
    if (!key) continue;
    const [row] = await db
      .select({ n: count() })
      .from(signInAttempts)
      .where(and(eq(signInAttempts.key, key), gte(signInAttempts.at, since)));
    if ((row?.n ?? 0) >= LIMIT) return true;
  }
  return false;
}

export async function recordSignInAttempt(ip: string | undefined, email: string) {
  await db.delete(signInAttempts).where(lt(signInAttempts.at, new Date(Date.now() - 86_400_000)));
  await db.insert(signInAttempts).values([...(ip ? [{ key: keyOf("ip", ip) }] : []), { key: keyOf("email", email) }]);
}
