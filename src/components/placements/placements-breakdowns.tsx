import type {
  PlacementsDashboardRow,
  PlacementsDashboardSourceChannel,
} from "@/lib/placements-dashboard";
import { formatMoneyShort } from "@/lib/placements-map-geo";

// Three breakdown cards rendered as a row under the placement map:
//   1. By Industry — bar list of client industries
//   2. By Sourcing — bar list of candidate source channels
//   3. Offer to Start — offer-to-start histogram + fastest-fill mini
//
// Pure functional view over the same PlacementsDashboardRow[] the rest
// of the tab consumes — no client state, no network. Bucket maths sit
// in this file rather than in the data layer because they're all
// dashboard-shape concerns the data layer shouldn't own.

const SOURCE_LABEL: Record<PlacementsDashboardSourceChannel, string> = {
  NETWORK: "Network",
  REFERRAL: "Referral",
  LINKEDIN: "LinkedIn",
  INBOUND: "Inbound",
  OTHER: "Other",
};

const SOURCE_ORDER: PlacementsDashboardSourceChannel[] = [
  "NETWORK",
  "REFERRAL",
  "LINKEDIN",
  "INBOUND",
  "OTHER",
];

// Bucket fills use the same Court Mode tokens the Scoreboard uses for its
// Cash Forecast bars: brand green for "on track", softened green for the
// slightly-slower bucket, then amber/red tints for the bad buckets. No
// hardcoded hex — keeps theme switching consistent with the rest of the
// dashboard.
const OFFER_TO_START_BUCKETS = [
  { id: "le14", label: "≤ 14d", fillClass: "bg-court-brand", min: 0, max: 14 },
  { id: "15to21", label: "15-21d", fillClass: "bg-court-brand/60", min: 15, max: 21 },
  { id: "22to30", label: "22-30d", fillClass: "bg-amber-300", min: 22, max: 30 },
  { id: "gt30", label: "30+d", fillClass: "bg-red-300", min: 31, max: Infinity },
] as const;

function safeFee(n: number | null): number {
  return n != null && Number.isFinite(n) && n > 0 ? n : 0;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function PlacementsBreakdowns({ rows }: { rows: PlacementsDashboardRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <ByIndustryCard rows={rows} />
      <BySourcingCard rows={rows} />
      <OfferToStartCard rows={rows} />
    </div>
  );
}

type BarRow = { key: string; label: string; count: number; total: number };

function aggregateBy(
  rows: PlacementsDashboardRow[],
  keyFn: (r: PlacementsDashboardRow) => { key: string; label: string },
): BarRow[] {
  const buckets = new Map<string, BarRow>();
  for (const r of rows) {
    const { key, label } = keyFn(r);
    let b = buckets.get(key);
    if (!b) {
      b = { key, label, count: 0, total: 0 };
      buckets.set(key, b);
    }
    b.count += 1;
    b.total += safeFee(r.feeAmount);
  }
  const out: BarRow[] = [];
  buckets.forEach((b) => out.push(b));
  out.sort((a, b) => b.total - a.total || b.count - a.count);
  return out;
}

function ByIndustryCard({ rows }: { rows: PlacementsDashboardRow[] }) {
  const bars = aggregateBy(rows, (r) => {
    const label = r.clientIndustry?.trim() || "Unspecified";
    return { key: label.toLowerCase(), label };
  });
  const grandTotalFee = bars.reduce((s, b) => s + b.total, 0);
  const grandTotalCount = bars.reduce((s, b) => s + b.count, 0);
  return (
    <BreakdownCard title="By Industry" empty={bars.length === 0}>
      <BarList bars={bars} grandTotalFee={grandTotalFee} grandTotalCount={grandTotalCount} />
    </BreakdownCard>
  );
}

function BySourcingCard({ rows }: { rows: PlacementsDashboardRow[] }) {
  // Force every known channel to render even when empty so the user
  // sees the full set of sourcing buckets at a glance — a missing
  // channel reads as "no placements from there yet," which is signal.
  const buckets = new Map<string, BarRow>();
  for (const ch of SOURCE_ORDER) {
    buckets.set(ch, { key: ch, label: SOURCE_LABEL[ch], count: 0, total: 0 });
  }
  for (const r of rows) {
    const b = buckets.get(r.sourceChannel);
    if (!b) continue;
    b.count += 1;
    b.total += safeFee(r.feeAmount);
  }
  const bars: BarRow[] = SOURCE_ORDER.map((ch) => buckets.get(ch)!);
  const grandTotalFee = bars.reduce((s, b) => s + b.total, 0);
  const grandTotalCount = bars.reduce((s, b) => s + b.count, 0);
  return (
    <BreakdownCard title="By Sourcing" empty={grandTotalCount === 0}>
      <BarList bars={bars} grandTotalFee={grandTotalFee} grandTotalCount={grandTotalCount} />
    </BreakdownCard>
  );
}

function BreakdownCard({
  title,
  children,
  empty,
}: {
  title: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted">
        {title}
      </p>
      <div className="mt-2.5">
        {empty ? (
          <p className="text-sm text-court-fg-muted">
            No placements in this window.
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function BarList({
  bars,
  grandTotalFee,
  grandTotalCount,
}: {
  bars: BarRow[];
  grandTotalFee: number;
  grandTotalCount: number;
}) {
  const maxCount = bars.reduce((m, b) => Math.max(m, b.count), 0);
  return (
    <ul className="flex flex-col gap-2">
      {bars.map((b) => {
        const pct =
          grandTotalFee > 0
            ? Math.round((b.total / grandTotalFee) * 100)
            : grandTotalCount > 0
              ? Math.round((b.count / grandTotalCount) * 100)
              : 0;
        const barWidth = maxCount > 0 ? Math.round((b.count / maxCount) * 100) : 0;
        return (
          <li key={b.key} className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="truncate font-medium text-court-fg">{b.label}</span>
              <span className="shrink-0 tabular-nums text-court-fg-muted">
                {b.count} · {b.total > 0 ? formatMoneyShort(b.total) : "—"} ·{" "}
                <span className="font-semibold text-court-fg">{pct}%</span>
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-court-surface-subtle">
              <div
                className="h-full rounded-full bg-court-brand"
                style={{ width: `${barWidth}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function OfferToStartCard({ rows }: { rows: PlacementsDashboardRow[] }) {
  // Fastest fill: smallest offer-to-start gap across the period.
  let fastest: { name: string; days: number; role: string | null } | null = null;
  for (const r of rows) {
    if (!r.offerAcceptedAt || !r.startDate) continue;
    const days = daysBetween(r.offerAcceptedAt, r.startDate);
    if (!Number.isFinite(days) || days < 0) continue;
    if (!fastest || days < fastest.days) {
      fastest = { name: r.candidateFullName || "Candidate", days, role: r.roleTitle };
    }
  }

  // Offer-to-start histogram bins.
  const bins = OFFER_TO_START_BUCKETS.map((b) => ({ ...b, count: 0 }));
  for (const r of rows) {
    if (!r.offerAcceptedAt || !r.startDate) continue;
    const days = daysBetween(r.offerAcceptedAt, r.startDate);
    if (!Number.isFinite(days) || days < 0) continue;
    const bin = bins.find((bk) => days >= bk.min && days <= bk.max);
    if (bin) bin.count += 1;
  }
  const binMax = bins.reduce((m, b) => Math.max(m, b.count), 0);

  return (
    <div className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted">
        Offer to Start
      </p>

      <div className="mt-2.5 flex items-end gap-2">
        {bins.map((b) => {
          // Scale each bin proportionally against the tallest bin. A zero
          // bin renders an empty track only — no floor — so a single
          // outlier doesn't make small bins look bigger than they are.
          const fillHeight = binMax > 0 ? `${(b.count / binMax) * 100}%` : "0%";
          return (
            <div key={b.id} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[11px] font-semibold tabular-nums text-court-fg">
                {b.count}
              </span>
              <div className="relative h-12 w-full overflow-hidden rounded-md bg-court-surface-subtle">
                <div
                  className={`absolute inset-x-0 bottom-0 rounded-md ${b.fillClass}`}
                  style={{ height: fillHeight }}
                />
              </div>
              <span className="text-[10px] uppercase tracking-wide text-court-fg-muted">
                {b.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <MiniCard
          label="Fastest fill"
          value={fastest ? `${fastest.days}d` : "—"}
          sub={
            fastest
              ? `${fastest.name}${fastest.role ? ` · ${fastest.role}` : ""}`
              : "Offer + start dates not yet captured"
          }
        />
      </div>
    </div>
  );
}

function MiniCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  const isEmpty = value === "—";
  return (
    <div className="rounded-xl border border-court-border bg-court-surface-subtle/60 px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-court-fg-muted">
        {label}
      </p>
      <p
        className={
          "mt-1 font-sans text-lg font-extrabold leading-none tracking-tight tabular-nums " +
          (isEmpty ? "text-court-fg-dim" : "text-court-fg")
        }
      >
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-court-fg-muted">{sub}</p>
    </div>
  );
}
