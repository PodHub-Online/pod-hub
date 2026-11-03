import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";
import { cronRuns, feedback, users, userTemperatureProfile } from "~/server/db/schema";
import {
  adjustTemperatureSafely,
  getAuthUserAndToken,
  logApp,
  requireEmail,
  requireOwner,
} from "~/server/api/routers/user";
import { pendingRequests } from "~/server/access";
import { getEightSchedule } from "~/server/eight/extras";
import { mailSetup, saveMailSetup, sendMail } from "~/server/mail";
import { isDemoEmail } from "~/server/demo/session";
import { notifyOwner } from "~/server/notices";

const sideInput = z.enum(["left", "right", "both"]);
const time = z.string().regex(/^\d{2}:\d{2}$/);
const DAY = 86_400_000;

/** Weekend schedule, room-aware cooling, feedback, usage, approval emails, the Eight Sleep schedule. */
export const moreRouter = createTRPCRouter({
  // ---------- Weekend nights (per side) ----------

  /** Turn weekend nights on (days + their own bedtime and wake-up) or off (days = 0). */
  setWeekend: publicProcedure
    .input(z.object({ side: sideInput, days: z.number().int().min(0).max(127), bedTime: time.nullable(), wakeupTime: time.nullable() }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      const on = input.days > 0 && !!input.bedTime && !!input.wakeupTime;
      const updated = await db
        .update(userTemperatureProfile)
        .set({
          weekendDays: on ? input.days : 0,
          weekendBedTime: on ? input.bedTime : null,
          weekendWakeupTime: on ? input.wakeupTime : null,
          updatedAt: new Date(),
        })
        .where(and(eq(userTemperatureProfile.email, email), eq(userTemperatureProfile.side, input.side)))
        .returning({ side: userTemperatureProfile.side });
      if (!updated.length) throw new TRPCError({ code: "NOT_FOUND", message: "Save a schedule for this side first." });
      await logApp(email, on ? "weekend_on" : "weekend_off", null, on ? `${input.bedTime} → ${input.wakeupTime}` : null, input.side);
      await adjustTemperatureSafely(email);
      return { success: true };
    }),

  // ---------- Room-aware cooling ----------

  getRoom: publicProcedure.query(async ({ ctx }) => {
    const email = await requireEmail(ctx.headers);
    const u = await db.query.users.findFirst({ where: eq(users.email, email) });
    let last: { at?: string; tempC?: number | null } = {};
    try {
      last = JSON.parse(u?.roomCache ?? "{}") as typeof last;
    } catch {
      // nothing measured yet
    }
    return { enabled: u?.roomAware ?? false, threshold: u?.roomAwareC ?? 26.5, lastC: last.tempC ?? null, lastAt: last.at ?? null };
  }),

  setRoom: publicProcedure
    .input(z.object({ enabled: z.boolean(), threshold: z.number().min(18).max(32) }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      await db.update(users).set({ roomAware: input.enabled, roomAwareC: Math.round(input.threshold * 2) / 2 }).where(eq(users.email, email));
      return { success: true };
    }),

  // ---------- Feedback ----------

  sendFeedback: publicProcedure
    .input(z.object({ kind: z.enum(["bug", "idea", "question"]), text: z.string().trim().min(3).max(2000), meta: z.string().max(300).optional() }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      // a few notes a day is plenty; this keeps the table from being flooded
      const today = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(feedback)
        .where(and(eq(feedback.email, email), gte(feedback.createdAt, new Date(Date.now() - DAY))));
      if ((today[0]?.n ?? 0) >= 10) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That's a lot of notes today. Try again tomorrow." });
      const [row] = await db.insert(feedback).values({ email, kind: input.kind, text: input.text, meta: input.meta ?? null }).returning({ id: feedback.id });
      await notifyOwner("owner_feedback", `feedback:${row?.id ?? Date.now()}`, "1", `New ${input.kind} from ${email.split("@")[0]}`, input.text.slice(0, 140)).catch(() => undefined);
      return { success: true };
    }),

  myFeedback: publicProcedure.query(async ({ ctx }) => {
    const email = await requireEmail(ctx.headers);
    return db
      .select({ id: feedback.id, kind: feedback.kind, text: feedback.text, status: feedback.status, createdAt: feedback.createdAt, reply: feedback.reply, repliedAt: feedback.repliedAt })
      .from(feedback)
      .where(eq(feedback.email, email))
      .orderBy(desc(feedback.createdAt))
      .limit(10);
  }),

  /** Owner: everyone's notes, newest first. */
  listFeedback: publicProcedure.query(async ({ ctx }) => {
    await requireOwner(ctx.headers);
    return db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(100);
  }),

  setFeedbackStatus: publicProcedure
    .input(z.object({ id: z.number().int(), status: z.enum(["new", "read", "fixed"]) }))
    .mutation(async ({ input, ctx }) => {
      await requireOwner(ctx.headers);
      await db.update(feedback).set({ status: input.status }).where(eq(feedback.id, input.id));
      return { success: true };
    }),

  /** Owner: answer a note by email, from the Gmail set up for approval emails. The reply is kept with the note. */
  replyFeedback: publicProcedure
    .input(z.object({ id: z.number().int(), text: z.string().trim().min(2).max(4000) }))
    .mutation(async ({ input, ctx }) => {
      await requireOwner(ctx.headers);
      const note = await db.query.feedback.findFirst({ where: eq(feedback.id, input.id) });
      if (!note) throw new TRPCError({ code: "NOT_FOUND", message: "That note is gone." });
      if (!(await mailSetup())) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Set up approval emails first (Invites → Approval emails): replies are sent from that Gmail." });
      }
      const kind = note.kind === "bug" ? "bug report" : note.kind === "idea" ? "idea" : "question";
      const quoted = note.text
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      const body = `${input.text}\n\n—\nPod Hub (not affiliated with Eight Sleep)\n\nYou wrote:\n${quoted}\n`;
      try {
        await sendMail(note.email, `Re: your ${kind} about Pod Hub`, body);
      } catch (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `The email didn't go out: ${error instanceof Error ? error.message : String(error)}` });
      }
      const repliedAt = new Date();
      await db
        .update(feedback)
        .set({ reply: input.text, repliedAt, status: note.status === "new" ? "read" : note.status })
        .where(eq(feedback.id, input.id));
      return { success: true, repliedAt };
    }),

  // ---------- Usage (owner) ----------

  getUsage: publicProcedure.query(async ({ ctx }) => {
    await requireOwner(ctx.headers);
    const since = new Date(Date.now() - DAY);
    const all = (await db.select({ email: users.email, createdAt: users.createdAt, lastCronRunAt: users.lastCronRunAt }).from(users)).filter((u) => !isDemoEmail(u.email));
    const runs = await db
      .select({ action: cronRuns.action, source: cronRuns.source, email: cronRuns.email, ranAt: cronRuns.ranAt })
      .from(cronRuns)
      .where(gte(cronRuns.ranAt, since));
    const sched = runs.filter((r) => r.source === "cron");
    const changes = new Set(["turned_on", "set_level", "turned_off"]);
    const newFeedback = await db.select({ n: sql<number>`count(*)::int` }).from(feedback).where(eq(feedback.status, "new"));
    const lastRun = all.reduce<Date | null>((a, u) => (u.lastCronRunAt && (!a || u.lastCronRunAt > a) ? u.lastCronRunAt : a), null);
    return {
      people: all.length,
      joinedThisWeek: all.filter((u) => u.createdAt.getTime() > Date.now() - 7 * DAY).length,
      activeToday: new Set(runs.filter((r) => r.source === "app").map((r) => r.email.toLowerCase())).size,
      checks: new Set(sched.map((r) => r.ranAt.toISOString().slice(0, 16))).size,
      changesSent: sched.filter((r) => changes.has(r.action)).length,
      errors: sched.filter((r) => r.action === "error").length,
      backedOff: sched.filter((r) => r.action === "backed_off").length,
      lastRunAt: lastRun,
      waitingRequests: (await pendingRequests()).length,
      newFeedback: newFeedback[0]?.n ?? 0,
    };
  }),

  // ---------- Approval emails through the owner's Gmail ----------

  getMailSetup: publicProcedure.query(async ({ ctx }) => {
    await requireOwner(ctx.headers);
    const s = await mailSetup();
    // the app password never leaves the server
    return s ? { configured: true as const, user: s.user, onApprove: s.onApprove } : { configured: false as const, user: null, onApprove: true };
  }),

  /** Saves the Gmail address + app password after a test email to the owner goes through. */
  saveMailSetup: publicProcedure
    .input(z.object({ user: z.string().trim().email().max(255), pass: z.string().max(64).optional(), onApprove: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const owner = await requireOwner(ctx.headers);
      const current = await mailSetup();
      // Google shows app passwords in groups of four ("abcd efgh ijkl mnop")
      const typed = input.pass?.replace(/\s+/g, "") ?? "";
      // left empty: keep the saved one (only for the same address)
      const pass = typed !== "" ? typed : current?.user === input.user ? current.pass : "";
      if (!pass) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the 16-letter app password from Google." });
      const setup = { user: input.user, pass, onApprove: input.onApprove };
      if (input.pass || !current) {
        try {
          await sendMail(owner, "Pod Hub: approval emails are on", "This is a test. From now on, people you approve in Pod Hub get a short \"You're in\" email from this address.", setup);
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Gmail didn't accept it." });
        }
      }
      await saveMailSetup(setup);
      return { success: true };
    }),

  removeMailSetup: publicProcedure.mutation(async ({ ctx }) => {
    await requireOwner(ctx.headers);
    await saveMailSetup(null);
    return { success: true };
  }),

  // ---------- Start from the Eight Sleep app's schedule ----------

  getEightSchedule: publicProcedure.query(async ({ ctx }) => {
    const { token } = await getAuthUserAndToken(ctx.headers);
    try {
      return { available: true as const, ...(await getEightSchedule(token)) };
    } catch {
      return { available: false as const, bedTime: null, wakeupTime: null, levels: { initial: null, mid: null, final: null }, eightScheduleOn: null };
    }
  }),
});
