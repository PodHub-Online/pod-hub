import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";
import { whoopConnections, whoopSleeps } from "~/server/db/schema";
import {
  emailFromCookie,
  getWhoopExtras,
  getWhoopNights,
  revealWhoopSecret,
  saveWhoopConfig,
  syncWhoop,
  whoopConfig,
} from "~/server/whoop";
import { recordActivity } from "~/server/activityLog";
import { isActiveAccount, isOwner } from "~/server/access";


const requireEmail = async (headers: Headers) => {
  const email = emailFromCookie(headers.get("cookie"));
  if (!email || !(await isActiveAccount(email))) throw new TRPCError({ code: "UNAUTHORIZED", message: "Please sign in again." });
  return email;
};

/** The WHOOP app keys belong to the owner: everyone else only connects their own WHOOP. */
const requireOwner = async (headers: Headers) => {
  const email = await requireEmail(headers);
  if (!(await isOwner(email))) throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can change the WHOOP app keys." });
  return email;
};

export const whoopRouter = createTRPCRouter({
  /** Whether WHOOP is set up on the server and connected for you. */
  getStatus: publicProcedure.query(async ({ ctx }) => {
    const email = await requireEmail(ctx.headers);
    const c = await db.query.whoopConnections.findFirst({ where: eq(whoopConnections.email, email) });
    const cfg = await whoopConfig();
    const owner = await isOwner(email);
    const host = ctx.headers.get("x-forwarded-host") ?? ctx.headers.get("host") ?? "localhost:3000";
    const origin = `${ctx.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
    return {
      configured: !!cfg,
      // what to paste into the WHOOP developer dashboard
      redirectUrl: `${origin}/api/whoop/callback`,
      webhookUrl: `${origin}/api/whoop/webhook`,
      // the Client ID is shown back; the secret never leaves the server
      clientId: owner ? cfg?.clientId ?? null : null,
      connected: !!c,
      connectedAt: c?.connectedAt ?? null,
      lastSyncAt: c?.lastSyncAt ?? null,
      lastWebhookAt: c?.lastWebhookAt ?? null,
    };
  }),

  /** Saves the WHOOP developer app keys entered in Settings. */
  saveSetup: publicProcedure
    .input(z.object({ clientId: z.string().trim().min(8).max(200), clientSecret: z.string().max(400).optional() }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireOwner(ctx.headers);
      const existing = await whoopConfig();
      if (!existing && !input.clientSecret?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Add the Client Secret too." });
      }
      await saveWhoopConfig(input.clientId, input.clientSecret);
      await recordActivity(email, { stage: "manual", source: "app", action: "whoop_keys_saved" });
      return { success: true };
    }),

  /** Strain, calories, heart rate, workouts and body measurements, straight from WHOOP. */
  getExtras: publicProcedure.query(async ({ ctx }) => {
    const email = await requireEmail(ctx.headers);
    try {
      return await getWhoopExtras(email, 14);
    } catch (error) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: error instanceof Error ? error.message : "WHOOP didn't answer." });
    }
  }),

  /** The saved Client Secret, shown only when you tap the eye in Settings. */
  revealSecret: publicProcedure.mutation(async ({ ctx }) => {
    await requireOwner(ctx.headers);
    return { secret: await revealWhoopSecret() };
  }),

  sync: publicProcedure.mutation(async ({ ctx }) => {
    const email = await requireEmail(ctx.headers);
    try {
      return { count: await syncWhoop(email, 14) };
    } catch (error) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: error instanceof Error ? error.message : "WHOOP sync failed." });
    }
  }),

  disconnect: publicProcedure.mutation(async ({ ctx }) => {
    const email = await requireEmail(ctx.headers);
    await db.delete(whoopSleeps).where(eq(whoopSleeps.email, email));
    await db.delete(whoopConnections).where(eq(whoopConnections.email, email));
    await recordActivity(email, { stage: "manual", source: "app", action: "whoop_disconnected" });
    return { success: true };
  }),

  /** Nights from WHOOP (newest first): the raw sleep and recovery records. */
  getNights: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(62).default(14) }).optional())
    .query(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      return getWhoopNights(email, input?.days ?? 14);
    }),
});
