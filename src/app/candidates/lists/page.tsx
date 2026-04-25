import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { listCandidateLists } from "@/app/candidates/lists-actions";
import { ListsManagementView } from "@/app/candidates/lists/lists-management-view";

export const dynamic = "force-dynamic";

export default async function CandidateListsPage() {
  const lists = await listCandidateLists();
  return (
    <div className="space-y-6">
      <Link
        href="/candidates"
        className="inline-flex items-center gap-1 text-xs text-court-fg-muted hover:text-court-fg"
      >
        <ArrowLeft className="h-3 w-3" /> Back to candidates
      </Link>
      <PageHeader
        eyebrow="Pool"
        title="Candidate lists"
        description="Recruiter-curated buckets of candidates. Rename or delete from here. Add candidates from any candidate profile."
      />
      <ListsManagementView initial={lists} />
    </div>
  );
}
