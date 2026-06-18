// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

// Trace sampling is env-controlled via NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
// (must be NEXT_PUBLIC_ to be readable in the browser bundle). Defaults LOWER
// than the server (0.02): browser pageload/navigation traces plus the 15-60s
// polls add up fast on a 1-2 user internal tool. Parse defensively — an
// unset/garbage/out-of-range value falls back to 0.02.
function parseSampleRate(raw: string | undefined, fallback: number): number {
  const n = parseFloat(raw ?? "");
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

const SAMPLE_RATE = parseSampleRate(
  process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  0.02,
);

Sentry.init({
  dsn: "https://ba32183b35552fc5b40f5c3a0a275c1d@o4511269869649920.ingest.us.sentry.io/4511269883543552",

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // Env-controlled default sample rate (see parseSampleRate above).
  tracesSampleRate: SAMPLE_RATE,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
