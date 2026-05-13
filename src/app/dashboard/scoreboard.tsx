import {
  ArrowUpRight,
  CalendarRange,
  Clock,
  Trophy,
} from "lucide-react";
import {
  formatMoneyShort,
  formatPeriodRange,
  getScoreboardData,
} from "@/app/dashboard/scoreboard-data";
import {
  ClientDrilldownTrigger,
  RoleDrilldownTrigger,
} from "@/app/dashboard/scoreboard-drilldowns";
import { SectionHero } from "@/components/section-hero";

// Top-level Scoreboard server component. Real Neon data only; sections
// that need data we don't yet track (sparklines, win-rate trend,
// Billed/Collected forecast, stalled-deal stage timers) render honest
// empty/placeholder states rather than mock numbers.
export async function Scoreboard() {
  const data = await getScoreboardData();

  return (
    <div className="flex flex-col gap-8">
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
    <SectionHero
      eyebrow="SCOREBOARD"
      title="The numbers that matter."
      description="Deal flow, forecast, and where the desk is winning. Everything here is live activity — no targets, just actuals."
      trailing={
        <div className="inline-flex items-center gap-2 rounded-full border border-court-border bg-court-surface px-3.5 py-1.5 text-sm font-medium text-court-fg">
          <CalendarRange className="h-4 w-4 text-court-fg-muted" />
          {periodLabel}
          <span className="text-[11px] text-court-fg-muted">· {periodRange}</span>
        </div>
      }
    />
  );
}

type Kpis = Awaited<ReturnType<typeof getScoreboardData>>["kpis"];

function KpiRow({ kpis }: { kpis: Kpis }) {
  // When there are open deals but every one has a null/zero fee, the
  // dashboard would otherwise read "$0 · Active offers + pending starts"
  // and hide the gap. Surface the count + "fee unset" instead so the
  // missing data is obvious enough to act on.
  const pipelineFeeMissing = kpis.pipelineValueUsd == null && kpis.pipelineCount > 0;
  const pipelineSub = pipelineFeeMissing
    ? `${kpis.pipelineCount} ${kpis.pipelineCount === 1 ? "deal" : "deals"} · fee unset`
    : "Active offers + pending starts";
  const tiles: Array<{ label: string; value: string; sub: string }> = [
    {
      label: "Pipeline Value",
      value: kpis.pipelineValueUsd != null ? formatMoneyShort(kpis.pipelineValueUsd) : "—",
      sub: pipelineSub,
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
      label: "Avg Days to Fill",
      value: kpis.avgDaysToFill != null ? `${kpis.avgDaysToFill}d` : "—",
      sub:
        kpis.avgDaysToFill != null
          ? "Avg, job posted → placed (90d)"
          : "No placements in last 90 days",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <KpiTile key={t.label} {...t} />
      ))}
    </div>
  );
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  // Compact slim-bar variant of the Clubhouse KpiTile chrome —
  // borderless, soft long-shadow, 9px extrabold label, 20px serif value
  // so the five tiles read as a single dense top strip on the Scoreboard.
  const isEmpty = value === "—";
  return (
    <div className="flex h-full flex-col rounded-2xl bg-court-surface px-3 py-2 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_8px_20px_rgba(16,36,24,0.03)]">
      <p className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-court-fg-muted">{label}</p>
      <div
        className={
          "mt-1.5 text-center font-serif text-[20px] font-semibold leading-none tracking-[-0.04em] tabular-nums " +
          (isEmpty ? "text-court-fg-dim" : "text-court-fg")
        }
      >
        {value}
      </div>
      <p className="mt-1 truncate text-center text-[9px] text-court-fg-muted">{sub}</p>
    </div>
  );
}

type Funnel = Awaited<ReturnType<typeof getScoreboardData>>["funnel"];

function FunnelCard({ funnel }: { funnel: Funnel }) {
  const stages = [
    { name: "Submitted", n: funnel.submitted },
    { name: "Interview", n: funnel.interview },
    { name: "Offer", n: funnel.offer },
    { name: "Placed", n: funnel.placed },
  ];
  const top = stages[0].n;
  // Scale every bar against the largest stage value so the widest stage
  // always reads as 100%. Interview can exceed Submitted (multi-interview
  // candidates), so anchoring to Submitted alone overflowed the row.
  const maxStage = stages.reduce((m, s) => Math.max(m, s.n), 0);
  // Submitted → Interview reads as `submitted / interview` so the funnel
  // top line matches the bar order; with multiple interviews per
  // candidate the raw interview count can exceed submits, so the literal
  // pair is the only honest reading. Interview Coverage below caps each
  // candidate at 1 to surface the conversion rate cleanly.
  const ratios = [
    {
      label: "Submitted → Interview",
      num: funnel.submitted,
      den: funnel.interview,
    },
    {
      label: "Interview → Offer",
      num: funnel.offer,
      den: funnel.interview,
    },
    {
      label: "Offer → Placed",
      num: funnel.placed,
      den: funnel.offer,
    },
  ];
  return (
    <div className="rounded-3xl bg-court-surface p-4 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)] lg:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">Deal Funnel</p>
          <h3 className="mt-1 font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">Submitted → Placed</h3>
          <p className="text-xs text-court-fg-muted">Activity through each gate, last 90 days.</p>
        </div>
      </div>
      {top === 0 ? (
        <EmptyBlock>No submit activity logged in the last 90 days yet.</EmptyBlock>
      ) : (
        <>
          <div className="mt-4 space-y-2">
            {stages.map((s) => {
              const widthPct = maxStage > 0 ? (s.n / maxStage) * 100 : 0;
              return (
                <div
                  key={s.name}
                  className="relative overflow-hidden rounded-lg bg-court-surface-subtle"
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-court-brand-tint"
                    style={{ width: `${widthPct}%` }}
                  />
                  <div className="relative flex items-center justify-between px-3 py-2">
                    <span className="text-sm text-court-fg">{s.name}</span>
                    <span className="text-sm font-semibold tabular-nums text-court-fg">
                      {s.n}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ratios.map((r) => (
              <RatioTile key={r.label} label={r.label} num={r.num} den={r.den} />
            ))}
            <CoverageTile
              label="Interview Coverage"
              pct={funnel.interviewCoveragePct}
              num={funnel.interviewedUniqueCandidates}
              den={funnel.submittedUniqueCandidates}
            />
          </div>
        </>
      )}
    </div>
  );
}

function RatioTile({ label, num, den }: { label: string; num: number; den: number }) {
  const pct = den > 0 ? Math.round((num / den) * 100) : null;
  const isEmpty = pct == null;
  return (
    <div className="rounded-xl border border-court-border bg-court-surface-subtle/60 px-2 py-1">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-court-fg-muted">
        {label}
      </p>
      <p
        className={
          "mt-0.5 text-sm font-semibold leading-tight tabular-nums " +
          (isEmpty ? "text-court-fg-dim" : "text-court-fg")
        }
      >
        {isEmpty ? "—" : `${pct}%`}
      </p>
      <p className="text-xs tabular-nums text-court-fg-muted">
        {num} / {den}
      </p>
    </div>
  );
}

// Distinct-candidate variant. Each candidate counts at most once toward
// the numerator regardless of how many interviews they had, so the %
// reads as "share of submitted candidates that reached an interview"
// instead of an event-over-event rate.
function CoverageTile({
  label,
  pct,
  num,
  den,
}: {
  label: string;
  pct: number | null;
  num: number;
  den: number;
}) {
  const isEmpty = pct == null;
  return (
    <div className="rounded-xl border border-court-border bg-court-surface-subtle/60 px-2 py-1">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-court-fg-muted">
        {label}
      </p>
      <p
        className={
          "mt-0.5 text-sm font-semibold leading-tight tabular-nums " +
          (isEmpty ? "text-court-fg-dim" : "text-court-fg")
        }
      >
        {isEmpty ? "—" : `${pct}%`}
      </p>
      <p className="text-xs tabular-nums text-court-fg-muted">
        {num} of {den} candidates
      </p>
    </div>
  );
}

type Cash = Awaited<ReturnType<typeof getScoreboardData>>["cashForecast"];

function CashForecastCard({ cash }: { cash: Cash }) {
  // Bar widths show each row's share of the largest cash bucket so the
  // four lines compare visually instead of all reading full-width.
  const maxAmount = Math.max(
    cash.pendingStartUsd,
    cash.billedUsd,
    cash.collectedUsd,
    0,
  );
  const widthPct = (amount: number) =>
    maxAmount > 0 ? Math.max(8, Math.round((amount / maxAmount) * 100)) : 0;
  return (
    <div className="rounded-3xl bg-court-surface p-4 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">Cash Forecast</p>
      <h3 className="mt-1 font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">Pipeline → Bank</h3>
      <p className="text-xs text-court-fg-muted">What&apos;s expected to land where.</p>
      <div className="mt-3 space-y-2">
        <ForecastRow
          label="Pending Start"
          amount={cash.pendingStartCount > 0 ? formatMoneyShort(cash.pendingStartUsd) : "—"}
          hint={cash.pendingStartCount > 0 ? `${cash.pendingStartCount} placement${cash.pendingStartCount === 1 ? "" : "s"}` : "No pending starts"}
          pct={cash.pendingStartCount > 0 ? widthPct(cash.pendingStartUsd) : 0}
          accent="bg-court-brand"
        />
        <ForecastRow
          label="Billed"
          amount={cash.billedUsd > 0 ? formatMoneyShort(cash.billedUsd) : "—"}
          hint="Fees on Q2 placements (Pending Start + Hired)"
          pct={widthPct(cash.billedUsd)}
          accent="bg-court-brand/40"
        />
        <ForecastRow
          label="Collected"
          amount={cash.collectedUsd > 0 ? formatMoneyShort(cash.collectedUsd) : "—"}
          hint="Invoices marked paid this quarter"
          pct={widthPct(cash.collectedUsd)}
          accent="bg-court-brand-dark/60"
        />
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
    <div className="py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-court-fg">{label}</span>
        <span
          className={
            "text-[18px] font-bold leading-none tabular-nums tracking-tight " +
            (isEmpty ? "text-court-fg-dim" : "text-court-fg")
          }
        >
          {amount}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-court-surface-subtle">
        <div className={`h-full rounded-full ${accent}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-court-fg-muted">{hint}</p>
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
        <ul className="mt-3 space-y-1">
          {rows.map((r) => (
            <li key={r.id}>
              <ClientDrilldownTrigger clientId={r.clientId} clientName={r.name}>
                <div className="px-1 py-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-court-fg">{r.name}</div>
                      <div className="truncate text-xs text-court-fg-muted">
                        {r.placements} placement{r.placements === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-semibold tabular-nums tracking-tight text-court-fg">
                      {formatMoneyShort(r.feeUsd)}
                    </div>
                  </div>
                  <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-court-surface-subtle">
                    <div
                      className="h-full rounded-full bg-court-brand"
                      style={{ width: `${maxFee > 0 ? Math.round((r.feeUsd / maxFee) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              </ClientDrilldownTrigger>
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
        <ul className="mt-3 space-y-1">
          {rows.map((r) => (
            <li key={r.title}>
              <RoleDrilldownTrigger roleTitle={r.title}>
                <div className="px-1 py-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-court-fg">{r.title}</div>
                      <div className="truncate text-xs text-court-fg-muted">
                        {r.avgFeeUsd != null ? `Avg fee ${formatMoneyShort(r.avgFeeUsd)}` : "Fee not logged"}
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-semibold tabular-nums text-court-fg">{r.placements}</div>
                  </div>
                  <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-court-surface-subtle">
                    <div
                      className="h-full rounded-full bg-court-brand"
                      style={{ width: `${maxCount > 0 ? Math.round((r.placements / maxCount) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              </RoleDrilldownTrigger>
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
        <ul className="mt-3 space-y-1">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-2.5 py-1.5">
              <span
                className={
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full " +
                  (e.kind === "win"
                    ? "bg-court-brand-tint text-court-brand-dark"
                    : "bg-blue-50 text-blue-700")
                }
              >
                {e.kind === "win" ? <Trophy className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  <span className="font-semibold text-court-fg">{e.candidateName}</span>{" "}
                  <span className="text-court-fg">{e.eventLabel}</span>
                </div>
                <div className="text-xs text-court-fg-muted">
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
    <div className="rounded-3xl bg-court-surface p-4 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <div className="flex items-end justify-between gap-3 py-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">Stalled Deals</p>
          <h3 className="mt-1 font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">Where the desk is stuck</h3>
          <p className="text-xs text-court-fg-muted">Per-stage idle thresholds: Submitted 5d · Interview 10d · Offer 7d.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
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
    <div className="rounded-3xl bg-court-surface p-4 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">{eyebrow}</p>
      <h3 className="mt-1 font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">{title}</h3>
      {children}
    </div>
  );
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-court-border bg-court-surface-subtle px-3 py-4 text-center text-xs text-court-fg-muted">
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
