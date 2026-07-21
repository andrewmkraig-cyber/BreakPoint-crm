import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewJobForm } from "@/app/jobs/new/new-job-form";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: { clientId?: string };
}) {
  // Load the create-job picker straight from Client, not from the
  // client-list buckets. The clients page derives Active / Quiet /
  // Inactive from activity windows, but posting a job from a client
  // profile must still be allowed for an Inactive client. The form
  // submits `clientId` (cuid) directly.
  let clients: Array<{ id: string; name: string }> = [];
  let error: string | null = null;

  try {
    const org = await getCurrentOrg();
    const rows = await prisma.client.findMany({
      where: { organizationId: org.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    clients = rows.map((c) => ({ id: c.id, name: c.name || "(unnamed)" }));
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load clients.";
  }

  // Prefill the client field when arriving from a client overview's
  // "+ New Job" button (`/jobs/new?clientId=<cuid>`). Only honor the
  // param when it matches a tenant client the recruiter can actually
  // pick; a stray/foreign id falls through to "Select a client…".
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
