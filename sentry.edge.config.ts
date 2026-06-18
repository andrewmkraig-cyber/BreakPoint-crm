// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

// Trace sampling is env-controlled (same SENTRY_TRACES_SAMPLE_RATE as the
// server runtime), defaulting LOW (0.05) for a 1-2 user internal tool. Parse
// defensively — an unset/garbage/out-of-range value falls back to 0.05.
function parseSampleRate(raw: string | undefined, fallback: number): number {
  const n = parseFloat(raw ?? "");
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

const SAMPLE_RATE = parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.05);

Sentry.init({
  dsn: "https://ba32183b35552fc5b40f5c3a0a275c1d@o4511269869649920.ingest.us.sentry.io/4511269883543552",

  // Env-controlled default sample rate (see parseSampleRate above).
  tracesSampleRate: SAMPLE_RATE,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});
