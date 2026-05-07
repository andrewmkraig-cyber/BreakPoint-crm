import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { NewCandidateForm } from "@/app/candidates/new/new-candidate-form";

export default function NewCandidatePage() {
  return (
    <div className="space-y-6">
      <Link href="/candidates" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-ink">
        <ArrowLeft className="h-3 w-3" /> Back to candidates
      </Link>
      <PageHeader
        title="New candidate"
        description="Drop a resume PDF, paste profile text, or enter a LinkedIn URL. Claude parses whatever you provide; review and edit before saving."
      />
      <NewCandidateForm />
    </div>
  );
}
