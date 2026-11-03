import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { emailFromCookie } from "~/server/whoop";
import { isActiveAccount } from "~/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the phone shows when a push arrives. Pushes carry no text; the service worker asks here,
 * with the person's own sign-in cookie, so only they can read it.
 */
export async function GET(request: Request): Promise<Response> {
  const email = emailFromCookie(request.headers.get("cookie"));
  if (!email || !(await isActiveAccount(email))) return Response.json(null, { status: 401 });
  const u = await db.query.users.findFirst({ where: eq(users.email, email), columns: { lastNotification: true } });
  return Response.json(u?.lastNotification ? (JSON.parse(u.lastNotification) as unknown) : null, {
    headers: { "Cache-Control": "no-store" },
  });
}
