import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getClientsForOrg } from "@/lib/clients";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { isActiveJobLifecycle } from "@/lib/job-lifecycle";
import { prisma } from "@/lib/prisma";
import { NewJobForm } from "@/app/jobs/new/new-job-form";

export const dynamic = "force-dynamic";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: { clientId?: string };
}) {
  // The client dropdown is limited to clients that have at least one ACTIVE
  // job (the same "active" the /jobs Active tab uses — lifecycle resolves to
  // "active" via isActiveJobLifecycle, so private/inactive jobs never qualify).
  // Clients with only private/inactive jobs, or no jobs at all, are omitted.
  // The form submits `clientId` (cuid) directly. Both queries are org-scoped
  // (Rule 8): the job query filters by organizationId and getClientsForOrg
  // scopes via getCurrentOrg.
  let clients: Array<{ id: string; name: string }> = [];
  let error: string | null = null;

  try {
    const org = await getCurrentOrg();
    // Active always implies isOpen=true, so prefilter on it, then let the
    // canonical helper make the final active/private/inactive call. A Set of
    // client cuids dedupes clients that have several active jobs.
    const activeJobs = await prisma.job.findMany({
      where: { organizationId: org.id, isOpen: true, clientId: { not: null } },
      select: { clientId: true, lifecycle: true, isOpen: true },
    });
    const activeClientIds = new Set(
      activeJobs
        .filter((j) => isActiveJobLifecycle(j.lifecycle, j.isOpen))
        .map((j) => j.clientId)
        .filter((id): id is string => Boolean(id)),
    );

    const rows = await getClientsForOrg();
    clients = rows
      .filter((c) => activeClientIds.has(c.id))
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
