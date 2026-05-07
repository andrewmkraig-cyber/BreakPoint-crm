import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

export const dynamic = "force-dynamic";

// Persistent transcript for the global Claude Panel (Sparkles icon in
// the topbar). Single org-scoped log. Each row carries a
// conversationId so Clear Chat can rotate the active conversation
// (preserving prior chats) rather than deleting Neon rows.
//
// GET semantics:
//   - ?conversationId=<id>   → returns that conversation's rows
//   - no param               → returns the most recent conversation's
//                              rows (max createdAt wins). Lets a fresh
//                              page load resume the in-progress chat.
//   - returns { conversationId, messages: [...] } so the client can
//     remember the active id across reloads even when no rows exist
//     yet (Clear Chat → reopen panel → new conversation, no rows yet).

type LatestConv = { conversationId: string | null; createdAt: Date } | null;

async function findLatestConversationId(orgId: string): Promise<LatestConv> {
  // Most recent message wins. Falls through to NULL when no rows
  // exist, in which case the client treats it as "start a fresh
  // conversation locally".
  return prisma.claudePanelMessage.findFirst({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    select: { conversationId: true, createdAt: true },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestedConvId = url.searchParams.get("conversationId");
  const org = await getCurrentOrg();

  let conversationId: string | null = requestedConvId;
  if (!conversationId) {
    const latest = await findLatestConversationId(org.id);
    conversationId = latest?.conversationId ?? null;
  }

  // Two filter shapes — by explicit conversationId, or by NULL when
  // the latest row predates this column (legacy bucket). Prisma
  // requires the right shape per case; mode: 'insensitive' isn't
  // applicable here since the column is a plain string.
  const where = conversationId
    ? { organizationId: org.id, conversationId }
    : { organizationId: org.id, conversationId: null };

  const rows = await prisma.claudePanelMessage.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      role: true,
      content: true,
      conversationId: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    conversationId,
    messages: rows,
  });
}

export async function POST(req: Request) {
  let body: { role?: unknown; content?: unknown; conversationId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const role = typeof body.role === "string" ? body.role : "";
  const content = typeof body.content === "string" ? body.content : "";
  if (role !== "user" && role !== "assistant") {
    return NextResponse.json(
      { ok: false, error: "role must be 'user' or 'assistant'" },
      { status: 400 },
    );
  }
  if (!content.trim()) {
    return NextResponse.json(
      { ok: false, error: "content is required" },
      { status: 400 },
    );
  }

  const org = await getCurrentOrg();
  // conversationId on POST is required for new rows so Clear Chat's
  // rotation actually creates a separate bucket. The client manages
  // the active id (localStorage); we accept whatever it sends.
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.trim().length > 0
      ? body.conversationId.trim()
      : null;

  const row = await prisma.claudePanelMessage.create({
    data: { organizationId: org.id, role, content, conversationId },
    select: {
      id: true,
      role: true,
      content: true,
      conversationId: true,
      createdAt: true,
    },
  });
  return NextResponse.json(row);
}

// Legacy DELETE — kept for callers (CLI tests, etc.) that wipe the
// org's transcript. The Panel UI no longer hits this route on Clear
// Chat; instead it rotates the active conversationId so the prior
// chat survives in History. Hard 401 when there's no signed-in
// recruiter so a leaked URL can't nuke history.
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }
  const org = await getCurrentOrg();
  await prisma.claudePanelMessage.deleteMany({
    where: { organizationId: org.id },
  });
  return NextResponse.json({ success: true });
}
