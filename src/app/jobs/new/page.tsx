import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { getClientsForOrg } from "@/lib/clients";
import { NewJobForm } from "@/app/jobs/new/new-job-form";

export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  // The Job-create action still writes to RF (Phase 2), so the dropdown
  // is restricted to clients that have an RF id. Ace-native Clients
  // (cuid-only) are hidden here until the Jobs cutover lands — they'd
  // get rejected by RF on create.
  let clients: Array<{ id: number; name: string }> = [];
  let error: string | null = null;

  try {
    const rows = await getClientsForOrg();
    clients = rows
      .filter((c) => c.legacyRfId != null)
      .map((c) => ({ id: c.legacyRfId as number, name: c.name }))
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
        description="Create a new job in Ace."
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load clients.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <NewJobForm clients={clients} />
    </div>
  );
}
