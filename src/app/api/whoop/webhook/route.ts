import { handleWebhook, verifyWebhook } from "~/server/whoop";

export const dynamic = "force-dynamic";

/** WHOOP calls this when a sleep or recovery is ready (or deleted). */
export async function POST(request: Request) {
  const raw = await request.text();
  const ok = await verifyWebhook(
    raw,
    request.headers.get("x-whoop-signature"),
    request.headers.get("x-whoop-signature-timestamp"),
  );
  if (!ok) return new Response("bad signature", { status: 401 });
  try {
    await handleWebhook(JSON.parse(raw) as { user_id: number; id: string; type: string });
    return new Response("ok");
  } catch (error) {
    console.error("WHOOP webhook failed:", error);
    // non-2xx makes WHOOP retry later
    return new Response("error", { status: 500 });
  }
}
