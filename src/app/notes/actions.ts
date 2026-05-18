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
//
// A note can be attached to any combination of Candidates, Clients,
// and Jobs at once (Andrew often wants the same note showing on a
// candidate AND the job they're being submitted for). The three
// relations are implicit many-to-many; createNote/attachNote take
// arrays of ids per kind and write them through Prisma's connect/set.

export type Attachments = {
  candidateIds: string[];
  clientIds: string[];
  jobIds: string[];
};

export type NoteActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const EMPTY_ATTACHMENTS: Attachments = {
  candidateIds: [],
  clientIds: [],
  jobIds: [],
};

function normalizeAttachments(input: Partial<Attachments> | null | undefined): Attachments {
  return {
    candidateIds: Array.from(new Set(input?.candidateIds ?? [])).filter(Boolean),
    clientIds: Array.from(new Set(input?.clientIds ?? [])).filter(Boolean),
    jobIds: Array.from(new Set(input?.jobIds ?? [])).filter(Boolean),
  };
}

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

// Verifies every target id belongs to the same org before letting an
// attachment land — otherwise a stranger's id could be passed in and
// connect a note to a row in another tenant. Returns ok only when
// every id resolves; otherwise we drop the whole attach attempt.
async function verifyAttachmentsInOrg(
  orgId: string,
  attach: Attachments,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (attach.candidateIds.length > 0) {
    const found = await prisma.candidate.count({
      where: { id: { in: attach.candidateIds }, organizationId: orgId },
    });
    if (found !== attach.candidateIds.length) {
      return { ok: false, error: "One or more candidates not found in this workspace." };
    }
  }
  if (attach.clientIds.length > 0) {
    const found = await prisma.client.count({
      where: { id: { in: attach.clientIds }, organizationId: orgId },
    });
    if (found !== attach.clientIds.length) {
      return { ok: false, error: "One or more clients not found in this workspace." };
    }
  }
  if (attach.jobIds.length > 0) {
    const found = await prisma.job.count({
      where: { id: { in: attach.jobIds }, organizationId: orgId },
    });
    if (found !== attach.jobIds.length) {
      return { ok: false, error: "One or more jobs not found in this workspace." };
    }
  }
  return { ok: true };
}

function attachmentRevalidatePaths(attach: Attachments): string[] {
  const paths: string[] = [];
  for (const id of attach.candidateIds) paths.push(`/candidates/${id}`);
  for (const id of attach.clientIds) paths.push(`/clients/${id}`);
  for (const id of attach.jobIds) paths.push(`/jobs/${id}`);
  return paths;
}

export type CreateNoteInput = {
  title?: string | null;
  body: string;
  attach?: Partial<Attachments> | null;
};

export async function createNote(input: CreateNoteInput): Promise<NoteActionResult> {
  try {
    const body = input.body?.trim() ?? "";
    if (!body) return { ok: false, error: "Body is required." };

    const ctx = await getAuthContext();
    if (!ctx.ok) return ctx;

    const attach = normalizeAttachments(input.attach);
    const verified = await verifyAttachmentsInOrg(ctx.orgId, attach);
    if (!verified.ok) return verified;

    const note = await prisma.note.create({
      data: {
        organizationId: ctx.orgId,
        createdById: ctx.userId,
        title: input.title?.trim() || null,
        body,
        candidates: { connect: attach.candidateIds.map((id) => ({ id })) },
        clients: { connect: attach.clientIds.map((id) => ({ id })) },
        jobs: { connect: attach.jobIds.map((id) => ({ id })) },
      },
      select: { id: true },
    });

    revalidatePath("/notes");
    for (const p of attachmentRevalidatePaths(attach)) revalidatePath(p);
    return { ok: true, id: note.id };
  } catch (e) {
    console.error("[notes.createNote] failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create note." };
  }
}

export type UpdateNoteInput = {
  id: string;
  title?: string | null;
  body?: string;
};

export async function updateNote(input: UpdateNoteInput): Promise<NoteActionResult> {
  try {
    const ctx = await getAuthContext();
    if (!ctx.ok) return ctx;

    const existing = await prisma.note.findFirst({
      where: { id: input.id, organizationId: ctx.orgId, createdById: ctx.userId },
      select: {
        id: true,
        candidates: { select: { id: true } },
        clients: { select: { id: true } },
        jobs: { select: { id: true } },
      },
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
    for (const c of existing.candidates) revalidatePath(`/candidates/${c.id}`);
    for (const c of existing.clients) revalidatePath(`/clients/${c.id}`);
    for (const j of existing.jobs) revalidatePath(`/jobs/${j.id}`);
    return { ok: true, id: existing.id };
  } catch (e) {
    console.error("[notes.updateNote] failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update note." };
  }
}

export async function deleteNote(id: string): Promise<NoteActionResult> {
  try {
    const ctx = await getAuthContext();
    if (!ctx.ok) return ctx;

    const existing = await prisma.note.findFirst({
      where: { id, organizationId: ctx.orgId, createdById: ctx.userId },
      select: {
        id: true,
        candidates: { select: { id: true } },
        clients: { select: { id: true } },
        jobs: { select: { id: true } },
      },
    });
    if (!existing) return { ok: false, error: "Note not found." };

    await prisma.note.delete({ where: { id: existing.id } });

    revalidatePath("/notes");
    for (const c of existing.candidates) revalidatePath(`/candidates/${c.id}`);
    for (const c of existing.clients) revalidatePath(`/clients/${c.id}`);
    for (const j of existing.jobs) revalidatePath(`/jobs/${j.id}`);
    return { ok: true, id: existing.id };
  } catch (e) {
    console.error("[notes.deleteNote] failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete note." };
  }
}

// Replaces the full attachment set on a saved note. Pass empty arrays
// for each kind to detach completely. Use `set` semantics (not
// merge) so the picker has a single "this is the new full state"
// shape — easier to reason about than connect+disconnect deltas.
export type AttachNoteInput = {
  id: string;
  attach: Partial<Attachments>;
};

export async function attachNote(input: AttachNoteInput): Promise<NoteActionResult> {
  try {
    const ctx = await getAuthContext();
    if (!ctx.ok) return ctx;

    const existing = await prisma.note.findFirst({
      where: { id: input.id, organizationId: ctx.orgId, createdById: ctx.userId },
      select: {
        id: true,
        candidates: { select: { id: true } },
        clients: { select: { id: true } },
        jobs: { select: { id: true } },
      },
    });
    if (!existing) return { ok: false, error: "Note not found." };

    const attach = normalizeAttachments(input.attach);
    const verified = await verifyAttachmentsInOrg(ctx.orgId, attach);
    if (!verified.ok) return verified;

    await prisma.note.update({
      where: { id: existing.id },
      data: {
        candidates: { set: attach.candidateIds.map((id) => ({ id })) },
        clients: { set: attach.clientIds.map((id) => ({ id })) },
        jobs: { set: attach.jobIds.map((id) => ({ id })) },
      },
    });

    revalidatePath("/notes");
    // Revalidate both old and new attachments so pages that lost a note
    // refresh too.
    for (const c of existing.candidates) revalidatePath(`/candidates/${c.id}`);
    for (const c of existing.clients) revalidatePath(`/clients/${c.id}`);
    for (const j of existing.jobs) revalidatePath(`/jobs/${j.id}`);
    for (const p of attachmentRevalidatePaths(attach)) revalidatePath(p);
    return { ok: true, id: existing.id };
  } catch (e) {
    console.error("[notes.attachNote] failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Failed to attach note." };
  }
}

export async function setPinned(id: string, pinned: boolean): Promise<NoteActionResult> {
  try {
    const ctx = await getAuthContext();
    if (!ctx.ok) return ctx;

    const existing = await prisma.note.findFirst({
      where: { id, organizationId: ctx.orgId, createdById: ctx.userId },
      select: {
        id: true,
        candidates: { select: { id: true } },
        clients: { select: { id: true } },
        jobs: { select: { id: true } },
      },
    });
    if (!existing) return { ok: false, error: "Note not found." };

    await prisma.note.update({
      where: { id: existing.id },
      data: { pinned },
    });

    revalidatePath("/notes");
    for (const c of existing.candidates) revalidatePath(`/candidates/${c.id}`);
    for (const c of existing.clients) revalidatePath(`/clients/${c.id}`);
    for (const j of existing.jobs) revalidatePath(`/jobs/${j.id}`);
    return { ok: true, id: existing.id };
  } catch (e) {
    console.error("[notes.setPinned] failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Failed to toggle pin." };
  }
}

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
  try {
    const ctx = await getAuthContext();
    if (!ctx.ok) return ctx;

    const q = query.trim();
    const contains = q.length === 0 ? undefined : q;

    return await runSearch(ctx.orgId, kind, contains);
  } catch (e) {
    console.error("[notes.searchAttachOptions] failed", { kind, query, error: e });
    return { ok: false, error: e instanceof Error ? e.message : "Search failed." };
  }
}

async function runSearch(
  orgId: string,
  kind: "candidate" | "client" | "job",
  contains: string | undefined,
): Promise<AttachOptionsResult> {
  if (kind === "candidate") {
    const rows = await prisma.candidate.findMany({
      where: {
        organizationId: orgId,
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
        organizationId: orgId,
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
      organizationId: orgId,
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

// Used by both the /notes composer and the global ComposeFAB popup to
// resolve already-picked attachment ids into display labels (so the
// chip row above the buttons doesn't have to do its own lookup).
export type ResolvedSelection = {
  candidates: Array<{ id: string; label: string }>;
  clients: Array<{ id: string; label: string }>;
  jobs: Array<{ id: string; label: string }>;
};

export type ResolveSelectionResult =
  | { ok: true; selection: ResolvedSelection }
  | { ok: false; error: string };

export async function resolveAttachmentLabels(
  attach: Partial<Attachments>,
): Promise<ResolveSelectionResult> {
  try {
    const ctx = await getAuthContext();
    if (!ctx.ok) return ctx;

    const a = normalizeAttachments(attach);
    const [candidates, clients, jobs] = await Promise.all([
      a.candidateIds.length === 0
        ? Promise.resolve([])
        : prisma.candidate.findMany({
            where: { id: { in: a.candidateIds }, organizationId: ctx.orgId },
            select: { id: true, firstName: true, lastName: true },
          }),
      a.clientIds.length === 0
        ? Promise.resolve([])
        : prisma.client.findMany({
            where: { id: { in: a.clientIds }, organizationId: ctx.orgId },
            select: { id: true, name: true },
          }),
      a.jobIds.length === 0
        ? Promise.resolve([])
        : prisma.job.findMany({
            where: { id: { in: a.jobIds }, organizationId: ctx.orgId },
            select: { id: true, title: true },
          }),
    ]);

    return {
      ok: true,
      selection: {
        candidates: candidates.map((c) => ({
          id: c.id,
          label: [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed",
        })),
        clients: clients.map((c) => ({ id: c.id, label: c.name })),
        jobs: jobs.map((j) => ({ id: j.id, label: j.title })),
      },
    };
  } catch (e) {
    console.error("[notes.resolveAttachmentLabels] failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Failed to resolve labels." };
  }
}

// Helper used by the candidate-profile / client-profile / job-profile
// EntityNotesSection (and the activity feeds): same shape as
// createNote but pre-attached to a single entity so the page-side
// caller doesn't have to construct the Attachments object.
export async function createNoteAttachedTo(
  entity: { kind: "candidate" | "client" | "job"; id: string },
  body: string,
  title: string | null = null,
): Promise<NoteActionResult> {
  return createNote({
    title,
    body,
    attach: {
      candidateIds: entity.kind === "candidate" ? [entity.id] : [],
      clientIds: entity.kind === "client" ? [entity.id] : [],
      jobIds: entity.kind === "job" ? [entity.id] : [],
    },
  });
}

