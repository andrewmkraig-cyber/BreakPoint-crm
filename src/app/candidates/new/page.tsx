import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewCandidateForm } from "@/app/candidates/new/new-candidate-form";

// `?phone=` is set by the "Add as candidate" action on an unknown phone
// thread (see AddToAceButton in phone-view.tsx) so the number carries
// over and the recruiter doesn't have to retype it. Read here on the
// server and seed the form rather than reaching for useSearchParams,
// which would force a Suspense boundary around the client form.
export default function NewCandidatePage({
  searchParams,
}: {
  searchParams: { phone?: string };
}) {
  return (
    <div className="space-y-6">
      <Link href="/candidates" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-ink">
        <ArrowLeft className="h-3 w-3" /> Back to candidates
      </Link>
      <NewCandidateForm initialPhone={searchParams.phone ?? ""} />
    </div>
  );
}
