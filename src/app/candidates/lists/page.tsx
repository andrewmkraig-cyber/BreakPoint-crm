import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
      <ListsManagementView initial={lists} />
    </div>
  );
}
