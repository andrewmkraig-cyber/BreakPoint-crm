import Link from "next/link";
import {
  CheckCircle2,
  Send,
  Reply,
  AlertCircle,
  UserMinus,
  Pause,
  Play,
  Eye,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { TabStrip, type TabStripItem } from "@/components/ui/tab-strip";
import { cn } from "@/lib/utils";
import { bucketForOccurredAt, formatBdDateTime, formatBdTime, type DayBucket } from "../date-format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Filter = "all" | "sends" | "replies" | "bounces" | "domains";

const FILTER_IDS: ReadonlyArray<Filter> = ["all", "sends", "replies", "bounces", "domains"];

const FILTER_KINDS: Record<Filter, ReadonlyArray<BDKind> | null> = {
  all: null,
  sends: ["ENROLL"],
  replies: ["REPLY"],
  bounces: ["BOUNCE"],
  domains: ["DOMAIN_COOLED", "DOMAIN_RESUMED"],
};

type BDKind =
  | "SCAN_COMPLETE"
  | "ENRICH"
  | "ENROLL"
  | "OPEN"
  | "REPLY"
  | "BOUNCE"
  | "UNSUB"
  | "DOMAIN_COOLED"
  | "DOMAIN_RESUMED";

function resolveFilter(raw: string | undefined): Filter {
  return FILTER_IDS.includes(raw as Filter) ? (raw as Filter) : "all";
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams?: { filter?: string; before?: string };
}) {
  const org = await getCurrentOrg();
  const filter = resolveFilter(searchParams?.filter);
  const before = searchParams?.before ? new Date(searchParams.before) : null;
  const kindFilter = FILTER_KINDS[filter];
  const nowMs = Date.now();

  const where = {
    organizationId: org.id,
    ...(kindFilter ? { kind: { in: [...kindFilter] } } : {}),
    ...(before && !Number.isNaN(before.getTime()) ? { occurredAt: { lt: before } } : {}),
  };

  // Pull PAGE_SIZE+1 so we know whether to render a Load earlier pill
  // without a second query. The +1 is dropped before rendering.
  const rawRows = await prisma.bDActivity.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      kind: true,
      metadata: true,
      occurredAt: true,
    },
  });
  const hasMore = rawRows.length > PAGE_SIZE;
  const visibleRaw = hasMore ? rawRows.slice(0, PAGE_SIZE) : rawRows;
  const oldestVisible = visibleRaw[visibleRaw.length - 1];

  // Pre-format every per-row string here so the row component receives
  // plain strings only. Date math + Intl formatting all happens in one
  // place against the single `nowMs` reference.
  const visible = visibleRaw.map((r) => {
    const kind = r.kind as BDKind;
    const meta = r.metadata as Record<string, unknown> | null;
    return {
      id: r.id,
      kind,
      bucket: bucketForOccurredAt(r.occurredAt, nowMs),
      text: formatEvent(kind, meta),
      timeIso: r.occurredAt.toISOString(),
      timeLabel: formatBdTime(r.occurredAt),
      titleLabel: formatBdDateTime(r.occurredAt),
    };
  });

  const tabs: ReadonlyArray<TabStripItem<Filter>> = [
    { id: "all", label: "All", href: "/bd/activity" },
    { id: "sends", label: "Sends", href: "/bd/activity?filter=sends" },
    { id: "replies", label: "Replies", href: "/bd/activity?filter=replies" },
    { id: "bounces", label: "Bounces", href: "/bd/activity?filter=bounces" },
    { id: "domains", label: "Domains", href: "/bd/activity?filter=domains" },
  ];

  const grouped = groupByBucket(visible);

  return (
    <section className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          Activity
        </p>
      </header>

      <TabStrip<Filter> items={tabs} activeId={filter} ariaLabel="Activity filters" />

      {visible.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map((bucket) => (
            <div key={bucket.label}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-court-fg-dim">
                {bucket.label}
              </p>
              <ul className="divide-y divide-court-border rounded-2xl border border-court-border bg-court-surface shadow-sm">
                {bucket.entries.map((row) => (
                  <ActivityRow key={row.id} {...row} />
                ))}
              </ul>
            </div>
          ))}
          {hasMore && oldestVisible && (
            <div className="flex justify-center">
              <Link
                href={`/bd/activity?${new URLSearchParams({
                  ...(filter !== "all" ? { filter } : {}),
                  before: oldestVisible.occurredAt.toISOString(),
                }).toString()}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3.5 py-1.5 text-xs font-medium text-court-fg shadow-sm transition hover:bg-court-surface-subtle"
              >
                Load earlier activity
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-court-border bg-court-surface-subtle p-10 text-center">
      <p className="text-sm font-semibold text-court-fg">No activity yet</p>
      <p className="mt-1 text-sm text-court-fg-muted">
        Will populate once contacts are enrolled and emails start sending.
      </p>
    </div>
  );
}

type GlyphTone = "reply" | "send" | "info" | "warn" | "bounce";

const GLYPHS: Record<BDKind, { icon: LucideIcon; tone: GlyphTone }> = {
  SCAN_COMPLETE: { icon: CheckCircle2, tone: "info" },
  ENRICH: { icon: Sparkles, tone: "info" },
  ENROLL: { icon: Send, tone: "send" },
  OPEN: { icon: Eye, tone: "info" },
  REPLY: { icon: Reply, tone: "reply" },
  BOUNCE: { icon: AlertCircle, tone: "bounce" },
  UNSUB: { icon: UserMinus, tone: "warn" },
  DOMAIN_COOLED: { icon: Pause, tone: "warn" },
  DOMAIN_RESUMED: { icon: Play, tone: "info" },
};

const TONE_CLASS: Record<GlyphTone, string> = {
  reply: "bg-court-brand-tint text-court-brand-dark",
  send: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200",
  info: "bg-court-surface-subtle text-court-fg-muted",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
  bounce: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200",
};

function ActivityRow({
  kind,
  text,
  timeIso,
  timeLabel,
  titleLabel,
}: {
  kind: BDKind;
  text: string;
  timeIso: string;
  timeLabel: string;
  titleLabel: string;
}) {
  const cfg = GLYPHS[kind] ?? { icon: CheckCircle2, tone: "info" as GlyphTone };
  const Icon = cfg.icon;
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <span
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
          TONE_CLASS[cfg.tone],
        )}
        aria-hidden="true"
      >
        <Icon className="h-3 w-3" />
      </span>
      <p className="min-w-0 flex-1 truncate text-sm text-court-fg">{text}</p>
      <time
        dateTime={timeIso}
        className="shrink-0 text-xs tabular-nums text-court-fg-muted"
        title={titleLabel}
      >
        {timeLabel}
      </time>
    </li>
  );
}

function formatEvent(kind: BDKind, m: Record<string, unknown> | null): string {
  const s = (k: string): string | null => {
    const v = m?.[k];
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  const n = (k: string): number | null => {
    const v = m?.[k];
    return typeof v === "number" ? v : null;
  };
  switch (kind) {
    case "SCAN_COMPLETE": {
      const c = n("companies");
      return c == null ? "Indeed scan complete" : `Indeed scan complete · ${c} companies`;
    }
    case "ENRICH": {
      const c = n("contacts");
      return c == null ? "Apollo enrichment finished" : `Apollo enriched ${c} contacts`;
    }
    case "ENROLL": {
      const c = n("contacts");
      const co = s("company");
      if (c != null && co) return `Enrolled ${c} contacts at ${co}`;
      if (c != null) return `Enrolled ${c} contacts`;
      if (co) return `Enrolled contacts at ${co}`;
      return "Enrolled contacts";
    }
    case "OPEN": {
      const who = s("contactName") ?? s("email");
      return who ? `Open from ${who}` : "Email opened";
    }
    case "REPLY": {
      const who = s("contactName") ?? s("email");
      const co = s("company");
      if (who && co) return `Reply from ${who} at ${co}`;
      if (who) return `Reply from ${who}`;
      return "Reply received";
    }
    case "BOUNCE": {
      const who = s("email");
      return who ? `Bounce on ${who}` : "Bounce";
    }
    case "UNSUB": {
      const who = s("email") ?? s("contactName");
      return who ? `${who} unsubscribed` : "Unsubscribe";
    }
    case "DOMAIN_COOLED": {
      const d = s("domain");
      const reason = s("reason");
      if (d && reason) return `${d} cooled (${reason})`;
      if (d) return `${d} cooled`;
      return "Domain cooled";
    }
    case "DOMAIN_RESUMED": {
      const d = s("domain");
      return d ? `${d} resumed` : "Domain resumed";
    }
  }
}

type BucketRow = {
  id: string;
  kind: BDKind;
  bucket: DayBucket;
  text: string;
  timeIso: string;
  timeLabel: string;
  titleLabel: string;
};

type Bucket = { label: DayBucket; entries: BucketRow[] };

function groupByBucket(rows: ReadonlyArray<BucketRow>): Bucket[] {
  const buckets: Bucket[] = [
    { label: "Today", entries: [] },
    { label: "Yesterday", entries: [] },
    { label: "2 days ago", entries: [] },
    { label: "Older", entries: [] },
  ];
  for (const r of rows) {
    const target = buckets.find((b) => b.label === r.bucket);
    target?.entries.push(r);
  }
  return buckets.filter((b) => b.entries.length > 0);
}
