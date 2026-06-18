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
  // The client dropdown includes a client when it has at least one ACTIVE
  // job (the same "active" the /jobs Active tab uses — lifecycle resolves to
  // "active" via isActiveJobLifecycle, so private/inactive jobs never qualify)
  // OR it was created within the last 7 days. The 7-day grace lets a
  // brand-new, still-jobless client (e.g. just added from the client
  // overview) be picked here so the recruiter can create its first job;
  // after 7 days a client that never got a job drops off this picker again.
  // This grace window mirrors the createdAt+7d rule /clients already uses for
  // its Active bucket (see ClientListRow.createdAt in lib/clients). The
  // filter is local to this picker — the global "active client" definition
  // used by /clients + dashboards is untouched. The form submits `clientId`
  // (cuid) directly. Both queries are org-scoped (Rule 8): the job query
  // filters by organizationId and getClientsForOrg scopes via getCurrentOrg.
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

    // 7-day grace floor for brand-new clients with no active job yet.
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const newClientFloor = Date.now() - SEVEN_DAYS_MS;

    const rows = await getClientsForOrg();
    clients = rows
      .filter(
        (c) => activeClientIds.has(c.id) || c.createdAt.getTime() >= newClientFloor,
      )
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
