import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { db } from "~/server/db";
import { userTemperatureProfile, users } from "~/server/db/schema";
import { callerFromHeaders, recordActivity, type ActivityStage, type CallerInfo } from "~/server/activityLog";
import { and, eq } from "drizzle-orm";
import { obtainFreshAccessToken } from "~/server/eight/auth";
import { type Token } from "~/server/eight/types";
import { setAwayMode } from "~/server/eight/user";
import { applyToSide, getSides, statusFromError, type PodSide } from "~/server/eight/extras";
import { syncWhoopIfStale } from "~/server/whoop";
import { isDemoEmail } from "~/server/demo/session";
import { open, seal, sealLegacyTokens } from "~/server/crypto";
import { getPodHealth } from "~/server/eight/extras";
import { notify, prefsOf } from "~/server/push";
import { pushSubscriptions, whoopConnections } from "~/server/db/schema";
import { nightWeather } from "~/server/weather";
import { parseHotPrev } from "~/lib/hotPrev";
import { hotPlan } from "~/lib/schedule";
import { AFTER_WAKE_CHECK_MIN, currentCycle, decideStage, minutesSinceWake, needsPod, wallClock } from "~/lib/scheduleCore";
import { getSleepNights } from "~/server/eight/extras";
import { getNightLevels, summarizeNights } from "~/server/nights";
import { notifyOnce, notifyOwner } from "~/server/notices";
import { pruneStats } from "~/server/stats";
import { NEWS } from "~/lib/whatsNew";
import { AuthError } from "~/server/eight/auth";
import { accessRequests, cronRuns, events, feedback, nightLevels, whoopSleeps } from "~/server/db/schema";
import { mailSetup, sendMail } from "~/server/mail";
import { gt, gte, desc as descOrder, inArray, isNull, sql as sqlOp } from "drizzle-orm";
import { ownerEmail, pendingRequests } from "~/server/access";

export const runtime = "nodejs";

async function retryApiCall<T>(apiCall: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await apiCall();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
  throw new Error("This should never happen due to the for loop, but TypeScript doesn't know that");
}

interface TestMode {
  enabled: boolean;
  currentTime: Date;
}

type CronStage = Exclude<ActivityStage, "manual">;
type CronAction =
  | "turned_on"
  | "set_level"
  | "turned_off"
  | "no_change"
  | "skipped_vacation"
  | "vacation_ended"
  | "no_schedule"
  | "schedule_off"
  | "manual_hold"
  | "day_off"
  | "skipped_whole_bed"
  | "idle"
  | "backed_off"
  | "nap"
  | "nap_ended"
  | "hot_ended"
  | "error";

export interface CronUserResult {
  email: string;
  side?: "left" | "right" | "both";
  stage: CronStage;
  action: CronAction;
  level: number | null;
  message: string | null;
  /** false when the activity log row couldn't be written */
  logged: boolean;
  logError?: string;
}

export interface CronSummary {
  ranAt: string;
  results: CronUserResult[];
}

export type CronTrigger = "cron" | "check" | "auto";

export interface AdjustOptions {
  /** run only this person's schedule (in-app saves and "Run now"); every user when omitted */
  onlyEmail?: string;
}

// People handled at the same time, and when to stop starting new ones (the route may run 60 s)
const BATCH_SIZE = 5;
const TIME_BUDGET_MS = 45_000;
// How long to leave someone alone after Eight Sleep refuses (too many requests, or a dead sign-in)
const BACKOFF_MIN = 60;

// Nap mode: the warm-up at the end (matches the app's nap card)
const NAP_WARM_MIN = 5;
// Pod health for notifications: at most this often, and only during someone's night
const HEALTH_EVERY_MIN = 60;
// Room-aware cooling: how long the Pod's room reading counts, and how early before pre-cool to look
const ROOM_CACHE_HOURS = 12;
const ROOM_LOOK_AHEAD_MIN = 120;
// Bedtime reminder: this many minutes before pre-cool starts
const BEDTIME_NOTICE_MIN = 15;
// Weekly digest: Sunday morning, from this hour (the person's time)
const DIGEST_HOUR = 9;
// Hot night (from the weather or a warm room): start cooling this much earlier, and one step colder

export async function adjustTemperature(
  testMode?: TestMode,
  trigger: CronTrigger = "cron",
  caller: CallerInfo | null = null,
  options: AdjustOptions = {},
): Promise<CronSummary> {
  const isTest = !!testMode?.enabled;
  const results: CronUserResult[] = [];
  const only = options.onlyEmail?.toLowerCase();
  const mine = (email: string) => !only || email.toLowerCase() === only;
  const runStartedAt = Date.now();
  // tokens saved before encryption existed get encrypted on the next scheduled run
  if (!isTest && trigger === "cron") {
    await sealLegacyTokens().catch((e) => console.error("Could not encrypt old tokens:", e));
  }
  try {
    // the demo account never runs (it has no rows, but never let one slip through)
    const profiles = (
      await db
        .select()
        .from(userTemperatureProfile)
        .innerJoin(users, eq(userTemperatureProfile.email, users.email))
    ).filter((p) => !isDemoEmail(p.users.email) && mine(p.users.email));

    // Accounts without a saved schedule have nothing to automate. Say so in their log
    // instead of silently skipping them.
    if (!isTest) {
      const withSchedule = new Set(profiles.map((p) => p.users.email));
      const allUsers = await db.select({ email: users.email }).from(users);
      for (const u of allUsers.filter((u) => !withSchedule.has(u.email) && !isDemoEmail(u.email) && mine(u.email))) {
        const r = await recordActivity(u.email, { stage: "off", action: "no_schedule", source: trigger, caller });
        if (trigger === "cron") {
          await db.update(users).set({ lastCronRunAt: new Date() }).where(eq(users.email, u.email));
        }
        results.push({ email: u.email, stage: "off", action: "no_schedule", level: null, message: null, logged: r.ok, logError: r.error });
      }
    }

    // One pass per person (token refresh, vacation), then one per side of the bed
    const byEmail = new Map<string, typeof profiles>();
    for (const p of profiles) byEmail.set(p.users.email, [...(byEmail.get(p.users.email) ?? []), p]);

    // WHOOP: pull new nights if the webhook hasn't delivered them (at most every 30 min)
    if (!isTest) await Promise.all([...byEmail.keys()].map((email) => syncWhoopIfStale(email)));

    const runUser = async (email: string, rows: typeof profiles) => {
      const userRow = rows[0]!.users;
      const userStartedAt = Date.now();
      const logUser = async (stage: CronStage, action: CronAction, message: string | null = null) => {
        const r = await recordActivity(email, { stage, action, message, source: trigger, caller, side: null, durationMs: Date.now() - userStartedAt });
        results.push({ email, stage, action, level: null, message, logged: r.ok, logError: r.error });
      };
      let token: Token = {
        eightAccessToken: open(userRow.eightAccessToken),
        eightRefreshToken: open(userRow.eightRefreshToken),
        eightExpiresAtPosix: userRow.eightTokenExpiresAt.getTime(),
        eightUserId: userRow.eightUserId,
      };
      const now = isTest ? testMode.currentTime : new Date();
      let sides: Awaited<ReturnType<typeof getSides>> | null = null;
      // only the scheduled cron backs off; a check you start yourself always runs
      const backOff = async (error: unknown) => {
        const status = statusFromError(error);
        if (isTest || trigger !== "cron" || !(status === 429 || status === 401 || status === 403)) return;
        await db
          .update(users)
          .set({ eightBackoffUntil: new Date(Date.now() + BACKOFF_MIN * 60_000) })
          .where(eq(users.email, email));
      };
      // notifications only go out from the real 5-minute check, and each one only once per occasion
      const live = !isTest && trigger === "cron";
      const say = async (kind: Parameters<typeof notifyOnce>[1], key: string, value: string, title: string, body: string) => {
        if (live) await notifyOnce(email, kind, key, value, title, body).catch((e) => console.error("Notification failed:", e));
      };
      const freshToken = async () => {
        if (isTest || now.getTime() <= token.eightExpiresAtPosix) return;
        try {
          token = await obtainFreshAccessToken(token.eightRefreshToken, token.eightUserId);
        } catch (error) {
          // Eight Sleep no longer takes this sign-in: nothing can run until they sign in again
          if (error instanceof AuthError) {
            await db.update(users).set({ authError: true }).where(eq(users.email, email));
            await say("signin", "signin", new Date().toISOString().slice(0, 10), "Sign in again", "Eight Sleep stopped accepting your sign-in, so your schedule can't run. Open the app and sign in again.");
          }
          throw error;
        }
        if (userRow.authError) await db.update(users).set({ authError: false }).where(eq(users.email, email));
        await db
          .update(users)
          .set({
            eightAccessToken: seal(token.eightAccessToken),
            eightRefreshToken: seal(token.eightRefreshToken),
            eightTokenExpiresAt: new Date(token.eightExpiresAtPosix),
          })
          .where(eq(users.email, email));
      };

      // Room-aware cooling: last night's bedroom temperature from the Pod's own sensor, read at most every 12 hours
      let roomChecked: boolean | null = null;
      const warmRoom = async (tz: string) => {
        if (roomChecked !== null) return roomChecked;
        let cache: { at?: string; tempC?: number | null } = {};
        try {
          cache = JSON.parse(userRow.roomCache ?? "{}") as typeof cache;
        } catch {
          // read it again
        }
        let tempC = cache.tempC ?? null;
        if (!cache.at || Date.now() - new Date(cache.at).getTime() > ROOM_CACHE_HOURS * 3_600_000) {
          try {
            await freshToken();
            const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: tz });
            const { days } = await getSleepNights(token, tz, day(Date.now() - 2 * 86_400_000), day(Date.now()));
            tempC = [...days].reverse().find((d) => d.roomTempC !== null)?.roomTempC ?? null;
          } catch (error) {
            console.error(`Room temperature unavailable for ${email}:`, error instanceof Error ? error.message : error);
          }
          await db.update(users).set({ roomCache: JSON.stringify({ at: new Date().toISOString(), tempC }) }).where(eq(users.email, email));
        }
        roomChecked = tempC !== null && tempC >= userRow.roomAwareC;
        return roomChecked;
      };

      try {
        // "Last cron run" only counts real calls of the cron URL
        if (!isTest && trigger === "cron") {
          await db.update(users).set({ lastCronRunAt: new Date() }).where(eq(users.email, email));
        }

        // Eight Sleep said no recently: give it a rest instead of asking every 5 minutes
        const backoff = userRow.eightBackoffUntil;
        if (!isTest && trigger === "cron" && backoff && now < backoff) {
          await logUser("off", "backed_off", backoff.toISOString());
          return;
        }

        // Vacation mode (whole bed): leave the pod alone until it ends (auto-resumes after vacationUntil)
        if (userRow.vacationMode) {
          const until = userRow.vacationUntil;
          if (until && now >= until) {
            if (!isTest) {
              await db.update(users).set({ vacationMode: false, vacationUntil: null }).where(eq(users.email, email));
              try {
                await freshToken();
                await setAwayMode(token, token.eightUserId, "end");
              } catch (error) {
                console.error(`Could not end Eight Sleep away mode for ${email}:`, error);
              }
              await logUser("vacation", "vacation_ended");
            }
          } else {
            if (!isTest) await logUser("vacation", "skipped_vacation");
            if (until && until.getTime() - now.getTime() <= 24 * 3_600_000) {
              await say("vacation", "vacation", until.toISOString(), "Away ends soon", "Away mode ends within a day, and your schedule starts again that night.");
            }
            return;
          }
        }

        // "I'm hot" ended: put the bed back how it was (off if it was off), even outside schedule hours
        if (!isTest && userRow.hotUntil && now >= userRow.hotUntil) {
          const hotSide = (userRow.hotSide ?? "left") as PodSide | "both";
          const targets: PodSide[] = hotSide === "both" ? ["left", "right"] : [hotSide];
          const prev = parseHotPrev(userRow.hotPrev);
          await freshToken();
          const s = await retryApiCall(() => getSides(token));
          sides = s;
          for (const t of targets) {
            const p = prev[t];
            const back = p?.on && p.level !== null ? { on: true, level: p.level } : { on: false };
            const cur = s.state[t];
            if (back.on ? !cur.isOn || cur.target !== back.level : cur.isOn) await retryApiCall(() => applyToSide(token, s.ids[t], back));
          }
          await db.update(users).set({ hotUntil: null, hotSide: null, hotPrev: null }).where(eq(users.email, email));
          await logUser("off", "hot_ended");
          // the schedule picks up from here on the next run
          return;
        }

        // Nap mode takes over until it ends: its level, warm for the last minutes, then off
        if (!isTest && userRow.napUntil) {
          const napSide = (userRow.napSide ?? "left") as PodSide | "both";
          const targets: PodSide[] = napSide === "both" ? ["left", "right"] : [napSide];
          await freshToken();
          const s = await retryApiCall(() => getSides(token));
          sides = s;
          if (now >= userRow.napUntil) {
            for (const t of targets) if (s.state[t].isOn) await retryApiCall(() => applyToSide(token, s.ids[t], { on: false }));
            await db.update(users).set({ napUntil: null, napSide: null }).where(eq(users.email, email));
            await logUser("off", "nap_ended");
            await say("nap", "nap", userRow.napUntil.toISOString(), "Nap over", "Your nap is done and the bed is off.");
            // the schedule picks up from here on the next run
            return;
          }
          const warm = userRow.napUntil.getTime() - now.getTime() <= NAP_WARM_MIN * 60_000;
          const level = (warm ? userRow.napWarmLevel : userRow.napLevel) ?? 0;
          for (const t of targets) {
            const cur = s.state[t];
            if (!cur.isOn || cur.target !== level) await retryApiCall(() => applyToSide(token, s.ids[t], { on: !cur.isOn || undefined, level }));
          }
          await logUser("off", "nap", warm ? "warming" : null);
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error preparing schedule check for ${email}:`, message);
        if (!isTest) {
          await backOff(error);
          const r = await recordActivity(email, { stage: "off", action: "error", message, source: trigger, caller });
          results.push({ email, stage: "off", action: "error", level: null, message, logged: r.ok, logError: r.error });
        }
        return;
      }

      // a schedule step that failed during the night (for the "schedule didn't run" notification)
      let nightError: string | null = null;
      // Whole-bed schedule switched on: it drives both sides, and the side schedules wait
      const wholeBed = rows.some((r) => r.userTemperatureProfiles.side === "both" && r.userTemperatureProfiles.scheduleEnabled);

      for (const profile of rows) {
        const schedule = profile.userTemperatureProfiles;
        const isWhole = schedule.side === "both";
        // the whole-bed schedule reads and reports through the left side
        const rowSide: PodSide = schedule.side === "right" ? "right" : "left";
        const logSide = isWhole ? "both" : rowSide;
        const startedAt = Date.now();
        let before: { podWasOn: boolean | null; levelBefore: number | null; targetBefore: number | null } = {
          podWasOn: null,
          levelBefore: null,
          targetBefore: null,
        };
        const log = async (stage: CronStage, action: CronAction, level: number | null = null, message: string | null = null) => {
          const r = await recordActivity(email, {
            stage,
            action,
            level,
            message,
            source: trigger,
            caller,
            side: logSide,
            ...before,
            durationMs: Date.now() - startedAt,
          });
          results.push({ email, side: logSide, stage, action, level, message, logged: r.ok, logError: r.error });
        };
        const setHold = (until: Date | null) =>
          db
            .update(userTemperatureProfile)
            .set({ manualHoldUntil: until })
            .where(and(eq(userTemperatureProfile.email, email), eq(userTemperatureProfile.side, schedule.side)));

        let stage: CronStage = "off";
        try {
          // only one plan runs: the whole-bed schedule when it's on, else each side's own
          if (wholeBed !== isWhole) {
            if (!isTest && !isWhole) await log("off", "skipped_whole_bed");
            continue;
          }
          // "Follow schedule" switched off: leave this side to manual control
          if (!schedule.scheduleEnabled) {
            if (!isTest) await log("off", "schedule_off");
            continue;
          }
          // A manual change holds the schedule off until its next stage
          const hold = schedule.manualHoldUntil;
          if (hold && now < hold) {
            if (!isTest) await log("off", "manual_hold", null, hold.toISOString());
            await say("hold", `hold:${logSide}`, hold.toISOString(), "Manual change", `Your schedule takes over again at ${clockIn(hold, schedule.timezoneTZ)}.`);
            continue;
          }
          if (hold && !isTest) await setHold(null);

          const userNow = wallClock(now, schedule.timezoneTZ);
          // a hot night (weather at home, or a warm bedroom last night): cool earlier and one step colder while falling asleep
          let hotWhy: "weather" | "room" | null = null;
          if (!isTest && userRow.weatherEnabled && (await nightWeather(userRow))?.hot) hotWhy = "weather";
          if (!isTest && !hotWhy && userRow.roomAware) {
            const usual = currentCycle(userNow, schedule);
            const soon = usual.preHeatingTime.getTime() - userNow.getTime() <= ROOM_LOOK_AHEAD_MIN * 60_000 && userNow < usual.wakeupTime;
            if (soon && (await warmRoom(schedule.timezoneTZ))) hotWhy = "room";
          }
          const hot = !!hotWhy;
          const plan = hot ? hotPlan(schedule) : schedule;
          // Decide what this side should be doing right now
          const decision = decideStage(userNow, schedule, plan);
          const adjustedCycle = decision.cycle;
          if (decision.dayOff) {
            if (!isTest) await log("off", "day_off", null, String(adjustedCycle.preHeatingTime.getDay()));
            continue;
          }
          stage = decision.stage;
          const targetLevel = decision.level;

          if (live) {
            const night = localDay(adjustedCycle.preHeatingTime);
            const toPre = adjustedCycle.preHeatingTime.getTime() - userNow.getTime();
            const who = isWhole ? "The whole bed" : rowSide === "left" ? "The left side" : "The right side";
            if (toPre > 0 && toPre <= BEDTIME_NOTICE_MIN * 60_000) {
              await say("bedtime", `bedtime:${logSide}`, night, "Bedtime soon", `${who} starts at ${hhmm(adjustedCycle.preHeatingTime)}. In bed at ${hhmm(adjustedCycle.bedTime)}.`);
            }
            if (hot && toPre > 0 && toPre <= 60 * 60_000) {
              await say("hotnight", "hotnight", night, hotWhy === "room" ? "Warm room tonight" : "Hot night tonight", `Cooling starts at ${hhmm(adjustedCycle.preHeatingTime)}, 30 minutes early, and one step colder.`);
            }
            const afterWake = minutesSinceWake(userNow, schedule);
            if (afterWake >= 30 && afterWake < 90) await morningNotices(email, schedule.timezoneTZ, schedule.midStageSleepLevel, say);
          }

          if (isTest) {
            console.log(`[TEST MODE] ${email} ${rowSide}: stage=${stage} target=${targetLevel ?? "off"}`);
            results.push({ email, side: logSide, stage, action: "no_change", level: targetLevel, message: "test mode", logged: false });
            continue;
          }

          // Outside the night (and past the after-wake check), there's nothing to ask Eight Sleep
          if (!needsPod(userNow, schedule, decision)) {
            await log("off", "idle");
            continue;
          }

          // read the bed once per person, and only when a side needs it
          if (!sides) {
            await freshToken();
            sides = await retryApiCall(() => getSides(token));
          }

          const st = sides.state[rowSide];
          before = { podWasOn: st.isOn, levelBefore: st.level, targetBefore: st.target };
          if (targetLevel !== null && (stage === "initial" || stage === "mid") && userNow.getTime() - adjustedCycle.bedTime.getTime() >= 60 * 60_000 && st.isOn && st.level !== null && st.target !== null && Math.abs(st.level - st.target) >= 20) {
            await say("notreached", `notreached:${rowSide}`, localDay(adjustedCycle.preHeatingTime), "Not at temperature yet", `The ${rowSide} side is at ${step(st.level)}, aiming for ${step(st.target)}, an hour after bedtime.`);
          }

          // In Both, the right side is checked too, so it can't drift from the left
          const drive: PodSide[] = isWhole ? ["left", "right"] : [rowSide];
          const did: Partial<Record<PodSide, CronAction>> = {};
          for (const s of drive) {
            const cur = sides.state[s];
            const id = sides.ids[s];
            did[s] = "no_change";
            if (targetLevel === null) {
              if (cur.isOn) {
                await retryApiCall(() => applyToSide(token, id, { on: false }));
                did[s] = "turned_off";
                const pastWake = minutesSinceWake(userNow, schedule);
                if (pastWake >= 30 && pastWake < AFTER_WAKE_CHECK_MIN) {
                  await say("lefton", `lefton:${s}`, localDay(userNow), "Bed was still on", `The ${s} side was still on after wake-up, so the schedule turned it off.`);
                }
              }
            } else {
              const level = targetLevel;
              const turnOn = !cur.isOn;
              const change = turnOn || cur.target !== level;
              if (change) {
                await retryApiCall(() => applyToSide(token, id, { on: turnOn || undefined, level }));
                did[s] = turnOn ? "turned_on" : "set_level";
              }
            }
          }
          // what the schedule's own side did; in Both, also say when the right side was brought back in line
          const other: PodSide = rowSide === "left" ? "right" : "left";
          let action: CronAction = did[rowSide] ?? "no_change";
          let note: string | null = hot && (stage === "preheat" || stage === "initial") ? (hotWhy === "room" ? "warm room: earlier and colder" : "hot night: earlier and colder") : null;
          if (isWhole && did[other] && did[other] !== "no_change") {
            note = [note, `${other} side corrected`].filter(Boolean).join(", ");
            if (action === "no_change") action = did[other]!;
          }
          await log(stage, action, targetLevel, note);
          console.log(`[${email}] ${logSide}: stage=${stage} target=${targetLevel} action=${action}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Error adjusting ${rowSide} side for ${email}:`, message);
          if (!isTest) {
            await backOff(error);
            await log(stage, "error", null, message);
            if (stage !== "off") nightError = message;
          }
        }
      }
      if (!isTest && trigger === "cron") await phoneNotices(email, userRow, token, !!sides, nightError).catch((e) => console.error("Notifications failed:", e));
      if (!isTest && trigger === "cron") await weeklyDigest(email, userRow, rows[0]!.userTemperatureProfiles.timezoneTZ).catch((e) => console.error("Weekly digest failed:", e));
    };

    // a few people at a time; anyone not reached in time is handled on the next run
    const people = [...byEmail];
    for (let i = 0; i < people.length; i += BATCH_SIZE) {
      if (Date.now() - runStartedAt > TIME_BUDGET_MS) {
        console.warn(`Schedule check out of time: ${people.length - i} people left for the next run`);
        break;
      }
      await Promise.all(people.slice(i, i + BATCH_SIZE).map(([email, rows]) => runUser(email, rows)));
    }
    if (!isTest && trigger === "cron") await ownerNotices(results, byEmail.size).catch((e) => console.error("Owner notifications failed:", e));
  } catch (error) {
    console.error("Error fetching user profiles:", error instanceof Error ? error.message : String(error));
    throw error;
  }
  return { ranAt: new Date().toISOString(), results };
}

/** "YYYY-MM-DD" of a wall-clock Date (the schedule's own local time). */
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
/** A real moment shown in a time zone, "23:30". */
const clockIn = (d: Date, tz: string) => d.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
/** −100…100 → "−3" / "+2" */
const step = (raw: number) => {
  const v = Math.round(raw / 10);
  return v > 0 ? `+${v}` : String(v);
};

/**
 * Once each morning (30–90 minutes after wake-up): last night's summary, a streak worth
 * celebrating, the monthly report, an app update, and an auto-tune suggestion on Sundays.
 * All from what the app already keeps; nothing is asked of Eight Sleep.
 */
async function morningNotices(
  email: string,
  tz: string,
  deepLevel: number,
  say: (kind: Parameters<typeof notifyOnce>[1], key: string, value: string, title: string, body: string) => Promise<void>,
) {
  const local = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const today = localDay(local);
  // last night, from the activity log
  const since = new Date(Date.now() - 14 * 3_600_000);
  const rows = await db
    .select({ action: cronRuns.action, source: cronRuns.source })
    .from(cronRuns)
    .where(and(sqlOp`lower(${cronRuns.email}) = lower(${email})`, gte(cronRuns.ranAt, since)));
  const changes = rows.filter((r) => r.source === "cron" && ["turned_on", "set_level", "turned_off"].includes(r.action)).length;
  const problems = rows.filter((r) => r.action === "error").length;
  if (changes || problems) {
    await say(
      "morning",
      "morning",
      today,
      "Good morning",
      problems ? `Last night the schedule had ${problems} problem${problems > 1 ? "s" : ""}. The Activity log has the details.` : `Last night the schedule ran fine (${changes} change${changes === 1 ? "" : "s"}).`,
    );
  }

  // nights on schedule in a row
  await summarizeNights(email, tz).catch(() => undefined);
  const nights = await getNightLevels(email, 120);
  const ran = new Set(nights.filter((n) => n.scheduleRan).map((n) => n.night));
  let streak = 0;
  const d = new Date(`${today}T12:00:00`);
  for (;;) {
    d.setDate(d.getDate() - 1);
    if (!ran.has(localDay(d))) break;
    streak++;
  }
  if ([7, 14, 30, 60, 100].includes(streak)) await say("streak", "streak", `${streak}:${today}`, `${streak} nights in a row 🎉`, `Your schedule ran ${streak} nights in a row.`);

  if (local.getDate() === 1) {
    await say("monthly", "monthly", today.slice(0, 7), "Your month in sleep", "Last month's report is ready on the Sleep tab.");
  }
  const news = NEWS[0];
  if (news) await say("news", "news", news.date, "What's new in Pod Hub", news.items[0] ?? "Open the app to see what changed.");

  // Sundays: auto-tune for deep sleep, from WHOOP's deep sleep and the level each night
  if (local.getDay() === 0) {
    const tip = await deepSleepTip(email, tz, Math.round(deepLevel / 10));
    if (tip) await say("autotune", "autotune", `${tip.level}:${today}`, "Auto-tune has a suggestion", `Your deep sleep was ${tip.pct}% longer at ${tip.level > 0 ? "+" : ""}${tip.level}. Open Sleep to use it.`);
  }
}

/** The deep-sleep level with the most WHOOP deep sleep (10+ nights, 2+ at each level, 8%+ better). */
async function deepSleepTip(email: string, tz: string, current: number) {
  const sleeps = await db
    .select({ start: whoopSleeps.start, sleep: whoopSleeps.sleep })
    .from(whoopSleeps)
    .where(and(eq(whoopSleeps.email, email), gte(whoopSleeps.start, new Date(Date.now() - 60 * 86_400_000))))
    .orderBy(descOrder(whoopSleeps.start));
  if (sleeps.length < 10) return null;
  const levels = await db.select().from(nightLevels).where(and(eq(nightLevels.email, email), gte(nightLevels.night, new Date(Date.now() - 61 * 86_400_000).toISOString().slice(0, 10))));
  const byNight = new Map<string, number>();
  for (const n of levels) {
    let mid: number | null = null;
    try {
      mid = (JSON.parse(n.stageLevels ?? "null") as { mid?: number | null } | null)?.mid ?? null;
    } catch {
      // older night
    }
    const l = mid ?? n.avgLevel;
    if (l !== null && !byNight.has(n.night)) byNight.set(n.night, Math.round(l / 10));
  }
  const groups = new Map<number, number[]>();
  for (const w of sleeps) {
    let deepMs: number | null = null;
    try {
      deepMs = (JSON.parse(w.sleep) as { score?: { stage_summary?: { total_slow_wave_sleep_time_milli?: number } } }).score?.stage_summary?.total_slow_wave_sleep_time_milli ?? null;
    } catch {
      // skip
    }
    const night = new Date(w.start.getTime() - 12 * 3_600_000).toLocaleDateString("en-CA", { timeZone: tz });
    const level = byNight.get(night);
    if (deepMs === null || level === undefined) continue;
    groups.set(level, [...(groups.get(level) ?? []), deepMs]);
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const g = [...groups.entries()].filter(([, xs]) => xs.length >= 2).map(([level, xs]) => ({ level, deep: avg(xs) }));
  const usable = [...groups.values()].reduce((a, xs) => a + xs.length, 0);
  const best = g.sort((a, b) => b.deep - a.deep)[0];
  const now = g.find((x) => x.level === current);
  if (usable < 10 || !best || !now || best.level === current) return null;
  const gain = (best.deep - now.deep) / now.deep;
  return gain >= 0.08 ? { level: best.level, pct: Math.round(gain * 100) } : null;
}

/** The owner hears when several people's schedules fail at once, and gets a short daily summary. */
/**
 * New join requests, emailed to the owner from their own Gmail (the approval-email setup):
 * everything that arrived since the last check goes out as one email, and each request is
 * only ever emailed once.
 */
async function requestEmails() {
  const fresh = await db.select().from(accessRequests).where(isNull(accessRequests.emailedAt)).orderBy(accessRequests.requestedAt);
  if (!fresh.length) return;
  const setup = await mailSetup();
  const owner = await ownerEmail();
  if (!setup || !owner) return;
  const waiting = (await pendingRequests()).length;
  const list = fresh.map((r) => `• ${r.firstName ? `${r.firstName} (${r.email})` : r.email}, asked ${r.requestedAt.toUTCString().slice(5, 22)} UTC`);
  const subject = fresh.length === 1 ? `Pod Hub: ${fresh[0]!.firstName ?? fresh[0]!.email} asked to join` : `Pod Hub: ${fresh.length} people asked to join`;
  const text = [
    fresh.length === 1 ? "Someone asked to join Pod Hub:" : `${fresh.length} people asked to join Pod Hub:`,
    "",
    ...list,
    "",
    waiting > fresh.length ? `${waiting} requests are waiting in total.` : "",
    "Open the app → tap the app icon → Invites to approve or deny.",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
  try {
    await sendMail(owner, subject, text, setup);
    await db.update(accessRequests).set({ emailedAt: new Date() }).where(inArray(accessRequests.email, fresh.map((r) => r.email)));
  } catch (error) {
    // not marked: the next check tries again
    console.error("Request email failed:", error instanceof Error ? error.message : error);
  }
}

/**
 * People who signed in since the last check (every 5 minutes), as one notification to the owner:
 * who is new, who came back, and how many have the app open right now. Nothing goes out when
 * nobody signed in. Remembers the last sign-in it told about, so none is sent twice.
 */
async function signinNotice() {
  const owner = await ownerEmail();
  if (!owner) return;
  const me = await db.query.users.findFirst({ where: eq(users.email, owner), columns: { notifyState: true } });
  let lastId = 0;
  try {
    lastId = Number((JSON.parse(me?.notifyState ?? "{}") as Record<string, unknown>)["once:signins"] ?? 0) || 0;
  } catch {
    // start over
  }
  const rows = await db
    .select({ id: events.id, email: events.email, meta: events.meta })
    .from(events)
    .where(
      and(
        eq(events.kind, "signin"),
        gt(events.id, lastId),
        // never more than an hour back (first run, or after the notification was off for a while)
        gte(events.at, new Date(Date.now() - 3_600_000)),
        sqlOp`lower(${events.email}) <> lower(${owner})`,
      ),
    )
    .orderBy(events.id);
  if (!rows.length) return;
  const emails = [...new Set(rows.map((r) => r.email!))];
  const named = await db.select({ email: users.email, name: users.displayName }).from(users).where(inArray(users.email, emails));
  const nameOf = (email: string) => named.find((n) => n.email === email)?.name ?? email.split("@")[0]!;
  const fresh = emails.filter((e) => rows.some((r) => r.email === e && r.meta === "new"));
  const back = emails.filter((e) => !fresh.includes(e));
  const live = await db.select({ n: sqlOp<number>`count(*)::int` }).from(users).where(gte(users.lastSeenAt, new Date(Date.now() - 3 * 60_000)));
  const title = fresh.length
    ? fresh.length === 1
      ? `New user: ${nameOf(fresh[0]!)}`
      : `${fresh.length} new users`
    : `${back.length} sign-in${back.length === 1 ? "" : "s"}`;
  const parts = [
    fresh.length ? `New: ${fresh.map(nameOf).join(", ")}.` : "",
    back.length ? `Signed in again: ${back.map(nameOf).join(", ")}.` : "",
    `${live[0]?.n ?? 0} using the app now.`,
  ];
  await notifyOwner("owner_signins", "signins", String(rows[rows.length - 1]!.id), title, parts.filter(Boolean).join(" "));
}

async function ownerNotices(results: CronUserResult[], people: number) {
  await requestEmails().catch((e) => console.error("Request emails failed:", e));
  await signinNotice().catch((e) => console.error("Sign-in notice failed:", e));
  const failing = new Set(results.filter((r) => r.action === "error").map((r) => r.email)).size;
  if (failing >= 3 || (people >= 2 && failing * 2 >= people)) {
    const bucket = `${new Date().toISOString().slice(0, 10)}:${Math.floor(new Date().getUTCHours() / 6)}`;
    await notifyOwner("owner_errors", "errors", bucket, "Eight Sleep errors piling up", `${failing} of ${people} people's schedules failed on the last check.`);
  }
  const owner = await ownerEmail();
  if (!owner) return;
  const profile = await db.query.userTemperatureProfile.findFirst({ where: eq(userTemperatureProfile.email, owner) });
  const tz = profile?.timezoneTZ ?? "UTC";
  const local = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  if (local.getHours() < 9) return;
  const day = localDay(local);
  const since = new Date(Date.now() - 86_400_000);
  const errs = await db.select({ n: sqlOp<number>`count(*)::int` }).from(cronRuns).where(and(eq(cronRuns.action, "error"), gte(cronRuns.ranAt, since)));
  const fb = await db.select({ n: sqlOp<number>`count(*)::int` }).from(feedback).where(eq(feedback.status, "new"));
  const waiting = (await pendingRequests()).length;
  const sent = await notifyOwner(
    "owner_daily",
    "daily",
    day,
    "Pod Hub today",
    `${people} people · ${errs[0]?.n ?? 0} errors in 24 h · ${waiting} request${waiting === 1 ? "" : "s"} waiting · ${fb[0]?.n ?? 0} new feedback`,
  );
  // once a day is also when old statistics get cleaned up
  if (sent || local.getHours() === 9) await pruneStats().catch(() => undefined);
}

/**
 * Phone notifications, only for people who turned them on and only on a change: the schedule
 * failed tonight, water ran out, priming finished, WHOOP stopped working. Pod health is asked
 * at most hourly and only when the bed was already being read (someone's night), so it adds
 * few calls to Eight Sleep.
 */
async function phoneNotices(
  email: string,
  user: typeof users.$inferSelect,
  token: Token,
  inNight: boolean,
  nightError: string | null,
) {
  const subs = await db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).where(eq(pushSubscriptions.email, email)).limit(1);
  if (!subs.length) return;
  const prefs = prefsOf(user.notifyPrefs);
  type NoticeState = { healthAt?: string; hasWater?: boolean | null; priming?: boolean | null; errorDay?: string; whoopError?: boolean };
  let state: NoticeState = {};
  try {
    state = JSON.parse(user.notifyState ?? "{}") as NoticeState;
  } catch {
    // start over
  }
  const next = { ...state };
  const today = new Date().toISOString().slice(0, 10);
  if (nightError && prefs.schedule && state.errorDay !== today) {
    await notify(email, "schedule", "Schedule didn't run", "Eight Sleep didn't take tonight's change. Check that the Pod is online.");
    next.errorDay = today;
  }
  if (inNight && (prefs.water || prefs.priming) && (!state.healthAt || Date.now() - new Date(state.healthAt).getTime() > HEALTH_EVERY_MIN * 60_000)) {
    const h = await getPodHealth(token).catch(() => null);
    if (h) {
      next.healthAt = new Date().toISOString();
      if (h.hasWater === false && state.hasWater !== false) await notify(email, "water", "Pod needs water", "Refill the tank before tonight.");
      if (h.online === false) await notifyOnce(email, "offline", "offline", new Date().toISOString().slice(0, 10), "Pod is offline", "Your Pod lost its connection during the night. Check its Wi-Fi and power.");
      if (state.priming === true && h.priming === false) await notify(email, "priming", "Priming done", "Your Pod is ready.");
      next.hasWater = h.hasWater;
      next.priming = h.priming;
    }
  }
  if (prefs.whoop) {
    const c = await db.query.whoopConnections.findFirst({ where: eq(whoopConnections.email, email) });
    // a connection that hasn't synced in two days has stopped working
    const broken = !!c && !!c.lastSyncAt && Date.now() - c.lastSyncAt.getTime() > 48 * 3600_000;
    if (broken && !state.whoopError) await notify(email, "whoop", "WHOOP disconnected", "Open Sleep → WHOOP to connect again.");
    next.whoopError = broken;
  }
  if (JSON.stringify(next) !== JSON.stringify(state)) {
    await db.update(users).set({ notifyState: JSON.stringify(next) }).where(eq(users.email, email));
  }
}

/**
 * Sunday morning: one notification with last week's nights. Built only from what the app
 * already keeps (night summaries), so it never asks Eight Sleep for anything.
 */
async function weeklyDigest(email: string, user: typeof users.$inferSelect, tz: string) {
  const local = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  if (local.getDay() !== 0 || local.getHours() < DIGEST_HOUR) return;
  if (user.lastDigestAt && Date.now() - user.lastDigestAt.getTime() < 5 * 86_400_000) return;
  if (!prefsOf(user.notifyPrefs).digest) return;
  const subs = await db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).where(eq(pushSubscriptions.email, email)).limit(1);
  if (!subs.length) return;
  // mark it first so a slow send can't make it go out twice
  await db.update(users).set({ lastDigestAt: new Date() }).where(eq(users.email, email));
  const week = (await getNightLevels(email, 8)).filter((n) => n.side === "left" || n.side === "right");
  const nights = new Map<string, typeof week>();
  for (const n of week) nights.set(n.night, [...(nights.get(n.night) ?? []), n]);
  const list = [...nights.values()].slice(0, 7);
  if (!list.length) return;
  const onSchedule = list.filter((ns) => ns.some((n) => n.scheduleRan)).length;
  const levels = week.map((n) => n.avgLevel).filter((l): l is number => l !== null);
  const avg = levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length / 10) : null;
  const parts = [`${onSchedule} of ${list.length} nights on schedule`];
  if (avg !== null) parts.push(`average level ${avg > 0 ? `+${avg}` : avg}`);
  parts.push("Open Sleep for the details.");
  await notify(email, "digest", "Your week in sleep 🌙", parts.join(" · "));
}

/** "jane@example.com" → "hu***@gmail.com" for responses that leave the app */
function maskEmail(email: string) {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 2)}***@${domain}`;
}

/** The cron secret, compared in constant time so timing can't reveal it. */
function authorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!authorized(request.headers.get("authorization"))) {
    return new Response("Unauthorized", { status: 401 });
  } else {
    try {
      const testTimeParam = request.nextUrl.searchParams.get("testTime");
      // pretend-time runs are for local testing only, never on the live site
      if (testTimeParam && process.env.NODE_ENV === "production") {
        return new Response("testTime is only available in development", { status: 403 });
      }
      if (testTimeParam) {
        const testTime = new Date(Number(testTimeParam)* 1000);
        if (isNaN(testTime.getTime())) {
          throw new Error("Invalid testTime parameter");
        }
        console.log(`[TEST MODE] Running temperature adjustment cron job with test time: ${testTime.toISOString()}`);
        const summary = await adjustTemperature({ enabled: true, currentTime: testTime });
        return Response.json({ success: true, test: true, ...summary, results: summary.results.map((r) => ({ ...r, email: maskEmail(r.email) })) });
      }
      // The response body shows up in cron-job.org's history, handy for checking what happened
      const summary = await adjustTemperature(undefined, "cron", callerFromHeaders(request.headers));
      return Response.json({
        success: true,
        ...summary,
        results: summary.results.map((r) => ({ ...r, email: maskEmail(r.email) })),
      });
    } catch (error) {
      console.error("Error in temperature adjustment cron job:", error instanceof Error ? error.message : String(error));
      return new Response("Internal server error", { status: 500 });
    }
  }
}
