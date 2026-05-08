import { withSentryConfig } from "@sentry/nextjs";
/** @type {import('next').NextConfig} */

// Content-Security-Policy + frame-deny headers.
//
// `script-src 'self'` is the key line: only scripts from our own origin (Ace)
// and the explicitly-listed Vercel preview/live hosts load. Any third-party
// script injection (Webflow CDN, extensions, stale service workers) is
// blocked. 'unsafe-inline' + 'unsafe-eval' are required for Next.js's React
// hydration runtime and dev overlays.
//
// img-src is permissive because RF serves candidate / company images from
// multiple S3 buckets and Google profile avatars come from lh3.google*.
// connect-src allows the browser to reach its own origin for server actions
// and API routes; Vercel live adds a websocket for preview deploys.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.vercel.app https://vercel.live",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  // api.open-meteo.com is the topbar weather widget's data source —
  // free, no key, no proxy needed; it's added to connect-src so the
  // browser fetch isn't silently blocked.
  "connect-src 'self' https://vercel.live wss://ws-us3.pusher.com https://api.open-meteo.com",
  // youtube.com + youtube-nocookie.com are allowlisted so the floating
  // YouTube panel can embed the standard /embed/{videoId} player.
  "frame-src 'self' https://vercel.live https://*.amazonaws.com https://www.youtube.com https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // SAMEORIGIN (not DENY) — we iframe our own API routes for inline PDF
  // previews (resume viewer, etc.). DENY refuses every iframe, including
  // same-origin ones, which surfaces as "refused to connect" in the browser.
  // CSP frame-src already scopes cross-origin framing to the allowlist.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig = {
  experimental: {
    serverActions: {
      // Allow up to 20MB uploads for client agreement PDFs. Default is 1MB.
      bodySizeLimit: "20mb",
    },
    // mammoth pulls in dynamic requires that Next's bundler mangles; keep it
    // external so `require("mammoth")` resolves at runtime on the server.
    serverComponentsExternalPackages: ["mammoth", "pdf-parse"],
  },
  images: {
    // Google profile avatars served via next/image need explicit allow-listing
    // since Next's image optimizer refuses unknown remotes by default. Without
    // this, the signed-in user's avatar in the top nav throws at runtime.
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "breakpoint-talent",

  project: "ace-crm",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
