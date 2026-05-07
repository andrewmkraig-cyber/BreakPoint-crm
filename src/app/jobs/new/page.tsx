import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { getClientsForOrg } from "@/lib/clients";
import { NewJobForm } from "@/app/jobs/new/new-job-form";

export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  // Phase 2: writes go to Neon, so the dropdown surfaces EVERY client in
  // the tenant — both RF-imported (legacyRfId set) and Ace-native rows
  // created via /clients/new. The form submits `clientId` (cuid) directly.
  let clients: Array<{ id: string; name: string }> = [];
  let error: string | null = null;

  try {
    const rows = await getClientsForOrg();
    clients = rows
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load clients.";
  }

  return (
    <div className="space-y-6">
      <Link href="/jobs" className="inline-flex items-center gap-1 text-xs text-court-fg-muted hover:text-court-fg">
        <ArrowLeft className="h-3 w-3" /> Back to jobs
      </Link>

      <PageHeader
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
