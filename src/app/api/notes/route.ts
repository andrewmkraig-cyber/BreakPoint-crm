import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

export const dynamic = "force-dynamic";

// Append-a-note endpoint backing the global FAB Notes popup. Takes
// { entityType: "candidate"|"client", entityId, note } and prepends
// the new entry — with a timestamp prefix — to the entity's `notes`
// text column. Tenant-scoped: the row update is gated on
// organizationId so a stranger probing by cuid gets a clean 404
// rather than a cross-tenant write.
//
// Storage shape: each note is stored on its own line, prefixed with
// "[YYYY-MM-DD HH:MM] " so the existing EditableNotes component
// (which splits Candidate.notes by newline + filters empty) keeps
// rendering each entry as its own row without further migration.

type Body = {
  entityType?: "candidate" | "client";
  entityId?: string;
  note?: string;
};

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { entityType, entityId } = body;
  const note = body.note?.trim() ?? "";
  if (!note) {
    return NextResponse.json({ error: "Empty note" }, { status: 400 });
  }
  if (entityType !== "candidate" && entityType !== "client") {
    return NextResponse.json(
      { error: "entityType must be 'candidate' or 'client'" },
      { status: 400 },
    );
  }
  if (!entityId) {
    return NextResponse.json({ error: "Missing entityId" }, { status: 400 });
  }

  const org = await getCurrentOrg();
  const stamped = `[${timestamp()}] ${note}`;

  if (entityType === "candidate") {
    const target = await prisma.candidate.findFirst({
      where: { id: entityId, organizationId: org.id },
      select: { id: true, rfId: true, notes: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }
    const next = target.notes ? `${stamped}\n${target.notes}` : stamped;
    await prisma.candidate.update({
      where: { id: target.id },
      data: { notes: next },
    });
    revalidatePath(`/candidates/${target.id}`);
    if (target.rfId != null) revalidatePath(`/candidates/${target.rfId}`);
    return NextResponse.json({ ok: true });
  }

  // client
  const target = await prisma.client.findFirst({
    where: { id: entityId, organizationId: org.id },
    select: { id: true, legacyRfId: true, notes: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  const next = target.notes ? `${stamped}\n${target.notes}` : stamped;
  await prisma.client.update({
    where: { id: target.id },
    data: { notes: next },
  });
  revalidatePath(`/clients/${target.id}`);
  if (target.legacyRfId != null) revalidatePath(`/clients/${target.legacyRfId}`);
  return NextResponse.json({ ok: true });
}
