import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";
import { pushSubscriptions, users, userTemperatureProfile } from "~/server/db/schema";
import {
  findProfile,
  getAuthUserAndToken,
  holdTargets,
  logApp,
  requireEmail,
  resolveControlSide,
  sendToSides,
} from "~/server/api/routers/user";
import { getSides, getSleepNights, otherSideTarget } from "~/server/eight/extras";
import { getNightLevels, summarizeNights } from "~/server/nights";
import { NOTIFY_KINDS, notify, prefsOf, vapidPublicKey } from "~/server/push";
import { kmBetween, nightWeather, skyWeather } from "~/server/weather";
import { parseHotPrev } from "~/lib/hotPrev";
import { ACCENTS, type Accent } from "~/lib/accents";

const sideInput = z.enum(["left", "right", "both"]);

/** {initial, mid, final} as saved by the night summaries, or null for older nights. */
const parseStages = (raw: string | null): { initial: number | null; mid: number | null; final: number | null } | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { initial: number | null; mid: number | null; final: number | null };
  } catch {
    return null;
  }
};
const MIN = 60_000;
// "I'm hot": how long and how much colder (pod levels are ×10 of the app's steps)
export const HOT_MINUTES = 20;
const HOT_STEPS = 4;
// nap: the warm-up at the end
export const NAP_WARM_MINUTES = 5;
// farther than this from home counts as away
const AWAY_KM = 100;

const userRow = async (email: string) => {
  const u = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!u) throw new TRPCError({ code: "UNAUTHORIZED", message: "Please sign in again." });
  return u;
};

/** The extras: nap, "I'm hot", colors, weather, travel, notifications, and nights kept for the long run. */
export const funRouter = createTRPCRouter({
  /** Everything the extras need on screen, in one call. */
  getExtras: publicProcedure.query(async ({ ctx }) => {
    const email = await requireEmail(ctx.headers);
    const u = await userRow(email);
    const subs = await db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).where(eq(pushSubscriptions.email, email));
    const hasHome = u.homeLat !== null && u.homeLon !== null;
    return {
      hot: u.hotUntil && u.hotUntil > new Date() ? { until: u.hotUntil, side: u.hotSide ?? "left" } : null,
      nap: u.napUntil && u.napUntil > new Date() ? { until: u.napUntil, side: u.napSide ?? "left" } : null,
      accent: (u.accentColor ?? "classic") as Accent,
      hasHome,
      weatherEnabled: u.weatherEnabled,
      weather: u.weatherEnabled && hasHome ? await nightWeather(u) : null,
      travelEnabled: u.travelEnabled,
      notify: prefsOf(u.notifyPrefs),
      phones: subs.length,
    };
  }),

  /** The weather and sun times at home, for the sky behind the 3D bed (null without a saved home). Kept 30 minutes. */
  getSky: publicProcedure.query(async ({ ctx }) => {
    const email = await requireEmail(ctx.headers);
    const u = await userRow(email);
    return skyWeather({ email, homeLat: u.homeLat, homeLon: u.homeLon });
  }),

  /**
   * Cools hard for 20 minutes, then puts the bed back (off if it was off, its old level if it was on).
   * Tapping again while it's active does nothing more: it never stacks colder, and stopHot ends it early.
   */
  imHot: publicProcedure.input(z.object({ side: sideInput.optional() })).mutation(async ({ input, ctx }) => {
    const { user, token } = await getAuthUserAndToken(ctx.headers);
    if (user.hotUntil && user.hotUntil > new Date()) {
      return { level: null as number | null, until: user.hotUntil, already: true };
    }
    const side = await resolveControlSide(token, user, input.side);
    const sides = await getSides(token);
    const targets = side === "both" ? (["left", "right"] as const) : ([side] as const);
    const prev: Record<string, { on: boolean; level: number | null }> = {};
    for (const t of targets) prev[t] = { on: sides.state[t].isOn, level: sides.state[t].target ?? sides.state[t].level ?? null };
    const base = sides.state[targets[0]];
    const level = Math.max(-100, (base.isOn ? base.target ?? base.level ?? 0 : 0) - HOT_STEPS * 10);
    await sendToSides(token, side, { on: !base.isOn || undefined, level });
    const until = new Date(Date.now() + HOT_MINUTES * MIN);
    await db.update(users).set({ hotUntil: until, hotSide: side, hotPrev: JSON.stringify(prev) }).where(eq(users.email, user.email));
    // the schedule waits exactly 20 minutes, then puts its own level back
    for (const target of await holdTargets(user.email, side)) {
      const p = await findProfile(user.email, target);
      if (p?.scheduleEnabled) {
        await db
          .update(userTemperatureProfile)
          .set({ manualHoldUntil: until })
          .where(and(eq(userTemperatureProfile.email, user.email), eq(userTemperatureProfile.side, target)));
      }
    }
    await logApp(user.email, "im_hot", level, until.toISOString(), side);
    return { level: level as number | null, until, already: false };
  }),

  /** Ends "I'm hot" now: the bed goes back to how it was, and the schedule takes over again. */
  stopHot: publicProcedure.mutation(async ({ ctx }) => {
    const { user, token } = await getAuthUserAndToken(ctx.headers);
    if (user.hotUntil) {
      const side = (user.hotSide ?? "left") as "left" | "right" | "both";
      const prev = parseHotPrev(user.hotPrev);
      const targets = side === "both" ? (["left", "right"] as const) : ([side] as const);
      for (const t of targets) {
        const p = prev[t];
        await sendToSides(token, t, p?.on && p.level !== null ? { on: true, level: p.level } : { on: false });
      }
      await db.update(users).set({ hotUntil: null, hotSide: null, hotPrev: null }).where(eq(users.email, user.email));
      for (const target of await holdTargets(user.email, side)) {
        await db
          .update(userTemperatureProfile)
          .set({ manualHoldUntil: null })
          .where(and(eq(userTemperatureProfile.email, user.email), eq(userTemperatureProfile.side, target)));
      }
      await logApp(user.email, "hot_ended", null, null, side);
    }
    return { success: true };
  }),

  /** Starts a nap: cool now, warm for the last 5 minutes, then off. */
  startNap: publicProcedure
    .input(z.object({ minutes: z.number().int().min(10).max(180), level: z.number().int().min(-100).max(100), warmLevel: z.number().int().min(-100).max(100), side: sideInput.optional() }))
    .mutation(async ({ input, ctx }) => {
      const { user, token } = await getAuthUserAndToken(ctx.headers);
      const side = await resolveControlSide(token, user, input.side);
      await sendToSides(token, side, { on: true, level: input.level });
      const until = new Date(Date.now() + input.minutes * MIN);
      await db
        .update(users)
        .set({ napUntil: until, napSide: side, napLevel: input.level, napWarmLevel: input.warmLevel })
        .where(eq(users.email, user.email));
      await logApp(user.email, "nap_started", input.level, String(input.minutes), side);
      return { until };
    }),

  stopNap: publicProcedure.mutation(async ({ ctx }) => {
    const { user, token } = await getAuthUserAndToken(ctx.headers);
    if (user.napUntil) {
      const side = (user.napSide ?? "left") as "left" | "right" | "both";
      await sendToSides(token, side, { on: false });
      await db.update(users).set({ napUntil: null, napSide: null }).where(eq(users.email, user.email));
      await logApp(user.email, "nap_ended", null, null, side);
    }
    return { success: true };
  }),

  setAccent: publicProcedure.input(z.object({ accent: z.enum(ACCENTS) })).mutation(async ({ input, ctx }) => {
    const email = await requireEmail(ctx.headers);
    await db.update(users).set({ accentColor: input.accent }).where(eq(users.email, email));
    return { success: true };
  }),

  /** Saves home from the phone's location (rounded to about 1 km), or forgets it. */
  setHome: publicProcedure
    .input(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).nullable())
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      const round = (n: number) => Math.round(n * 100) / 100;
      await db
        .update(users)
        .set(
          input
            ? { homeLat: round(input.lat), homeLon: round(input.lon), weatherCache: null }
            : { homeLat: null, homeLon: null, weatherCache: null, weatherEnabled: false, travelEnabled: false },
        )
        .where(eq(users.email, email));
      return { success: true };
    }),

  setWeather: publicProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ input, ctx }) => {
    const email = await requireEmail(ctx.headers);
    await db.update(users).set({ weatherEnabled: input.enabled }).where(eq(users.email, email));
    return { success: true };
  }),

  setTravel: publicProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ input, ctx }) => {
    const email = await requireEmail(ctx.headers);
    await db.update(users).set({ travelEnabled: input.enabled }).where(eq(users.email, email));
    return { success: true };
  }),

  /** Where the phone is now vs home. The location isn't saved. */
  checkTravel: publicProcedure
    .input(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }))
    .query(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      const u = await userRow(email);
      if (!u.travelEnabled || u.homeLat === null || u.homeLon === null) return { away: false, km: null, vacation: u.vacationMode };
      const km = Math.round(kmBetween({ lat: u.homeLat, lon: u.homeLon }, input));
      return { away: km > AWAY_KM, km, vacation: u.vacationMode };
    }),

  /** One summary per night and side (up to 120 nights): what the pod did. */
  getNightLevels: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(366).default(60), timezone: z.string().max(50) }))
    .query(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      await summarizeNights(email, input.timezone).catch((e) => console.error("Night summaries failed:", e));
      const rows = await getNightLevels(email, input.days);
      return rows.map((r) => ({
        night: r.night,
        side: r.side,
        avgLevel: r.avgLevel,
        minLevel: r.minLevel,
        maxLevel: r.maxLevel,
        onMinutes: r.onMinutes,
        manualChanges: r.manualChanges,
        scheduleRan: r.scheduleRan,
        firstOn: r.firstOn,
        stageLevels: parseStages(r.stageLevels),
      }));
    }),

  /** Both sides' sleep from Eight Sleep, for "who slept better" (the other side may not share it). */
  getBothSidesSleep: publicProcedure.input(z.object({ timezone: z.string().max(50) })).query(async ({ input, ctx }) => {
    const { token } = await getAuthUserAndToken(ctx.headers);
    const fmt = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: input.timezone });
    const to = new Date();
    const from = new Date(to.getTime() - 6 * 86_400_000);
    const sides = await getSides(token);
    const mine = await getSleepNights(token, input.timezone, fmt(from), fmt(to)).then((r) => r.days).catch(() => []);
    let theirs: typeof mine = [];
    try {
      const other = await otherSideTarget(token);
      if (other) theirs = (await getSleepNights({ ...token, eightUserId: other.id }, input.timezone, fmt(from), fmt(to))).days;
    } catch {
      // the other side's account doesn't share sleep with this one
    }
    const pick = (d: (typeof mine)[number]) => ({ day: d.day, score: d.score, sleepSeconds: d.sleepSeconds });
    return {
      own: sides.own,
      mine: mine.filter((d) => (d.sleepSeconds ?? 0) > 0).map(pick),
      theirs: theirs.filter((d) => (d.sleepSeconds ?? 0) > 0).map(pick),
    };
  }),

  /** The key a phone needs to ask for notifications. */
  getPushKey: publicProcedure.query(async ({ ctx }) => {
    await requireEmail(ctx.headers);
    return { key: await vapidPublicKey() };
  }),

  subscribePush: publicProcedure
    .input(z.object({ endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "Push address must be https"), quiet: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      await db
        .insert(pushSubscriptions)
        .values({ endpoint: input.endpoint, email })
        .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { email } });
      // "quiet": the phone re-registering by itself when Settings opens, no test notification
      if (!input.quiet) await notify(email, "test", "Notifications are on", "You'll hear from your Pod Hub only when something matters.");
      return { success: true };
    }),

  unsubscribePush: publicProcedure.input(z.object({ endpoint: z.string().max(1000) })).mutation(async ({ input, ctx }) => {
    const email = await requireEmail(ctx.headers);
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.email, email)));
    return { success: true };
  }),

  setNotify: publicProcedure
    .input(z.object({ kind: z.enum(NOTIFY_KINDS as [string, ...string[]]), enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      const u = await userRow(email);
      const prefs = { ...prefsOf(u.notifyPrefs), [input.kind]: input.enabled };
      await db.update(users).set({ notifyPrefs: JSON.stringify(prefs) }).where(eq(users.email, email));
      return prefs;
    }),

  testPush: publicProcedure.mutation(async ({ ctx }) => {
    const email = await requireEmail(ctx.headers);
    return notify(email, "test", "Test from Pod Hub", "Notifications work on this phone.");
  }),
});
