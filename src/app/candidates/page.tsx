import { PageHeader } from "@/components/page-header";
import { CandidatesView } from "@/app/candidates/candidates-view";
import { recruiterflow, normalizeCandidate } from "@/lib/recruiterflow";

export const dynamic = "force-dynamic";

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const query = searchParams?.q ?? "";
  let candidates: ReturnType<typeof normalizeCandidate>[] = [];
  let error: string | null = null;

  try {
    const list = await recruiterflow.listAllCandidates({ query, perPage: 100 });
    candidates = list.map(normalizeCandidate);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to fetch candidates";
  }

  return (
    <div>
      <PageHeader
        eyebrow="Pool"
        title="Candidates"
        description="Sourced and applied candidates — not yet submitted. Full Boolean search is coming Day 5."
      />
      <CandidatesView initialQuery={query} candidates={candidates} error={error} />
    </div>
  );
}
