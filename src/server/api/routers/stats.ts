import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";
import {
  cronRuns,
  dailyCounters,
  events,
  invites,
  nightLevels,
  pushSubscriptions,
  users,
  userTemperatureProfile,
  whoopConnections,
} from "~/server/db/schema";
import { requireEmail, requireOwner } from "~/server/api/routers/user";
import { pendingRequests } from "~/server/access";
import { isDemoEmail } from "~/server/demo/session";
import { track } from "~/server/stats";
import { notify } from "~/server/push";
import { notifyOwner } from "~/server/notices";
import { mailSetup, sendMail } from "~/server/mail";

const DAY = 86_400_000;
// a visit counts as new after this long without the app open
const VISIT_GAP_MIN = 30;
// open "right now" (the Statistics page)
const LIVE_MIN = 3;

const clientInput = z.object({
  device: z.enum(["phone", "tablet", "computer"]),
  os: z.string().max(20),
  standalone: z.boolean(),
  lang: z.string().max(8),
  unit: z.enum(["f", "c"]),
});

type Client = z.infer<typeof clientInput>;
const parse = <T>(raw: string | null | undefined): T | null => {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const count = <T>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n);
};

/** Owner statistics: how people use the app and how it runs. Usage only; no sleep or health data. */
export const statsRouter = createTRPCRouter({
  /** The app says it's open (on start and every couple of minutes): last visit, device, and a visit event. */
  heartbeat: publicProcedure
    .input(
      z.object({
        client: clientInput,
        loadMs: z.number().int().min(0).max(120_000).optional(),
        checklist: z.object({ done: z.number().int().min(0).max(10), total: z.number().int().min(0).max(10), missing: z.array(z.string().max(20)).max(10) }).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      const u = await db.query.users.findFirst({ where: eq(users.email, email), columns: { lastSeenAt: true } });
      const newVisit = !u?.lastSeenAt || Date.now() - u.lastSeenAt.getTime() > VISIT_GAP_MIN * 60_000;
      await db.update(users).set({ lastSeenAt: new Date(), lastClient: JSON.stringify(input.client) }).where(eq(users.email, email));
      if (newVisit) {
        track(email, "visit", JSON.stringify({ ...input.client, loadMs: input.loadMs, checklist: input.checklist }));
        // anyone opening the app is a chance to notice the 5-minute schedule check has stopped
        const last = await db.select({ at: sql<Date | null>`max(${users.lastCronRunAt})` }).from(users);
        const at = last[0]?.at ? new Date(last[0].at) : null;
        if (at && Date.now() - at.getTime() > 20 * 60_000) {
          await notifyOwner("owner_cron", "cron", at.toISOString(), "Schedule check stopped", "cron-job.org hasn't called the app in over 20 minutes. Check the job there.").catch(() => undefined);
        }
      }
      return { ok: true };
    }),

  /** Small things the app reports itself: the tour, the setup checklist. */
  track: publicProcedure
    .input(z.object({ kind: z.string().regex(/^(tour_done|tour_skipped|checklist_hidden|ui:[a-z_]{1,30})$/), meta: z.string().max(100).optional() }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      track(email, input.kind, input.meta);
      return { ok: true };
    }),

  /** How many people opened the app today, in the owner's timezone, not counting the owner (the Statistics icon). */
  todayCount: publicProcedure.query(async ({ ctx }) => {
    const owner = (await requireOwner(ctx.headers)).toLowerCase();
    const profile = await db.query.userTemperatureProfile.findFirst({
      where: sql`lower(${userTemperatureProfile.email}) = ${owner}`,
      columns: { timezoneTZ: true },
    });
    // midnight on the owner's clock
    const now = new Date();
    const wall = new Date(now.toLocaleString("en-US", { timeZone: profile?.timezoneTZ ?? "America/New_York" }));
    const sinceMidnight = ((wall.getHours() * 60 + wall.getMinutes()) * 60 + wall.getSeconds()) * 1000;
    const rows = await db
      .select({ email: users.email })
      .from(users)
      .where(gte(users.lastSeenAt, new Date(now.getTime() - sinceMidnight)));
    return { n: rows.filter((r) => r.email.toLowerCase() !== owner && !isDemoEmail(r.email)).length };
  }),

  /** Everything on the Statistics screen, in one go (owner only). */
  getStats: publicProcedure.query(async ({ ctx }) => {
    await requireOwner(ctx.headers);
    const now = Date.now();
    const all = (await db.select().from(users)).filter((u) => !isDemoEmail(u.email));
    const profiles = await db.select().from(userTemperatureProfile);
    const whoop = new Set((await db.select({ email: whoopConnections.email }).from(whoopConnections)).map((w) => w.email.toLowerCase()));
    const phones = new Set((await db.select({ email: pushSubscriptions.email }).from(pushSubscriptions)).map((p) => p.email.toLowerCase()));
    const ev = await db.select().from(events).where(gte(events.at, new Date(now - 90 * DAY)));
    const visits = ev.filter((e) => e.kind === "visit");
    const runs = await db
      .select({ ranAt: cronRuns.ranAt, action: cronRuns.action, source: cronRuns.source, email: cronRuns.email })
      .from(cronRuns)
      .where(gte(cronRuns.ranAt, new Date(now - 7 * DAY)));
    const counters = await db.select().from(dailyCounters).where(gte(dailyCounters.day, dayOf(new Date(now - 14 * DAY))));
    const nights = await db.select({ manualChanges: nightLevels.manualChanges }).from(nightLevels).where(gte(nightLevels.night, dayOf(new Date(now - 30 * DAY))));
    const invited = await db.select({ email: invites.email }).from(invites);
    const waiting = await pendingRequests();

    const lc = (e: string | null) => (e ?? "").toLowerCase();
    const activeSince = (ms: number) => new Set(visits.filter((v) => v.at.getTime() > now - ms).map((v) => lc(v.email))).size;
    const clientOf = (u: (typeof all)[number]) => parse<Client>(u.lastClient);

    // 1, 4: sign-ups and retention by week (last 8 weeks)
    const weekStart = (t: number) => {
      const d = new Date(t);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    };
    const weeks = [...Array(8).keys()].map((i) => weekStart(now - (7 - i) * 7 * DAY));
    const recent = new Set(visits.filter((v) => v.at.getTime() > now - 7 * DAY).map((v) => lc(v.email)));
    const cohorts = weeks.map((w) => {
      const joined = all.filter((u) => weekStart(u.createdAt.getTime()) === w);
      return { week: w, joined: joined.length, stillActive: joined.filter((u) => recent.has(lc(u.email))).length };
    });

    // 13: the setup checklist, from each person's latest visit
    const lastVisit = new Map<string, { checklist?: { done: number; total: number; missing: string[] }; loadMs?: number }>();
    for (const v of [...visits].sort((a, b) => a.at.getTime() - b.at.getTime())) lastVisit.set(lc(v.email), parse(v.meta) ?? {});
    const lists = [...lastVisit.values()].map((v) => v.checklist).filter((c): c is NonNullable<typeof c> => !!c);
    const loads = [...lastVisit.values()].map((v) => v.loadMs).filter((n): n is number => typeof n === "number" && n > 0);

    // 15, 16: schedule checks per hour (last 48 h) and changes per night (last 7)
    const cron = runs.filter((r) => r.source === "cron");
    const hours = [...Array(48).keys()].map((i) => {
      const from = now - (48 - i) * 3_600_000;
      const inHour = cron.filter((r) => r.ranAt.getTime() >= from && r.ranAt.getTime() < from + 3_600_000);
      return { at: new Date(from).toISOString(), checks: new Set(inHour.map((r) => r.ranAt.toISOString().slice(0, 16))).size };
    });
    const changes = new Set(["turned_on", "set_level", "turned_off"]);
    const perNight = [...Array(7).keys()].map((i) => {
      const from = now - (7 - i) * DAY;
      return {
        day: dayOf(new Date(from)),
        changes: cron.filter((r) => r.ranAt.getTime() >= from && r.ranAt.getTime() < from + DAY && changes.has(r.action)).length,
        errors: cron.filter((r) => r.ranAt.getTime() >= from && r.ranAt.getTime() < from + DAY && r.action === "error").length,
      };
    });

    // 17, 18, 20, 21: daily counters
    const days = [...Array(14).keys()].map((i) => dayOf(new Date(now - (13 - i) * DAY)));
    const counter = (day: string, test: (k: string) => boolean) => counters.filter((c) => c.day === day && test(c.key)).reduce((a, c) => a + c.n, 0);
    const daily = days.map((d) => ({
      day: d,
      eightCalls: counter(d, (k) => k === "eight_calls"),
      eightErrors: counter(d, (k) => k.startsWith("eight_error_")),
      pushSent: counter(d, (k) => k === "push_sent"),
      pushDropped: counter(d, (k) => k === "push_dropped"),
      emailsSent: counter(d, (k) => k === "email_sent"),
      emailsFailed: counter(d, (k) => k === "email_failed"),
    }));
    const errorTypes = count(
      counters.filter((c) => c.key.startsWith("eight_error_")).flatMap((c) => Array<string>(c.n).fill(c.key.slice(12))),
      (k) => k,
    );
    const pushKinds = count(
      counters.filter((c) => c.key.startsWith("push_") && !["push_sent", "push_dropped"].includes(c.key)).flatMap((c) => Array<string>(c.n).fill(c.key.slice(5))),
      (k) => k,
    );

    // 19: slow answers (> 2 s) in the last 7 days
    const slow = ev.filter((e) => e.kind === "slow" && e.at.getTime() > now - 7 * DAY).map((e) => {
      const [path = "?", ms = "0"] = (e.meta ?? "").split(" ");
      return { path, ms: Number(ms) };
    });
    const slowest = count(slow, (s) => s.path).map(({ key, n }) => {
      const xs = slow.filter((s) => s.path === key).map((s) => s.ms);
      return { path: key, times: n, avgMs: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), maxMs: Math.max(...xs) };
    });

    // 22: the Pods as last seen by the app
    const pods = all.map((u) => ({ email: u.email, ...(parse<{ online: boolean | null; hasWater: boolean | null; needsPriming: boolean | null; at: string }>(u.podState) ?? { online: null, hasWater: null, needsPriming: null, at: null }) }));

    const people = all
      .map((u) => {
        const c = clientOf(u);
        const mine = profiles.filter((p) => lc(p.email) === lc(u.email));
        return {
          email: u.email,
          name: u.displayName,
          joinedAt: u.createdAt,
          lastSeenAt: u.lastSeenAt,
          live: !!u.lastSeenAt && now - u.lastSeenAt.getTime() < LIVE_MIN * 60_000,
          inactive: !u.lastSeenAt || now - u.lastSeenAt.getTime() > 14 * DAY,
          device: c ? `${c.device} · ${c.os}${c.standalone ? " · app" : " · browser"}` : null,
          lang: c?.lang ?? null,
          unit: c?.unit ?? null,
          hasSchedule: mine.length > 0,
          following: mine.some((p) => p.scheduleEnabled),
          whoop: whoop.has(lc(u.email)),
          notifications: phones.has(lc(u.email)),
          signInOk: !u.authError,
          away: u.vacationMode,
          napping: !!u.napUntil && u.napUntil.getTime() > now,
          errors7d: runs.filter((r) => lc(r.email) === lc(u.email) && r.action === "error").length,
        };
      })
      .sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0));

    const bedHours = count(
      profiles.filter((p) => p.side !== "both"),
      (p) => p.bedTime.slice(0, 2),
    ).sort((a, b) => ((Number(a.key) + 12) % 24) - ((Number(b.key) + 12) % 24));
    const avgOf = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 100 : null);
    const sideProfiles = profiles.filter((p) => p.side !== "both");

    return {
      // people
      total: all.length,
      newThisWeek: all.filter((u) => u.createdAt.getTime() > now - 7 * DAY).length,
      signups: weeks.map((w) => ({ week: w, n: all.filter((u) => weekStart(u.createdAt.getTime()) === w).length })),
      activeToday: activeSince(DAY),
      activeWeek: activeSince(7 * DAY),
      activeMonth: activeSince(30 * DAY),
      liveNow: people.filter((p) => p.live).length,
      cohorts,
      devices: count(all.map(clientOf).filter((c): c is Client => !!c), (c) => c.device),
      systems: count(all.map(clientOf).filter((c): c is Client => !!c), (c) => c.os),
      installed: all.map(clientOf).filter((c) => c?.standalone).length,
      languages: count(all.map(clientOf).filter((c): c is Client => !!c), (c) => c.lang),
      units: count(all.map(clientOf).filter((c): c is Client => !!c), (c) => (c.unit === "c" ? "°C" : "°F")),
      requests: {
        waiting: waiting.length,
        approved: ev.filter((e) => e.kind === "request_approved").length,
        denied: ev.filter((e) => e.kind === "request_denied").length,
        asked: ev.filter((e) => e.kind === "request").length,
        invited: invited.length,
      },
      // use
      withSchedule: new Set(profiles.map((p) => lc(p.email))).size,
      following: new Set(profiles.filter((p) => p.scheduleEnabled).map((p) => lc(p.email))).size,
      features: count(ev.filter((e) => e.kind.startsWith("feature:") && e.at.getTime() > now - 30 * DAY), (e) => e.kind.slice(8)).slice(0, 20),
      manualPerNight: nights.length ? Math.round((nights.reduce((a, n) => a + n.manualChanges, 0) / nights.length) * 10) / 10 : null,
      bedHours,
      avgLevels: {
        initial: avgOf(sideProfiles.map((p) => p.initialSleepLevel)),
        mid: avgOf(sideProfiles.map((p) => p.midStageSleepLevel)),
        final: avgOf(sideProfiles.map((p) => p.finalSleepLevel)),
      },
      whoop: whoop.size,
      notificationsOn: phones.size,
      checklist: {
        reported: lists.length,
        finished: lists.filter((c) => c.done >= c.total).length,
        stuckOn: count(lists.flatMap((c) => c.missing), (k) => k),
      },
      tour: {
        done: ev.filter((e) => e.kind === "tour_done").length,
        skipped: count(ev.filter((e) => e.kind === "tour_skipped"), (e) => e.meta ?? "?"),
      },
      // health
      hours,
      perNight,
      daily,
      errorTypes,
      pushKinds,
      slowest,
      avgLoadMs: loads.length ? Math.round(loads.reduce((a, b) => a + b, 0) / loads.length) : null,
      lastCronRunAt: all.reduce<Date | null>((a, u) => (u.lastCronRunAt && (!a || u.lastCronRunAt > a) ? u.lastCronRunAt : a), null),
      // pods
      pods: {
        online: pods.filter((p) => p.online === true).length,
        offline: pods.filter((p) => p.online === false).length,
        noWater: pods.filter((p) => p.hasWater === false).length,
        needsPriming: pods.filter((p) => p.needsPriming === true).length,
        unknown: pods.filter((p) => p.online === null).length,
      },
      signInExpired: people.filter((p) => !p.signInOk).map((p) => p.email),
      away: people.filter((p) => p.away).length,
      napping: people.filter((p) => p.napping).length,
      people,
    };
  }),

  /** One person's usage, for the owner (no sleep data). */
  getPerson: publicProcedure.input(z.object({ email: z.string().max(255) })).query(async ({ input, ctx }) => {
    await requireOwner(ctx.headers);
    const u = await db.query.users.findFirst({ where: sql`lower(${users.email}) = lower(${input.email})` });
    if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "No such account." });
    const since = new Date(Date.now() - 30 * DAY);
    const mine = await db.select().from(events).where(and(sql`lower(${events.email}) = lower(${u.email})`, gte(events.at, since))).orderBy(desc(events.at)).limit(200);
    const errs = await db
      .select({ ranAt: cronRuns.ranAt, message: cronRuns.message })
      .from(cronRuns)
      .where(and(sql`lower(${cronRuns.email}) = lower(${u.email})`, eq(cronRuns.action, "error")))
      .orderBy(desc(cronRuns.ranAt))
      .limit(5);
    const profiles = await db.query.userTemperatureProfile.findMany({ where: eq(userTemperatureProfile.email, u.email) });
    const subs = await db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).where(eq(pushSubscriptions.email, u.email));
    return {
      email: u.email,
      name: u.displayName,
      joinedAt: u.createdAt,
      lastSeenAt: u.lastSeenAt,
      client: parse<Client>(u.lastClient),
      visits30d: mine.filter((e) => e.kind === "visit").length,
      features: count(mine.filter((e) => e.kind.startsWith("feature:")), (e) => e.kind.slice(8)).slice(0, 10),
      schedules: profiles.map((p) => ({ side: p.side, on: p.scheduleEnabled, bedTime: p.bedTime.slice(0, 5), wakeupTime: p.wakeupTime.slice(0, 5) })),
      signInOk: !u.authError,
      lastErrors: errs.map((e) => ({ at: e.ranAt, message: (e.message ?? "").slice(0, 120) })),
      phones: subs.length,
      pod: parse<{ online: boolean | null; hasWater: boolean | null; needsPriming: boolean | null; at: string }>(u.podState),
      away: u.vacationMode,
      canEmail: !!(await mailSetup()),
    };
  }),

  /** The owner writes to one person: a phone notification or an email from the owner's Gmail. */
  messagePerson: publicProcedure
    .input(z.object({ email: z.string().max(255), via: z.enum(["push", "email"]), title: z.string().trim().min(1).max(80), text: z.string().trim().min(1).max(1000) }))
    .mutation(async ({ input, ctx }) => {
      await requireOwner(ctx.headers);
      const u = await db.query.users.findFirst({ where: sql`lower(${users.email}) = lower(${input.email})`, columns: { email: true } });
      if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "No such account." });
      if (input.via === "push") {
        const r = await notify(u.email, "test", input.title, input.text);
        if (!r.sent) throw new TRPCError({ code: "BAD_REQUEST", message: r.errors[0] ?? "They don't have notifications on." });
        return { sent: r.sent };
      }
      try {
        await sendMail(u.email, input.title, input.text);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The email didn't go out." });
      }
      return { sent: 1 };
    }),
});
