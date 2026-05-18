"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Root-level boundary. Catches layout-level throws (which segment-level
// error.tsx files can't see). Surfaces message + digest so Andrew can
// quote the digest to find the underlying stack in Vercel function
// logs, rather than the previous behavior of falling back to Next's
// generic blank "Application error" screen.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          color: "#111",
        }}
      >
        <div style={{ maxWidth: 720 }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 18, color: "#b91c1c" }}>
            Ace hit a server error
          </h1>
          <pre
            style={{
              margin: "8px 0",
              padding: 12,
              background: "#fef2f2",
              color: "#7f1d1d",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              borderRadius: 8,
            }}
          >
            {error.message}
          </pre>
          {error.digest && (
            <div style={{ fontSize: 12, color: "#374151", marginBottom: 12 }}>
              Digest:{" "}
              <code
                style={{ background: "#fff", padding: "2px 4px", borderRadius: 4 }}
              >
                {error.digest}
              </code>
            </div>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#5A9642",
              color: "#fff",
              border: "none",
              padding: "8px 12px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
