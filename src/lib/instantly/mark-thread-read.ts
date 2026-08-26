import { InstantlyError, kindForStatus } from "@/lib/instantly/errors";
import { normalizeApiKey, tryAcquireEmailsSlot } from "@/lib/instantly/client";

// =====================================================================
// THE ONLY WRITE IN THE ENTIRE INSTANTLY INTEGRATION.
//
// This file exists to hold exactly one call and nothing else, so the
// build gate (scripts/check-instantly-readonly.mjs) can allowlist it by
// three conditions at once - this filename, the POST method, and this
// one endpoint shape. Any other write, in this file or any other, still
// fails the build. Do not add a second function here; put new reads in
// client.ts, and understand that a new WRITE requires deliberately
// widening the gate, which is a decision, not a refactor.
//
// Endpoint: POST /api/v2/emails/threads/{thread_id}/mark-as-read
// Scopes:   emails:update (also emails:all / all:update / all:all)
//
// VERIFIED 2026-08-26 against a real thread: the docs claim thread_id is
// a UUID, but real ids are 26-char base64url (e.g.
// "8e-cKcz_194i4PONIN3kuof-2l") and the endpoint accepts them, returning
// {"success":true}. Do not "fix" the id format to match the docs.
//
// This mirrors Ace's local read state outward. It is BEST EFFORT: the
// caller has already recorded readAt locally, and that local state is
// authoritative and never reverted on failure here.
// =====================================================================

const BASE_URL = "https://api.instantly.ai/api/v2";
const TIMEOUT_MS = 10_000;

export type MarkThreadReadResult =
  | { ok: true }
  | { ok: false; kind: string; status: number | null; detail: string };

export async function markInstantlyThreadRead(
  threadId: string,
): Promise<MarkThreadReadResult> {
  const key = normalizeApiKey(process.env.INSTANTLY_API_KEY);
  if (!key) {
    return { ok: false, kind: "not_configured", status: null, detail: "INSTANTLY_API_KEY is not set." };
  }
  if (!threadId.trim()) {
    return { ok: false, kind: "bad_request", status: null, detail: "Missing thread id." };
  }

  // Counts against the same /emails bucket as everything else. Uses the
  // NON-blocking reservation: a read-sync must never make the user wait,
  // and an unsynced row is retried by the poller.
  if (!tryAcquireEmailsSlot()) {
    return { ok: false, kind: "rate_limited", status: null, detail: "Local /emails budget spent; will retry." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `${BASE_URL}/emails/threads/${encodeURIComponent(threadId)}/mark-as-read`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (res.ok) return { ok: true };

    const body = await res.text().catch(() => "");
    const kind = kindForStatus(res.status, body);
    return { ok: false, kind, status: res.status, detail: body.slice(0, 200) };
  } catch (e) {
    const isAbort = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      kind: "unavailable",
      status: null,
      detail: isAbort ? "Timed out." : e instanceof Error ? e.message : "Network error.",
    };
  } finally {
    clearTimeout(timer);
  }
}

// Re-exported so callers can classify without importing errors.ts too.
export { InstantlyError };
