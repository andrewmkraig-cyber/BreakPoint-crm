import "server-only";

import type { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export type NoteAttachedCandidate = {
  id: string;
  firstName: string;
  lastName: string | null;
};
export type NoteAttachedClient = { id: string; name: string };
export type NoteAttachedJob = { id: string; title: string };

export type NoteRow = {
  id: string;
  title: string | null;
  body: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  candidates: NoteAttachedCandidate[];
  clients: NoteAttachedClient[];
  jobs: NoteAttachedJob[];
};

export type NoteFilter = "all" | "mine" | "attached";

async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return user?.id ?? null;
}

const NOTE_INCLUDE = {
  candidates: { select: { id: true, firstName: true, lastName: true } },
  clients: { select: { id: true, name: true } },
  jobs: { select: { id: true, title: true } },
} as const;

// Loads the signed-in user's notes for the /notes page. Scoped to
// organizationId + createdById on every branch so a stranger probing
// the page can never see a teammate's notes.
//   all      — every note this user has created
//   mine     — loose notes (no candidate/client/job attachment)
//   attached — notes attached to at least one entity
export async function getNotesForUser(
  filter: NoteFilter = "all",
): Promise<NoteRow[]> {
  try {
    const [org, userId] = await Promise.all([getCurrentOrg(), getCurrentUserId()]);
    if (!userId) return [];

    const where: Prisma.NoteWhereInput = {
      organizationId: org.id,
      createdById: userId,
    };
    if (filter === "mine") {
      where.AND = [
        { candidates: { none: {} } },
        { clients: { none: {} } },
        { jobs: { none: {} } },
      ];
    } else if (filter === "attached") {
      where.OR = [
        { candidates: { some: {} } },
        { clients: { some: {} } },
        { jobs: { some: {} } },
      ];
    }

    const rows = await prisma.note.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      include: NOTE_INCLUDE,
    });
    return rows;
  } catch (e) {
    console.error("[notes.getNotesForUser] failed", { filter, error: e });
    return [];
  }
}

// Loads notes attached to a specific entity for the activity feed on
// that entity's profile page. Still scoped to organizationId +
// createdById because notes are private to their author.
export async function getNotesForEntity(
  entityType: "candidate" | "client" | "job",
  entityId: string,
): Promise<NoteRow[]> {
  try {
    const [org, userId] = await Promise.all([getCurrentOrg(), getCurrentUserId()]);
    if (!userId) return [];

    const where: Prisma.NoteWhereInput = {
      organizationId: org.id,
      createdById: userId,
    };
    if (entityType === "candidate") {
      where.candidates = { some: { id: entityId } };
    } else if (entityType === "client") {
      where.clients = { some: { id: entityId } };
    } else {
      where.jobs = { some: { id: entityId } };
    }

    const rows = await prisma.note.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      include: NOTE_INCLUDE,
    });
    return rows;
  } catch (e) {
    console.error("[notes.getNotesForEntity] failed", { entityType, entityId, error: e });
    return [];
  }
}

// Counts feed the TabStrip pills on /notes so each tab shows its own
// total without three round-trips on the client.
export async function getNoteCountsForUser(): Promise<{
  all: number;
  mine: number;
  attached: number;
}> {
  try {
    const [org, userId] = await Promise.all([getCurrentOrg(), getCurrentUserId()]);
    if (!userId) return { all: 0, mine: 0, attached: 0 };

    const [all, attached] = await Promise.all([
      prisma.note.count({
        where: { organizationId: org.id, createdById: userId },
      }),
      prisma.note.count({
        where: {
          organizationId: org.id,
          createdById: userId,
          OR: [
            { candidates: { some: {} } },
            { clients: { some: {} } },
            { jobs: { some: {} } },
          ],
        },
      }),
    ]);
    return { all, mine: all - attached, attached };
  } catch (e) {
    console.error("[notes.getNoteCountsForUser] failed", e);
    return { all: 0, mine: 0, attached: 0 };
  }
}
