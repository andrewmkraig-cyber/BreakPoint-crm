import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

export const dynamic = "force-dynamic";

// Persistent transcript for the global Claude Panel (Sparkles icon in
// the topbar). Single org-scoped log — every recruiter on the org sees
// the same chat. Phase 1 ships persistence only; the assistant call
// lands in Phase 2.

export async function GET() {
  const org = await getCurrentOrg();
  const rows = await prisma.claudePanelMessage.findMany({
    where: { organizationId: org.id },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  let body: { role?: unknown; content?: unknown };
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
  const row = await prisma.claudePanelMessage.create({
    data: { organizationId: org.id, role, content },
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return NextResponse.json(row);
}
