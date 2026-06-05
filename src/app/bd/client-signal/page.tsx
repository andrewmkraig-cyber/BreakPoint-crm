import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { TabStrip, type TabStripItem } from "@/components/ui/tab-strip";
import { formatDaysAgo } from "../date-format";
import { type SignalRowData } from "./signal-row";
import { SignalList } from "./signal-list";

// First client contact carrying a usable email. The Client Signal "Reach out"
// composer pre-fills To with this address (and greets by first name); clients
// with no email-bearing contact open the composer with To blank.
function primaryContact(
  contacts: ReadonlyArray<{ firstName: string | null; emails: string[] }> | undefined,
): { email: string | null; firstName: string | null } {
  const hit = (contacts ?? []).find((c) => c.emails.some((e) => e.trim().length > 0));
  if (!hit) return { email: null, firstName: null };
  const email = hit.emails.find((e) => e.trim().length > 0)?.trim() ?? null;
  return { email, firstName: hit.firstName?.trim() || null };
}

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
        // "All" is the working list: never resurface signals already
        // dismissed. They stay reachable only under the Dismissed tab.
        return { organizationId: org.id, status: { not: "DISMISSED" as const } };
    }
  })();

  const [rows, allCount, newWeekCount, actedCount, dismissedCount] = await Promise.all([
    prisma.clientSignal.findMany({
      where,
      // Newest posting first. postedAt is the real listing date; rows where we
      // never captured it (null) sort last and fall back to discoveredAt.
      orderBy: [{ postedAt: { sort: "desc", nulls: "last" } }, { discoveredAt: "desc" }],
      take: 100,
      select: {
        id: true,
        companyName: true,
        jobTitle: true,
        jobLocation: true,
        jobPostingUrl: true,
        postedAt: true,
        discoveredAt: true,
        status: true,
        source: true,
        client: {
          select: {
            id: true,
            legacyRfId: true,
            domain: true,
            contacts: { select: { firstName: true, emails: true } },
          },
        },
      },
    }),
    prisma.clientSignal.count({ where: { organizationId: org.id } }),
    prisma.clientSignal.count({
      where: { organizationId: org.id, status: "NEW", discoveredAt: { gte: weekAgo } },
    }),
    prisma.clientSignal.count({ where: { organizationId: org.id, status: "ACTED" } }),
    prisma.clientSignal.count({ where: { organizationId: org.id, status: "DISMISSED" } }),
  ]);

  const signals: SignalRowData[] = rows.map((s) => {
    const contact = primaryContact(s.client?.contacts);
    return {
      id: s.id,
      companyName: s.companyName,
      // Key the logo on the matched client's domain (same source as the
      // Clients page). Soft matches with no client get null -> initials chip.
      domain: s.client?.domain ?? null,
      matchedClientHref: clientHref(s.client),
      jobTitle: s.jobTitle,
      jobLocation: s.jobLocation,
      // Real posting date when we captured it; fall back to discoveredAt for
      // older rows where postedAt is null so the row still shows a date.
      postedLabel: formatDaysAgo(s.postedAt ?? s.discoveredAt, nowMs),
      jobPostingUrl: s.jobPostingUrl,
      status: s.status,
      source: s.source === "CLIENT_MONITOR" ? "CLIENT_MONITOR" : "BD_DISCOVERY",
      // Reach-out composer pre-fill. Null email -> composer opens with To blank.
      contactEmail: contact.email,
      contactFirstName: contact.firstName,
    };
  });

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
          Client Signals
        </p>
      </header>

      <TabStrip<Filter> items={tabs} activeId={filter} ariaLabel="Client Signal filters" />

      <SignalList signals={signals} />
    </section>
  );
}
