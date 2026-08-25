import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { describeInstantlyError } from "@/lib/instantly/errors";
import { isInstantlyConfigured } from "@/lib/instantly/client";

// Shared plumbing for the read-only /api/instantly/* routes.
//
// Every route is GET-only and every one of them returns the SAME error
// envelope, so the client renders one error component instead of each
// page inventing its own handling. The error `kind` is the taxonomy from
// lib/instantly/errors (not_configured | bad_key | insufficient_scope |
// rate_limited | unavailable | bad_request).

export type InstantlyApiError = {
  ok: false;
  kind: string;
  message: string;
  hint: string;
};

export type InstantlyApiOk<T> = { ok: true } & T;

/**
 * Wraps a read handler with auth, the not-configured short-circuit, and
 * uniform error mapping.
 *
 * Failures come back as HTTP 200 with `ok: false` so the client renders
 * a specific diagnosis rather than a generic fetch failure - the payload
 * carries success/failure, matching the /api/instantly/test route. The
 * exceptions are 401 (not signed in) and 405, which are real transport
 * errors and should read as such.
 */
export async function withInstantly<T>(
  handler: () => Promise<T>,
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, kind: "unauthorized", message: "Not signed in.", hint: "Sign in to Ace." },
      { status: 401 },
    );
  }

  if (!isInstantlyConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        kind: "not_configured",
        message: "INSTANTLY_API_KEY is not set.",
        hint: "Add the key to your environment config and redeploy.",
      } satisfies InstantlyApiError,
      { status: 200 },
    );
  }

  try {
    const data = await handler();
    return NextResponse.json({ ok: true, ...data }, { status: 200 });
  } catch (e) {
    const { kind, message, hint } = describeInstantlyError(e);
    return NextResponse.json(
      { ok: false, kind, message, hint } satisfies InstantlyApiError,
      { status: 200 },
    );
  }
}
