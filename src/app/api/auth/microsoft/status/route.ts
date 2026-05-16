import { NextResponse } from "next/server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Lightweight read-only endpoint the Settings → Connectors row hits on
// mount to decide whether to render the Connect button or the
// Connected badge + Disconnect button. Kept separate from the
// initiate route so GET /api/auth/microsoft can stay a pure redirect
// to Microsoft's authorize endpoint.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const org = await getCurrentOrg();
    const token = await prisma.microsoftToken.findUnique({
      where: { organizationId: org.id },
      select: { email: true, expiresAt: true },
    });
    if (!token) {
      return NextResponse.json({ connected: false, email: null });
    }
    return NextResponse.json({
      connected: true,
      email: token.email,
      expiresAt: token.expiresAt.toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { connected: false, email: null, error: e instanceof Error ? e.message : "status failed" },
      { status: 500 },
    );
  }
}
