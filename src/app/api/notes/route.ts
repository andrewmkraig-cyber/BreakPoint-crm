import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

export const dynamic = "force-dynamic";

// Append-a-note endpoint backing the global FAB Notes popup. Takes
// { entityType: "candidate"|"client", entityId, note } and prepends
// the new entry to the entity's notes. Tenant-scoped: the row update
// is gated on organizationId so a stranger probing by cuid gets a
// clean 404 rather than a cross-tenant write.
//
// Storage shape diverges by entity:
//   - Candidate: the Notes tab reads from Candidate.raw.notes (the
//     structured RF-shaped {id?, note, added_time, added_by} array).
//     We prepend a new entry to that array AND mirror joined text
//     into Candidate.notes so updateCandidate's text-column mirror
//     stays consistent.
//   - Client: the Notes tab renders Client.notes as a <pre> block,
//     so we keep the original "[YYYY-MM-DD HH:MM] body" line-prefix
//     append against the text column, with a visible separator between
//     entries for older raw-text readers.

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
      select: { id: true, rfId: true, raw: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }
    // Prepend a structured entry into raw.notes — this is the array
    // the Notes tab reads from. added_by mirrors the RF shape so the
    // existing EditableNotes byline renderer ("Name · timestamp")
    // doesn't need to branch on Ace-native vs RF-imported entries.
    const session = await getServerSession(authOptions);
    const addedByName = session?.user?.name ?? session?.user?.email ?? null;
    const prevRaw = (target.raw as Record<string, unknown> | null) ?? {};
    const prevNotes = Array.isArray(prevRaw.notes)
      ? (prevRaw.notes as Array<Record<string, unknown>>)
      : [];
    const newEntry = {
      note,
      added_time: new Date().toISOString(),
      added_by: addedByName ? { name: addedByName } : null,
    };
    const nextNotes = [newEntry, ...prevNotes];
    const nextRaw = { ...prevRaw, notes: nextNotes };
    // Mirror joined text into the Candidate.notes column so the
    // legacy text-column reader (and updateCandidate's rfNotesToText
    // round-trip) stays consistent with raw.notes.
    const mirroredText = nextNotes
      .map((n) => (typeof n.note === "string" ? n.note.trim() : ""))
      .filter((s): s is string => Boolean(s))
      .join("\n\n---\n\n");
    await prisma.candidate.update({
      where: { id: target.id },
      data: {
        raw: nextRaw as Prisma.InputJsonValue,
        notes: mirroredText || null,
      },
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
  const next = target.notes ? `${stamped}\n\n---\n\n${target.notes}` : stamped;
  await prisma.client.update({
    where: { id: target.id },
    data: { notes: next },
  });
  revalidatePath(`/clients/${target.id}`);
  if (target.legacyRfId != null) revalidatePath(`/clients/${target.legacyRfId}`);
  return NextResponse.json({ ok: true });
}
