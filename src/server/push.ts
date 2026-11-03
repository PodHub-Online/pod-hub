import "server-only";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { bump } from "~/server/stats";
import { appConfig, pushSubscriptions, users } from "~/server/db/schema";

/**
 * Phone notifications (Web Push) without a push library: each push is an empty "wake up" signed
 * with the app's own VAPID key; the phone's service worker then asks /api/push/latest what to
 * show (with the person's sign-in cookie). So no message content ever passes through
 * Google's or Apple's push servers.
 */

/** Every kind, and whether it starts on: the important ones on, the chatty ones off. */
const DEFAULTS = {
  water: true,
  priming: true,
  schedule: true,
  whoop: true,
  digest: true,
  signin: true,
  offline: true,
  lefton: true,
  nap: true,
  vacation: true,
  hotnight: true,
  autotune: true,
  notreached: false,
  bedtime: false,
  morning: false,
  hold: false,
  streak: false,
  monthly: false,
  news: false,
  // the owner only
  owner_request: true,
  owner_signins: true,
  owner_feedback: true,
  owner_cron: true,
  owner_errors: true,
  owner_daily: false,
};
export type NotifyKind = keyof typeof DEFAULTS;
export const NOTIFY_KINDS = Object.keys(DEFAULTS) as NotifyKind[];
export type NotifyPrefs = Record<NotifyKind, boolean>;
const ALL_ON: NotifyPrefs = DEFAULTS;

const b64url = (b: Buffer) => b.toString("base64url");

/** The app's VAPID key pair, made the first time it's needed and kept in the app settings. */
async function vapidKeys(): Promise<{ publicKey: string; privateJwk: crypto.JsonWebKey }> {
  const row = await db.query.appConfig.findFirst({ where: eq(appConfig.key, "vapid") });
  if (row) return JSON.parse(row.value) as { publicKey: string; privateJwk: crypto.JsonWebKey };
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pub = publicKey.export({ format: "jwk" });
  // the browser wants the raw uncompressed point: 0x04 || x || y
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x!, "base64url"), Buffer.from(pub.y!, "base64url")]);
  const keys = { publicKey: b64url(raw), privateJwk: privateKey.export({ format: "jwk" }) };
  await db.insert(appConfig).values({ key: "vapid", value: JSON.stringify(keys) }).onConflictDoNothing();
  // two first calls at once: keep whichever was saved
  const saved = await db.query.appConfig.findFirst({ where: eq(appConfig.key, "vapid") });
  return JSON.parse(saved!.value) as { publicKey: string; privateJwk: crypto.JsonWebKey };
}

export async function vapidPublicKey() {
  return (await vapidKeys()).publicKey;
}

/** A signed VAPID header for one push service (its origin is the audience). */
async function vapidAuth(endpoint: string) {
  const { publicKey, privateJwk } = await vapidKeys();
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: "mailto:pod-hub@users.noreply.github.com",
      }),
    ),
  );
  const key = crypto.createPrivateKey({ key: privateJwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${body}.${b64url(sig)}, k=${publicKey}`;
}

export function prefsOf(raw: string | null | undefined): NotifyPrefs {
  try {
    return { ...ALL_ON, ...(raw ? (JSON.parse(raw) as Partial<NotifyPrefs>) : {}) };
  } catch {
    return ALL_ON;
  }
}

/**
 * Notifies every phone this person turned notifications on for. Saves the text for the phone to
 * fetch, then wakes it up. Phones that unsubscribed (404/410) are forgotten; a phone that still
 * has notifications on registers again the next time Settings opens on it.
 */
export async function notify(email: string, kind: NotifyKind | "test", title: string, body: string): Promise<{ sent: number; phones: number; errors: string[] }> {
  const none = { sent: 0, phones: 0, errors: [] as string[] };
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) return none;
  if (kind !== "test" && !prefsOf(user.notifyPrefs)[kind]) return none;
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.email, email));
  if (!subs.length) return none;
  await db
    .update(users)
    .set({ lastNotification: JSON.stringify({ title, body, kind, at: new Date().toISOString() }) })
    .where(eq(users.email, email));
  let sent = 0;
  const errors: string[] = [];
  for (const s of subs) {
    const service = new URL(s.endpoint).host.includes("apple") ? "Apple" : new URL(s.endpoint).host.includes("google") ? "Google" : new URL(s.endpoint).host;
    try {
      const res = await fetch(s.endpoint, {
        method: "POST",
        headers: { Authorization: await vapidAuth(s.endpoint), TTL: "43200", Urgency: "normal", "Content-Length": "0" },
      });
      if (res.status === 404 || res.status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint));
        bump("push_dropped");
        errors.push(`${service} says this phone's notifications expired (${res.status})`);
      } else if (res.ok) {
        sent++;
        bump("push_sent");
        bump(`push_${kind}`);
      }
      else {
        const why = (await res.text().catch(() => "")).slice(0, 120);
        console.error(`Push to ${new URL(s.endpoint).host} failed: HTTP ${res.status} ${why}`);
        errors.push(`${service} refused it (HTTP ${res.status}${why ? `: ${why}` : ""})`);
      }
    } catch (error) {
      console.error("Push failed:", error);
      errors.push(`${service} couldn't be reached`);
    }
  }
  return { sent, phones: subs.length, errors };
}
