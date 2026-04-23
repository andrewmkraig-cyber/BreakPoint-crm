import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ClientsView, type ClientCard } from "@/app/clients/clients-view";
import { buildClientCounts, emptyJobCounts, canonicalStage } from "@/lib/recruiterflow";
import { getRfCandidatesForOrg } from "@/lib/candidates";
import { getClientsForOrg } from "@/lib/clients";

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
    const [clients, candidates] = await Promise.all([
      getClientsForOrg(),
      getRfCandidatesForOrg(),
    ]);
    // Pipeline counts are keyed by RF client_company_id. Ace-native
    // Clients have no legacyRfId yet, so they fall through to zero
    // counts — the right answer until a Candidate/Placement lands on
    // them post-Phase-2.
    const counts = buildClientCounts(candidates);
    const recentPlacementIds = recentlyPlacedClientIds(candidates);
    all = clients.map((c) => {
      const legacyId = c.legacyRfId;
      const pc = legacyId != null ? counts.get(legacyId) ?? emptyJobCounts() : emptyJobCounts();
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
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
