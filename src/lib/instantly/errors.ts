// Instantly error taxonomy.
//
// The point of the `kind` discriminant is that callers branch on CAUSE,
// not on string matching. The three failures Andrew cares about telling
// apart are: the key is missing/wrong, Instantly itself is down, and
// there's simply nothing to show. The first two are errors here; "no
// data" is deliberately NOT an error - an empty workspace returns an
// empty array, so a brand-new Instantly account never renders as broken.

export type InstantlyErrorKind =
  // No INSTANTLY_API_KEY in the environment. Never hits the network.
  | "not_configured"
  // 401 - key missing at the API or outright invalid.
  | "bad_key"
  // 403 - key is real but lacks the scope for this endpoint (e.g. the
  // emails reads need emails:read / all:read). A different fix from a
  // bad key, so it gets its own kind.
  | "insufficient_scope"
  // 429 after our retries were exhausted.
  | "rate_limited"
  // 5xx, timeout, DNS/socket failure - Instantly is down or unreachable.
  | "unavailable"
  // Other 4xx - our request is malformed. A bug on our side.
  | "bad_request";

export class InstantlyError extends Error {
  readonly kind: InstantlyErrorKind;
  readonly status?: number;
  readonly endpoint?: string;

  constructor(
    kind: InstantlyErrorKind,
    message: string,
    opts?: { status?: number; endpoint?: string; cause?: unknown },
  ) {
    super(message, opts?.cause ? { cause: opts.cause } : undefined);
    this.name = "InstantlyError";
    this.kind = kind;
    this.status = opts?.status;
    this.endpoint = opts?.endpoint;
  }
}

export function isInstantlyError(e: unknown): e is InstantlyError {
  return e instanceof InstantlyError;
}

// Map an HTTP status onto a kind. Shared by the request path and the
// retry predicate so the two can't disagree about what a 503 means.
//
// LIVE-VERIFIED DIVERGENCE (2026-08-25): the docs say a scope failure is
// 403, but Instantly actually returns 401 with an "Invalid scope.
// Required: X. Found: Y" body. Without the body sniff below, a
// perfectly good key missing one scope reports as "bad key - generate a
// new one", sending you off to fix the wrong thing. Status alone is not
// enough to classify auth failures on this API.
export function kindForStatus(status: number, body?: string): InstantlyErrorKind {
  if (status === 401) {
    return body && /invalid scope/i.test(body) ? "insufficient_scope" : "bad_key";
  }
  if (status === 403) return "insufficient_scope";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "bad_request";
}

// Extract the upstream body from an InstantlyError message, which is
// formatted as `Instantly <status> on <path>: <body>`. Returns null when
// there was no body to report.
export function upstreamDetail(message: string): string | null {
  const idx = message.indexOf(": ");
  if (idx === -1) return null;
  const detail = message.slice(idx + 2).trim();
  return detail.length > 0 ? detail : null;
}

// Pull the scope names out of Instantly's error body so the Settings row
// can name the missing scope instead of saying "some scope is missing".
export function parseMissingScope(body: string | undefined): string | null {
  if (!body) return null;
  const m = body.match(/Required:\s*([^.".}]+)/i);
  return m?.[1]?.trim() || null;
}

// Only these are worth a second attempt. A 401/403/400 will fail
// identically no matter how long we wait, so retrying them just burns
// the rate-limit budget and delays the error the user needs to see.
export function isRetryableKind(kind: InstantlyErrorKind): boolean {
  return kind === "rate_limited" || kind === "unavailable";
}

// Plain-English rendering for the Settings row and the test route.
// `hint` is the actionable next step, kept separate from `message` so
// the UI can show the reason on one line and the fix on another.
export function describeInstantlyError(e: unknown): {
  kind: InstantlyErrorKind | "unknown";
  message: string;
  hint: string;
} {
  if (isInstantlyError(e)) {
    switch (e.kind) {
      case "not_configured":
        return {
          kind: e.kind,
          message: "INSTANTLY_API_KEY is not set.",
          hint: "Add the key to your environment config and redeploy.",
        };
      case "bad_key": {
        // Carry Instantly's OWN words through. The canned message used to
        // replace them, which meant a 401 always read as "bad key" even
        // when the body said something far more specific - that is
        // exactly the information you need to tell a wrong key apart
        // from a scope or formatting problem, and it was being thrown
        // away. e.message is `Instantly 401 on /path: <body>`.
        const detail = upstreamDetail(e.message);
        return {
          kind: e.kind,
          message: detail
            ? `Instantly rejected the API key (401): ${detail}`
            : "Instantly rejected the API key (401).",
          hint: "Confirm the key stored in the deployed environment matches the one in Instantly, with no surrounding quotes or whitespace. /api/instantly/diagnose reports the deployed key's fingerprint without revealing it.",
        };
      }
      case "insufficient_scope": {
        // Instantly reports this as a 401 with the scope named in the
        // body - surface the specific scope so the fix is obvious.
        const scope = parseMissingScope(e.message);
        return {
          kind: e.kind,
          message: scope
            ? `The API key is valid but is missing the ${scope} scope.`
            : "The API key is valid but lacks a required scope.",
          hint: scope
            ? `Add ${scope} to the key in Instantly under Settings > Integrations > API Keys.`
            : "Give the key at least all:read, or the per-resource read scopes.",
        };
      }
      case "rate_limited":
        return {
          kind: e.kind,
          message: "Instantly rate-limited the request (429).",
          hint: "Ace already backs off and retries. Wait a minute and try again.",
        };
      case "unavailable":
        return {
          kind: e.kind,
          message: e.message || "Instantly is unreachable.",
          hint: "This is on Instantly's end, not the key. Check status.instantly.ai.",
        };
      case "bad_request":
        return {
          kind: e.kind,
          message: e.message || "Instantly rejected the request.",
          hint: "This is a bug in how Ace built the request. Worth reporting.",
        };
    }
  }
  return {
    kind: "unknown",
    message: e instanceof Error ? e.message : "Unknown error talking to Instantly.",
    hint: "Try again. If it persists, check the server logs.",
  };
}
