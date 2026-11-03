/**
 * Runs once when the server starts, before any page or API call. On a test copy (Vercel
 * Preview) it swaps in the STAGING_ database and secrets, so the test copy never uses the live
 * ones. Same list as scripts/staging-env.mjs (used by the build).
 */
const STAGED_VARS = ["POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "JWT_SECRET", "TOKEN_KEY", "CRON_SECRET", "OWNER_EMAIL"];

export function register() {
  if (process.env.VERCEL_ENV !== "preview") return;
  for (const name of STAGED_VARS) {
    const value = process.env[`STAGING_${name}`];
    if (value) process.env[name] = value;
  }
}
