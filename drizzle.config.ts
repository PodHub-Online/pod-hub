import { type Config } from "drizzle-kit";

import { env } from "~/env";

const sslConfig =
  env.POSTGRES_SSL === "false" || env.POSTGRES_SSL === "disable"
    ? undefined
    : { rejectUnauthorized: false };

// Prefer the direct DB URL for drizzle-kit. Pooled PgBouncer URLs hang at
// "Pulling schema from database". Vercel builds use scripts/db-push.mjs instead.
const databaseUrl = env.POSTGRES_URL_NON_POOLING ?? env.POSTGRES_URL;

export default {
  schema: "./src/server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
    ssl: sslConfig,
  },
  tablesFilter: ["8slp_*"], // also in schema.ts
} satisfies Config;
