// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

// Trace sampling is env-controlled so the rate can be tuned in Vercel without a
// code change. Defaults LOW (0.05) for a 1-2 user internal tool: error capture
// is unaffected by trace sampling, so this only trims performance traces.
// Parse defensively — an unset/garbage/out-of-range value falls back to 0.05.
function parseSampleRate(raw: string | undefined, fallback: number): number {
  const n = parseFloat(raw ?? "");
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

const SAMPLE_RATE = parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.05);

// High-frequency machine traffic that was burning the span budget at 100%
// capture: the every-minute scheduled-send cron, the 15-minute calendar-sync
// cron, and the 15-60s client polls (mail unread/list, SMS, phone, reminders,
// scheduled-send failures). We drop their traces entirely (rate 0) and sample
// only genuine, lower-frequency activity at SAMPLE_RATE. The other crons
// (news-feed, bd-discovery, renew-gmail-watch, client-release) run daily and
// are left on the normal low rate.
const DROP_TRACE_PATHS = [
  "/api/cron/scheduled-send",
  "/api/cron/calendar-sync",
  "/api/mail/unread", // mail-context unread-badge poll (15s)
  "/api/mail/threads", // mail-view list-refresh poll (30s)
  "/api/krispcall/recent", // texting-context poll (30s)
  "/api/phone/unread-count", // phone-context poll (30s)
  "/api/reminders/due", // reminder-toast-provider poll (60s)
  "/api/mail/scheduled/failed", // scheduled-send-failure-toaster poll (60s)
];

Sentry.init({
  dsn: "https://ba32183b35552fc5b40f5c3a0a275c1d@o4511269869649920.ingest.us.sentry.io/4511269883543552",

  // Env-controlled default sample rate (see parseSampleRate above). Used for
  // every transaction the tracesSampler below does not explicitly drop.
  tracesSampleRate: SAMPLE_RATE,

  // Drop machine-traffic traces; sample everything else at SAMPLE_RATE. The
  // incoming path can surface on the span name, the normalized request URL, or
  // the OpenTelemetry http.* / url.* attributes depending on the span kind, so
  // we check all of them and substring-match the base route (covers dynamic
  // segments like /api/mail/threads/[id]/read too).
  tracesSampler: (samplingContext) => {
    const attrs = samplingContext.attributes ?? {};
    const candidates = [
      samplingContext.name,
      samplingContext.normalizedRequest?.url,
      attrs["http.target"],
      attrs["http.route"],
      attrs["url.path"],
      attrs["http.url"],
      attrs["url.full"],
    ];
    const haystack = candidates
      .filter((c): c is string => typeof c === "string")
      .join(" ");
    if (DROP_TRACE_PATHS.some((path) => haystack.includes(path))) return 0;
    return SAMPLE_RATE;
  },

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});
