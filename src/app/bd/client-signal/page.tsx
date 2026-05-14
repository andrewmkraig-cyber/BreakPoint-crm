import { ExternalLink, MapPin, Clock, Mail } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { TabStrip, type TabStripItem } from "@/components/ui/tab-strip";
import { cn } from "@/lib/utils";
import { formatDaysAgo } from "../date-format";

export const dynamic = "force-dynamic";

type Filter = "all" | "new-week" | "acted" | "dismissed";

const FILTER_IDS: ReadonlyArray<Filter> = ["all", "new-week", "acted", "dismissed"];

function resolveFilter(raw: string | undefined): Filter {
  return FILTER_IDS.includes(raw as Filter) ? (raw as Filter) : "all";
}

export default async function ClientSignalPage({
  searchParams,
}: {
  searchParams?: { filter?: string };
}) {
  const org = await getCurrentOrg();
  const filter = resolveFilter(searchParams?.filter);

  // One reference point for every relative-time computation on this
  // render so each row's "Posted X days ago" derives from the same
  // baseline. Without this, server SSR and the RSC payload could each
  // call Date.now() at slightly different ticks and produce drifting
  // text — the hydration mismatch trigger we're guarding against.
  const nowMs = Date.now();
  const weekAgo = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);

  const where = (() => {
    switch (filter) {
      case "new-week":
        return { organizationId: org.id, status: "NEW" as const, detectedAt: { gte: weekAgo } };
      case "acted":
        return { organizationId: org.id, status: "ACTED" as const };
      case "dismissed":
        return { organizationId: org.id, status: "DISMISSED" as const };
      default:
        return { organizationId: org.id };
    }
  })();

  const [signalRows, newThisWeekCount, allCount, actedCount, dismissedCount] = await Promise.all([
    prisma.clientSignal.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      take: 100,
      select: {
        id: true,
        externalUrl: true,
        jobTitle: true,
        location: true,
        detectedAt: true,
        status: true,
        client: {
          select: {
            id: true,
            name: true,
            contacts: {
              orderBy: { lastActivityAt: "desc" },
              take: 1,
              select: {
                name: true,
                firstName: true,
                lastName: true,
                emails: true,
                currentDesignation: true,
              },
            },
          },
        },
      },
    }),
    prisma.clientSignal.count({
      where: { organizationId: org.id, status: "NEW", detectedAt: { gte: weekAgo } },
    }),
    prisma.clientSignal.count({ where: { organizationId: org.id } }),
    prisma.clientSignal.count({ where: { organizationId: org.id, status: "ACTED" } }),
    prisma.clientSignal.count({ where: { organizationId: org.id, status: "DISMISSED" } }),
  ]);

  // Pre-format every date-derived string here so the row component
  // receives only plain strings — never a Date object — and the SSR
  // output cannot drift from the RSC payload.
  const signals = signalRows.map((s) => ({
    id: s.id,
    clientName: s.client?.name ?? "Unknown client",
    primaryContact: formatContact(s.client?.contacts[0] ?? null),
    jobTitle: s.jobTitle,
    location: s.location,
    postedLabel: formatDaysAgo(s.detectedAt, nowMs),
    externalUrl: s.externalUrl,
    status: s.status,
  }));

  const tabs: ReadonlyArray<TabStripItem<Filter>> = [
    { id: "all", label: "All", count: allCount, href: "/bd/client-signal" },
    {
      id: "new-week",
      label: "New this week",
      count: newThisWeekCount,
      href: "/bd/client-signal?filter=new-week",
    },
    { id: "acted", label: "Acted on", count: actedCount, href: "/bd/client-signal?filter=acted" },
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
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-serif text-xl font-bold tracking-tight text-court-fg">
            Existing clients hiring publicly
          </h2>
          <span className="inline-flex items-center rounded-full border border-court-brand/30 bg-court-brand-tint px-2.5 py-0.5 text-[11px] font-semibold text-court-brand-dark">
            {newThisWeekCount} new this week
          </span>
        </div>
        <p className="max-w-2xl text-sm text-court-fg-muted">
          Daily Indeed scan flags clients posting publicly. That usually means they aren&apos;t
          filling it internally, so reach out before someone else does.
        </p>
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
      <p className="text-sm font-semibold text-court-fg">No new client job postings detected.</p>
      <p className="mt-1 text-sm text-court-fg-muted">We scan every morning at 6 AM.</p>
    </div>
  );
}

type ContactSummary = {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  emails: string[];
  currentDesignation: string | null;
};

function SignalRow({
  clientName,
  primaryContact,
  jobTitle,
  location,
  postedLabel,
  externalUrl,
  status,
}: {
  clientName: string;
  primaryContact: string | null;
  jobTitle: string | null;
  location: string | null;
  postedLabel: string;
  externalUrl: string;
  status: "NEW" | "ACTED" | "DISMISSED";
}) {
  const reachedOut = status !== "NEW";
  return (
    <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_auto] sm:items-center sm:p-5">
      <div className="flex items-center gap-3">
        <LogoMark name={clientName} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-court-fg">{clientName}</p>
          <p className="truncate text-xs text-court-fg-muted">
            {primaryContact ?? "No primary contact on file"}
          </p>
        </div>
      </div>

      <div className="min-w-0 text-sm">
        <p className="truncate font-medium text-court-fg">{jobTitle ?? "Untitled posting"}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-court-fg-muted">
          {location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {location}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> Posted {postedLabel} · via Indeed
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg shadow-sm transition hover:bg-court-surface-subtle"
        >
          <ExternalLink className="h-3.5 w-3.5" /> View listing
        </a>
        <button
          type="button"
          disabled
          title="Mail composer pre-fill ships in Phase 4"
          className={cn(
            "inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-court-brand bg-court-brand-tint px-3.5 py-1.5 text-xs font-semibold text-court-brand-dark opacity-60",
          )}
        >
          <Mail className="h-3.5 w-3.5" />
          {reachedOut ? "Reached out" : "Reach out"}
        </button>
      </div>
    </div>
  );
}

function LogoMark({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-court-fg font-mono text-xs font-bold tracking-wider text-court-surface"
      aria-hidden="true"
    >
      {initials || "?"}
    </span>
  );
}

function formatContact(c: ContactSummary | null): string | null {
  if (!c) return null;
  const name = c.name?.trim() || [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  const email = c.emails[0]?.trim();
  const title = c.currentDesignation?.trim();
  const parts = [name, title, email].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
