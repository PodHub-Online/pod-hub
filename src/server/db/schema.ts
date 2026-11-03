import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTableCreator,
  primaryKey,
  real,
  serial,
  text,
  time,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const createTable = pgTableCreator((name) => `8slp_${name}`); // also in drizzle.config.ts

export const users = createTable("users", {
  email: varchar("email", { length: 255 }).notNull().primaryKey(),
  eightUserId: varchar("eightUserId", { length: 255 }).notNull(),
  eightAccessToken: text("access_token").notNull(),
  eightRefreshToken: text("refresh_token").notNull(),
  eightTokenExpiresAt: timestamp("expires_at").notNull(),
  vacationMode: boolean("vacationMode").default(false).notNull(),
  vacationUntil: timestamp("vacationUntil"),
  lastCronRunAt: timestamp("lastCronRunAt"),
  // Side the user had before switching to whole-bed ("solo") mode
  homeSide: varchar("homeSide", { length: 10 }),
  otherSideUserId: varchar("otherSideUserId", { length: 64 }),
  // Whole bed done by the app: every change is also sent to the other side
  wholeBedApp: boolean("wholeBedApp").default(false).notNull(),
  // Off = the cron leaves the pod alone (manual only)
  scheduleEnabled: boolean("scheduleEnabled").default(true).notNull(),
  // After a manual change the schedule waits until this time (its next stage)
  manualHoldUntil: timestamp("manualHoldUntil"),
  // Eight Sleep refused (too many requests or a dead sign-in): the cron leaves this person alone until then
  eightBackoffUntil: timestamp("eightBackoffUntil"),
  // shown after sign-in: "{name}'s Hub", the headboard engraving, the nightstand title
  displayName: varchar("displayName", { length: 40 }),
  // Nap mode: until when, which side, the level, and the warm-up level for its last minutes
  napUntil: timestamp("napUntil"),
  napSide: varchar("napSide", { length: 10 }),
  napLevel: integer("napLevel"),
  napWarmLevel: integer("napWarmLevel"),
  // "I'm hot": until when, which side, and how each side was before (JSON {left:{on,level},right:{on,level}}) so it can be put back
  hotUntil: timestamp("hotUntil"),
  hotSide: varchar("hotSide", { length: 10 }),
  hotPrev: varchar("hotPrev", { length: 200 }),
  // the app's accent color (Settings → Preferences)
  accentColor: varchar("accentColor", { length: 16 }),
  // home, from the phone's location (only when asked): for the weather and travel checks
  homeLat: real("homeLat"),
  homeLon: real("homeLon"),
  weatherEnabled: boolean("weatherEnabled").default(false).notNull(),
  // JSON: tonight's forecast, fetched at most every 3 hours
  weatherCache: text("weatherCache"),
  travelEnabled: boolean("travelEnabled").default(true).notNull(),
  // JSON: which phone notifications are on; what was last seen (to notify only on changes)
  notifyPrefs: text("notifyPrefs"),
  notifyState: text("notifyState"),
  // JSON {title, body, at}: what the phone shows when a push arrives (pushes carry no content)
  lastNotification: text("lastNotification"),
  // room-aware cooling: the Pod measured a warm room last night → start earlier and colder
  roomAware: boolean("roomAware").default(false).notNull(),
  roomAwareC: real("roomAwareC").default(26.5).notNull(),
  roomCache: text("roomCache"),
  // weekly digest notification (Sunday morning)
  lastDigestAt: timestamp("lastDigestAt"),
  // owner statistics: last time the app was open, and what it ran on (phone, language, unit)
  lastSeenAt: timestamp("lastSeenAt"),
  lastClient: text("lastClient"),
  // the Pod as last seen by the app (online, water, priming), so statistics never ask Eight Sleep
  podState: text("podState"),
  // Eight Sleep stopped accepting this account's sign-in (cleared on the next good sign-in)
  authError: boolean("authError").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const profilePresets = createTable("profilePresets", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).references(() => users.email).notNull(),
  name: varchar("name", { length: 60 }).notNull(),
  description: varchar("description", { length: 160 }).default("").notNull(),
  bedTime: time("bedTime").notNull(),
  wakeupTime: time("wakeupTime").notNull(),
  initialSleepLevel: integer("initialSleepLevel").notNull(),
  midStageSleepLevel: integer("midStageSleepLevel").notNull(),
  midStageSleepLevelStartTime: time("midStageSleepLevelStartTime").notNull(),
  finalSleepLevel: integer("finalSleepLevel").notNull(),
  finalSleepLevelStartTime: time("finalSleepLevelStartTime").notNull(),
  wakeupAlarmEnabled: boolean("wakeupAlarmEnabled").default(false).notNull(),
  wakeupAlarmLevel: integer("wakeupAlarmLevel").default(0).notNull(),
  wakeupAlarmLeadMinutes: integer("wakeupAlarmLeadMinutes").default(30).notNull(),
  // Pre-wake: a step from preWakeLeadMinutes before wake-up until the wake-up warmth starts
  preWakeEnabled: boolean("preWakeEnabled").default(false).notNull(),
  preWakeLevel: integer("preWakeLevel").default(10).notNull(),
  preWakeLeadMinutes: integer("preWakeLeadMinutes").default(60).notNull(),
  preheatLeadMinutes: integer("preheatLeadMinutes").default(60).notNull(),
  // stages set to Off: 1 falling asleep (and pre-cool), 2 deep sleep, 4 late sleep, 8 Pre-wake
  offStages: integer("offStages").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// One schedule per side of the bed ("left" / "right"), keyed by (email, side)
export const userTemperatureProfile = createTable("userTemperatureProfiles", {
  email: varchar('email', { length: 255 }).references(() => users.email).notNull(),
  side: varchar("side", { length: 10 }).default("left").notNull(),
  // Off = the cron leaves this side alone (manual only)
  scheduleEnabled: boolean("scheduleEnabled").default(true).notNull(),
  // After a manual change the schedule waits until this time (its next stage)
  manualHoldUntil: timestamp("manualHoldUntil"),
  bedTime: time("bedTime").notNull(),
  wakeupTime: time("wakeupTime").notNull(),
  initialSleepLevel: integer("initialSleepLevel").notNull(),
  midStageSleepLevel: integer("midStageSleepLevel").notNull(),
  midStageSleepLevelStartTime: time("midStageSleepLevelStartTime").notNull(),
  finalSleepLevel: integer("finalSleepLevel").notNull(),
  finalSleepLevelStartTime: time("finalSleepLevelStartTime").notNull(),
  wakeupAlarmEnabled: boolean("wakeupAlarmEnabled").default(false).notNull(),
  wakeupAlarmLevel: integer("wakeupAlarmLevel").default(0).notNull(),
  wakeupAlarmLeadMinutes: integer("wakeupAlarmLeadMinutes").default(30).notNull(),
  // Pre-wake: a step from preWakeLeadMinutes before wake-up until the wake-up warmth starts
  preWakeEnabled: boolean("preWakeEnabled").default(false).notNull(),
  preWakeLevel: integer("preWakeLevel").default(10).notNull(),
  preWakeLeadMinutes: integer("preWakeLeadMinutes").default(60).notNull(),
  preheatLeadMinutes: integer("preheatLeadMinutes").default(60).notNull(),
  // stages set to Off: 1 falling asleep (and pre-cool), 2 deep sleep, 4 late sleep, 8 Pre-wake
  offStages: integer("offStages").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  timezoneTZ: varchar("timezone", { length: 50 }).notNull(),
  // Nights the schedule runs: bit per weekday of the bedtime (bit 0 = Sunday). 127 = every night.
  activeDays: integer("activeDays").default(127).notNull(),
  // Weekend nights: these weekdays (same bits as activeDays) use their own bedtime and wake-up
  weekendDays: integer("weekendDays").default(0).notNull(),
  weekendBedTime: time("weekendBedTime"),
  weekendWakeupTime: time("weekendWakeupTime"),
}, (t) => ({
  pk: primaryKey({ columns: [t.email, t.side] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  temperatureProfiles: many(userTemperatureProfile),
}));

export const userTemperatureProfileRelations = relations(userTemperatureProfile, ({ one }) => ({
  user: one(users, {
    fields: [userTemperatureProfile.email],
    references: [users.email],
  }),
}));

// Activity log: one row per cron run or in-app change; pruned to the last 7 days.
export const cronRuns = createTable(
  "cronRuns",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    ranAt: timestamp("ranAt").defaultNow().notNull(),
    stage: varchar("stage", { length: 20 }).notNull(),
    action: varchar("action", { length: 30 }).notNull(),
    level: integer("level"),
    message: text("message"),
    // "cron" for scheduled runs; "app" for changes made in the app
    source: varchar("source", { length: 20 }).default("cron").notNull(),
    podWasOn: boolean("podWasOn"),
    levelBefore: integer("levelBefore"),
    targetBefore: integer("targetBefore"),
    durationMs: integer("durationMs"),
    // JSON: who triggered it (ip, city, region, country, userAgent, host)
    meta: text("meta"),
    // which side of the bed: "left", "right" or "both" (null on older rows)
    side: varchar("side", { length: 10 }),
  },
  (t) => ({
    emailRanAtIdx: index("8slp_cronRuns_email_ranAt_idx").on(t.email, t.ranAt),
  }),
);

// WHOOP: one connection per app user (OAuth tokens), and the nights it sent
export const whoopConnections = createTable("whoopConnections", {
  email: varchar("email", { length: 255 }).references(() => users.email).primaryKey(),
  whoopUserId: varchar("whoopUserId", { length: 32 }).notNull(),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken"),
  expiresAt: timestamp("expiresAt").notNull(),
  connectedAt: timestamp("connectedAt").defaultNow().notNull(),
  lastSyncAt: timestamp("lastSyncAt"),
  lastWebhookAt: timestamp("lastWebhookAt"),
});

export const whoopSleeps = createTable(
  "whoopSleeps",
  {
    // WHOOP's sleep UUID
    id: varchar("id", { length: 64 }).primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    start: timestamp("start").notNull(),
    end: timestamp("end").notNull(),
    nap: boolean("nap").default(false).notNull(),
    // raw WHOOP records as JSON: the sleep, and the recovery that came from it
    sleep: text("sleep").notNull(),
    recovery: text("recovery"),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => ({
    emailStartIdx: index("8slp_whoopSleeps_email_start_idx").on(t.email, t.start),
  }),
);

// Settings entered in the app itself (e.g. the WHOOP developer app keys)
export const appConfig = createTable("appConfig", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// Who may sign in besides the owner (Settings → Invites)
export const invites = createTable("invites", {
  email: varchar("email", { length: 255 }).primaryKey(),
  addedAt: timestamp("addedAt").defaultNow().notNull(),
});

// People who proved they own an Eight Sleep account and asked to get in (no tokens kept)
export const accessRequests = createTable("accessRequests", {
  email: varchar("email", { length: 255 }).primaryKey(),
  firstName: varchar("firstName", { length: 80 }),
  requestedAt: timestamp("requestedAt").defaultNow().notNull(),
  // when the owner got the email about it (null: not yet)
  emailedAt: timestamp("emailedAt"),
});

// Failed sign-ins and access requests (hashed keys), to slow down password guessing
export const signInAttempts = createTable(
  "signInAttempts",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 80 }).notNull(),
    at: timestamp("at").defaultNow().notNull(),
  },
  (t) => ({
    keyAtIdx: index("8slp_signInAttempts_key_at_idx").on(t.key, t.at),
  }),
);

// One row per night and side: a summary of what the pod did, kept after the activity log is pruned
export const nightLevels = createTable(
  "nightLevels",
  {
    email: varchar("email", { length: 255 }).notNull(),
    night: varchar("night", { length: 10 }).notNull(), // YYYY-MM-DD of the evening
    side: varchar("side", { length: 10 }).notNull(),
    avgLevel: real("avgLevel"),
    minLevel: integer("minLevel"),
    maxLevel: integer("maxLevel"),
    onMinutes: integer("onMinutes").default(0).notNull(),
    manualChanges: integer("manualChanges").default(0).notNull(),
    scheduleRan: boolean("scheduleRan").default(false).notNull(),
    firstOn: timestamp("firstOn"),
    // JSON {initial, mid, final}: the average level the schedule set in each stage (for auto-tune)
    stageLevels: text("stageLevels"),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.email, t.night, t.side] }),
  }),
);

// Phones that asked for notifications (the push endpoint is the key)
export const pushSubscriptions = createTable("pushSubscriptions", {
  endpoint: text("endpoint").primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// Notes people send from Settings → Send feedback; the owner reads them under Invites
export const feedback = createTable("feedback", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  kind: varchar("kind", { length: 20 }).notNull(),
  text: varchar("text", { length: 2000 }).notNull(),
  meta: varchar("meta", { length: 300 }),
  status: varchar("status", { length: 20 }).default("new").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  // the owner's email reply (sent from the approval-emails Gmail), and when
  reply: varchar("reply", { length: 4000 }),
  repliedAt: timestamp("repliedAt"),
});

// Owner statistics: one row per visit or feature use (no health data), kept 90 days
export const events = createTable(
  "events",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 255 }),
    kind: varchar("kind", { length: 40 }).notNull(),
    meta: varchar("meta", { length: 300 }),
    at: timestamp("at").defaultNow().notNull(),
  },
  (t) => ({
    atIdx: index("8slp_events_at_idx").on(t.at),
    emailAtIdx: index("8slp_events_email_at_idx").on(t.email, t.at),
  }),
);

// Daily counters for the statistics (Eight Sleep calls and errors, notifications, emails)
export const dailyCounters = createTable(
  "dailyCounters",
  {
    day: varchar("day", { length: 10 }).notNull(),
    key: varchar("key", { length: 40 }).notNull(),
    n: integer("n").default(0).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.day, t.key] }),
  }),
);
