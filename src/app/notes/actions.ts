"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// All notes actions are scoped by both organizationId AND createdById.
// Notes are private to their author; the tenant guard keeps cross-org
// probing out, the createdById guard keeps teammates' notes from
// appearing in each other's lists.

export type AttachKind = "candidate" | "client" | "job" | null;

export type NoteActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

async function getAuthContext(): Promise<
  | { ok: true; orgId: string; userId: string }
  | { ok: false; error: string }
> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };
  const [user, org] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    getCurrentOrg(),
  ]);
  if (!user) return { ok: false, error: "User not found." };
  return { ok: true, orgId: org.id, userId: user.id };
}

// Verifies the target entity belongs to the same org before letting an
// attachment land — otherwise a stranger's id could be passed in and
// orphan a note onto a row in another tenant.
async function verifyEntityInOrg(
  orgId: string,
  attach: { kind: AttachKind; id: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!attach.kind || !attach.id) return { ok: true };
  if (attach.kind === "candidate") {
    const row = await prisma.candidate.findFirst({
      where: { id: attach.id, organizationId: orgId },
      select: { id: true },
    });
    return row ? { ok: true } : { ok: false, error: "Candidate not found." };
  }
  if (attach.kind === "client") {
    const row = await prisma.client.findFirst({
      where: { id: attach.id, organizationId: orgId },
      select: { id: true },
    });
    return row ? { ok: true } : { ok: false, error: "Client not found." };
  }
  const row = await prisma.job.findFirst({
    where: { id: attach.id, organizationId: orgId },
    select: { id: true },
  });
  return row ? { ok: true } : { ok: false, error: "Job not found." };
}

function attachmentPaths(
  attach: { kind: AttachKind; id: string | null } | null,
): string[] {
  if (!attach || !attach.kind || !attach.id) return [];
  if (attach.kind === "candidate") return [`/candidates/${attach.id}`];
  if (attach.kind === "client") return [`/clients/${attach.id}`];
  return [`/jobs/${attach.id}`];
}

export type CreateNoteInput = {
  title?: string | null;
  body: string;
  attach?: { kind: AttachKind; id: string | null } | null;
};

export async function createNote(input: CreateNoteInput): Promise<NoteActionResult> {
  const body = input.body?.trim() ?? "";
  if (!body) return { ok: false, error: "Body is required." };

  const ctx = await getAuthContext();
  if (!ctx.ok) return ctx;

  const attach = input.attach ?? null;
  const verified = await verifyEntityInOrg(ctx.orgId, attach ?? { kind: null, id: null });
  if (!verified.ok) return verified;

  const note = await prisma.note.create({
    data: {
      organizationId: ctx.orgId,
      createdById: ctx.userId,
      title: input.title?.trim() || null,
      body,
      candidateId: attach?.kind === "candidate" ? attach.id : null,
      clientId: attach?.kind === "client" ? attach.id : null,
      jobId: attach?.kind === "job" ? attach.id : null,
    },
    select: { id: true },
  });

  revalidatePath("/notes");
  for (const p of attachmentPaths(attach)) revalidatePath(p);
  return { ok: true, id: note.id };
}

export type UpdateNoteInput = {
  id: string;
  title?: string | null;
  body?: string;
};

export async function updateNote(input: UpdateNoteInput): Promise<NoteActionResult> {
  const ctx = await getAuthContext();
  if (!ctx.ok) return ctx;

  const existing = await prisma.note.findFirst({
    where: { id: input.id, organizationId: ctx.orgId, createdById: ctx.userId },
    select: { id: true, candidateId: true, clientId: true, jobId: true },
  });
  if (!existing) return { ok: false, error: "Note not found." };

  const body = input.body?.trim();
  if (body !== undefined && body.length === 0) {
    return { ok: false, error: "Body is required." };
  }

  await prisma.note.update({
    where: { id: existing.id },
    data: {
      title: input.title === undefined ? undefined : (input.title?.trim() || null),
      body: body ?? undefined,
    },
  });

  revalidatePath("/notes");
  if (existing.candidateId) revalidatePath(`/candidates/${existing.candidateId}`);
  if (existing.clientId) revalidatePath(`/clients/${existing.clientId}`);
  if (existing.jobId) revalidatePath(`/jobs/${existing.jobId}`);
  return { ok: true, id: existing.id };
}

export async function deleteNote(id: string): Promise<NoteActionResult> {
  const ctx = await getAuthContext();
  if (!ctx.ok) return ctx;

  const existing = await prisma.note.findFirst({
    where: { id, organizationId: ctx.orgId, createdById: ctx.userId },
    select: { id: true, candidateId: true, clientId: true, jobId: true },
  });
  if (!existing) return { ok: false, error: "Note not found." };

  await prisma.note.delete({ where: { id: existing.id } });

  revalidatePath("/notes");
  if (existing.candidateId) revalidatePath(`/candidates/${existing.candidateId}`);
  if (existing.clientId) revalidatePath(`/clients/${existing.clientId}`);
  if (existing.jobId) revalidatePath(`/jobs/${existing.jobId}`);
  return { ok: true, id: existing.id };
}

// Re-attach (or detach) a saved note. Passing kind=null clears every
// foreign key so the note becomes loose. Otherwise we set exactly one
// of candidateId/clientId/jobId and null the other two — mutual
// exclusion is an application-layer invariant.
export type AttachNoteInput = {
  id: string;
  attach: { kind: AttachKind; id: string | null };
};

export async function attachNote(input: AttachNoteInput): Promise<NoteActionResult> {
  const ctx = await getAuthContext();
  if (!ctx.ok) return ctx;

  const existing = await prisma.note.findFirst({
    where: { id: input.id, organizationId: ctx.orgId, createdById: ctx.userId },
    select: { id: true, candidateId: true, clientId: true, jobId: true },
  });
  if (!existing) return { ok: false, error: "Note not found." };

  const verified = await verifyEntityInOrg(ctx.orgId, input.attach);
  if (!verified.ok) return verified;

  await prisma.note.update({
    where: { id: existing.id },
    data: {
      candidateId: input.attach.kind === "candidate" ? input.attach.id : null,
      clientId: input.attach.kind === "client" ? input.attach.id : null,
      jobId: input.attach.kind === "job" ? input.attach.id : null,
    },
  });

  revalidatePath("/notes");
  if (existing.candidateId) revalidatePath(`/candidates/${existing.candidateId}`);
  if (existing.clientId) revalidatePath(`/clients/${existing.clientId}`);
  if (existing.jobId) revalidatePath(`/jobs/${existing.jobId}`);
  for (const p of attachmentPaths(input.attach)) revalidatePath(p);
  return { ok: true, id: existing.id };
}

export async function setPinned(id: string, pinned: boolean): Promise<NoteActionResult> {
  const ctx = await getAuthContext();
  if (!ctx.ok) return ctx;

  const existing = await prisma.note.findFirst({
    where: { id, organizationId: ctx.orgId, createdById: ctx.userId },
    select: { id: true, candidateId: true, clientId: true, jobId: true },
  });
  if (!existing) return { ok: false, error: "Note not found." };

  await prisma.note.update({
    where: { id: existing.id },
    data: { pinned },
  });

  revalidatePath("/notes");
  if (existing.candidateId) revalidatePath(`/candidates/${existing.candidateId}`);
  if (existing.clientId) revalidatePath(`/clients/${existing.clientId}`);
  if (existing.jobId) revalidatePath(`/jobs/${existing.jobId}`);
  return { ok: true, id: existing.id };
}

// Small helper exposed to the attach-picker popover so the picker can
// fetch its own candidate/client/job options via a server action
// instead of an extra /api/* round-trip.
export type AttachOption = {
  id: string;
  label: string;
  sublabel: string | null;
};

export type AttachOptionsResult =
  | { ok: true; options: AttachOption[] }
  | { ok: false; error: string };

const PICKER_LIMIT = 20;

export async function searchAttachOptions(
  kind: "candidate" | "client" | "job",
  query: string,
): Promise<AttachOptionsResult> {
  const ctx = await getAuthContext();
  if (!ctx.ok) return ctx;

  const q = query.trim();
  const contains = q.length === 0 ? undefined : q;

  if (kind === "candidate") {
    const rows = await prisma.candidate.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(contains
          ? {
              OR: [
                { firstName: { contains, mode: "insensitive" } },
                { lastName: { contains, mode: "insensitive" } },
                { email: { contains, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: PICKER_LIMIT,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        currentDesignation: true,
      },
    });
    return {
      ok: true,
      options: rows.map((r) => ({
        id: r.id,
        label: [r.firstName, r.lastName].filter(Boolean).join(" ") || "Unnamed",
        sublabel: r.currentDesignation ?? null,
      })),
    };
  }

  if (kind === "client") {
    const rows = await prisma.client.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(contains ? { name: { contains, mode: "insensitive" } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: PICKER_LIMIT,
      select: { id: true, name: true, industry: true },
    });
    return {
      ok: true,
      options: rows.map((r) => ({
        id: r.id,
        label: r.name,
        sublabel: r.industry ?? null,
      })),
    };
  }

  const rows = await prisma.job.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(contains ? { title: { contains, mode: "insensitive" } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: PICKER_LIMIT,
    include: { client: { select: { name: true } } },
  });
  return {
    ok: true,
    options: rows.map((r) => ({
      id: r.id,
      label: r.title,
      sublabel: r.client?.name ?? null,
    })),
  };
}
