import {
  ArrowUpRight,
  BarChart3,
  Clock,
  DollarSign,
  type LucideIcon,
  Target,
  Trophy,
} from "lucide-react";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import {
  formatMoneyShort,
  getScoreboardData,
} from "@/app/dashboard/scoreboard-data";
import {
  ClientDrilldownTrigger,
  RoleDrilldownTrigger,
} from "@/app/dashboard/scoreboard-drilldowns";
import { PeriodPillToggle } from "@/app/dashboard/period-pill-toggle";
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
    <div className="flex flex-col gap-6 rounded-2xl bg-court-surface-subtle p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          Deal Flow &amp; Forecast
        </p>
        <PeriodPillToggle period={period} />
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
  const pipelineFeeMissing = kpis.pipelineValueUsd == null && kpis.pipelineCount > 0;
  const pipelineSub = pipelineFeeMissing
    ? `${kpis.pipelineCount} ${kpis.pipelineCount === 1 ? "deal" : "deals"} · fee unset`
    : "Active offers + pending starts";
  const tiles: Array<{ label: string; value: string; sub: string; icon: LucideIcon }> = [
    {
      label: "Pipeline Value",
      value: kpis.pipelineValueUsd != null ? formatMoneyShort(kpis.pipelineValueUsd) : "—",
      sub: pipelineSub,
      icon: DollarSign,
    },
    {
      label: "Avg Fee Size",
      value: kpis.avgFeeSizeUsd != null ? formatMoneyShort(kpis.avgFeeSizeUsd) : "—",
      sub: kpis.avgFeeSizeUsd != null ? "Per placement, last 90 days" : "No placements in last 90 days",
      icon: BarChart3,
    },
    {
      label: "Placements",
      value: String(kpis.placementsQtd),
      sub: periodLabel,
      icon: Trophy,
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl shadow-sm">
          <KpiTile
            label={t.label}
            value={t.value}
            icon={t.icon}
            subtext={t.sub}
            zeroDim
          />
        </div>
      ))}
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
  const maxStage = stages.reduce((m, s) => Math.max(m, s.n), 0);
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
    <div className="rounded-2xl border-0 bg-court-surface p-5 shadow-sm lg:col-span-2">
      <SectionHeader
        eyebrow="Deal Funnel"
        title="Submitted → Placed"
        description="Activity through each gate, last 90 days."
      />
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
  const maxAmount = Math.max(
    cash.pendingStartUsd,
    cash.billedUsd,
    cash.collectedUsd,
    0,
  );
  const widthPct = (amount: number) =>
    maxAmount > 0 ? Math.max(8, Math.round((amount / maxAmount) * 100)) : 0;
  return (
    <div className="rounded-2xl border-0 bg-court-surface p-5 shadow-sm">
      <SectionHeader
        eyebrow="Cash Forecast"
        title="Pipeline → Bank"
        description="What's expected to land where."
      />
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
    <ListCard eyebrow="Who's paying" title="Top Clients · Revenue">
      {rows.length === 0 ? (
        <EmptyBlock>No placements with logged fees yet.</EmptyBlock>
      ) : (
        <ul className="mt-4 divide-y divide-court-border-soft">
          {rows.map((r, i) => (
            <li key={r.id}>
              <ClientDrilldownTrigger clientId={r.clientId} clientName={r.name}>
                <LeaderboardRow
                  rank={i + 1}
                  name={r.name}
                  hint={`${r.placements} placement${r.placements === 1 ? "" : "s"}`}
                  value={formatMoneyShort(r.feeUsd)}
                  pct={maxFee > 0 ? Math.round((r.feeUsd / maxFee) * 100) : 0}
                />
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
        <ul className="mt-4 divide-y divide-court-border-soft">
          {rows.map((r, i) => (
            <li key={r.title}>
              <RoleDrilldownTrigger roleTitle={r.title}>
                <LeaderboardRow
                  rank={i + 1}
                  name={r.title}
                  hint={r.avgFeeUsd != null ? `Avg fee ${formatMoneyShort(r.avgFeeUsd)}` : "Fee not logged"}
                  value={String(r.placements)}
                  pct={maxCount > 0 ? Math.round((r.placements / maxCount) * 100) : 0}
                />
              </RoleDrilldownTrigger>
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  );
}

function LeaderboardRow({
  rank,
  name,
  hint,
  value,
  pct,
}: {
  rank: number;
  name: string;
  hint: string;
  value: string;
  pct: number;
}) {
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="w-6 shrink-0 font-mono text-[13px] text-court-fg-muted">
            {rank}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-court-fg">{name}</div>
            <div className="truncate text-[11px] text-court-fg-muted">{hint}</div>
          </div>
        </div>
        <div className="shrink-0 text-right font-bold tabular-nums text-court-fg">
          {value}
        </div>
      </div>
      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-court-surface-subtle">
        <div
          className="h-full rounded-full bg-court-accent"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

type MomentumEvent = Awaited<ReturnType<typeof getScoreboardData>>["momentum"][number];

function MomentumCard({ events }: { events: MomentumEvent[] }) {
  return (
    <div className="rounded-2xl border-0 bg-court-surface p-4 shadow-sm">
      <div className="px-1">
        <SectionHeader eyebrow="Momentum" title="Recent deal moves" />
      </div>
      {events.length === 0 ? (
        <EmptyBlock>Nothing has moved in the last 30 days.</EmptyBlock>
      ) : (
        <ul className="mt-3 divide-y divide-court-border-soft">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-3 py-3">
              <span
                className={
                  "grid h-7 w-7 shrink-0 place-items-center rounded-full " +
                  (e.kind === "win"
                    ? "bg-court-accent-tint text-court-brand-dark"
                    : "bg-blue-50 text-blue-700")
                }
                aria-hidden
              >
                {e.kind === "win" ? <Trophy className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px]">
                  <span className="font-semibold text-court-fg">{e.candidateName}</span>{" "}
                  <span className="text-court-fg-muted">{e.eventLabel}</span>
                </div>
                {e.clientName && (
                  <div className="truncate text-[11px] text-court-fg-muted">
                    {e.clientName}
                  </div>
                )}
              </div>
              <span className="shrink-0 text-right text-[10px] text-court-fg-muted">
                {formatRelative(e.eventAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
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
    <div className="rounded-2xl border-0 bg-court-surface p-5 shadow-sm">
      <SectionHeader eyebrow={eyebrow} title={title} />
      {children}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
        {eyebrow}
      </p>
      <h3 className="font-serif text-[18px] font-bold tracking-tight text-court-fg">
        {title}
      </h3>
      {description && (
        <p className="mt-0.5 text-[12px] text-court-fg-muted">{description}</p>
      )}
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
