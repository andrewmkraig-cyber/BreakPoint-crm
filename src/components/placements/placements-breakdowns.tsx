import type {
  PlacementsDashboardRow,
  PlacementsDashboardSourceChannel,
} from "@/lib/placements-dashboard";
import { formatMoneyShort } from "@/lib/placements-map-geo";

// Placements analytics row beneath the ledger: three equal cards —
// "By Industry", "By Source", "Offer to Start". The Revenue by City
// list lives inside the Placement Map card (placements-map-card.tsx).
// The card chrome (rounded-3xl bg-court-surface p-5 shadow) matches the
// rest of the Clubhouse / Placements surfaces. Pure functional view —
// no client state, no network.

const PANEL_CLASS =
  "rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]";

const EYEBROW_CLASS =
  "text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted";

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

// Table rows: always use Deal Funnel row style as the standard pattern
const OFFER_TO_START_BUCKETS = [
  { id: "le14", label: "≤ 14d", min: 0, max: 14 },
  { id: "15to21", label: "15-21d", min: 15, max: 21 },
  { id: "22to30", label: "22-30d", min: 22, max: 30 },
  { id: "gt30", label: "30+d", min: 31, max: Infinity },
] as const;

function safeFee(n: number | null): number {
  return n != null && Number.isFinite(n) && n > 0 ? n : 0;
}

function daysBetween(a: Date, b: Date): number {
  // Calendar-day diff (UTC), not raw timestamp diff. placedAt is a full
  // UTC timestamp (e.g. 2026-05-27T18:00:00Z when the recruiter clicked
  // Record Placement at 2pm ET) but expectedStartDate is parsed from
  // "YYYY-MM-DD" → 2026-05-27T00:00:00Z, so a same-business-day pair
  // previously produced -0.75 days, rounded to -1, and the call-site
  // negative-clamp dropped the row from the ≤14d bucket. Comparing
  // year/month/day in UTC isolates the date portion and makes same-day
  // starts read as 0 (Jennifer Cole 2026-05-27 → counted in ≤14d
  // instead of 0). Cross-midnight-UTC edges (placedAt at 9pm ET =
  // next-day UTC) are caught by the Math.max(0, …) clamp at the call
  // sites — same-day in the recruiter's head, 0 in the bucket.
  const da = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const db = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((db - da) / (1000 * 60 * 60 * 24));
}

export function PlacementsBreakdowns({
  rows,
}: {
  rows: PlacementsDashboardRow[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <ByIndustryCard rows={rows} />
      <BySourceCard rows={rows} />
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

function BySourceCard({ rows }: { rows: PlacementsDashboardRow[] }) {
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
    <BreakdownCard title="By Source" empty={grandTotalCount === 0}>
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
    <div className={PANEL_CLASS}>
      <p className={EYEBROW_CLASS}>{title}</p>
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
    const raw = daysBetween(r.offerAcceptedAt, r.startDate);
    if (!Number.isFinite(raw)) continue;
    // Clamp negatives to 0 — a same-business-day placement that
    // spans UTC midnight (e.g. recorded at 9pm ET, which is next-day
    // UTC, with start date "today" parsed as midnight UTC of the
    // earlier day) reads as -1 here. The recruiter's mental model is
    // "they accepted today, they start today" → 0 days, not "drop the
    // row from the histogram."
    const days = Math.max(0, raw);
    if (!fastest || days < fastest.days) {
      fastest = { name: r.candidateFullName || "Candidate", days, role: r.roleTitle };
    }
  }

  // Offer-to-start histogram bins.
  const bins = OFFER_TO_START_BUCKETS.map((b) => ({ ...b, count: 0 }));
  for (const r of rows) {
    if (!r.offerAcceptedAt || !r.startDate) continue;
    const raw = daysBetween(r.offerAcceptedAt, r.startDate);
    if (!Number.isFinite(raw)) continue;
    // Same clamp as the fastest-fill loop above so same-day starts
    // land in the ≤14d bucket regardless of which UTC date the
    // placedAt timestamp ended up on.
    const days = Math.max(0, raw);
    const bin = bins.find((bk) => days >= bk.min && days <= bk.max);
    if (bin) bin.count += 1;
  }
  const binMax = bins.reduce((m, b) => Math.max(m, b.count), 0);

  return (
    <div className={PANEL_CLASS}>
      <p className={EYEBROW_CLASS}>Offer to Start</p>

      <div className="mt-2.5 space-y-2">
        {bins.map((b) => {
          const widthPct = binMax > 0 ? (b.count / binMax) * 100 : 0;
          const rowClass =
            "relative overflow-hidden rounded-lg bg-court-surface-subtle" +
            (b.count === 0 ? " opacity-40" : "");
          return (
            <div key={b.id} className={rowClass}>
              <div
                className="absolute inset-y-0 left-0 bg-court-brand-tint"
                style={{ width: `${widthPct}%` }}
              />
              <div className="relative flex items-center justify-between px-4 py-2">
                <span className="text-sm text-court-fg">{b.label}</span>
                <span className="text-sm font-semibold tabular-nums text-court-fg">
                  {b.count}
                </span>
              </div>
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

