import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteGmailDraft } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Ace 28.0b — Delete a Gmail draft by id. The composer's Delete button
// calls this when the recruiter discards a draft they had previously
// saved with Save Draft. Tenant boundary: the user's per-account
// refresh token (Account row) — Gmail enforces that the draft id
// belongs to the same mailbox the token authenticates against, so a
// forged id from another user's session can't reach across.

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

  const draftId = params.id;
  if (!draftId) {
    return NextResponse.json({ error: "Missing draft id" }, { status: 400 });
  }

  try {
    await deleteGmailDraft(user.id, draftId);
    await Promise.all([
      prisma.invoiceEmailDraft.deleteMany({
        where: { userId: user.id, gmailDraftId: draftId },
      }),
      prisma.scheduledEmail.updateMany({
        where: {
          userId: user.id,
          gmailDraftId: draftId,
          status: "SCHEDULED",
        },
        data: {
          status: "CANCELED",
          gmailDraftId: null,
          lastError: null,
        },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Delete Draft failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
