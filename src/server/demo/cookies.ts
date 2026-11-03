import { cookies } from "next/headers";
import { DEMO_MAX_AGE_SECONDS, signDemoToken } from "~/server/demo/session";

const AUTH_COOKIE = "8slpAutht";

/** Signs this browser in to the demo (a short session, never a device token). */
export function setDemoCookie() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined in the environment");
  cookies().set(AUTH_COOKIE, signDemoToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: DEMO_MAX_AGE_SECONDS,
    path: "/",
  });
}

export function clearAuthCookieForDemo() {
  cookies().set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}
