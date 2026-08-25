import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

export const dynamic = "force-dynamic";

// Mark replies read. This writes `readAt` in NEON ONLY.
//
// Read state is Ace's, not Instantly's: marking a reply read here has no
// effect on the Instantly Unibox, and nothing in this codebase can write
// to Instantly. Reading in Ace and reading in Instantly are independent
// by design - that is what lets the badge mean "things I haven't looked
// at in Ace".

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { ids?: string[]; emailIds?: string[]; all?: boolean }
    | null;
  if (!body) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });

  try {
    const org = await getCurrentOrg();
    const now = new Date();

    // Tenant scoping (NN #8): organizationId is always in the filter, so
    // an id from another org can never be marked read.
    const result = await prisma.instantlyReply.updateMany({
      where: {
        organizationId: org.id,
        readAt: null,
        // Accept either our cuid or Instantly's email id - the toast
        // knows the former, the Replies list knows the latter.
        ...(body.all
          ? {}
          : {
              OR: [
                { id: { in: body.ids ?? [] } },
                { instantlyEmailId: { in: body.emailIds ?? [] } },
              ],
            }),
      },
      data: { readAt: now },
    });

    return NextResponse.json({ ok: true, updated: result.count }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to mark read." },
      { status: 200 },
    );
  }
}
