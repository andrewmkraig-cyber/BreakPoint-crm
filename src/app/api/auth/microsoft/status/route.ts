import { NextResponse } from "next/server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { checkMicrosoftHealth } from "@/lib/microsoft-graph";
import { prisma } from "@/lib/prisma";

// Lightweight endpoint the Settings → Connectors row hits on mount to
// decide whether to render the Connect button, the Connected badge, or
// the amber "Token expired - reconnect" banner. Kept separate from the
// initiate route so GET /api/auth/microsoft can stay a pure redirect to
// Microsoft's authorize endpoint.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const org = await getCurrentOrg();
    // checkMicrosoftHealth judges validity by GET /me + the refresh grant,
    // not by whether onlineMeetings is authorized, so a valid token that
    // simply lacks Teams meeting permission still reports "connected".
    const health = await checkMicrosoftHealth(org.id);
    if (health === "disconnected") {
      return NextResponse.json({ connected: false, status: "disconnected", email: null });
    }

    const row = await prisma.microsoftToken.findUnique({
      where: { organizationId: org.id },
      select: { email: true },
    });

    return NextResponse.json({
      connected: health === "connected",
      status: health,
      email: row?.email ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { connected: false, status: "disconnected", email: null, error: e instanceof Error ? e.message : "status failed" },
      { status: 500 },
    );
  }
}
