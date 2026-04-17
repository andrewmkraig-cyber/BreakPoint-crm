import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { recruiterflow, normalizeClient } from "@/lib/recruiterflow";
import { NewJobForm } from "@/app/jobs/new/new-job-form";

export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  let clients: Array<{ id: number; name: string }> = [];
  let error: string | null = null;

  try {
    const rawClients = await recruiterflow.listAllClients({ perPage: 100 });
    clients = rawClients
      .map((c) => {
        const n = normalizeClient(c);
        return { id: n.id, name: n.name };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load clients.";
  }

  return (
    <div className="space-y-6">
      <Link href="/jobs" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-navy">
        <ArrowLeft className="h-3 w-3" /> Back to jobs
      </Link>

      <PageHeader
        eyebrow="Requisitions"
        title="New Job"
        description="Create a new job. We push it to RecruiterFlow so the rest of Ace sees it everywhere."
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load clients from RecruiterFlow.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <NewJobForm clients={clients} />
    </div>
  );
}
