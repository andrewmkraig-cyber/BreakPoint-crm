import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewCandidateForm } from "@/app/candidates/new/new-candidate-form";

export default function NewCandidatePage() {
  return (
    <div className="space-y-6">
      <Link href="/candidates" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-ink">
        <ArrowLeft className="h-3 w-3" /> Back to candidates
      </Link>
      <NewCandidateForm />
    </div>
  );
}
