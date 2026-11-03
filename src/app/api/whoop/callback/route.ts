import { NextResponse } from "next/server";
import { connectWhoop, emailFromCookie, STATE_COOKIE } from "~/server/whoop";
import { recordActivity } from "~/server/activityLog";
import { originOf } from "../origin";
import { isActiveAccount } from "~/server/access";

export const dynamic = "force-dynamic";

/** WHOOP sends you back here after you approve; saves the connection and returns to the app. */
export async function GET(request: Request) {
  const origin = originOf(request);
  const url = new URL(request.url);
  const cookieEmail = emailFromCookie(request.headers.get("cookie"));
  const email = cookieEmail && (await isActiveAccount(cookieEmail)) ? cookieEmail : null;
  // every outcome goes to the activity log, with WHOOP's own reason when it gives one
  const back = async (result: string, detail?: string | null) => {
    if (email && result !== "connected") {
      await recordActivity(email, {
        stage: "manual",
        source: "app",
        action: "whoop_connect_failed",
        message: [result, detail].filter(Boolean).join(": ").slice(0, 400),
      });
    }
    const res = NextResponse.redirect(`${origin}/?whoop=${encodeURIComponent(result)}`);
    res.cookies.delete(STATE_COOKIE);
    return res;
  };
  const state = request.headers
    .get("cookie")
    ?.split(";")
    .map((r) => r.trim())
    .find((r) => r.startsWith(`${STATE_COOKIE}=`))
    ?.split("=")[1];
  const code = url.searchParams.get("code");
  if (!email) return back("signed_out");
  // WHOOP sends ?error=… when it refuses (e.g. a scope the developer app doesn't allow)
  const err = url.searchParams.get("error");
  if (err) return back(err === "access_denied" ? "declined" : err, url.searchParams.get("error_description"));
  if (!code) return back("no_code");
  if (!state || state !== url.searchParams.get("state")) {
    // the sign-in started in a different window/browser than it finished in
    return back("bad_state", state ? "state didn't match" : "no state cookie (opened in another browser?)");
  }
  try {
    await connectWhoop(email, code, origin);
    return back("connected");
  } catch (error) {
    console.error("WHOOP connect failed:", error);
    return back("error", error instanceof Error ? error.message : String(error));
  }
}
