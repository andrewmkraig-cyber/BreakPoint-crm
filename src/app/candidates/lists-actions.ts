"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Server actions backing the Phase 5A.4.b lists feature. Every read
// and write scopes by organizationId via getCurrentOrg() — Rule 8
// belt-and-suspenders even alongside the Prisma tenant-scope
// extension. List names are unique per (organizationId, name) at the
// schema level; we surface a friendly error here when the constraint
// fires.

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

export type CandidateListSummary = {
  id: string;
  name: string;
  memberCount: number;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

async function requireUser(): Promise<{ id: string; email: string } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true },
  });
  return u?.email ? { id: u.id, email: u.email } : null;
}

// All lists for the signed-in user's org with member counts and
// creator name. Sorted alphabetically by name — the spec ordering for
// every consumer (filter dropdown, management page, popup picker).
export async function listCandidateLists(): Promise<CandidateListSummary[]> {
  const org = await getCurrentOrg();
  const rows = await prisma.candidateList.findMany({
    where: { organizationId: org.id },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { memberships: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    memberCount: r._count.memberships,
    createdById: r.createdById,
    createdByName: r.createdBy?.name?.trim() || r.createdBy?.email || "",
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

// The list-ids that a given candidate is currently a member of.
// Used by the popup to pre-check existing memberships.
export async function getCandidateListMemberships(candidateId: string): Promise<string[]> {
  if (!candidateId) return [];
  const org = await getCurrentOrg();
  const rows = await prisma.candidateListMembership.findMany({
    where: {
      candidateId,
      // List join enforces the org boundary even if a forged candidateId
      // somehow crossed it (the schema's CASCADE delete on org → list →
      // membership keeps this inherently in-bounds, but explicit guard
      // is rule 8).
      list: { organizationId: org.id },
    },
    select: { listId: true },
  });
  return rows.map((r) => r.listId);
}

// Diff-set the membership rows for one candidate: add lists in
// `targetListIds` that are missing, remove memberships pointing at
// lists not in the target. Both sides are scoped by org so a forged
// listId from another tenant can't sneak in.
export async function setCandidateListMemberships(input: {
  candidateId: string;
  listIds: string[];
}): Promise<ActionResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.candidateId) return { ok: false, error: "Missing candidate id." };

  try {
    const org = await getCurrentOrg();
    // Verify the candidate is in the caller's org.
    const candidate = await prisma.candidate.findFirst({
      where: { id: input.candidateId, organizationId: org.id },
      select: { id: true },
    });
    if (!candidate) return { ok: false, error: "Candidate not found." };

    // Restrict the listIds set to only lists in the caller's org —
    // a forged id from another tenant gets dropped silently rather
    // than throwing.
    const validLists = await prisma.candidateList.findMany({
      where: {
        id: { in: input.listIds },
        organizationId: org.id,
      },
      select: { id: true },
    });
    const validIds = new Set(validLists.map((l) => l.id));

    const current = await prisma.candidateListMembership.findMany({
      where: { candidateId: candidate.id, list: { organizationId: org.id } },
      select: { listId: true },
    });
    const currentIds = new Set(current.map((m) => m.listId));

    const toAdd = Array.from(validIds).filter((id) => !currentIds.has(id));
    const toRemove = Array.from(currentIds).filter((id) => !validIds.has(id));

    if (toAdd.length === 0 && toRemove.length === 0) {
      return { ok: true };
    }

    await prisma.$transaction([
      ...(toAdd.length > 0
        ? [
            prisma.candidateListMembership.createMany({
              data: toAdd.map((listId) => ({ candidateId: candidate.id, listId })),
              skipDuplicates: true,
            }),
          ]
        : []),
      ...(toRemove.length > 0
        ? [
            prisma.candidateListMembership.deleteMany({
              where: {
                candidateId: candidate.id,
                listId: { in: toRemove },
                list: { organizationId: org.id },
              },
            }),
          ]
        : []),
    ]);

    revalidatePath("/candidates");
    revalidatePath(`/candidates/${candidate.id}`);
    revalidatePath("/candidates/lists");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update lists." };
  }
}

// Creates a new list for the caller's org and (optionally) seeds it
// with one candidate. Friendly error on the (organizationId, name)
// unique violation so the popup can show a useful message.
export async function createCandidateList(input: {
  name: string;
  candidateId?: string;
}): Promise<ActionResult<{ id: string; name: string }>> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "List name is required." };
  if (name.length > 80) return { ok: false, error: "List name is too long (max 80)." };

  try {
    const org = await getCurrentOrg();

    // If a candidate is being seeded, verify it's in-org first so the
    // create + add are atomic.
    let candidateId: string | null = null;
    if (input.candidateId) {
      const c = await prisma.candidate.findFirst({
        where: { id: input.candidateId, organizationId: org.id },
        select: { id: true },
      });
      if (!c) return { ok: false, error: "Candidate not found." };
      candidateId = c.id;
    }

    const created = await prisma.candidateList.create({
      data: {
        name,
        organizationId: org.id,
        createdById: user.id,
      },
      select: { id: true, name: true },
    });

    if (candidateId) {
      await prisma.candidateListMembership.create({
        data: { listId: created.id, candidateId },
      });
    }

    revalidatePath("/candidates");
    revalidatePath("/candidates/lists");
    if (candidateId) revalidatePath(`/candidates/${candidateId}`);
    return { ok: true, value: created };
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return { ok: false, error: `A list named "${name}" already exists.` };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create list." };
  }
}

export async function renameCandidateList(input: {
  listId: string;
  name: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "List name is required." };
  if (name.length > 80) return { ok: false, error: "List name is too long (max 80)." };

  try {
    const org = await getCurrentOrg();
    const list = await prisma.candidateList.findFirst({
      where: { id: input.listId, organizationId: org.id },
      select: { id: true },
    });
    if (!list) return { ok: false, error: "List not found." };

    await prisma.candidateList.update({
      where: { id: list.id },
      data: { name },
    });

    revalidatePath("/candidates");
    revalidatePath("/candidates/lists");
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return { ok: false, error: `A list named "${name}" already exists.` };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Failed to rename list." };
  }
}

export async function deleteCandidateList(listId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  try {
    const org = await getCurrentOrg();
    const list = await prisma.candidateList.findFirst({
      where: { id: listId, organizationId: org.id },
      select: { id: true },
    });
    if (!list) return { ok: false, error: "List not found." };
    // Schema cascade-deletes the membership rows; candidates are
    // preserved (Candidate.listMemberships only).
    await prisma.candidateList.delete({ where: { id: list.id } });
    revalidatePath("/candidates");
    revalidatePath("/candidates/lists");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete list." };
  }
}
