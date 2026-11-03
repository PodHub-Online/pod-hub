import jwt from "jsonwebtoken";

/**
 * The demo login: a session cookie marked `demo: true`. A demo session is answered by the
 * demo router (fake data, kept in its own cookie) and never reaches Eight Sleep, WHOOP or
 * the database.
 */
export const DEMO_EMAIL = "demo@example.com";
export const DEMO_STATE_COOKIE = "8slpDemo";
/** A demo visit lasts at most this long; then it's back to the login screen. */
export const DEMO_MAX_AGE_SECONDS = 12 * 60 * 60;

export const isDemoEmail = (email: string | null | undefined) =>
  !!email && email.trim().toLowerCase() === DEMO_EMAIL;

export function readCookie(cookieHeader: string | null, name: string): string | null {
  const row = (cookieHeader ?? "")
    .split(";")
    .map((r) => r.trim())
    .find((r) => r.startsWith(`${name}=`));
  return row ? row.slice(name.length + 1) : null;
}

export function signDemoToken(secret: string) {
  return jwt.sign({ email: DEMO_EMAIL, demo: true }, secret, { expiresIn: DEMO_MAX_AGE_SECONDS });
}

/** Whether this request's session cookie is a (valid) demo session. */
export function isDemoCookie(cookieHeader: string | null): boolean {
  const token = readCookie(cookieHeader, "8slpAutht");
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET ?? "") as { demo?: boolean; email?: string };
    return decoded.demo === true || isDemoEmail(decoded.email);
  } catch {
    return false;
  }
}
