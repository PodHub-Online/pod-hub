import "server-only";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "~/server/db";
import { appConfig, whoopConnections, whoopSleeps } from "~/server/db/schema";
import { recordActivity } from "~/server/activityLog";
import { isDemoEmail } from "~/server/demo/session";
import { open, seal, sealOrNull } from "~/server/crypto";

// WHOOP official API (v2): https://developer.whoop.com
const AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const API = "https://api.prod.whoop.com/developer";
// The permissions that connected fine the first time; workouts and body are asked for in a
// separate, optional step so a refusal there never blocks the basic connection.
export const WHOOP_SCOPES = "offline read:sleep read:recovery read:cycles read:profile";
export const WHOOP_EXTRA_SCOPES = `${WHOOP_SCOPES} read:workout read:body_measurement`;

export const STATE_COOKIE = "whoop_state";

const KEY_ID = "whoop_client_id";
const KEY_SECRET = "whoop_client_secret";

/** The WHOOP developer app keys, as entered in Settings → WHOOP. */
export async function whoopConfig(): Promise<{ clientId: string; clientSecret: string } | null> {
  const rows = await db.select().from(appConfig).where(inArray(appConfig.key, [KEY_ID, KEY_SECRET]));
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const clientId = get(KEY_ID);
  const clientSecret = get(KEY_SECRET);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Saves the keys from Settings; an empty secret keeps the one already saved. */
export async function saveWhoopConfig(clientId: string, clientSecret?: string) {
  const put = (key: string, value: string) =>
    db
      .insert(appConfig)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: new Date() } });
  await put(KEY_ID, clientId.trim());
  if (clientSecret?.trim()) await put(KEY_SECRET, clientSecret.trim());
}

export const redirectUri = (origin: string) => `${origin}/api/whoop/callback`;

/** The signed-in app user from the session cookie, or null. */
export function emailFromCookie(cookieHeader: string | null): string | null {
  const token = (cookieHeader ?? "")
    .split(";")
    .map((r) => r.trim())
    .find((r) => r.startsWith("8slpAutht="))
    ?.split("=")[1];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET ?? "") as { email: string; demo?: boolean };
    // the demo never connects to WHOOP
    return decoded.demo || isDemoEmail(decoded.email) ? null : decoded.email;
  } catch {
    return null;
  }
}

export async function authorizeUrl(origin: string, state: string, extra = false) {
  const cfg = await whoopConfig();
  if (!cfg) throw new Error("WHOOP isn't set up. Add the app keys in Settings → WHOOP.");
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: extra ? WHOOP_EXTRA_SCOPES : WHOOP_SCOPES,
    state,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const cfg = await whoopConfig();
  if (!cfg) throw new Error("WHOOP isn't set up.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
  });
  if (!res.ok) throw new Error(`WHOOP sign-in failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as TokenResponse;
}

/** Finishes the WHOOP sign-in: saves the tokens and pulls the last two weeks. */
export async function connectWhoop(email: string, code: string, origin: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin) });
  const profile = (await apiGet(t.access_token, "/v2/user/profile/basic")) as { user_id: number | string };
  const values = {
    whoopUserId: String(profile.user_id),
    accessToken: seal(t.access_token),
    refreshToken: sealOrNull(t.refresh_token),
    expiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000),
    connectedAt: new Date(),
  };
  await db
    .insert(whoopConnections)
    .values({ email, ...values })
    .onConflictDoUpdate({ target: whoopConnections.email, set: values });
  await recordActivity(email, { stage: "manual", source: "app", action: "whoop_connected" });
  await syncWhoop(email, 14).catch((e) => console.error("First WHOOP sync failed:", e));
}

async function apiGet(accessToken: string, path: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`WHOOP ${path} failed (HTTP ${res.status})`);
  return res.json();
}

/** A valid access token for this user, refreshing it when it's about to expire. */
async function accessTokenFor(email: string): Promise<string> {
  const c = await db.query.whoopConnections.findFirst({ where: eq(whoopConnections.email, email) });
  if (!c) throw new Error("WHOOP isn't connected.");
  if (c.expiresAt > new Date()) return open(c.accessToken);
  if (!c.refreshToken) throw new Error("WHOOP sign-in expired. Connect WHOOP again.");
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: open(c.refreshToken), scope: "offline" });
  await db
    .update(whoopConnections)
    .set({
      accessToken: seal(t.access_token),
      refreshToken: t.refresh_token ? seal(t.refresh_token) : c.refreshToken,
      expiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000),
    })
    .where(eq(whoopConnections.email, email));
  return t.access_token;
}

interface WhoopSleep {
  id: string;
  cycle_id?: number;
  start: string;
  end: string;
  nap?: boolean;
  score_state?: string;
}

/** Saves one sleep and the recovery that came from it. */
async function saveSleep(email: string, token: string, sleep: WhoopSleep) {
  let recovery: unknown = null;
  if (sleep.cycle_id !== undefined && !sleep.nap) {
    recovery = await apiGet(token, `/v2/cycle/${sleep.cycle_id}/recovery`).catch(() => null);
  }
  const row = {
    email,
    start: new Date(sleep.start),
    end: new Date(sleep.end),
    nap: !!sleep.nap,
    sleep: JSON.stringify(sleep),
    recovery: recovery ? JSON.stringify(recovery) : null,
    updatedAt: new Date(),
  };
  await db
    .insert(whoopSleeps)
    .values({ id: sleep.id, ...row })
    .onConflictDoUpdate({ target: whoopSleeps.id, set: row });
}

/** Pulls the last `days` of sleeps (with recovery) from WHOOP. */
export async function syncWhoop(email: string, days = 3): Promise<number> {
  const token = await accessTokenFor(email);
  const start = new Date(Date.now() - days * 86_400_000).toISOString();
  let next: string | null = null;
  let count = 0;
  do {
    const q = new URLSearchParams({ start, limit: "25", ...(next ? { nextToken: next } : {}) });
    const page = (await apiGet(token, `/v2/activity/sleep?${q.toString()}`)) as {
      records?: WhoopSleep[];
      next_token?: string | null;
    } | null;
    for (const s of page?.records ?? []) {
      await saveSleep(email, token, s);
      count++;
    }
    next = page?.next_token ?? null;
  } while (next);
  await db.update(whoopConnections).set({ lastSyncAt: new Date() }).where(eq(whoopConnections.email, email));
  return count;
}

/** True when the request really came from WHOOP (HMAC-SHA256 of timestamp + body, base64). */
export async function verifyWebhook(rawBody: string, signature: string | null, timestamp: string | null): Promise<boolean> {
  const cfg = await whoopConfig();
  if (!cfg || !signature || !timestamp) return false;
  const expected = crypto.createHmac("sha256", cfg.clientSecret).update(timestamp + rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Handles a WHOOP event: a sleep or its recovery is ready (or was deleted). */
export async function handleWebhook(event: { user_id: number | string; id: string | number; type: string }) {
  const c = await db.query.whoopConnections.findFirst({
    where: eq(whoopConnections.whoopUserId, String(event.user_id)),
  });
  if (!c) return;
  await db.update(whoopConnections).set({ lastWebhookAt: new Date() }).where(eq(whoopConnections.email, c.email));
  const sleepId = String(event.id);
  if (event.type === "sleep.deleted") {
    await db.delete(whoopSleeps).where(eq(whoopSleeps.id, sleepId));
    return;
  }
  if (event.type === "sleep.updated" || event.type === "recovery.updated") {
    // for recovery events the id is the sleep's UUID too
    const token = await accessTokenFor(c.email);
    const sleep = (await apiGet(token, `/v2/activity/sleep/${sleepId}`)) as WhoopSleep | null;
    if (sleep) await saveSleep(c.email, token, sleep);
  }
}

/** Fallback when webhooks don't arrive: sync at most every 30 minutes (called from the cron job). */
export async function syncWhoopIfStale(email: string) {
  const c = await db.query.whoopConnections.findFirst({ where: eq(whoopConnections.email, email) });
  if (!c || !(await whoopConfig())) return;
  if (c.lastSyncAt && Date.now() - c.lastSyncAt.getTime() < 30 * 60_000) return;
  await syncWhoop(email, 2).catch((e) => console.error(`WHOOP sync for ${email} failed:`, e));
}

export async function getWhoopNights(email: string, days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select()
    .from(whoopSleeps)
    .where(and(eq(whoopSleeps.email, email), gte(whoopSleeps.start, since)))
    .orderBy(desc(whoopSleeps.start));
  return rows.map((r) => ({
    id: r.id,
    start: r.start,
    end: r.end,
    nap: r.nap,
    sleep: JSON.parse(r.sleep) as Record<string, unknown>,
    recovery: r.recovery ? (JSON.parse(r.recovery) as Record<string, unknown>) : null,
  }));
}

/** Asks WHOOP for one page of a collection; null when this connection lacks the permission. */
async function tryGet(token: string, path: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`WHOOP ${path} failed (HTTP ${res.status})`);
  return res.json();
}

/**
 * Everything else WHOOP has, fetched live: daily strain/calories/heart rate (cycles),
 * workouts and body measurements. Workouts and body need permissions added after the
 * first connection, so they come back null until WHOOP is reconnected.
 */
export async function getWhoopExtras(email: string, days = 14) {
  const token = await accessTokenFor(email);
  const start = new Date(Date.now() - days * 86_400_000).toISOString();
  const q = new URLSearchParams({ start, limit: "25" }).toString();
  const [cycles, workouts, body, profile] = await Promise.all([
    tryGet(token, `/v2/cycle?${q}`),
    tryGet(token, `/v2/activity/workout?${q}`),
    tryGet(token, `/v2/user/measurement/body`),
    tryGet(token, `/v2/user/profile/basic`),
  ]);
  const records = (x: unknown) => ((x as { records?: Record<string, unknown>[] } | null)?.records ?? null);
  return {
    cycles: records(cycles),
    workouts: records(workouts),
    body: (body as Record<string, unknown> | null) ?? null,
    profile: (profile as Record<string, unknown> | null) ?? null,
  };
}

/** The saved Client Secret, for the "show" button in Settings. */
export async function revealWhoopSecret(): Promise<string | null> {
  return (await whoopConfig())?.clientSecret ?? null;
}
