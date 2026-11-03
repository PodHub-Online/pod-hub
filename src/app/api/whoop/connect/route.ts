import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeUrl, emailFromCookie, STATE_COOKIE, whoopConfig } from "~/server/whoop";
import { originOf } from "../origin";
import { isActiveAccount } from "~/server/access";

export const dynamic = "force-dynamic";

/** Starts "Connect WHOOP": sends you to WHOOP's sign-in page. */
export async function GET(request: Request) {
  const origin = originOf(request);
  const email = emailFromCookie(request.headers.get("cookie"));
  if (!email || !(await isActiveAccount(email))) return NextResponse.redirect(`${origin}/`);
  if (!(await whoopConfig())) return NextResponse.redirect(`${origin}/?whoop=not_configured`);
  // WHOOP wants an 8-character state; it comes back on the callback to prove it's our request
  const state = crypto.randomBytes(6).toString("base64url").slice(0, 8);
  const res = NextResponse.redirect(await authorizeUrl(origin, state, new URL(request.url).searchParams.has("extra")));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
