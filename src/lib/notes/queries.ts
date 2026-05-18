import "server-only";

import type { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export type NoteRow = {
  id: string;
  title: string | null;
  body: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  candidateId: string | null;
  clientId: string | null;
  jobId: string | null;
  candidate: { id: string; firstName: string; lastName: string | null } | null;
  client: { id: string; name: string; slug?: string | null } | null;
  job: { id: string; title: string } | null;
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

function notesInclude() {
  return {
    candidate: { select: { id: true, firstName: true, lastName: true } },
    client: { select: { id: true, name: true } },
    job: { select: { id: true, title: true } },
  } as const;
}

// Loads the signed-in user's notes for the /notes page. Scoped to
// organizationId + createdById on every branch so a stranger probing
// the page can never see a teammate's notes.
//   all      — every note this user has created
//   mine     — loose notes (no candidate/client/job attachment)
//   attached — notes attached to at least one entity
export async function getNotesForUser(
  filter: NoteFilter = "all",
): Promise<NoteRow[]> {
  const [org, userId] = await Promise.all([getCurrentOrg(), getCurrentUserId()]);
  if (!userId) return [];

  const where: Prisma.NoteWhereInput = {
    organizationId: org.id,
    createdById: userId,
  };
  if (filter === "mine") {
    where.candidateId = null;
    where.clientId = null;
    where.jobId = null;
  } else if (filter === "attached") {
    where.OR = [
      { candidateId: { not: null } },
      { clientId: { not: null } },
      { jobId: { not: null } },
    ];
  }

  const rows = await prisma.note.findMany({
    where,
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    include: notesInclude(),
  });
  return rows as NoteRow[];
}

// Loads notes attached to a specific entity for the activity feed on
// that entity's profile page. Still scoped to organizationId +
// createdById because notes are private to their author.
export async function getNotesForEntity(
  entityType: "candidate" | "client" | "job",
  entityId: string,
): Promise<NoteRow[]> {
  const [org, userId] = await Promise.all([getCurrentOrg(), getCurrentUserId()]);
  if (!userId) return [];

  const where: Prisma.NoteWhereInput = {
    organizationId: org.id,
    createdById: userId,
  };
  if (entityType === "candidate") where.candidateId = entityId;
  else if (entityType === "client") where.clientId = entityId;
  else where.jobId = entityId;

  const rows = await prisma.note.findMany({
    where,
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    include: notesInclude(),
  });
  return rows as NoteRow[];
}

// Counts feed the TabStrip pills on /notes so each tab shows its own
// total without three round-trips on the client. One query, grouped
// per-attachment-kind via a CASE-style aggregate.
export async function getNoteCountsForUser(): Promise<{
  all: number;
  mine: number;
  attached: number;
}> {
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
          { candidateId: { not: null } },
          { clientId: { not: null } },
          { jobId: { not: null } },
        ],
      },
    }),
  ]);
  return { all, mine: all - attached, attached };
}
