import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ClientsView, type ClientCard } from "@/app/clients/clients-view";
import { canonicalStage, emptyJobCounts, type JobPipelineCounts } from "@/lib/rf-payload-shapes";
import { getRfCandidatesForOrg } from "@/lib/candidates";
import { getClientsForOrg } from "@/lib/clients";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const PLACEMENT_WINDOW_MS = 1000 * 60 * 60 * 24 * 30 * 6; // ~6 months

export default async function ClientsPage({
  searchParams,
}: {
  searchParams?: { q?: string; page?: string; tab?: "active" | "inactive" };
}) {
  const q = (searchParams?.q ?? "").trim();
  const tab: "active" | "inactive" = searchParams?.tab === "inactive" ? "inactive" : "active";
  const pageParam = parseInt(searchParams?.page ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  let all: ClientCard[] = [];
  let error: string | null = null;

  try {
    const [clients, candidates, org] = await Promise.all([
      getClientsForOrg(),
      getRfCandidatesForOrg(),
      getCurrentOrg(),
    ]);
    // Pipeline counts read from Neon Placement.stage (canonical post-
    // Phase-5), one groupBy across the whole tenant rather than walking
    // every candidate's RF jobs[] array. Filters out null clientId
    // rows (the orphan-row class fixed by the 2026-04-28 backfill;
    // safety net here in case any new ones land).
    const placementGroups = await prisma.placement.groupBy({
      by: ["clientId", "stage"],
      where: { organizationId: org.id, clientId: { not: null } },
      _count: { _all: true },
    });
    const counts = new Map<string, JobPipelineCounts>();
    for (const g of placementGroups) {
      if (!g.clientId) continue;
      const bucket = canonicalStage(g.stage);
      const n = g._count._all;
      const pc = counts.get(g.clientId) ?? emptyJobCounts();
      switch (bucket) {
        case "submitted":
          pc.submitted += n;
          pc.totalActive += n;
          break;
        case "interviewing":
          pc.interviewing += n;
          pc.totalActive += n;
          break;
        case "offer":
          pc.offer += n;
          pc.totalActive += n;
          break;
        case "pending_start":
          pc.pendingStart += n;
          pc.totalActive += n;
          break;
        case "hired":
          pc.hired += n;
          break;
        default:
          break;
      }
      counts.set(g.clientId, pc);
    }
    // recentlyPlacedClientIds still reads from RF payload — same
    // RF-leak class as the counters were before, queued as a follow-up.
    // Keying by legacyRfId here keeps the existing Active/Inactive
    // logic intact while the counters move to Neon.
    const recentPlacementIds = recentlyPlacedClientIds(candidates);
    all = clients.map((c) => {
      const legacyId = c.legacyRfId;
      const pc = counts.get(c.id) ?? emptyJobCounts();
      const hadRecentPlacement = legacyId != null && recentPlacementIds.has(legacyId);
      const hasOpenJob = c.openJobsCount > 0;
      const website = c.domain ? (c.domain.startsWith("http") ? c.domain : `https://${c.domain}`) : null;
      return {
        slug: c.slug,
        legacyRfId: c.legacyRfId,
        name: c.name,
        domain: c.domain,
        website,
        industry: c.industry,
        linkedIn: c.linkedIn,
        location: c.location ?? "",
        phone: c.phone,
        openJobsCount: c.openJobsCount,
        closedJobsCount: c.closedJobsCount,
        isVerified: c.isVerified,
        feePct: c.feePct,
        submittedCount: pc.submitted,
        interviewingCount: pc.interviewing,
        // Offer counter rolls up canonical "offer" + "pending_start"
        // (offer accepted, awaiting start) — both are post-interview
        // active states the recruiter wants to see at a glance.
        offerCount: pc.offer + pc.pendingStart,
        hiredCount: pc.hired,
        isActive: hasOpenJob || hadRecentPlacement,
      };
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to fetch clients";
  }

  const activeCount = all.filter((c) => c.isActive).length;
  const inactiveCount = all.length - activeCount;

  let cards = all.filter((c) => (tab === "active" ? c.isActive : !c.isActive));

  if (q) {
    const needle = q.toLowerCase();
    cards = cards.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        (c.industry ?? "").toLowerCase().includes(needle) ||
        (c.location ?? "").toLowerCase().includes(needle),
    );
  }

  cards.sort((a, b) => {
    if (!a.name && b.name) return 1;
    if (a.name && !b.name) return -1;
    if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
    if (b.openJobsCount !== a.openJobsCount) return b.openJobsCount - a.openJobsCount;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  const total = cards.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageCards = cards.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const verifiedCount = cards.filter((c) => c.isVerified).length;

  return (
    <div>
      <PageHeader
        eyebrow="Accounts"
        title="Clients"
        description="Active = an open job or a placement in the last 6 months. Verified badge means a signed fee agreement is on file."
        actions={
          <Link
            href="/clients/new"
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
          >
            <Plus className="h-3 w-3" /> New Client
          </Link>
        }
      />
      <ClientsView
        cards={pageCards}
        total={total}
        page={safePage}
        totalPages={totalPages}
        pageSize={PAGE_SIZE}
        q={q}
        tab={tab}
        activeCount={activeCount}
        inactiveCount={inactiveCount}
        verifiedCount={verifiedCount}
        error={error}
      />
    </div>
  );
}

// Walks every candidate's jobs[] array and returns the set of
// client_company_ids that have had a stage_moved to a "hired" stage
// within the last 6 months.
function recentlyPlacedClientIds(candidates: Awaited<ReturnType<typeof getRfCandidatesForOrg>>): Set<number> {
  const cutoff = Date.now() - PLACEMENT_WINDOW_MS;
  const out = new Set<number>();
  for (const c of candidates) {
    const jobs = Array.isArray(c.jobs) ? c.jobs : [];
    for (const j of jobs) {
      if (canonicalStage(j.stage_name) !== "hired") continue;
      if (typeof j.client_company_id !== "number") continue;
      if (!j.stage_moved) continue;
      const t = Date.parse(j.stage_moved);
      if (!Number.isFinite(t)) continue;
      if (t >= cutoff) out.add(j.client_company_id);
    }
  }
  return out;
}
