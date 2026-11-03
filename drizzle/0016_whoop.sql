-- WHOOP connection per app user, and the nights it has sent (sleep + recovery, as JSON)
CREATE TABLE IF NOT EXISTS "8slp_whoopConnections" (
  "email" varchar(255) PRIMARY KEY NOT NULL REFERENCES "8slp_users"("email"),
  "whoopUserId" varchar(32) NOT NULL,
  "accessToken" text NOT NULL,
  "refreshToken" text,
  "expiresAt" timestamp NOT NULL,
  "connectedAt" timestamp DEFAULT now() NOT NULL,
  "lastSyncAt" timestamp,
  "lastWebhookAt" timestamp
);
CREATE INDEX IF NOT EXISTS "8slp_whoopConnections_user_idx" ON "8slp_whoopConnections" ("whoopUserId");

CREATE TABLE IF NOT EXISTS "8slp_whoopSleeps" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "email" varchar(255) NOT NULL,
  "start" timestamp NOT NULL,
  "end" timestamp NOT NULL,
  "nap" boolean DEFAULT false NOT NULL,
  "sleep" text NOT NULL,
  "recovery" text,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "8slp_whoopSleeps_email_start_idx" ON "8slp_whoopSleeps" ("email", "start");
