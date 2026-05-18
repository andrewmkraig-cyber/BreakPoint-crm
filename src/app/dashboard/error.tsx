"use client";

import { useEffect } from "react";

// Surfaces the real server-render error on /dashboard instead of
// degrading to the generic "Application error" crash page. Digest can
// be matched against Vercel function logs to pull the stack trace.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[/dashboard error boundary]", error);
  }, [error]);

  return (
    <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      <div className="font-semibold">Dashboard hit a server error.</div>
      <div className="whitespace-pre-wrap font-mono text-xs">{error.message}</div>
      {error.digest && (
        <div className="text-xs">
          Digest: <code className="rounded bg-white px-1 py-0.5">{error.digest}</code>
        </div>
      )}
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
      >
        Retry
      </button>
    </div>
  );
}
