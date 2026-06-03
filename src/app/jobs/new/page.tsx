import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getClientsForOrg } from "@/lib/clients";
import { NewJobForm } from "@/app/jobs/new/new-job-form";

export const dynamic = "force-dynamic";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: { clientId?: string };
}) {
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

  // Prefill the client field when arriving from a client overview's
  // "+ New Job" button (`/jobs/new?clientId=<cuid>`). Only honor the param
  // when it matches a client the recruiter can actually pick — the list is
  // already org-scoped via getClientsForOrg (Rule 8), so a stray/foreign id
  // simply falls through to "Select a client…".
  const defaultClientId =
    searchParams.clientId && clients.some((c) => c.id === searchParams.clientId)
      ? searchParams.clientId
      : "";

  return (
    <div className="space-y-6">
      <Link href="/jobs" className="inline-flex items-center gap-1 text-xs text-court-fg-muted hover:text-court-fg">
        <ArrowLeft className="h-3 w-3" /> Back to jobs
      </Link>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load clients.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <NewJobForm clients={clients} defaultClientId={defaultClientId} />
    </div>
  );
}
