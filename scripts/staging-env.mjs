/**
 * Test copies (Vercel "Preview" deployments) use their own database and secrets. The live
 * database variables come from the Supabase connection and can't be limited to Production, so a
 * test copy reads STAGING_<name> instead of <name> wherever one is set. Production never does.
 * The same list is in src/instrumentation.ts (for the running app).
 */
export const STAGED_VARS = ["POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "JWT_SECRET", "TOKEN_KEY", "CRON_SECRET", "OWNER_EMAIL"];

export const isTestCopy = () => process.env.VERCEL_ENV === "preview";

export function applyStagingEnv() {
  if (!isTestCopy()) return;
  for (const name of STAGED_VARS) {
    const value = process.env[`STAGING_${name}`];
    if (value) process.env[name] = value;
  }
}
