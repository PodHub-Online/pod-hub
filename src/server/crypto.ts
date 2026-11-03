import "server-only";
import crypto from "node:crypto";
import { and, eq, not, like, or, isNotNull } from "drizzle-orm";
import { db } from "~/server/db";
import { users, whoopConnections } from "~/server/db/schema";

/**
 * Eight Sleep and WHOOP sign-in tokens are stored encrypted (AES-256-GCM), so someone who
 * reads the database can't use them to control anyone's Pod. The key is TOKEN_KEY, or one
 * made from JWT_SECRET when TOKEN_KEY isn't set; it never touches the database.
 */
const PREFIX = "enc:v1:";

function key(): Buffer {
  const base = process.env.TOKEN_KEY ?? `pod-hub-tokens:${process.env.JWT_SECRET ?? ""}`;
  if (!process.env.TOKEN_KEY && !process.env.JWT_SECRET) throw new Error("No key to protect sign-in tokens (TOKEN_KEY / JWT_SECRET).");
  return crypto.createHash("sha256").update(base).digest();
}

export const isSealed = (value: string) => value.startsWith(PREFIX);

export function seal(plain: string): string {
  if (isSealed(plain)) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

/** The plain token; values saved before encryption existed pass through unchanged. */
export function open(stored: string): string {
  if (!isSealed(stored)) return stored;
  const [iv = "", tag = "", data = ""] = stored.slice(PREFIX.length).split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export const sealOrNull = (v: string | null | undefined) => (v ? seal(v) : null);
export const openOrNull = (v: string | null | undefined) => (v ? open(v) : null);

/** Encrypts any tokens still saved in plain text (from before encryption). Cheap when there are none. */
export async function sealLegacyTokens() {
  const plainUsers = await db
    .select({ email: users.email, a: users.eightAccessToken, r: users.eightRefreshToken })
    .from(users)
    .where(or(not(like(users.eightAccessToken, `${PREFIX}%`)), not(like(users.eightRefreshToken, `${PREFIX}%`))));
  for (const u of plainUsers) {
    await db.update(users).set({ eightAccessToken: seal(u.a), eightRefreshToken: seal(u.r) }).where(eq(users.email, u.email));
  }
  const plainWhoop = await db
    .select({ email: whoopConnections.email, a: whoopConnections.accessToken, r: whoopConnections.refreshToken })
    .from(whoopConnections)
    .where(
      or(
        not(like(whoopConnections.accessToken, `${PREFIX}%`)),
        and(isNotNull(whoopConnections.refreshToken), not(like(whoopConnections.refreshToken, `${PREFIX}%`))),
      ),
    );
  for (const w of plainWhoop) {
    await db
      .update(whoopConnections)
      .set({ accessToken: seal(w.a), refreshToken: sealOrNull(w.r) })
      .where(eq(whoopConnections.email, w.email));
  }
  return plainUsers.length + plainWhoop.length;
}
