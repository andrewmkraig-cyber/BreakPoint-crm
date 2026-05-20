import { NextResponse } from "next/server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getMicrosoftToken } from "@/lib/microsoft-graph";
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
    const token = await prisma.microsoftToken.findUnique({
      where: { organizationId: org.id },
      select: { email: true, status: true },
    });
    if (!token) {
      return NextResponse.json({ connected: false, status: "disconnected", email: null });
    }

    // Validate on read instead of trusting row-existence. Two ways a
    // connection can be dead:
    //   1. A prior Graph call (onlineMeetings) or refresh already failed
    //      and flagged the row "expired": honor that flag until the
    //      recruiter reconnects. This is the AuthenticationError case
    //      where the token still refreshes, so only the flag reveals it.
    //   2. The row reads "connected" but the refresh grant is now dead.
    //      getMicrosoftToken refreshes when it can and flips the row to
    //      "expired" (returning null) when it can't.
    // On a transient 5xx/network failure getMicrosoftToken throws; treat
    // a still-"connected" row as healthy rather than nuking it on a blip.
    let expired = token.status === "expired";
    if (!expired) {
      try {
        expired = (await getMicrosoftToken(org.id)) === null;
      } catch {
        expired = false;
      }
    }

    return NextResponse.json({
      connected: !expired,
      status: expired ? "expired" : "connected",
      email: token.email,
    });
  } catch (e) {
    return NextResponse.json(
      { connected: false, status: "disconnected", email: null, error: e instanceof Error ? e.message : "status failed" },
      { status: 500 },
    );
  }
}
