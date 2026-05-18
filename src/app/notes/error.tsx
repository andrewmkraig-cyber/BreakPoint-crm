"use client";

import { useEffect } from "react";

// Per-segment error boundary so a server-render failure on /notes shows
// the real message + digest in the UI instead of falling through to the
// generic "Application error" client crash. Andrew can quote the digest
// to grep Vercel function logs for the underlying stack.
export default function NotesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[/notes error boundary]", error);
  }, [error]);

  return (
    <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      <div className="font-semibold">Notes page hit a server error.</div>
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
