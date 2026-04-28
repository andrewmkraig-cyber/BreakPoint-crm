import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listActiveTemplates, type ActiveTemplateSummary } from "@/app/email/actions";

export const dynamic = "force-dynamic";

// Hydrates the click-to-email popup composer on demand. Returns
// everything the composer needs to bootstrap without a server-
// component wrapper: the active templates for the Use Template
// dropdown, and the signed-in user's first/full name for the
// {{user.*}} merge-field context. Cached client-side after the
// first call so subsequent popups on the same page are instant.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      name: true,
      profile: { select: { fullName: true } },
    },
  });
  const fullName = user?.profile?.fullName?.trim() || user?.name?.trim() || "";
  const firstName = fullName.split(/\s+/)[0] ?? "";
  const templates: ActiveTemplateSummary[] = await listActiveTemplates();
  return NextResponse.json({
    templates,
    user: { firstName, fullName, email: session.user.email },
  });
}
