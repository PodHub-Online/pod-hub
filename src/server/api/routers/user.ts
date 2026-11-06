import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";
import { sendApprovalEmail } from "~/server/mail";
import { track } from "~/server/stats";
import { notifyOwner } from "~/server/notices";
import { accessRequests, cronRuns, feedback, invites, nightLevels, profilePresets, pushSubscriptions, users, userTemperatureProfile, whoopConnections, whoopSleeps } from "~/server/db/schema";
import { cookies } from "next/headers";
import {
  authenticate,
  obtainFreshAccessToken,
  AuthError,
} from "~/server/eight/auth";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { type Token } from "~/server/eight/types";
import { TRPCError } from "@trpc/server";
import { adjustTemperature } from "~/app/api/temperatureCron/route";
import { getPodDisplayStatus } from "~/server/eight/user";
import {
  getAwayState,
  getPodHealth,
  getBedSide,
  getGuestSide,
  setGuestSide,
  assignAccountToSide,
  getSides,
  applyToSide,
  setAwayModeChecked,
  getQuickModeStatus,
  setBedSideMode,
  getSleepNights,
  probeCapabilities,
  setLedBrightness,
  setQuickMode,
  startPriming,
  statusFromError,
} from "~/server/eight/extras";
import { turnOffSide } from "~/server/eight/eight";
import {
  toHHMM,
  type PresetDescriptor,
  type ScheduleValues,
} from "~/lib/presets";
import jwt from "jsonwebtoken";
import { getNextEvent } from "~/lib/schedule";
import { isValidZone } from "~/lib/scheduleTime";
import { callerFromHeaders, recordActivity } from "~/server/activityLog";
import { isDemoCookie, isDemoEmail } from "~/server/demo/session";
import { setDemoCookie } from "~/server/demo/cookies";
import { clearState as clearDemoState } from "~/server/demo/data";
import {
  addAccessRequest,
  approvedEmails,
  canSignIn,
  isActiveAccount,
  isOwner,
  pendingRequests,
  recordSignInAttempt,
  seedInvitesFromSetting,
  signInBlocked,
} from "~/server/access";
import { getUserProfile } from "~/server/eight/user";
import { open, seal } from "~/server/crypto";

type BedSideName = "left" | "right";
type ControlSide = BedSideName | "both";
/** schedules: one per side, plus the whole-bed one ("both"), used only when switched on */
type ScheduleSide = BedSideName | "both";
const sideInput = z.enum(["left", "right"]);
const scheduleSideInput = z.enum(["left", "right", "both"]);
const controlSideInput = z.enum(["left", "right", "both"]);

export const logApp = (
  email: string,
  action: string,
  level: number | null = null,
  message: string | null = null,
  side: ControlSide | null = null,
) => {
  track(email, `feature:${action}`);
  return recordActivity(email, { stage: "manual", source: "app", action, level, message, side });
};

const profileWhere = (email: string, side: ScheduleSide) =>
  and(eq(userTemperatureProfile.email, email), eq(userTemperatureProfile.side, side));

export const findProfile = (email: string, side: ScheduleSide) =>
  db.query.userTemperatureProfile.findFirst({ where: profileWhere(email, side) });

/** Which side a control change is for: what the app asked, or Both when Whole bed is on, or your side. */
export async function resolveControlSide(
  token: Token,
  user: { wholeBedApp: boolean },
  side: ControlSide | undefined,
): Promise<ControlSide> {
  if (side) return side;
  if (user.wholeBedApp) return "both";
  return (await getSides(token)).own;
}

/** Sends a power/level change to one side, or to both. */
export async function sendToSides(token: Token, side: ControlSide, change: { on?: boolean; level?: number }) {
  const sides = await getSides(token);
  for (const s of side === "both" ? (["left", "right"] as const) : [side]) {
    try {
      await applyToSide(token, sides.ids[s], change);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`The ${s} side didn't accept it: ${message}`);
    }
  }
}


/**
 * After a manual change, keep the schedule from undoing it until its next stage
 * (e.g. until deep sleep starts). Returns the hold end, or null if no schedule applies.
 */
async function startManualHold(email: string, side: ScheduleSide): Promise<Date | null> {
  const profile = await findProfile(email, side);
  if (!profile?.scheduleEnabled) return null;
  const userNow = new Date(new Date().toLocaleString("en-US", { timeZone: profile.timezoneTZ }));
  const next = getNextEvent(
    {
      bedTime: profile.bedTime,
      wakeupTime: profile.wakeupTime,
      midStageSleepLevelStartTime: profile.midStageSleepLevelStartTime,
      finalSleepLevelStartTime: profile.finalSleepLevelStartTime,
      initialSleepLevel: profile.initialSleepLevel,
      midStageSleepLevel: profile.midStageSleepLevel,
      finalSleepLevel: profile.finalSleepLevel,
      wakeupAlarmEnabled: profile.wakeupAlarmEnabled,
      wakeupAlarmLevel: profile.wakeupAlarmLevel,
      wakeupAlarmLeadMinutes: profile.wakeupAlarmLeadMinutes,
      preWakeEnabled: profile.preWakeEnabled,
      preWakeLevel: profile.preWakeLevel,
      preWakeLeadMinutes: profile.preWakeLeadMinutes,
      preheatLeadMinutes: profile.preheatLeadMinutes,
    },
    userNow,
  );
  if (!next) return null;
  const until = new Date(Date.now() + next.inMinutes * 60_000);
  await db.update(userTemperatureProfile).set({ manualHoldUntil: until }).where(profileWhere(email, side)).execute();
  return until;
}

/**
 * Whether the schedule wants the pod on right now (between pre-cool start and wake-up).
 * null when there's no schedule or it's switched off.
 */
async function scheduleWantsPodOn(email: string, side: ScheduleSide): Promise<boolean | null> {
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  const profile = await findProfile(email, side);
  if (!profile?.scheduleEnabled || user?.vacationMode || !profile) return null;
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: profile.timezoneTZ }));
  const mins = (t: string) => {
    const [h = 0, m = 0] = t.slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  };
  const on = (mins(profile.bedTime) - (profile.preheatLeadMinutes ?? 60) + 1440) % 1440;
  const off = mins(profile.wakeupTime);
  const cur = now.getHours() * 60 + now.getMinutes();
  // the window usually crosses midnight
  return on <= off ? cur >= on && cur < off : cur >= on || cur < off;
}

/**
 * The schedules a manual change on `side` pauses: the whole-bed one when it's in use,
 * otherwise the side's own (both sides' for a whole-bed change).
 */
export async function holdTargets(email: string, side: ControlSide): Promise<ScheduleSide[]> {
  const whole = await findProfile(email, "both");
  if (whole?.scheduleEnabled) return ["both"];
  return side === "both" ? ["left", "right"] : [side];
}

/** Clears the manual pause on one side, or on both when side is omitted. */
const clearManualHold = (email: string, side?: ScheduleSide) =>
  db
    .update(userTemperatureProfile)
    .set({ manualHoldUntil: null })
    .where(side ? profileWhere(email, side) : eq(userTemperatureProfile.email, email))
    .execute();

/** Logs a failed in-app change for the signed-in user (no-op if the cookie is invalid). */
async function logAppFailure(headers: Headers, action: string, error: unknown) {
  const cookieHeader = headers.get("cookie") ?? "";
  const token = cookieHeader
    .split(";")
    .map((row) => row.trim())
    .find((row) => row.startsWith("8slpAutht="))
    ?.split("=")[1];
  if (!token) return;
  try {
    const { email } = jwt.verify(token, process.env.JWT_SECRET ?? "") as { email: string };
    const message = error instanceof Error ? error.message : String(error);
    await recordActivity(email, { stage: "manual", source: "app", action: `${action}_failed`, message });
  } catch {
    // not signed in: nothing to log against
  }
}

class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

const AUTH_COOKIE = "8slpAutht";
const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year, renewed on every app open
const DEVICE_TOKEN_EXPIRY = "400d";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not defined in the environment");
  }
  return secret;
}

// SameSite=Lax (not Strict): Android launches installed web apps from the home
// screen as an external navigation, and Chrome withholds Strict cookies there.
function setAuthCookie(email: string) {
  const token = jwt.sign({ email }, getJwtSecret(), { expiresIn: SESSION_MAX_AGE_SECONDS });
  cookies().set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

function clearAuthCookie() {
  cookies().set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

// Long-lived token kept in the installed app's localStorage, used to restore the
// cookie session if the browser ever drops it.
function signDeviceToken(email: string): string {
  return jwt.sign({ email, typ: "device" }, getJwtSecret(), { expiresIn: DEVICE_TOKEN_EXPIRY });
}

const checkAuthCookie = async (headers: Headers) => {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) {
    throw new AuthError(`Auth request failed. No cookies found.`, 401);
  }

  const token = cookieHeader
    .split(";")
    .map((row) => row.trim())
    .find((row) => row.startsWith(`${AUTH_COOKIE}=`))
    ?.split("=")[1];

  if (!token) {
    throw new AuthError(`Auth request failed. No cookies found.`, 401);
  }
  let decoded;
  try {
    decoded = jwt.verify(token, getJwtSecret()) as {
      email: string;
      demo?: boolean;
    };
  } catch {
    throw new AuthError(`Auth request failed. Invalid token.`, 401);
  }
  // a demo session is answered by the demo router; it never acts on real accounts here
  if (decoded.demo || isDemoEmail(decoded.email)) {
    throw new AuthError(`Auth request failed. Demo session.`, 401);
  }
  // removed from the app, or account deleted: the session ends right away
  if (!(await isActiveAccount(decoded.email))) {
    throw new AuthError(`Auth request failed. Access removed.`, 401);
  }

  return decoded;
};

const isExpiredRefreshToken = (error: unknown) =>
  error instanceof AuthError && error.message.includes("Invalid or expired refresh token");

export const getAuthUserAndToken = async (headers: Headers) => {
  const decoded = await checkAuthCookie(headers);

  const userList = await db
    .select()
    .from(users)
    .where(eq(users.email, decoded.email))
    .execute();

  const user = userList[0];
  if (userList.length !== 1 || user === undefined) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "User not found.",
    });
  }

  let token: Token = {
    eightAccessToken: open(user.eightAccessToken),
    eightRefreshToken: open(user.eightRefreshToken),
    eightExpiresAtPosix: user.eightTokenExpiresAt.getTime(),
    eightUserId: user.eightUserId,
  };

  if (user.eightTokenExpiresAt < new Date()) {
    token = await obtainFreshAccessToken(
      token.eightRefreshToken,
      token.eightUserId,
    );
    await db
      .update(users)
      .set({
        eightAccessToken: seal(token.eightAccessToken),
        eightRefreshToken: seal(token.eightRefreshToken),
        eightTokenExpiresAt: new Date(token.eightExpiresAtPosix),
      })
      .where(eq(users.email, decoded.email))
      .execute();
  }

  return { user, token };
};

export const requireEmail = async (headers: Headers) => {
  try {
    return (await checkAuthCookie(headers)).email;
  } catch {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Please sign in again." });
  }
};

/** This site's address, for links in emails ("https://your-app.vercel.app"). */
const appUrlOf = (headers: Headers) => {
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto = headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
};

export const requireOwner = async (headers: Headers) => {
  const email = await requireEmail(headers);
  if (!(await isOwner(email))) throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can do this." });
  return email;
};

function toTRPCError(error: unknown, fallbackMessage: string): TRPCError {
  if (error instanceof TRPCError) return error;
  if (error instanceof AuthError) {
    return new TRPCError({ code: "UNAUTHORIZED", message: error.message });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: fallbackMessage });
}

const timeInput = z.string().regex(/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/, "Must be HH:MM");
const levelInput = z.number().int().min(-100).max(100);

const scheduleValuesInput = z.object({
  bedTime: timeInput,
  wakeupTime: timeInput,
  midStageSleepLevelStartTime: timeInput,
  finalSleepLevelStartTime: timeInput,
  initialSleepLevel: levelInput,
  midStageSleepLevel: levelInput,
  finalSleepLevel: levelInput,
  wakeupAlarmEnabled: z.boolean(),
  wakeupAlarmLevel: levelInput,
  wakeupAlarmLeadMinutes: z.number().int().min(5).max(120),
  preWakeEnabled: z.boolean().default(false),
  preWakeLevel: levelInput.default(10),
  preWakeLeadMinutes: z.number().int().min(5).max(180).default(60),
  preheatLeadMinutes: z.number().int().min(0).max(180).default(60),
  // left out = unchanged (auto-tune and the compromise card save levels only)
  offStages: z.number().int().min(0).max(15).optional(),
});

const presetMetaInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  description: z.string().trim().max(160).default(""),
});

function scheduleFromRow(row: ScheduleValues): ScheduleValues {
  return {
    bedTime: toHHMM(row.bedTime),
    wakeupTime: toHHMM(row.wakeupTime),
    midStageSleepLevelStartTime: toHHMM(row.midStageSleepLevelStartTime),
    finalSleepLevelStartTime: toHHMM(row.finalSleepLevelStartTime),
    initialSleepLevel: row.initialSleepLevel,
    midStageSleepLevel: row.midStageSleepLevel,
    finalSleepLevel: row.finalSleepLevel,
    wakeupAlarmEnabled: row.wakeupAlarmEnabled,
    wakeupAlarmLevel: row.wakeupAlarmLevel,
    wakeupAlarmLeadMinutes: row.wakeupAlarmLeadMinutes,
    preWakeEnabled: row.preWakeEnabled ?? false,
    preWakeLevel: row.preWakeLevel ?? 10,
    preWakeLeadMinutes: row.preWakeLeadMinutes ?? 60,
    preheatLeadMinutes: row.preheatLeadMinutes,
    offStages: row.offStages ?? 0,
  };
}

/**
 * Saves one side's schedule. Its time zone is NOT changed by an ordinary save: a new schedule joins
 * the zone the account's other schedules already use (else the one sent), and only
 * setScheduleTimezone changes it later. So a stale screen or another device can never move a
 * schedule onto a different clock.
 */
async function saveProfile(email: string, side: ScheduleSide, values: ScheduleValues, timezoneTZ: string, activeDays?: number) {
  const profileValues = {
    ...values,
    ...(activeDays !== undefined ? { activeDays } : {}),
    updatedAt: new Date(),
  };
  const others = await db.select({ tz: userTemperatureProfile.timezoneTZ }).from(userTemperatureProfile).where(eq(userTemperatureProfile.email, email)).execute();
  const shared = others.map((o) => o.tz).find((tz) => isValidZone(tz));
  await db
    .insert(userTemperatureProfile)
    .values({ email, side, ...profileValues, timezoneTZ: shared ?? timezoneTZ, ...(side === "both" ? { scheduleEnabled: false } : {}) })
    .onConflictDoUpdate({
      target: [userTemperatureProfile.email, userTemperatureProfile.side],
      set: profileValues,
    })
    .execute();
}

async function listCustomPresets(email: string): Promise<PresetDescriptor[]> {
  const rows = await db
    .select()
    .from(profilePresets)
    .where(eq(profilePresets.email, email))
    .orderBy(asc(profilePresets.createdAt))
    .execute();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    values: scheduleFromRow(row),
  }));
}

// Applies this person's schedule right away; never fail their action if the pod is unreachable.
export async function adjustTemperatureSafely(email: string) {
  try {
    await adjustTemperature(undefined, "auto", null, { onlyEmail: email });
  } catch (error) {
    console.error("Immediate temperature adjustment failed:", error);
  }
}

export const userRouter = createTRPCRouter({
  checkLoginState: publicProcedure.query(async ({ ctx }) => {
    if (isDemoCookie(ctx.headers.get("cookie"))) return { loginRequired: false };
    try {
      let decoded;
      try {
        decoded = await checkAuthCookie(ctx.headers);
      } catch (error) {
        if (error instanceof AuthError) {
          return { loginRequired: true };
        }
        throw error;
      }
      const email = decoded.email;

      const userList = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .execute();

      if (userList.length !== 1 || userList[0] === undefined) {
        return { loginRequired: true };
      }

      const user = userList[0];

      // check if token is expired, and if so, refresh it
      if (user.eightTokenExpiresAt < new Date()) {
        console.log("Token expired, refreshing for user", user.email);
        try {
          const {
            eightAccessToken,
            eightRefreshToken,
            eightExpiresAtPosix: expiresAt,
          } = await obtainFreshAccessToken(
            open(user.eightRefreshToken),
            user.eightUserId,
          );

          await db
            .update(users)
            .set({
              eightAccessToken: seal(eightAccessToken),
              eightRefreshToken: seal(eightRefreshToken),
              eightTokenExpiresAt: new Date(expiresAt),
            })
            .where(eq(users.email, email))
            .execute();
        } catch (error) {
          console.error("Token renewal failed:", error);
          // Only a rejected refresh token needs a new password. Network hiccups
          // or Eight Sleep outages should not kick the user out of the app.
          if (isExpiredRefreshToken(error)) {
            return { loginRequired: true };
          }
        }
      }
      return { loginRequired: false };
    } catch (error) {
      console.error("Error in checkLoginState:", error);
      throw new Error(
        "An unexpected error occurred while checking login state.",
      );
    }
  }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email().max(255),
        password: z.string().max(200),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // too many wrong passwords (or requests) from this IP or for this email: wait 10 minutes
      const ip = callerFromHeaders(ctx.headers).ip;
      if (await signInBlocked(ip, input.email)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many tries. Wait 10 minutes and try again." });
      }
      try {
        let authResult: Token;
        try {
          authResult = await authenticateUser(input.email, input.password);
        } catch (error) {
          await recordSignInAttempt(ip, input.email);
          throw error;
        }

        // Not invited: the Eight Sleep sign-in proved they own this email, so ask the owner.
        // Only the email and first name are kept; their tokens are dropped right here.
        if (!(await canSignIn(input.email))) {
          await recordSignInAttempt(ip, input.email);
          const firstName = await getUserProfile(authResult)
            .then((u) => u.firstName ?? null)
            .catch(() => null);
          const saved = await addAccessRequest(input.email, firstName);
          if (saved) {
            track(input.email, "request");
            await notifyOwner("owner_request", `request:${input.email.toLowerCase()}`, new Date().toISOString().slice(0, 10), "Someone asked to join", `${firstName ?? input.email} wants to use Pod Hub. Open Settings → Invites to answer.`).catch(() => undefined);
          }
          return { success: false, requested: saved, deviceToken: null };
        }

        const existed = await db.query.users.findFirst({ where: eq(users.email, input.email), columns: { email: true } });
        await saveUserToDatabase(input.email, authResult);
        track(input.email, "signin", existed ? "back" : "new");
        // a new account starts with its Eight Sleep first name (changeable in Settings → Preferences)
        const saved = await db.query.users.findFirst({ where: eq(users.email, input.email), columns: { displayName: true } });
        if (!saved?.displayName) {
          const firstName = await getUserProfile(authResult)
            .then((u) => u.firstName?.trim().slice(0, 40) ?? null)
            .catch(() => null);
          if (firstName) await db.update(users).set({ displayName: firstName }).where(eq(users.email, input.email));
        }

        setAuthCookie(input.email);
        await logApp(input.email, "signed_in");

        return {
          success: true,
          requested: false,
          deviceToken: signDeviceToken(input.email) as string | null,
        };
      } catch (error) {
        console.error("Error in login process:", error);
        if (error instanceof AuthError) {
          throw new Error(`Authentication failed: ${error.message}`);
        } else if (error instanceof DatabaseError) {
          throw new Error(
            "Failed to save login information. Please try again.",
          );
        } else {
          throw new Error(
            "An unexpected error occurred. Please try again later.",
          );
        }
      }
    }),

  // "Try the demo": a short session on pretend data, answered by the demo router
  startDemo: publicProcedure.mutation(async () => {
    setDemoCookie();
    clearDemoState();
    return { success: true };
  }),

  // Called on every app open: slides the cookie expiry forward and rotates the device token.
  refreshSession: publicProcedure.mutation(async ({ ctx }) => {
    const email = await requireEmail(ctx.headers);
    setAuthCookie(email);
    return { deviceToken: signDeviceToken(email) };
  }),

  resumeSession: publicProcedure
    .input(z.object({ deviceToken: z.string().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      let decoded: { email?: string; typ?: string };
      try {
        decoded = jwt.verify(input.deviceToken, getJwtSecret()) as typeof decoded;
      } catch {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Device token expired." });
      }
      const email = decoded.email;
      if (decoded.typ !== "device" || !email || !(await isActiveAccount(email))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Device token invalid." });
      }

      const user = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (!user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found." });
      }

      setAuthCookie(email);
      return { success: true, deviceToken: signDeviceToken(email) };
    }),

  // Deletes everything this app keeps about you, then signs you out. Type your email to confirm.
  deleteAccount: publicProcedure
    .input(z.object({ confirmEmail: z.string().max(255) }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      if (input.confirmEmail.trim().toLowerCase() !== email.toLowerCase()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Type your email exactly to confirm." });
      }
      if (await isOwner(email)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "The owner's account can't be deleted from the app." });
      }
      await deleteAccountData(email);
      clearAuthCookie();
      return { success: true };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    try {
      const email = await requireEmail(ctx.headers).catch(() => null);
      if (email) await logApp(email, "signed_out");
      clearAuthCookie();
      return {
        success: true,
      };
    } catch (error) {
      console.error("Error during logout:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred during logout.",
      });
    }
  }),

  getPodStatus: publicProcedure
    .input(z.object({ side: sideInput.optional() }).optional())
    .query(async ({ input, ctx }) => {
    try {
      const { token } = await getAuthUserAndToken(ctx.headers);
      if (input?.side) {
        // any side, from the pod's own readings
        const sides = await getSides(token);
        if (input.side !== sides.own) {
          const st = sides.state[input.side];
          return {
            isOn: st.isOn,
            isHeating: st.isOn,
            heatingLevel: st.level,
            targetHeatingLevel: st.target,
            temperatureF: st.tempF,
            temperatureC: st.tempF !== null ? ((st.tempF - 32) * 5) / 9 : null,
            side: input.side,
          };
        }
      }
      return await getPodDisplayStatus(token);
    } catch (error) {
      console.error("Error fetching pod status:", error);
      throw toTRPCError(error, "An unexpected error occurred while fetching pod status.");
    }
  }),

  setPodPower: publicProcedure
    .input(z.object({ isOn: z.boolean(), side: controlSideInput.optional() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { user, token } = await getAuthUserAndToken(ctx.headers);
        const side = await resolveControlSide(token, user, input.side);
        await sendToSides(token, side, { on: input.isOn });
        await logApp(user.email, input.isOn ? "turned_on" : "turned_off", null, null, side);
        // Only a change the schedule disagrees with is "manual": turning the pod off
        // while the schedule has it off anyway (or on during the night) needs no pause.
        let holdUntil: Date | null = null;
        for (const target of await holdTargets(user.email, side)) {
          const wantsOn = await scheduleWantsPodOn(user.email, target);
          if (wantsOn !== null && wantsOn === input.isOn) {
            await clearManualHold(user.email, target);
          } else {
            holdUntil = (await startManualHold(user.email, target)) ?? holdUntil;
          }
        }
        if (holdUntil) await logApp(user.email, "hold_started", null, holdUntil.toISOString(), side);
        return { success: true, isOn: input.isOn, holdUntil };
      } catch (error) {
        console.error("Error setting pod power:", error);
await logAppFailure(ctx.headers, "power", error);
        throw toTRPCError(error, "Failed to set pod power.");
      }
    }),

  setPodTargetLevel: publicProcedure
    .input(
      z.object({
        level: levelInput,
        turnOn: z.boolean().optional(),
        side: controlSideInput.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { user, token } = await getAuthUserAndToken(ctx.headers);
        const side = await resolveControlSide(token, user, input.side);
        await sendToSides(token, side, { on: input.turnOn, level: input.level });
        await logApp(user.email, input.turnOn ? "turned_on" : "set_level", input.level, null, side);
        let holdUntil: Date | null = null;
        for (const target of await holdTargets(user.email, side)) {
          holdUntil = (await startManualHold(user.email, target)) ?? holdUntil;
        }
        if (holdUntil) await logApp(user.email, "hold_started", null, holdUntil.toISOString(), side);
        return { success: true, level: input.level, holdUntil };
      } catch (error) {
        console.error("Error setting pod target level:", error);
await logAppFailure(ctx.headers, "set_level", error);
        throw toTRPCError(error, "Failed to set pod target level.");
      }
    }),

  // Returns null (not an error) when no schedule has been saved yet.
  getUserTemperatureProfile: publicProcedure
    .input(z.object({ side: scheduleSideInput }))
    .query(async ({ input, ctx }) => {
    const email = await requireEmail(ctx.headers);
    try {
      const profile = await findProfile(email, input.side);
      return profile ?? null;
    } catch (error) {
      console.error("Error fetching user temperature profile:", error);
      throw toTRPCError(
        error,
        "An unexpected error occurred while fetching the temperature profile.",
      );
    }
  }),

  updateUserTemperatureProfile: publicProcedure
    .input(
      scheduleValuesInput.extend({
        timezoneTZ: z.string().max(50),
        activeDays: z.number().int().min(0).max(127).optional(),
        side: scheduleSideInput,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      try {
        const { timezoneTZ, activeDays, side, ...values } = input;
        await saveProfile(email, side, values, timezoneTZ, activeDays);
        await clearManualHold(email, side);
        await logApp(email, "schedule_saved", null, null, side);
        await adjustTemperatureSafely(email);
        return { success: true };
      } catch (error) {
        console.error("Error updating user temperature profile:", error);
await logAppFailure(ctx.headers, "schedule_save", error);
        throw toTRPCError(
          error,
          "An unexpected error occurred while updating the temperature profile.",
        );
      }
    }),

  deleteUserTemperatureProfile: publicProcedure
    .input(z.object({ side: scheduleSideInput }))
    .mutation(async ({ input, ctx }) => {
    const email = await requireEmail(ctx.headers);
    try {
      const deleted = await db
        .delete(userTemperatureProfile)
        .where(profileWhere(email, input.side))
        .returning({ email: userTemperatureProfile.email })
        .execute();

      if (deleted.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Temperature profile not found for this user.",
        });
      }

      await logApp(email, "schedule_cleared", null, null, input.side);
      return {
        success: true,
        message: "User temperature profile deleted successfully",
      };
    } catch (error) {
      console.error("Error deleting user temperature profile:", error);
await logAppFailure(ctx.headers, "schedule_clear", error);
      throw toTRPCError(
        error,
        "An unexpected error occurred while deleting the user temperature profile.",
      );
    }
  }),

  // ---------- Presets ----------

  listPresets: publicProcedure.query(async ({ ctx }) => {
    const email = await requireEmail(ctx.headers);
    return listCustomPresets(email);
  }),

  createPreset: publicProcedure
    .input(presetMetaInput.extend({ values: scheduleValuesInput }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      try {
        const [row] = await db
          .insert(profilePresets)
          .values({
            email,
            name: input.name,
            description: input.description,
            ...input.values,
          })
          .returning({ id: profilePresets.id })
          .execute();
        await logApp(email, "preset_created", null, input.name);
        return { id: row?.id };
      } catch (error) {
        console.error("Error creating preset:", error);
await logAppFailure(ctx.headers, "preset_create", error);
        throw toTRPCError(error, "Failed to save preset.");
      }
    }),

  updatePreset: publicProcedure
    .input(
      presetMetaInput.partial().extend({
        id: z.number().int(),
        values: scheduleValuesInput.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      const { id, values, ...meta } = input;
      const updated = await db
        .update(profilePresets)
        .set({ ...meta, ...values, updatedAt: new Date() })
        .where(and(eq(profilePresets.id, id), eq(profilePresets.email, email)))
        .returning({ id: profilePresets.id })
        .execute();
      if (updated.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Preset not found." });
      }
      await logApp(email, "preset_updated", null, input.name ?? null);
      return { success: true };
    }),

  deletePreset: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      const removed = await db
        .delete(profilePresets)
        .where(and(eq(profilePresets.id, input.id), eq(profilePresets.email, email)))
        .returning({ name: profilePresets.name })
        .execute();
      await logApp(email, "preset_deleted", null, removed[0]?.name ?? null);
      return { success: true };
    }),

  applyPreset: publicProcedure
    .input(z.object({ id: z.number().int(), timezoneTZ: z.string().max(50), side: scheduleSideInput }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      const preset = (await listCustomPresets(email)).find((p) => p.id === input.id);
      if (!preset) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Preset not found." });
      }

      try {
        // Keep the timezone the user already chose; fall back to the device's.
        const existing = await findProfile(email, input.side);
        await saveProfile(email, input.side, preset.values, existing?.timezoneTZ ?? input.timezoneTZ);
        await clearManualHold(email, input.side);
        await adjustTemperatureSafely(email);
        await logApp(email, "preset_applied", null, preset.name, input.side);
        return { success: true, name: preset.name };
      } catch (error) {
        console.error("Error applying preset:", error);
await logAppFailure(ctx.headers, "preset_apply", error);
        throw toTRPCError(error, "Failed to apply preset.");
      }
    }),

  // ---------- Account, vacation & config ----------

  getAccount: publicProcedure.query(async ({ ctx }) => {
    const email = await requireEmail(ctx.headers);
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found." });
    }
    // Newest cron entry, read in the same request as lastCronRunAt so the two can be compared
    const lastLogged = await db
      .select({ ranAt: cronRuns.ranAt })
      .from(cronRuns)
      .where(and(sql`lower(${cronRuns.email}) = lower(${email})`, eq(cronRuns.source, "cron")))
      .orderBy(desc(cronRuns.ranAt))
      .limit(1)
      .execute();
    const profiles = await db.query.userTemperatureProfile.findMany({ where: eq(userTemperatureProfile.email, email) });
    const owner = await isOwner(email);
    return {
      demo: false,
      lastLoggedCronAt: lastLogged[0]?.ranAt ?? null,
      email: user.email,
      eightUserId: user.eightUserId,
      eightTokenExpiresAt: user.eightTokenExpiresAt,
      vacationMode: user.vacationMode,
      vacationUntil: user.vacationUntil,
      lastCronRunAt: user.lastCronRunAt,
      // "Follow schedule" and the manual pause, per side of the bed
      sides: Object.fromEntries(
        (["left", "right", "both"] as const).map((side) => {
          const p = profiles.find((r) => r.side === side);
          return [
            side,
            {
              hasSchedule: !!p,
              // the whole-bed schedule only counts as on when it exists and was switched on
              scheduleEnabled: side === "both" ? !!p?.scheduleEnabled : p?.scheduleEnabled ?? true,
              manualHoldUntil: p?.manualHoldUntil && p.manualHoldUntil > new Date() ? p.manualHoldUntil : null,
              // the zone this schedule's clock runs on (null: no schedule)
              timezone: p?.timezoneTZ ?? null,
            },
          ];
        }),
      ) as Record<ScheduleSide, { hasSchedule: boolean; scheduleEnabled: boolean; manualHoldUntil: Date | null; timezone: string | null }>,
      // Eight Sleep refused earlier (the check leaves the account alone until then), or the sign-in expired
      eightBackoffUntil: user.eightBackoffUntil && user.eightBackoffUntil > new Date() ? user.eightBackoffUntil : null,
      authError: user.authError,
      wholeBed: user.wholeBedApp,
      memberSince: user.createdAt,
      // only the owner sees the cron job, the WHOOP app keys and the invite list
      isOwner: owner,
      // "{name}'s Hub" and the headboard engraving; null shows the plain app name
      displayName: user.displayName,
      // people waiting for the owner to let them in (a dot on the avatar)
      pendingRequests: owner ? (await pendingRequests()).length : 0,
    };
  }),

  /**
   * One time zone for every schedule of the account (Left, Right and Whole bed share it, so they can
   * never run on different clocks). The 5-minute check reads it from each schedule row, so all rows move together.
   */
  setScheduleTimezone: publicProcedure
    .input(z.object({ timezone: z.string().max(50) }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      if (!isValidZone(input.timezone)) throw new TRPCError({ code: "BAD_REQUEST", message: "That time zone isn't known." });
      await db.update(userTemperatureProfile).set({ timezoneTZ: input.timezone, updatedAt: new Date() }).where(eq(userTemperatureProfile.email, email)).execute();
      await logApp(email, "timezone_set", null, input.timezone);
      await adjustTemperatureSafely(email);
      return { success: true, timezone: input.timezone };
    }),

  setVacationMode: publicProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        until: z.date().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { user, token } = await getAuthUserAndToken(ctx.headers);
        await db
          .update(users)
          .set({
            vacationMode: input.enabled,
            vacationUntil: input.enabled ? input.until ?? null : null,
            updatedAt: new Date(),
          })
          .where(eq(users.email, user.email))
          .execute();

        // Mirror it in Eight Sleep's own Away mode (best effort)
        let awaySynced = true;
        let awayError: string | null = null;
        try {
          await setAwayModeChecked(token, input.enabled ? "start" : "end");
        } catch (error) {
          awaySynced = false;
          awayError = error instanceof Error ? error.message : String(error);
          console.error("Could not sync Eight Sleep away mode:", error);
        }

        if (input.enabled) {
          try {
            await turnOffSide(token, user.eightUserId);
          } catch (error) {
            console.error("Could not turn pod off when enabling vacation mode:", error);
          }
        } else {
          await adjustTemperatureSafely(user.email);
        }
        await logApp(
          user.email,
          input.enabled ? "vacation_on" : "vacation_off",
          null,
          input.enabled && input.until ? `until ${input.until.toISOString().slice(0, 10)}` : null,
        );
        return { success: true, awaySynced, awayError };
      } catch (error) {
        console.error("Error setting vacation mode:", error);
await logAppFailure(ctx.headers, "vacation", error);
        throw toTRPCError(error, "Failed to update vacation mode.");
      }
    }),

  // Set only Eight Sleep's own Away mode (to fix a mismatch with Vacation mode)
  setEightAwayMode: publicProcedure
    .input(z.object({ on: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { user, token } = await getAuthUserAndToken(ctx.headers);
        const used = await setAwayModeChecked(token, input.on ? "start" : "end");
        await logApp(user.email, input.on ? "eight_away_on" : "eight_away_off", null, `via ${used}`);
        return { success: true };
      } catch (error) {
        console.error("Error setting Eight Sleep away mode:", error);
        await logAppFailure(ctx.headers, "eight_away", error);
        throw toTRPCError(error, error instanceof Error ? error.message : "Eight Sleep didn't accept the Away mode change.");
      }
    }),

  getAppConfig: publicProcedure.query(async ({ ctx }) => {
    const email = await requireEmail(ctx.headers);
    if (!(await isOwner(email))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can see this." });
    }
    const host = ctx.headers.get("x-forwarded-host") ?? ctx.headers.get("host") ?? "localhost:3000";
    const proto =
      ctx.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    const cronSecret = process.env.CRON_SECRET ?? "";
    return {
      cronUrl: `${proto}://${host}/api/temperatureCron`,
      cronSecret,
      cronHeaderName: "Authorization",
      cronHeaderValue: `Bearer ${cronSecret}`,
      cronIntervalHint: "Every 5 minutes",
      approvedEmails: approvedEmails(),
    };
  }),

  setDisplayName: publicProcedure
    .input(z.object({ name: z.string().trim().max(30) }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      await db.update(users).set({ displayName: input.name || null, updatedAt: new Date() }).where(eq(users.email, email));
      return { success: true };
    }),

  // ---------- Invites (owner only) ----------

  getInvites: publicProcedure.query(async ({ ctx }) => {
    await requireOwner(ctx.headers);
    await seedInvitesFromSetting();
    const list = await db.select().from(invites).orderBy(asc(invites.addedAt));
    const accounts = await db.select({ email: users.email, createdAt: users.createdAt, updatedAt: users.updatedAt }).from(users);
    const account = (e: string) => accounts.find((a) => a.email.toLowerCase() === e);
    return {
      invites: list.map((i) => ({
        email: i.email,
        addedAt: i.addedAt,
        // first sign-in, and the last time they signed in again
        joinedAt: account(i.email)?.createdAt ?? null,
        lastSignInAt: account(i.email)?.updatedAt ?? null,
      })),
      requests: await pendingRequests(),
    };
  }),

  addInvite: publicProcedure
    .input(z.object({ email: z.string().trim().email().max(255) }))
    .mutation(async ({ input, ctx }) => {
      await requireOwner(ctx.headers);
      const email = input.email.toLowerCase();
      const added = await db.insert(invites).values({ email }).onConflictDoNothing().returning({ email: invites.email });
      await db.delete(accessRequests).where(eq(accessRequests.email, email));
      // a "You're in" email from the owner's Gmail, when that's set up
      const emailed = added.length ? await sendApprovalEmail(email, appUrlOf(ctx.headers)) : false;
      return { success: true, emailed };
    }),

  // Removing someone signs them out right away; their data stays unless deleteData is set
  removeInvite: publicProcedure
    .input(z.object({ email: z.string().max(255), deleteData: z.boolean().default(false) }))
    .mutation(async ({ input, ctx }) => {
      const me = await requireOwner(ctx.headers);
      const email = input.email.toLowerCase();
      if (email === me.toLowerCase()) throw new TRPCError({ code: "BAD_REQUEST", message: "You can't remove yourself." });
      await db.delete(invites).where(eq(invites.email, email));
      if (input.deleteData) {
        const account = await db.query.users.findFirst({ where: sql`lower(${users.email}) = ${email}` });
        if (account) await deleteAccountData(account.email);
      }
      return { success: true };
    }),

  answerRequest: publicProcedure
    .input(z.object({ email: z.string().max(255), approve: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await requireOwner(ctx.headers);
      const email = input.email.toLowerCase();
      if (input.approve) await db.insert(invites).values({ email }).onConflictDoNothing();
      await db.delete(accessRequests).where(eq(accessRequests.email, email));
      track(email, input.approve ? "request_approved" : "request_denied");
      const emailed = input.approve ? await sendApprovalEmail(email, appUrlOf(ctx.headers)) : false;
      return { success: true, emailed };
    }),

  // ---------- Follow schedule / manual hold ----------

  setScheduleEnabled: publicProcedure
    .input(z.object({ enabled: z.boolean(), side: scheduleSideInput }))
    .mutation(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      await db
        .update(userTemperatureProfile)
        .set({ scheduleEnabled: input.enabled, manualHoldUntil: null })
        .where(profileWhere(email, input.side))
        .execute();
      await logApp(email, input.enabled ? "schedule_on" : "schedule_off", null, null, input.side);
      if (input.enabled) await adjustTemperatureSafely(email);
      return { success: true };
    }),

  resumeSchedule: publicProcedure
    .input(z.object({ side: scheduleSideInput.optional() }).optional())
    .mutation(async ({ input, ctx }) => {
    const email = await requireEmail(ctx.headers);
    await clearManualHold(email, input?.side);
    await logApp(email, "hold_ended", null, null, input?.side ?? null);
    await adjustTemperatureSafely(email);
    return { success: true };
  }),

  // ---------- Cron history ----------

  getCronHistory: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(7).default(3) }).optional())
    .query(async ({ input, ctx }) => {
      const email = await requireEmail(ctx.headers);
      const since = new Date(Date.now() - (input?.days ?? 3) * 24 * 60 * 60 * 1000);
      return db
        .select({
          id: cronRuns.id,
          ranAt: cronRuns.ranAt,
          stage: cronRuns.stage,
          action: cronRuns.action,
          level: cronRuns.level,
          message: cronRuns.message,
          source: cronRuns.source,
          podWasOn: cronRuns.podWasOn,
          levelBefore: cronRuns.levelBefore,
          targetBefore: cronRuns.targetBefore,
          durationMs: cronRuns.durationMs,
          meta: cronRuns.meta,
          side: cronRuns.side,
        })
        .from(cronRuns)
        .where(and(sql`lower(${cronRuns.email}) = lower(${email})`, gte(cronRuns.ranAt, since)))
        .orderBy(desc(cronRuns.ranAt))
        // a run every 5 min writes a row per side: 7 days is about 4,000 rows
        .limit(6000)
        .execute();
    }),

  // What the activity log table holds, to debug missing entries. Owner only.
  getLogDiagnostics: publicProcedure.query(async ({ ctx }) => {
    const email = await requireOwner(ctx.headers);
    const mine = await db
      .select({ ranAt: cronRuns.ranAt, source: cronRuns.source, action: cronRuns.action })
      .from(cronRuns)
      .where(sql`lower(${cronRuns.email}) = lower(${email})`)
      .orderBy(desc(cronRuns.ranAt))
      .limit(1)
      .execute();
    const counts = await db
      .select({ email: cronRuns.email, source: cronRuns.source, n: sql<number>`count(*)::int` })
      .from(cronRuns)
      .groupBy(cronRuns.email, cronRuns.source)
      .execute();
    const account = await db.query.users.findFirst({ where: eq(users.email, email) });
    const profile = await db.query.userTemperatureProfile.findFirst({ where: eq(userTemperatureProfile.email, email) });
    // other people are shown as "person 1", "person 2"… (no email parts at all)
    const others = [...new Set(counts.map((c) => c.email.toLowerCase()).filter((e) => e !== email.toLowerCase()))].sort();
    const mask = (e: string) => (e.toLowerCase() === email.toLowerCase() ? "you" : `person ${others.indexOf(e.toLowerCase()) + 1}`);
    const dbNow = await db.execute(sql`select now()::text as now`);
    return {
      signedInAs: email,
      accountFound: !!account,
      hasSchedule: !!profile,
      lastCronRunAt: account?.lastCronRunAt ?? null,
      latestEntry: mine[0] ?? null,
      rowsBySource: counts.map((c) => ({ who: mask(c.email), source: c.source, rows: c.n })),
      serverTime: new Date().toISOString(),
      dbTime: (dbNow as unknown as { now: string }[])[0]?.now ?? null,
    };
  }),

  // ---------- Eight Sleep extras ----------

  getSleepData: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(31).default(7), timezone: z.string().max(50) }))
    .query(async ({ input, ctx }) => {
      try {
        const { token } = await getAuthUserAndToken(ctx.headers);
        const fmt = (d: Date) =>
          d.toLocaleDateString("en-CA", { timeZone: input.timezone }); // YYYY-MM-DD
        const to = new Date();
        const from = new Date(to.getTime() - (input.days - 1) * 24 * 60 * 60 * 1000);
        const { days, debug } = await getSleepNights(token, input.timezone, fmt(from), fmt(to));
        console.log("Sleep data debug:", JSON.stringify(debug));
        return { available: true as const, days, debug };
      } catch (error) {
        const status = statusFromError(error);
        if (status !== null) {
          console.error("Sleep data unavailable:", status);
          return { available: false as const, status, days: [], debug: null };
        }
        throw toTRPCError(error, "Failed to load sleep data.");
      }
    }),

  getPodHealth: publicProcedure.query(async ({ ctx }) => {
    try {
      const { user, token } = await getAuthUserAndToken(ctx.headers);
      const health = await getPodHealth(token);
      void db
        .update(users)
        .set({ podState: JSON.stringify({ online: health.online, hasWater: health.hasWater, needsPriming: health.needsPriming, priming: health.priming, at: new Date().toISOString() }) })
        .where(eq(users.email, user.email))
        .catch(() => undefined);
      let isAway: boolean | null = null;
      try {
        isAway = await getAwayState(token);
      } catch {
        // not critical
      }
      return { ...health, isAway };
    } catch (error) {
      console.error("Error fetching pod health:", error);
      throw toTRPCError(error, "Failed to load pod health.");
    }
  }),

  primePod: publicProcedure.mutation(async ({ ctx }) => {
    try {
      const { user, token } = await getAuthUserAndToken(ctx.headers);
      await startPriming(token);
      await logApp(user.email, "priming_started");
      return { success: true };
    } catch (error) {
      console.error("Error starting priming:", error);
await logAppFailure(ctx.headers, "priming", error);
      throw toTRPCError(error, "Could not start priming.");
    }
  }),

  setLedBrightness: publicProcedure
    .input(z.object({ level: z.number().int().min(0).max(100) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { user, token } = await getAuthUserAndToken(ctx.headers);
        await setLedBrightness(token, input.level);
        await logApp(user.email, "led_set", null, `${input.level}%`);
        return { success: true };
      } catch (error) {
        console.error("Error setting LED brightness:", error);
await logAppFailure(ctx.headers, "led", error);
        throw toTRPCError(error, "Could not change LED brightness.");
      }
    }),

  getQuickModes: publicProcedure.query(async ({ ctx }) => {
    const { token } = await getAuthUserAndToken(ctx.headers);
    const read = async (mode: "nap-mode" | "hot-flash-mode") => {
      try {
        return { supported: true, active: await getQuickModeStatus(token, mode) };
      } catch (error) {
        const status = statusFromError(error);
        return { supported: !(status === 403 || status === 404 || status === 402), active: null };
      }
    };
    const [nap, hotFlash] = await Promise.all([read("nap-mode"), read("hot-flash-mode")]);
    return { nap, hotFlash };
  }),

  setQuickMode: publicProcedure
    .input(
      z.object({
        mode: z.enum(["nap-mode", "hot-flash-mode"]),
        action: z.enum(["activate", "deactivate", "extend"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { user, token } = await getAuthUserAndToken(ctx.headers);
        await setQuickMode(token, input.mode, input.action);
        await logApp(user.email, `${input.mode === "nap-mode" ? "nap" : "hot_flash"}_${input.action}`);
        return { success: true };
      } catch (error) {
        console.error("Error setting quick mode:", error);
await logAppFailure(ctx.headers, "quick_mode", error);
        const status = statusFromError(error);
        if (status === 403 || status === 402) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This mode needs an Eight Sleep subscription." });
        }
        throw toTRPCError(error, "The pod didn't accept that mode.");
      }
    }),

  getBedMode: publicProcedure.query(async ({ ctx }) => {
    try {
      const { user, token } = await getAuthUserAndToken(ctx.headers);
      const side = await getBedSide(token);
      return {
        side,
        wholeBed: user.wholeBedApp || side === "solo",
        /** true when Eight Sleep's own "solo" is on (old way, removes the other account) */
        solo: side === "solo",
        homeSide: user.homeSide ?? null,
        otherSaved: !!user.otherSideUserId,
      };
    } catch (error) {
      console.error("Error reading bed side:", error);
      throw toTRPCError(error, "Could not read your bed side.");
    }
  }),

  setWholeBed: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { user, token } = await getAuthUserAndToken(ctx.headers);
        // Whole bed is done here, never with Eight Sleep's "solo": solo removes the
        // other account from the pod, and this login can't put it back.
        await db.update(users).set({ wholeBedApp: input.enabled }).where(eq(users.email, user.email)).execute();

        // One read of the pod (2 calls) gives everything; no full schedule check here,
        // the next cron run (≤5 min) keeps both sides on the schedule.
        let note: string | null = null;
        const sides = await getSides(token);
        if (sides.solo) {
          // left over from the old way: go back to your side
          const home = user.homeSide === "right" ? "right" : "left";
          await setBedSideMode(token, home).catch(() => undefined);
          note = "left Eight Sleep solo mode";
        }
        if (input.enabled) {
          // the other side copies yours right now
          const other: "left" | "right" = sides.own === "left" ? "right" : "left";
          const mine = sides.state[sides.own];
          try {
            await applyToSide(token, sides.ids[other], mine.isOn ? { on: true, level: mine.target } : { on: false });
          } catch (error) {
            note = `other side didn't follow: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        await logApp(user.email, input.enabled ? "whole_bed_on" : "whole_bed_off", null, note, input.enabled ? "both" : null);
        return { success: true, note };
      } catch (error) {
        console.error("Error switching whole-bed mode:", error);
        await logAppFailure(ctx.headers, "whole_bed", error);
        throw toTRPCError(error, "Couldn't switch Whole bed.");
      }
    }),

  // Try to put the other account back on its side (after Eight Sleep's solo removed it)
  restoreOtherAccount: publicProcedure.mutation(async ({ ctx }) => {
    try {
      const { user, token } = await getAuthUserAndToken(ctx.headers);
      if (!user.otherSideUserId) throw new Error("No other account saved yet.");
      const side = await getBedSide(token);
      const otherName = side === "right" ? "left" : "right";
      const result = await assignAccountToSide(token, user.otherSideUserId, otherName);
      await logApp(user.email, result.ok ? "other_account_restored" : "other_account_restore_failed", null, result.log.join("; "));
      return result;
    } catch (error) {
      console.error("Error restoring the other account:", error);
      await logAppFailure(ctx.headers, "restore_other", error);
      throw toTRPCError(error, "Couldn't put the other account back.");
    }
  }),

  getGuestSide: publicProcedure.query(async ({ ctx }) => {
    try {
      const { token } = await getAuthUserAndToken(ctx.headers);
      return await getGuestSide(token);
    } catch (error) {
      console.error("Error reading guest side:", error);
      throw toTRPCError(error, "Could not read the guest side.");
    }
  }),

  setGuestSide: publicProcedure
    .input(z.object({ on: z.boolean().optional(), level: levelInput.optional() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { user, token } = await getAuthUserAndToken(ctx.headers);
        const result = await setGuestSide(token, input);
        const how = `via ${result.used}`;
        if (input.on !== undefined) await logApp(user.email, input.on ? "guest_on" : "guest_off", null, how);
        if (input.level !== undefined) await logApp(user.email, "guest_set_level", input.level, how);
        return { success: true, used: result.used, attempts: result.attempts };
      } catch (error) {
        console.error("Error changing guest side:", error);
        await logAppFailure(ctx.headers, "guest_side", error);
        throw toTRPCError(error, error instanceof Error ? error.message : "The guest side didn't accept that.");
      }
    }),

  getCapabilities: publicProcedure.query(async ({ ctx }) => {
    try {
      const { token } = await getAuthUserAndToken(ctx.headers);
      return await probeCapabilities(token);
    } catch (error) {
      console.error("Error probing capabilities:", error);
      throw toTRPCError(error, "Could not check pod capabilities.");
    }
  }),

  // your own beds; the owner can also run everyone's (what the 5-minute cron does)
  runCronNow: publicProcedure
    .input(z.object({ everyone: z.boolean().optional() }).optional())
    .mutation(async ({ input, ctx }) => {
    const email = await requireEmail(ctx.headers);
    try {
      const everyone = input?.everyone === true && (await isOwner(email));
      const summary = await adjustTemperature(undefined, "check", callerFromHeaders(ctx.headers), everyone ? {} : { onlyEmail: email });
      return {
        success: true,
        ranAt: new Date(),
        mine: summary.results.filter((r) => r.email.toLowerCase() === email.toLowerCase()),
      };
    } catch (error) {
      console.error("Manual cron run failed:", error);
await logAppFailure(ctx.headers, "manual_check", error);
      throw toTRPCError(error, "Cron run failed. Check the server logs.");
    }
  }),
});

/** Removes every row this app keeps for one person (children first; the log has no foreign key). */
export async function deleteAccountData(email: string) {
  await db.transaction(async (tx) => {
    await tx.delete(whoopSleeps).where(sql`lower(${whoopSleeps.email}) = lower(${email})`);
    await tx.delete(whoopConnections).where(eq(whoopConnections.email, email));
    await tx.delete(profilePresets).where(eq(profilePresets.email, email));
    await tx.delete(userTemperatureProfile).where(eq(userTemperatureProfile.email, email));
    await tx.delete(cronRuns).where(sql`lower(${cronRuns.email}) = lower(${email})`);
    await tx.delete(nightLevels).where(sql`lower(${nightLevels.email}) = lower(${email})`);
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.email, email));
    await tx.delete(feedback).where(eq(feedback.email, email));
    await tx.delete(users).where(eq(users.email, email));
  });
}

async function authenticateUser(email: string, password: string) {
  try {
    return await authenticate(email, password);
  } catch (error) {
    if (error instanceof AuthError) {
      throw error; // Propagate the AuthError with its specific message
    } else {
      throw new AuthError("Failed to authenticate user");
    }
  }
}

async function saveUserToDatabase(email: string, authResult: Token) {
  try {
    await db
      .insert(users)
      .values({
        email,
        eightAccessToken: seal(authResult.eightAccessToken),
        eightRefreshToken: seal(authResult.eightRefreshToken),
        eightTokenExpiresAt: new Date(authResult.eightExpiresAtPosix),
        eightUserId: authResult.eightUserId,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          eightAccessToken: seal(authResult.eightAccessToken),
          eightRefreshToken: seal(authResult.eightRefreshToken),
          eightTokenExpiresAt: new Date(authResult.eightExpiresAtPosix),
          eightUserId: authResult.eightUserId,
          // a fresh sign-in fixes "sign in again"
          authError: false,
          updatedAt: new Date(),
        },
      })
      .execute();
  } catch (error) {
    console.error("Database operation failed:", error);
    throw new DatabaseError("Failed to save user token to database.");
  }
}
