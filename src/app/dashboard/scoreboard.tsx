import {
  ArrowUpRight,
  Clock,
  DollarSign,
  Target,
  TrendingUp,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  formatMoneyShort,
  getScoreboardData,
} from "@/app/dashboard/scoreboard-data";
import {
  ClientDrilldownTrigger,
  RoleDrilldownTrigger,
} from "@/app/dashboard/scoreboard-drilldowns";
import { PeriodTabs } from "@/app/dashboard/period-tabs";
import type { DashboardPeriod } from "@/app/dashboard/period-tabs-shared";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { GoalPacingCard, getGoalPacingData } from "@/app/dashboard/goal-pacing";

// Top-level Scoreboard server component. Real Neon data only; sections
// that need data we don't yet track (sparklines, win-rate trend,
// Billed/Collected forecast, stalled-deal stage timers) render honest
// empty/placeholder states rather than mock numbers.
export async function Scoreboard({
  period = "THIS_QUARTER",
}: {
  period?: DashboardPeriod;
} = {}) {
  const org = await getCurrentOrg();
  const [data, goalPacing] = await Promise.all([
    getScoreboardData(period),
    getGoalPacingData(org.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          DEAL FLOW &amp; FORECAST
        </p>
        <PeriodTabs period={period} />
      </div>
      <KpiRow kpis={data.kpis} periodLabel={data.period.label} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <FunnelCard funnel={data.funnel} />
        <CashForecastCard cash={data.cashForecast} />
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        <TopClientsCard rows={data.topClients} />
        <TopRolesCard rows={data.topRoles} />
        <MomentumCard events={data.momentum} />
      </div>
      <GoalPacingCard data={goalPacing} />
    </div>
  );
}

type Kpis = Awaited<ReturnType<typeof getScoreboardData>>["kpis"];

function KpiRow({ kpis, periodLabel }: { kpis: Kpis; periodLabel: string }) {
  // When there are open deals but every one has a null/zero fee, the
  // dashboard would otherwise read "$0 · Active offers + pending starts"
  // and hide the gap. Surface the count + "fee unset" instead so the
  // missing data is obvious enough to act on.
  const pipelineFeeMissing = kpis.pipelineValueUsd == null && kpis.pipelineCount > 0;
  const pipelineSub = pipelineFeeMissing
    ? `${kpis.pipelineCount} ${kpis.pipelineCount === 1 ? "deal" : "deals"} · fee unset`
    : "Active offers + pending starts";
  const tiles: Array<{ label: string; value: string; sub: string; icon: LucideIcon }> = [
    {
      label: "Pipeline Value",
      value: kpis.pipelineValueUsd != null ? formatMoneyShort(kpis.pipelineValueUsd) : "—",
      sub: pipelineSub,
      icon: TrendingUp,
    },
    {
      label: "Avg Fee Size",
      value: kpis.avgFeeSizeUsd != null ? formatMoneyShort(kpis.avgFeeSizeUsd) : "—",
      sub: kpis.avgFeeSizeUsd != null ? "Per placement, last 90 days" : "No placements in last 90 days",
      icon: DollarSign,
    },
    {
      label: "Placements",
      value: String(kpis.placementsQtd),
      sub: periodLabel,
      icon: Users,
    },
    {
      label: "Win Rate",
      value: kpis.winRatePct != null ? `${kpis.winRatePct}%` : "—",
      sub:
        kpis.winRatePct != null
          ? `${kpis.winRateNumerator} placed · ${kpis.winRateDenominator} submitted (90d)`
          : "No submits logged in last 90 days",
      icon: Target,
    },
    {
      label: "Avg Days to Fill",
      value: kpis.avgDaysToFill != null ? `${kpis.avgDaysToFill}d` : "—",
      sub:
        kpis.avgDaysToFill != null
          ? "Avg, job posted → placed (90d)"
          : "No placements in last 90 days",
      icon: Clock,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <ScoreboardKpiTile key={t.label} {...t} />
      ))}
    </div>
  );
}

function ScoreboardKpiTile({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
}) {
  const isEmpty = value === "—";
  return (
    <div
      title={sub}
      // Mobile (base): 2-col Jobot/Jax card style — icon alone top-left,
      // value centered, label below value, sub-caption at bottom. sm+
      // restores the canonical icon+label-in-a-row over centered value
      // chrome so desktop reads as the same family as KpiTile.
      className="flex h-full min-h-0 flex-col rounded-2xl bg-court-surface px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)] sm:min-h-[84px] sm:py-2.5"
    >
      <div className="flex items-center gap-2">
        <div
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-court-brand-tint text-court-brand-dark"
          aria-hidden
        >
          <Icon className="h-3 w-3" />
        </div>
        {/* Desktop: label inline with icon. Hidden on mobile so the icon
            sits alone in the top-left corner per the Jobot card style. */}
        <p className="hidden min-w-0 flex-1 text-[10px] font-extrabold uppercase tracking-wide text-court-fg-muted sm:block">
          {label}
        </p>
      </div>
      <div
        className={
          "mt-2 text-center font-serif text-[26px] font-bold leading-none tracking-[-0.04em] tabular-nums sm:mt-1.5 " +
          (isEmpty ? "text-court-fg-dim" : "text-court-fg")
        }
      >
        {value}
      </div>
      {/* Mobile-only: label below value in smaller text. Hidden on
          desktop where it lives next to the icon above. */}
      <p className="mt-1 text-center text-[11px] font-semibold text-court-fg-muted sm:hidden">
        {label}
      </p>
      <div className="mt-1 text-center text-[10px] text-court-fg-dim">
        {sub}
      </div>
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
    <div className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)] lg:col-span-2">
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
    cash.pendingInvoicesUsd,
    cash.billedUsd,
    cash.collectedUsd,
    0,
  );
  const widthPct = (amount: number) =>
    maxAmount > 0 ? Math.max(8, Math.round((amount / maxAmount) * 100)) : 0;
  return (
    <div className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">Cash Forecast</p>
      <h3 className="mt-1 font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">Pipeline → Bank</h3>
      <p className="text-xs text-court-fg-muted">What&apos;s expected to land where.</p>
      <div className="mt-3 space-y-2">
        <ForecastRow
          label="Pending Invoices"
          amount={cash.pendingInvoicesCount > 0 ? formatMoneyShort(cash.pendingInvoicesUsd) : "—"}
          hint={cash.pendingInvoicesCount > 0 ? `${cash.pendingInvoicesCount} invoice${cash.pendingInvoicesCount === 1 ? "" : "s"}` : "No pending invoices"}
          pct={cash.pendingInvoicesCount > 0 ? widthPct(cash.pendingInvoicesUsd) : 0}
          accent="bg-court-brand"
        />
        <ForecastRow
          label="Billed"
          amount={cash.billedUsd > 0 ? formatMoneyShort(cash.billedUsd) : "—"}
          hint="Invoices due this quarter (Sent + Paid)"
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
    <div className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
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
