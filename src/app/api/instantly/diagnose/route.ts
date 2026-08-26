import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { readKeyDiagnostics, normalizeApiKey } from "@/lib/instantly/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Connector diagnostics for the DEPLOYED environment.
//
// Exists because a 401 in production and a 200 locally is otherwise
// almost unfalsifiable: the app can only report what its error taxonomy
// decided, and the taxonomy had been collapsing every 401 to "bad key".
// This route reports the raw upstream status and body, plus a
// description of the stored key that does not reveal it.
//
// SAFETY: the key is never returned, in whole or in part. What comes
// back is a truncated SHA-256 (non-reversible), the length, formatting
// flags, and the workspace UUID half of the decoded token - which is
// already visible elsewhere in the app and is not secret. The secret
// half is never read out.
//
// Requires a signed-in session. The upstream body is Instantly's own
// error text, which is what distinguishes a wrong key from a missing
// scope - the whole reason this endpoint exists.

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const key = readKeyDiagnostics();

  // Where is this actually executing? Answers the edge-vs-node and
  // build-vs-request questions directly rather than by inference.
  const environment = {
    // "nodejs" | "edge" | undefined. Undefined in local dev.
    nextRuntime: process.env.NEXT_RUNTIME ?? "(unset - local dev)",
    vercelEnv: process.env.VERCEL_ENV ?? "(not on Vercel)",
    vercelRegion: process.env.VERCEL_REGION ?? "(n/a)",
    nodeVersion: process.version,
    // Read at REQUEST time. If this route is executing at all, the value
    // above came from the running lambda's environment, not the build.
    readAt: new Date().toISOString(),
  };

  // Raw upstream call - no retry, no cache, no error taxonomy in the
  // way. Whatever Instantly says is reported verbatim.
  let upstream: {
    status: number | null;
    ok: boolean;
    body: string;
    error?: string;
  } = { status: null, ok: false, body: "" };

  const token = normalizeApiKey(process.env.INSTANTLY_API_KEY);
  if (token) {
    try {
      const res = await fetch("https://api.instantly.ai/api/v2/workspaces/current", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });
      const text = await res.text().catch(() => "");
      upstream = {
        status: res.status,
        ok: res.ok,
        // Truncated, and this is an error message from Instantly, not
        // our credential.
        body: text.slice(0, 500),
      };
    } catch (e) {
      upstream = {
        status: null,
        ok: false,
        body: "",
        error: e instanceof Error ? e.message : "network error",
      };
    }
  }

  // Same call again WITHOUT normalization, but only when normalization
  // actually changed something. Proves whether the stored formatting is
  // the cause rather than leaving it as a theory.
  let rawVariant: { attempted: boolean; status: number | null; body: string } = {
    attempted: false,
    status: null,
    body: "",
  };
  const rawValue = process.env.INSTANTLY_API_KEY ?? "";
  if (rawValue && rawValue !== token) {
    try {
      const res = await fetch("https://api.instantly.ai/api/v2/workspaces/current", {
        method: "GET",
        headers: { Authorization: `Bearer ${rawValue}`, Accept: "application/json" },
        cache: "no-store",
      });
      rawVariant = {
        attempted: true,
        status: res.status,
        body: (await res.text().catch(() => "")).slice(0, 300),
      };
    } catch {
      rawVariant = { attempted: true, status: null, body: "(request failed)" };
    }
  }

  return NextResponse.json(
    {
      key,
      environment,
      upstream,
      // Populated only when the stored value needed normalizing. A 401
      // here alongside a 200 above means the stored value is malformed
      // (quotes or whitespace), not that the key itself is wrong.
      rawVariant,
      interpretation: interpret(key, upstream),
    },
    { status: 200 },
  );
}

function interpret(
  key: ReturnType<typeof readKeyDiagnostics>,
  upstream: { status: number | null; ok: boolean; body: string },
): string {
  if (!key.present) {
    return "INSTANTLY_API_KEY is not present in this environment at all. If it is set in the hosting dashboard, the deployment predates the variable being saved - redeploy.";
  }
  if (!key.decodesToExpectedShape) {
    return "The stored value does not decode to the expected <workspace-uuid>:<secret> shape. It is likely truncated, wrapped, or not an API v2 key.";
  }
  if (upstream.ok) {
    return "The stored key works from this environment. If the UI still shows an error, the failure is downstream of the credential.";
  }
  if (upstream.status === 401 && /invalid scope/i.test(upstream.body)) {
    return "The key is VALID but missing a scope. See the body for which one - this is not a bad key.";
  }
  if (upstream.status === 401) {
    return "Instantly rejected this exact token. Compare the fingerprint against the key that works locally: if they differ, the deployed environment holds a different (likely older) key.";
  }
  return `Unexpected upstream status ${upstream.status}. See body.`;
}
