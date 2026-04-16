import { PageHeader } from "@/components/page-header";
import { ClientsView, type ClientCard } from "@/app/clients/clients-view";
import {
  recruiterflow,
  normalizeClient,
  buildClientCounts,
  emptyJobCounts,
} from "@/lib/recruiterflow";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams?: { q?: string; page?: string };
}) {
  const q = (searchParams?.q ?? "").trim();
  const pageParam = parseInt(searchParams?.page ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  let cards: ClientCard[] = [];
  let error: string | null = null;

  try {
    const [clients, candidates] = await Promise.all([
      recruiterflow.listAllClients({ perPage: 100 }),
      recruiterflow.listAllCandidates({ perPage: 100 }),
    ]);
    const counts = buildClientCounts(candidates);
    cards = clients.map((raw) => {
      const c = normalizeClient(raw);
      const pc = counts.get(c.id) ?? emptyJobCounts();
      return {
        ...c,
        submittedCount: pc.submitted,
        interviewingCount: pc.interviewing,
        hiredCount: pc.hired,
      };
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to fetch clients";
  }

  if (q) {
    const needle = q.toLowerCase();
    cards = cards.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        (c.industry ?? "").toLowerCase().includes(needle) ||
        (c.location ?? "").toLowerCase().includes(needle),
    );
  }

  // Unnamed companies to the bottom; verified first, then most recently engaged-ish (openJobsCount desc).
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
        description="Every client company from RecruiterFlow. Verified badge means a signed fee agreement is on file."
      />
      <ClientsView
        cards={pageCards}
        total={total}
        page={safePage}
        totalPages={totalPages}
        pageSize={PAGE_SIZE}
        q={q}
        verifiedCount={verifiedCount}
        error={error}
      />
    </div>
  );
}
