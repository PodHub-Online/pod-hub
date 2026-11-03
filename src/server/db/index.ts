import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "~/env";
import * as schema from "./schema";

const sslMode = env.POSTGRES_SSL;
const sslConfig =
  sslMode === "true" || sslMode === "require"
    ? { rejectUnauthorized: false }
    : false;

// A few connections per server, so a long schedule check running on the same server doesn't
// make every screen wait in line behind it. Supabase's pooler (port 6543) hands each query to
// any backend, so prepared statements are off.
const client = postgres(process.env.POSTGRES_URL!, {
  ssl: sslConfig,
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(client, { schema });
