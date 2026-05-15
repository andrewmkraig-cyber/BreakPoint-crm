import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { TabStrip, type TabStripItem } from "@/components/ui/tab-strip";
import { formatDaysAgo } from "../date-format";
import { SignalRow, type SignalRowData } from "./signal-row";

export const dynamic = "force-dynamic";

type Filter = "all" | "new-week" | "acted" | "dismissed";

const FILTER_IDS: ReadonlyArray<Filter> = ["all", "new-week", "acted", "dismissed"];

function resolveFilter(raw: string | undefined): Filter {
  return FILTER_IDS.includes(raw as Filter) ? (raw as Filter) : "all";
}

function clientHref(c: { id: string; legacyRfId: number | null } | null | undefined): string | null {
  if (!c) return null;
  return c.legacyRfId != null ? `/clients/${c.legacyRfId}` : `/clients/${c.id}`;
}

export default async function ClientSignalPage({
  searchParams,
}: {
  searchParams?: { filter?: string };
}) {
  const org = await getCurrentOrg();
  const filter = resolveFilter(searchParams?.filter);
  const nowMs = Date.now();
  const weekAgo = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);

  const where = (() => {
    switch (filter) {
      case "new-week":
        return {
          organizationId: org.id,
          status: "NEW" as const,
          discoveredAt: { gte: weekAgo },
        };
      case "acted":
        return { organizationId: org.id, status: "ACTED" as const };
      case "dismissed":
        return { organizationId: org.id, status: "DISMISSED" as const };
      default:
        return { organizationId: org.id };
    }
  })();

  const [rows, allCount, newWeekCount, actedCount, dismissedCount] = await Promise.all([
    prisma.clientSignal.findMany({
      where,
      orderBy: { discoveredAt: "desc" },
      take: 100,
      select: {
        id: true,
        companyName: true,
        jobTitle: true,
        jobLocation: true,
        jobPostingUrl: true,
        discoveredAt: true,
        status: true,
        source: true,
        client: { select: { id: true, legacyRfId: true, logoUrl: true } },
      },
    }),
    prisma.clientSignal.count({ where: { organizationId: org.id } }),
    prisma.clientSignal.count({
      where: { organizationId: org.id, status: "NEW", discoveredAt: { gte: weekAgo } },
    }),
    prisma.clientSignal.count({ where: { organizationId: org.id, status: "ACTED" } }),
    prisma.clientSignal.count({ where: { organizationId: org.id, status: "DISMISSED" } }),
  ]);

  const signals: SignalRowData[] = rows.map((s) => ({
    id: s.id,
    companyName: s.companyName,
    logoUrl: s.client?.logoUrl ?? null,
    matchedClientHref: clientHref(s.client),
    jobTitle: s.jobTitle,
    jobLocation: s.jobLocation,
    postedLabel: formatDaysAgo(s.discoveredAt, nowMs),
    jobPostingUrl: s.jobPostingUrl,
    status: s.status,
    source: s.source === "CLIENT_MONITOR" ? "CLIENT_MONITOR" : "BD_DISCOVERY",
  }));

  const tabs: ReadonlyArray<TabStripItem<Filter>> = [
    { id: "all", label: "All", count: allCount, href: "/bd/client-signal" },
    {
      id: "new-week",
      label: "New this week",
      count: newWeekCount,
      href: "/bd/client-signal?filter=new-week",
    },
    {
      id: "acted",
      label: "Acted on",
      count: actedCount,
      href: "/bd/client-signal?filter=acted",
    },
    {
      id: "dismissed",
      label: "Dismissed",
      count: dismissedCount,
      href: "/bd/client-signal?filter=dismissed",
    },
  ];

  return (
    <section className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          Client Signal
        </p>
        <h2 className="font-serif text-xl font-bold tracking-tight text-court-fg">
          Existing clients hiring publicly
        </h2>
      </header>

      <TabStrip<Filter> items={tabs} activeId={filter} ariaLabel="Client Signal filters" />

      {signals.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="divide-y divide-court-border rounded-2xl border border-court-border bg-court-surface shadow-sm">
          {signals.map((s) => (
            <SignalRow key={s.id} {...s} />
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-court-border bg-court-surface-subtle p-10 text-center">
      <p className="text-sm font-semibold text-court-fg">No client signals yet.</p>
      <p className="mt-1 text-sm text-court-fg-muted">
        TheirStack flags an existing client posting publicly and it lands here.
      </p>
    </div>
  );
}
