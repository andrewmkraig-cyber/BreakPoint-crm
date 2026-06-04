import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, MapPin } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { ClientLogo } from "@/components/clients/client-logo";
import { formatBdDateTime } from "../../date-format";

export const dynamic = "force-dynamic";

// Shape of one entry in BDRun.discoveredPayload (Json). Written by the
// BD discovery cron as a DiscoveredCompany[] (see
// src/lib/bd/job-discovery-provider.ts). Read-only display here; every
// field is optional at the boundary because the column is Json and a
// legacy/partial row could be missing any of them.
type DiscoveredItem = {
  companyName?: string;
  domain?: string;
  jobTitle?: string;
  jobLocation?: string;
  jobPostingUrl?: string;
};

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
      discoveredPayload: true,
      vertical: { select: { name: true } },
      savedSearch: { select: { name: true } },
    },
  });
  if (!run) notFound();

  // discoveredPayload is Json; coerce defensively. A run with no
  // companies (still RUNNING, FAILED, or an empty pull) yields [] and
  // renders the empty state rather than crashing.
  const companies: DiscoveredItem[] = Array.isArray(run.discoveredPayload)
    ? (run.discoveredPayload as DiscoveredItem[])
    : [];

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

      <div className="rounded-2xl border border-court-border bg-court-surface p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-court-fg">Discovered companies</h2>
          <span className="text-xs font-medium text-court-fg-muted">
            {companies.length} {companies.length === 1 ? "company" : "companies"}
          </span>
        </div>

        {companies.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-court-border bg-court-surface-subtle p-6 text-sm text-court-fg-muted">
            No companies were discovered for this run yet.
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {companies.map((company, idx) => {
              const name = company.companyName?.trim() || "Unknown company";
              const url = company.jobPostingUrl?.trim();
              return (
                <li
                  key={`${name}-${company.jobTitle ?? ""}-${idx}`}
                  className="flex items-start gap-3 rounded-xl border border-court-border bg-court-surface-subtle p-3"
                >
                  <ClientLogo domain={company.domain} name={name} size={40} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="truncate text-sm font-semibold text-court-fg">{name}</p>
                    {company.jobTitle ? (
                      <p className="truncate text-xs font-medium text-court-brand">
                        {company.jobTitle}
                      </p>
                    ) : null}
                    {company.jobLocation ? (
                      <p className="flex items-center gap-1 truncate text-xs text-court-fg-muted">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{company.jobLocation}</span>
                      </p>
                    ) : null}
                  </div>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 self-center rounded-lg border border-court-border bg-court-surface px-2.5 py-1.5 text-xs font-medium text-court-fg-muted transition-colors hover:text-court-fg"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Job
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
