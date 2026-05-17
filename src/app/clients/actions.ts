"use server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Lightweight client search for type-ahead pickers (the calendar's
// CreateEventModal, future submittal/interview surfaces, etc). Mirrors
// the shape of quickSearchCandidates in src/app/candidates/actions.ts
// — capped row count, projected to the minimum the dropdown renders,
// and tenant-scoped via getCurrentOrg.

const QUICK_LIMIT = 8;

export type QuickClientRow = {
  id: string;
  name: string;
  domain: string | null;
};

export type QuickClientResult =
  | { ok: true; rows: QuickClientRow[] }
  | { ok: false; error: string };

export async function quickSearchClients(query: string): Promise<QuickClientResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { ok: true, rows: [] };
  try {
    const org = await getCurrentOrg();
    const rows = await prisma.client.findMany({
      where: {
        organizationId: org.id,
        OR: [
          { name: { contains: trimmed, mode: "insensitive" } },
          { domain: { contains: trimmed, mode: "insensitive" } },
        ],
      },
      orderBy: { name: "asc" },
      take: QUICK_LIMIT,
      select: { id: true, name: true, domain: true },
    });
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Search failed." };
  }
}
