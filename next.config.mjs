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
  "connect-src 'self' https://vercel.live wss://ws-us3.pusher.com",
  "frame-src 'self' https://vercel.live https://*.amazonaws.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
