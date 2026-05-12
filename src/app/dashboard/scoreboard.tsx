import {
  ArrowUpRight,
  CalendarRange,
  Clock,
  Sparkles,
  Trophy,
} from "lucide-react";
import {
  formatMoneyShort,
  formatPeriodRange,
  getScoreboardData,
} from "@/app/dashboard/scoreboard-data";

// Top-level Scoreboard server component. Real Neon data only; sections
// that need data we don't yet track (sparklines, win-rate trend,
// Billed/Collected forecast, stalled-deal stage timers) render honest
// empty/placeholder states rather than mock numbers.
export async function Scoreboard() {
  const data = await getScoreboardData();

  return (
    <div className="flex flex-col gap-7">
      <ScoreboardHeader periodLabel={data.period.label} periodRange={formatPeriodRange(data.period.start, data.period.endExclusive)} />
      <KpiRow kpis={data.kpis} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <FunnelCard funnel={data.funnel} />
        <CashForecastCard cash={data.cashForecast} />
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        <TopClientsCard rows={data.topClients} />
        <TopRolesCard rows={data.topRoles} />
        <MomentumCard events={data.momentum} />
      </div>
      <StalledDealsCard />
    </div>
  );
}

function ScoreboardHeader({ periodLabel, periodRange }: { periodLabel: string; periodRange: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
          Scoreboard
        </p>
        <h2 className="mt-1 font-serif text-2xl font-extrabold tracking-tight text-court-fg sm:text-3xl">
          The numbers that matter
        </h2>
        <p className="mt-1 max-w-xl text-sm text-court-fg-muted">
          Deal flow, forecast, and where the desk is winning. Everything here is live activity — no targets, just actuals.
        </p>
      </div>
      <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-court-border bg-court-surface px-3.5 py-1.5 text-sm font-medium text-court-fg">
        <CalendarRange className="h-4 w-4 text-court-fg-muted" />
        {periodLabel}
        <span className="text-[11px] text-court-fg-muted">· {periodRange}</span>
      </div>
    </div>
  );
}

type Kpis = Awaited<ReturnType<typeof getScoreboardData>>["kpis"];

function KpiRow({ kpis }: { kpis: Kpis }) {
  const tiles: Array<{ label: string; value: string; sub: string }> = [
    {
      label: "Pipeline Value",
      value: kpis.pipelineValueUsd != null ? formatMoneyShort(kpis.pipelineValueUsd) : "—",
      sub: "Active offers + pending starts",
    },
    {
      label: "Avg Fee Size",
      value: kpis.avgFeeSizeUsd != null ? formatMoneyShort(kpis.avgFeeSizeUsd) : "—",
      sub: kpis.avgFeeSizeUsd != null ? "Per placement, last 90 days" : "No placements in last 90 days",
    },
    {
      label: "Placements",
      value: String(kpis.placementsQtd),
      sub: "Q2 to date",
    },
    {
      label: "Win Rate",
      value: kpis.winRatePct != null ? `${kpis.winRatePct}%` : "—",
      sub:
        kpis.winRatePct != null
          ? `${kpis.winRateNumerator} placed · ${kpis.winRateDenominator} submitted (90d)`
          : "No submits logged in last 90 days",
    },
    {
      label: "Time to Fill",
      value: kpis.medianDaysToFill != null ? `${kpis.medianDaysToFill}d` : "—",
      sub: kpis.medianDaysToFill != null ? "Median, created → placed (90d)" : "No placements in last 90 days",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <KpiTile key={t.label} {...t} />
      ))}
    </div>
  );
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  const isEmpty = value === "—";
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-5 shadow-sm transition hover:border-court-brand/40 hover:shadow-md">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">{label}</p>
      <div
        className={
          "mt-2 font-sans text-[clamp(22px,2.6vw,38px)] font-extrabold leading-none tracking-[-0.035em] tabular-nums " +
          (isEmpty ? "text-court-fg-dim" : "text-court-fg")
        }
      >
        {value}
      </div>
      <p className="mt-3 truncate text-[11px] text-court-fg-muted">{sub}</p>
    </div>
  );
}

type Funnel = Awaited<ReturnType<typeof getScoreboardData>>["funnel"];

function FunnelCard({ funnel }: { funnel: Funnel }) {
  const stages = [
    { name: "Submitted", n: funnel.submitted, accent: "bg-court-brand/85" },
    { name: "Interview", n: funnel.interview, accent: "bg-court-brand/70" },
    { name: "Offer", n: funnel.offer, accent: "bg-court-brand-dark/85" },
    { name: "Placed", n: funnel.placed, accent: "bg-court-brand-dark" },
  ];
  const top = stages[0].n;
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-7 shadow-sm lg:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">Deal Funnel</p>
          <h3 className="mt-1 font-serif text-lg font-bold tracking-tight text-court-fg sm:text-xl">Submitted → Placed</h3>
          <p className="text-xs text-court-fg-muted">Activity through each gate, last 90 days.</p>
        </div>
        {top > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-court-brand/30 bg-court-brand-tint px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-court-brand-dark">
            <Sparkles className="h-3 w-3" /> Live
          </span>
        )}
      </div>
      {top === 0 ? (
        <EmptyBlock>No submit activity logged in the last 90 days yet.</EmptyBlock>
      ) : (
        <div className="mt-6 space-y-3">
          {stages.map((s) => {
            const widthPct = top > 0 ? Math.max(8, Math.round((s.n / top) * 100)) : 8;
            return (
              <div key={s.name} className="flex items-center gap-3">
                <div className="w-28 shrink-0 text-[12px] font-medium text-court-fg">{s.name}</div>
                <div
                  className={`flex h-14 items-center rounded-lg px-4 text-white ${s.accent}`}
                  style={{ width: `${widthPct}%`, minWidth: "120px" }}
                >
                  <span className="text-[22px] font-extrabold leading-none tabular-nums tracking-[-0.03em]">
                    {s.n}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type Cash = Awaited<ReturnType<typeof getScoreboardData>>["cashForecast"];

function CashForecastCard({ cash }: { cash: Cash }) {
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-7 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">Cash Forecast</p>
      <h3 className="mt-1 font-serif text-lg font-bold tracking-tight text-court-fg sm:text-xl">Pipeline → Bank</h3>
      <p className="text-xs text-court-fg-muted">What&apos;s expected to land where.</p>
      <div className="mt-5 space-y-4">
        <ForecastRow
          label="Pending Start"
          amount={cash.pendingStartCount > 0 ? formatMoneyShort(cash.pendingStartUsd) : "—"}
          hint={cash.pendingStartCount > 0 ? `${cash.pendingStartCount} placement${cash.pendingStartCount === 1 ? "" : "s"}` : "No pending starts"}
          pct={cash.pendingStartCount > 0 ? 100 : 0}
          accent="bg-court-brand"
        />
        <ForecastRow label="Billed" amount="—" hint="Invoice tracking ships next session" pct={0} accent="bg-court-brand/40" />
        <ForecastRow label="Collected" amount="—" hint="Mercury sync ships next session" pct={0} accent="bg-court-brand-dark/60" />
        <ForecastRow label="Overdue" amount="—" hint="—" pct={0} accent="bg-red-500" />
      </div>
    </div>
  );
}

function ForecastRow({
  label,
  amount,
  hint,
  pct,
  accent,
}: {
  label: string;
  amount: string;
  hint: string;
  pct: number;
  accent: string;
}) {
  const isEmpty = amount === "—";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-court-fg">{label}</span>
        <span
          className={
            "text-base font-bold tabular-nums tracking-tight sm:text-lg " +
            (isEmpty ? "text-court-fg-dim" : "text-court-fg")
          }
        >
          {amount}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-court-surface-subtle">
        <div className={`h-full rounded-full ${accent}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-court-fg-muted">{hint}</p>
    </div>
  );
}

type TopClient = Awaited<ReturnType<typeof getScoreboardData>>["topClients"][number];

function TopClientsCard({ rows }: { rows: TopClient[] }) {
  const maxFee = rows.length > 0 ? rows[0].feeUsd : 0;
  return (
    <ListCard eyebrow="Who&apos;s paying" title="Top Clients · Revenue">
      {rows.length === 0 ? (
        <EmptyBlock>No placements with logged fees yet.</EmptyBlock>
      ) : (
        <ul className="mt-5 space-y-4">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-court-fg">{r.name}</div>
                  <div className="truncate text-[11px] text-court-fg-muted">
                    {r.placements} placement{r.placements === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="shrink-0 text-[17px] font-bold tabular-nums tracking-tight text-court-fg">
                  {formatMoneyShort(r.feeUsd)}
                </div>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-court-surface-subtle">
                <div
                  className="h-full rounded-full bg-court-brand"
                  style={{ width: `${maxFee > 0 ? Math.round((r.feeUsd / maxFee) * 100) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  );
}

type TopRole = Awaited<ReturnType<typeof getScoreboardData>>["topRoles"][number];

function TopRolesCard({ rows }: { rows: TopRole[] }) {
  const maxCount = rows.length > 0 ? rows[0].placements : 0;
  return (
    <ListCard eyebrow="What's working" title="Top Roles · Closed">
      {rows.length === 0 ? (
        <EmptyBlock>No closed roles yet.</EmptyBlock>
      ) : (
        <ul className="mt-5 space-y-4">
          {rows.map((r) => (
            <li key={r.title}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-court-fg">{r.title}</div>
                  <div className="truncate text-[11px] text-court-fg-muted">
                    {r.avgFeeUsd != null ? `Avg fee ${formatMoneyShort(r.avgFeeUsd)}` : "Fee not logged"}
                  </div>
                </div>
                <div className="shrink-0 text-[17px] font-bold tabular-nums text-court-fg">{r.placements}</div>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-court-surface-subtle">
                <div
                  className="h-full rounded-full bg-court-brand"
                  style={{ width: `${maxCount > 0 ? Math.round((r.placements / maxCount) * 100) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  );
}

type MomentumEvent = Awaited<ReturnType<typeof getScoreboardData>>["momentum"][number];

function MomentumCard({ events }: { events: MomentumEvent[] }) {
  return (
    <ListCard eyebrow="Momentum" title="Recent deal moves">
      {events.length === 0 ? (
        <EmptyBlock>Nothing has moved in the last 30 days.</EmptyBlock>
      ) : (
        <ul className="mt-5 space-y-3.5">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-3">
              <span
                className={
                  "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full " +
                  (e.kind === "win"
                    ? "bg-court-brand-tint text-court-brand-dark"
                    : "bg-blue-50 text-blue-700")
                }
              >
                {e.kind === "win" ? <Trophy className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  <span className="font-semibold text-court-fg">{e.candidateName}</span>{" "}
                  <span className="text-court-fg">{e.eventLabel}</span>
                </div>
                <div className="text-[11px] text-court-fg-muted">
                  {e.clientName}
                  {e.clientName ? <span className="mx-1.5 text-court-fg-dim">·</span> : null}
                  {formatRelative(e.eventAt)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  );
}

function StalledDealsCard() {
  // Per CLAUDE.md rule 13, Placement.stage is the canonical truth — but
  // we don't yet stamp stage-change timestamps, so "days in current
  // stage" is unknowable. Render the section title and an honest empty
  // state until that telemetry lands.
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-7 shadow-sm">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">Stalled Deals</p>
          <h3 className="mt-1 font-serif text-lg font-bold tracking-tight text-court-fg sm:text-xl">Where the desk is stuck</h3>
          <p className="text-xs text-court-fg-muted">Per-stage idle thresholds: Submitted 5d · Interview 10d · Offer 7d.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-800">
          <Clock className="h-3 w-3" /> Coming soon
        </span>
      </div>
      <EmptyBlock>
        We don&apos;t yet stamp stage-transition timestamps on placements, so days-in-stage is unknowable today. Lands with the next placement-stage refactor.
      </EmptyBlock>
    </div>
  );
}

function ListCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-7 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">{eyebrow}</p>
      <h3 className="mt-1 font-serif text-lg font-bold tracking-tight text-court-fg sm:text-xl">{title}</h3>
      {children}
    </div>
  );
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 rounded-xl border border-dashed border-court-border bg-court-surface-subtle px-4 py-6 text-center text-[13px] text-court-fg-muted">
      {children}
    </div>
  );
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
