import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { clearInstantlyCache, probeConnection, isInstantlyConfigured } from "@/lib/instantly/client";
import { describeInstantlyError } from "@/lib/instantly/errors";

export const dynamic = "force-dynamic";

// Test connection for the Settings > Connectors Instantly row.
//
// The browser never talks to Instantly - it POSTs here, and this route
// makes the only outbound call, server-side, with the key from env. The
// key is never included in the response.
//
// Rate safety: this probes GET /workspaces/current ONLY. That endpoint
// sits under the global budget (100/s, 6000/min), NOT the 20/min budget
// that /emails has. Clicking Test connection repeatedly cannot exhaust
// the emails budget, because this path never touches /emails.
//
// The cache is cleared first so "Test" means a real live call rather
// than a replay of a cached workspace read - otherwise the button would
// happily report "Connected" for up to a minute after a key was revoked.

type TestResult = {
  ok: boolean;
  state: "connected" | "not_configured" | "error";
  workspace: string | null;
  message: string;
  hint?: string;
  kind?: string;
  checkedAt: string;
};

export async function POST() {
  // Settings is authenticated; don't let an unauthenticated caller use
  // this as a free probe of our Instantly credential's validity.
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, state: "error", workspace: null, message: "Not signed in.", checkedAt: new Date().toISOString() } satisfies TestResult,
      { status: 401 },
    );
  }

  const checkedAt = new Date().toISOString();

  if (!isInstantlyConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        state: "not_configured",
        workspace: null,
        message: "INSTANTLY_API_KEY is not set.",
        hint: "Add the key to your environment config and redeploy.",
        kind: "not_configured",
        checkedAt,
      } satisfies TestResult,
      { status: 200 },
    );
  }

  clearInstantlyCache();

  try {
    const probe = await probeConnection();
    return NextResponse.json(
      {
        ok: true,
        state: "connected",
        workspace: probe.workspace,
        message: probe.note ?? "Connected. Read-only access confirmed.",
        checkedAt,
      } satisfies TestResult,
      { status: 200 },
    );
  } catch (e) {
    const { kind, message, hint } = describeInstantlyError(e);
    return NextResponse.json(
      {
        ok: false,
        state: "error",
        workspace: null,
        message,
        hint,
        kind,
        checkedAt,
      } satisfies TestResult,
      // 200 so the client renders the diagnosis instead of a generic
      // fetch failure. The payload's `ok` carries success/failure.
      { status: 200 },
    );
  }
}
