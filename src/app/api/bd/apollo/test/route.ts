import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/bd/apollo/test
// Pings Apollo's /v1/users/me with the configured API key and returns
// a tiny envelope describing the outcome. The /settings/bd Apollo
// section's Test connection button calls this and surfaces the result
// inline.
//
// Returns:
//   200 { ok: true, email: "...", name: "..." }  when the key works
//   200 { ok: false, status: 4xx, error: "..." } when Apollo rejected
//   501 { ok: false, error: "not configured" }   when env var missing
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "APOLLO_API_KEY not set in environment" },
      { status: 501 },
    );
  }

  try {
    const res = await fetch("https://api.apollo.io/api/v1/users/me", {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          status: res.status,
          error: text.slice(0, 200) || `HTTP ${res.status}`,
        },
        { status: 200 },
      );
    }
    const payload = (await res.json().catch(() => ({}))) as {
      user?: { email?: string; name?: string; first_name?: string; last_name?: string };
    };
    const u = payload.user;
    const name = u?.name ?? [u?.first_name, u?.last_name].filter(Boolean).join(" ");
    return NextResponse.json({
      ok: true,
      email: u?.email ?? null,
      name: name || null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "network error" },
      { status: 200 },
    );
  }
}
