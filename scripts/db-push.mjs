/**
 * Apply schema changes during Vercel builds without drizzle-kit push.
 * drizzle-kit introspects the DB and can hang forever on pooled PgBouncer URLs
 * at "Pulling schema from database".
 *
 * Each file in drizzle/ runs once and is recorded in "8slp_appMigrations" as "file:<name>", so a
 * normal build doesn't touch the live tables at all. (Re-running them every build took table locks
 * that waited on the live app and timed the build out.) A change to the database goes in a new file.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { isTestCopy, applyStagingEnv } from "./staging-env.mjs";

const OVERALL_TIMEOUT_MS = 150_000;
const CONNECT_TIMEOUT_SEC = 15;
// A busy table: wait this long for it, then retry the file a few times (never hold up the live app for long)
const LOCK_TIMEOUT = "5s";
const LOCK_RETRIES = 5;
const LOCK_RETRY_WAIT_MS = 3_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.join(__dirname, "..", "drizzle");

function requireDatabaseUrl() {
  // A test copy must never change the live database: without its own, the build stops here.
  if (isTestCopy()) {
    if (!process.env.STAGING_POSTGRES_URL) {
      throw new Error("This is a test copy (Preview) and STAGING_POSTGRES_URL isn't set, so it would use the live database. Add the STAGING_ variables in Vercel (docs/PREVIEWS.md, Part 2).");
    }
    applyStagingEnv();
  }
  const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "Missing POSTGRES_URL_NON_POOLING (preferred) or POSTGRES_URL for db:push",
    );
  }
  if (!process.env.POSTGRES_URL_NON_POOLING) {
    console.warn(
      "POSTGRES_URL_NON_POOLING is unset; using POSTGRES_URL (pooled URLs may hang or fail)",
    );
  }
  return url;
}

function sslOption() {
  const mode = process.env.POSTGRES_SSL ?? "true";
  if (mode === "false" || mode === "disable") return false;
  return { rejectUnauthorized: false };
}

const bootstrapSql = `
CREATE TABLE IF NOT EXISTS "8slp_users" (
  "email" varchar(255) PRIMARY KEY NOT NULL,
  "eightUserId" varchar(255) NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "8slp_userTemperatureProfiles" (
  "email" varchar(255) PRIMARY KEY NOT NULL REFERENCES "8slp_users"("email"),
  "bedTime" time NOT NULL,
  "wakeupTime" time NOT NULL,
  "initialSleepLevel" integer NOT NULL,
  "midStageSleepLevel" integer NOT NULL,
  "midStageSleepLevelStartTime" time DEFAULT '23:00' NOT NULL,
  "finalSleepLevel" integer NOT NULL,
  "finalSleepLevelStartTime" time DEFAULT '06:00' NOT NULL,
  "wakeupAlarmEnabled" boolean DEFAULT false NOT NULL,
  "wakeupAlarmLevel" integer DEFAULT 0 NOT NULL,
  "wakeupAlarmLeadMinutes" integer DEFAULT 30 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "timezone" varchar(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS "8slp_appMigrations" (
  "name" varchar(100) PRIMARY KEY NOT NULL,
  "applied_at" timestamp DEFAULT now() NOT NULL
);
`;

/** Run one transaction, retrying when a table it needs is busy (lock timeout). */
async function withLockRetry(sql, label, work) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
        return work(tx);
      });
    } catch (error) {
      if (error?.code !== "55P03" || attempt >= LOCK_RETRIES) throw error;
      console.log(`${label}: a table is busy, retrying (${attempt}/${LOCK_RETRIES - 1})...`);
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_WAIT_MS));
    }
  }
}

async function applyMigrations(sql) {
  await withLockRetry(sql, "Bootstrap", (tx) => tx.unsafe(bootstrapSql));

  const done = new Set(
    (await sql`SELECT "name" FROM "8slp_appMigrations" WHERE "name" LIKE 'file:%'`).map((r) => r.name),
  );
  const files = (await readdir(drizzleDir))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) => !done.has(`file:${name}`));
  if (files.length === 0) {
    console.log("No new database changes.");
    return;
  }

  for (const file of files) {
    const contents = await readFile(path.join(drizzleDir, file), "utf8");
    console.log(`Applying ${file}...`);
    // the file and its record go together: applied and remembered, or neither
    await withLockRetry(sql, file, async (tx) => {
      await tx.unsafe(contents);
      await tx`INSERT INTO "8slp_appMigrations" ("name") VALUES (${`file:${file}`}) ON CONFLICT DO NOTHING`;
    });
  }
}

async function main() {
  const url = requireDatabaseUrl();
  const sql = postgres(url, {
    ssl: sslOption(),
    max: 1,
    connect_timeout: CONNECT_TIMEOUT_SEC,
    idle_timeout: 20,
    max_lifetime: 60,
    // "already exists, skipping" notices are expected and only bury the real error in the log
    onnotice: () => {},
  });

  try {
    await applyMigrations(sql);
    console.log("Database schema is up to date.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

let timer;
const timedOut = new Promise((_, reject) => {
  timer = setTimeout(() => {
    reject(
      new Error(
        `db:push timed out after ${OVERALL_TIMEOUT_MS / 1000}s (check POSTGRES_URL_NON_POOLING)`,
      ),
    );
  }, OVERALL_TIMEOUT_MS);
});

try {
  await Promise.race([main(), timedOut]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  // done: don't sit out the rest of the time limit before the build can finish
  clearTimeout(timer);
}
