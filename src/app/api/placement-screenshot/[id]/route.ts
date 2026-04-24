import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new NextResponse("Unauthorized", { status: 401 });

  // Phase 4a: scope the Placement read by organizationId so cross-
  // tenant id probing can't ever 200 on another org's screenshot.
  const org = await getCurrentOrg();
  const p = await prisma.placement.findFirst({
    where: { id: params.id, organizationId: org.id },
    select: { startConfirmationFile: true, startConfirmationMime: true },
  });
  if (!p?.startConfirmationFile) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(p.startConfirmationFile), {
    status: 200,
    headers: {
      "Content-Type": p.startConfirmationMime ?? "image/png",
      "Cache-Control": "private, no-store",
    },
  });
}
