/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
// a test copy (Vercel Preview) uses its STAGING_ database and secrets; must run before env.js checks them
const { applyStagingEnv } = await import("./scripts/staging-env.mjs");
applyStagingEnv();
await import("./src/env.js");

const isDev = process.env.NODE_ENV !== "production";

// The page only talks to this site (Eight Sleep and WHOOP are called from the server) and to Google
// Analytics (page views only), so a script that somehow got in still couldn't send anything (like the
// sign-in token) anywhere else.
const ga = {
  script: "https://www.googletagmanager.com",
  send: "https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
};
const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js inlines small scripts (and the theme script in layout.tsx); dev also needs eval
  `script-src 'self' 'unsafe-inline' ${ga.script}${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${ga.send}`,
  "font-src 'self' data:",
  `connect-src 'self' ${ga.send}${isDev ? " ws:" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** @type {import("next").NextConfig} */
const config = {
    experimental: {
        // src/instrumentation.ts: the STAGING_ swap for the running app on a test copy
        instrumentationHook: true,
    },
    typescript: {
        ignoreBuildErrors: true,
    },
    eslint: {
        ignoreDuringBuilds: true,
    },
    async headers() {
        return [
            {
                source: "/:path*",
                headers: [
                    { key: "Content-Security-Policy", value: contentSecurityPolicy },
                    { key: "X-Frame-Options", value: "DENY" },
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
                ],
            },
        ];
    },
};

export default config;
