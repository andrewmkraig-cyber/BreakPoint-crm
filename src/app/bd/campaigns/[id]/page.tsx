import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { formatBdDateTime } from "../../date-format";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const org = await getCurrentOrg();
  const run = await prisma.bDRun.findFirst({
    where: { id: params.id, organizationId: org.id },
    select: {
      id: true,
      status: true,
      createdAt: true,
      plan: true,
      metrics: true,
      vertical: { select: { name: true } },
      savedSearch: { select: { name: true } },
    },
  });
  if (!run) notFound();

  return (
    <section className="flex w-full flex-col gap-6">
      <Link
        href="/bd/campaigns"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-court-fg-muted transition-colors hover:text-court-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Active Campaigns
      </Link>

      <header className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          {run.vertical?.name ?? "Discovery"}
        </p>
        <h2 className="font-serif text-xl font-bold tracking-tight text-court-fg">
          {run.savedSearch?.name ?? "Org-wide BD discovery"}
        </h2>
        <p className="text-sm text-court-fg-muted">
          Status {run.status} · Started {formatBdDateTime(run.createdAt)}
        </p>
      </header>

      <div className="rounded-2xl border border-court-border bg-court-surface p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-court-fg">Plan snapshot</h2>
        <pre className="mt-3 overflow-x-auto rounded-md border border-court-border bg-court-surface-subtle p-3 text-xs leading-relaxed text-court-fg">
{JSON.stringify(run.plan ?? {}, null, 2)}
        </pre>
        {run.metrics ? (
          <>
            <h2 className="mt-5 text-sm font-semibold text-court-fg">Metrics</h2>
            <pre className="mt-3 overflow-x-auto rounded-md border border-court-border bg-court-surface-subtle p-3 text-xs leading-relaxed text-court-fg">
{JSON.stringify(run.metrics, null, 2)}
            </pre>
          </>
        ) : null}
      </div>

      <div className="rounded-2xl border border-dashed border-court-border bg-court-surface-subtle p-6 text-sm text-court-fg-muted">
        Contact list ships in Phase 4. Once Apollo enrolls contacts into the sequence, each
        person + their event timeline will land here.
      </div>
    </section>
  );
}
