import { ExpenseAddForm } from "@/app/dashboard/expense-add-form";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  getMercuryTransactions,
  mercuryTransactionDescription,
} from "@/lib/mercury";
import {
  matchTransaction,
  shouldIgnoreTransaction,
  domainForTool,
} from "@/lib/mercury-matcher";
import {
  SubscriptionsList,
  type RecurringRow,
  type OneTimeRow,
  type MoneyInRow,
} from "@/app/dashboard/subscriptions-list";

const USD_NO_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatUsd(n: number): string {
  return USD_NO_CENTS.format(Math.round(n));
}

function decimalToNumber(d: { toString(): string } | null): number {
  if (d == null) return 0;
  const n = Number(d.toString());
  return Number.isFinite(n) ? n : 0;
}


// The Expenses surface (standalone /expenses page). Revenue &
// Profitability was deleted in Ace 74.0 — its three Revenue cards moved
// to the Placements page (src/components/finances/revenue-cards.tsx) and
// the KPI row + P&L/Margins were removed entirely. This component now
// renders only the Expenses section. It is always calendar-year scoped
// (catalog rows + YTD aggregates, no period selector). The revenue
// invoice query is kept solely to feed ROI-per-tool revenue attribution.
export async function FinancialPerformanceTab() {
  const org = await getCurrentOrg();
  const now = new Date();
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const revStart = yearStart;
  const revEnd = yearEnd;

  // Mercury fetch needs the org's API key, which lives on the
  // Organization row. We chain the key lookup into the upstream call so
  // the network request fires as soon as the key resolves, in parallel
  // with the unrelated prisma queries below.
  const mercuryKeyPromise = prisma.organization
    .findUnique({
      where: { id: org.id },
      select: { mercuryApiKey: true },
    })
    .then((o) => o?.mercuryApiKey ?? null);
  const mercuryTxnsPromise = mercuryKeyPromise.then((key) =>
    key ? getMercuryTransactions(key) : [],
  );

  // One-shot cleanup: an early seed double-recorded the Lone Wolf
  // training fee under both "Lone Wolf Course" and "Training Course".
  // Idempotent deleteMany — does nothing once the duplicate row is
  // gone, so it's safe to leave inline.
  await prisma.toolExpense.deleteMany({
    where: {
      organizationId: org.id,
      name: { contains: "Training Course", mode: "insensitive" },
    },
  });
  // Apollo lives in the annual catalog with its own fallback. Any
  // manual Apollo ToolExpense row is now a duplicate of the catalog
  // entry — strip it so Recurring Annual shows exactly one Apollo row.
  await prisma.toolExpense.deleteMany({
    where: {
      organizationId: org.id,
      name: { contains: "apollo", mode: "insensitive" },
    },
  });

  const [revenueInvoices, mercuryApiKey, mercuryTxnsAll, manualExpenses] =
    await Promise.all([
      // Revenue invoices kept solely to attribute revenue per sourcing
      // tool on the ROI card below (year-scoped to match the YTD read).
      // The deleted Revenue & Profitability surface used to consume this
      // for By Client / By Source / Trend / KPIs; those moved to the
      // Placements page's RevenueCards component, which runs its own query.
      prisma.invoice.findMany({
        where: {
          organizationId: org.id,
          status: { in: ["SENT", "PAID"] },
          OR: [
            { sentAt: { gte: revStart, lt: revEnd } },
            { paidAt: { gte: revStart, lt: revEnd } },
          ],
        },
        select: {
          feeAmount: true,
          placement: { select: { candidateSource: true } },
        },
      }),
      mercuryKeyPromise,
      mercuryTxnsPromise,
      // Manually-entered subscriptions / one-time tool spend from the
      // "Add expense" form. Merged into the same recurring/one-time
      // buckets below so they appear alongside Mercury-matched rows.
      prisma.toolExpense.findMany({
        where: { organizationId: org.id },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  // ---- Expenses section data ----
  // Catalog drives the recurring sections — Mercury matches enrich each
  // catalog row with a Total Paid YTD figure. Any Mercury debit that
  // matches a known tool family but falls outside ±30% of the catalog
  // price drops into the one-time section instead (e.g. OpenPhone has
  // a $35.64 recurring charge plus ad-hoc $1.40 / $19.50 fees, all
  // sharing the "OpenPhone / Quo" matcher name).
  const mercuryConnected = mercuryApiKey != null;
  const mercuryTxns = mercuryTxnsAll.filter((t) => {
    const stamp = t.postedAt ?? t.createdAt;
    if (!stamp) return false;
    return new Date(stamp).getFullYear() === year;
  });

  type RecurringCatalogEntry = {
    displayName: string;
    matcherName: string;
    // What we show in the Cost column (e.g. annual-equivalent for GoDaddy).
    catalogCost: number;
    // The dollar amount Mercury actually charges. Defaults to catalogCost
    // when omitted. GoDaddy bills $46.59 every 3 years but we surface its
    // $15.53/yr annual equivalent, so its match window centers on $46.59.
    matchCost?: number;
    // Absolute min/max for the Mercury match window. When set, overrides
    // the default ±30% band — used for Anthropic Claude Code where
    // post-tax charges land in a $95–$115 corridor we want to catch
    // without widening the band for every other tool.
    matchMin?: number;
    matchMax?: number;
    // Optional muted line under the tool name (e.g. "billed every 3 years").
    subline?: string;
    // Domain used by ExpenseMerchantLogo for the favicon. Falls back to
    // domainForTool(matcherName) when omitted.
    domain?: string;
    // When Mercury never sees this tool (paid via personal card, etc.),
    // fall back to a stated YTD spend so the row doesn't sit at $0.
    fallbackPaidCount?: number;
    fallbackTotalUsd?: number;
  };
  const RECURRING_MONTHLY_CATALOG: RecurringCatalogEntry[] = [
    { displayName: "Pin", matcherName: "Pin", catalogCost: 299, domain: "pin.com" },
    {
      displayName: "Anthropic / Claude Code",
      matcherName: "Anthropic / Claude",
      catalogCost: 100,
      matchMin: 95,
      matchMax: 115,
      domain: "anthropic.com",
    },
    { displayName: "TheirStack", matcherName: "TheirStack", catalogCost: 58.95, domain: "theirstack.com" },
    { displayName: "OpenPhone / Quo", matcherName: "OpenPhone / Quo", catalogCost: 35.64, domain: "quo.com" },
    { displayName: "Vercel", matcherName: "Vercel", catalogCost: 21.6, domain: "vercel.com" },
    { displayName: "OpenAI / ChatGPT", matcherName: "OpenAI / ChatGPT", catalogCost: 20, domain: "openai.com" },
  ];
  const RECURRING_ANNUAL_CATALOG: RecurringCatalogEntry[] = [
    {
      displayName: "Apollo",
      matcherName: "Apollo",
      catalogCost: 500,
      // Renewals land at $505.44 (subscription + tax). Explicit window
      // overrides the ±30% rule so post-tax amounts always hit the
      // annual bucket instead of falling through to one-time.
      matchMin: 400,
      matchMax: 700,
      fallbackPaidCount: 1,
      fallbackTotalUsd: 500,
      domain: "apollo.io",
    },
    { displayName: "Zoho", matcherName: "Zoho", catalogCost: 104, domain: "zoho.com" },
    {
      displayName: "DocuSign",
      matcherName: "DocuSign",
      catalogCost: 321.29,
      fallbackPaidCount: 1,
      fallbackTotalUsd: 321.29,
      domain: "docusign.com",
    },
  ];
  // Surfaced in its own "Every 3 Years" section below the annual list.
  const RECURRING_EVERY_3_YEARS_CATALOG: RecurringCatalogEntry[] = [
    {
      displayName: "GoDaddy",
      matcherName: "GoDaddy",
      catalogCost: 46.59,
      subline: "$15.53/yr equivalent",
      domain: "godaddy.com",
    },
  ];

  // Anthropic txns that aren't the Claude subscription are pay-as-you-go
  // Console charges. Same matcher tool name, different display in the
  // one-time bucket.
  const ANTHROPIC_MATCHER_NAME = "Anthropic / Claude";
  const ANTHROPIC_CONSOLE_DISPLAY = "Anthropic Console";

  const RECURRING_TOLERANCE = 0.3;
  const matchesRecurringEntry = (amount: number, c: RecurringCatalogEntry) => {
    if (c.matchMin != null && c.matchMax != null) {
      return amount >= c.matchMin && amount <= c.matchMax;
    }
    const target = c.matchCost ?? c.catalogCost;
    return Math.abs(amount - target) / target <= RECURRING_TOLERANCE;
  };

  type RecurringAgg = { totalUsd: number; paidCount: number };
  const monthlyAgg = new Map<string, RecurringAgg>();
  const annualAgg = new Map<string, RecurringAgg>();
  const every3YearsAgg = new Map<string, RecurringAgg>();
  const oneTimeRowsRaw: OneTimeRow[] = [];
  const cashbackTxns: { amount: number; date: Date | null; key: string }[] = [];

  for (const t of mercuryTxns) {
    const description = mercuryTransactionDescription(t);
    const cp = (t.counterpartyName ?? "").toLowerCase();
    const bd = (t.bankDescription ?? "").toLowerCase();
    const isCashback = cp.includes("io cashback") || bd.includes("io cashback");

    if (isCashback) {
      const raw = Number(t.amount ?? 0);
      if (!Number.isFinite(raw)) continue;
      const stamp = t.postedAt ?? t.createdAt;
      cashbackTxns.push({
        amount: raw,
        date: stamp ? new Date(stamp) : null,
        key: `cashback-${t.id ?? `${stamp}-${raw}`}`,
      });
      continue;
    }

    if (shouldIgnoreTransaction(t)) continue;
    if (!description) continue;
    const tool = matchTransaction(description);
    if (!tool) continue;
    const raw = Number(t.amount ?? 0);
    if (!Number.isFinite(raw)) continue;
    const spend = -raw;
    if (spend <= 0) continue;

    const monthlyHit = RECURRING_MONTHLY_CATALOG.find(
      (c) => c.matcherName === tool && matchesRecurringEntry(spend, c),
    );
    if (monthlyHit) {
      const prev = monthlyAgg.get(monthlyHit.displayName) ?? {
        totalUsd: 0,
        paidCount: 0,
      };
      prev.totalUsd += spend;
      prev.paidCount += 1;
      monthlyAgg.set(monthlyHit.displayName, prev);
      continue;
    }

    const annualHit = RECURRING_ANNUAL_CATALOG.find(
      (c) => c.matcherName === tool && matchesRecurringEntry(spend, c),
    );
    if (annualHit) {
      const prev = annualAgg.get(annualHit.displayName) ?? {
        totalUsd: 0,
        paidCount: 0,
      };
      prev.totalUsd += spend;
      prev.paidCount += 1;
      annualAgg.set(annualHit.displayName, prev);
      continue;
    }

    const every3YearsHit = RECURRING_EVERY_3_YEARS_CATALOG.find(
      (c) => c.matcherName === tool && matchesRecurringEntry(spend, c),
    );
    if (every3YearsHit) {
      const prev = every3YearsAgg.get(every3YearsHit.displayName) ?? {
        totalUsd: 0,
        paidCount: 0,
      };
      prev.totalUsd += spend;
      prev.paidCount += 1;
      every3YearsAgg.set(every3YearsHit.displayName, prev);
      continue;
    }

    const displayName =
      tool === ANTHROPIC_MATCHER_NAME ? ANTHROPIC_CONSOLE_DISPLAY : tool;
    const stamp = t.postedAt ?? t.createdAt;
    oneTimeRowsRaw.push({
      key: `merc-onetime-${t.id ?? `${displayName}-${stamp}-${spend}`}`,
      toolName: displayName,
      amountUsd: spend,
      date: stamp ? new Date(stamp) : null,
      matched: true,
      domain: domainForTool(tool) ?? undefined,
    });
  }

  const recurringMonthly: RecurringRow[] = RECURRING_MONTHLY_CATALOG.map((c) => {
    const agg = monthlyAgg.get(c.displayName);
    const matched = !!agg && agg.paidCount > 0;
    return {
      key: `mo-${c.displayName}`,
      toolName: c.displayName,
      catalogCost: c.catalogCost,
      totalYtdUsd: matched ? agg!.totalUsd : (c.fallbackTotalUsd ?? 0),
      paidCount: matched ? agg!.paidCount : (c.fallbackPaidCount ?? 0),
      matched,
      subline: c.subline,
      domain: c.domain ?? domainForTool(c.matcherName) ?? undefined,
    };
  });
  const recurringAnnual: RecurringRow[] = RECURRING_ANNUAL_CATALOG.map((c) => {
    const agg = annualAgg.get(c.displayName);
    const matched = !!agg && agg.paidCount > 0;
    return {
      key: `yr-${c.displayName}`,
      toolName: c.displayName,
      catalogCost: c.catalogCost,
      totalYtdUsd: matched ? agg!.totalUsd : (c.fallbackTotalUsd ?? 0),
      paidCount: matched ? agg!.paidCount : (c.fallbackPaidCount ?? 0),
      matched,
      subline: c.subline,
      domain: c.domain ?? domainForTool(c.matcherName) ?? undefined,
    };
  });
  const recurringEvery3Years: RecurringRow[] = RECURRING_EVERY_3_YEARS_CATALOG.map((c) => {
    const agg = every3YearsAgg.get(c.displayName);
    const matched = !!agg && agg.paidCount > 0;
    return {
      key: `e3y-${c.displayName}`,
      toolName: c.displayName,
      catalogCost: c.catalogCost,
      totalYtdUsd: matched ? agg!.totalUsd : (c.fallbackTotalUsd ?? 0),
      paidCount: matched ? agg!.paidCount : (c.fallbackPaidCount ?? 0),
      matched,
      subline: c.subline,
      domain: c.domain ?? domainForTool(c.matcherName) ?? undefined,
    };
  });

  // Manual entries from the "Add expense" form route into the bucket
  // that matches their frequency. Quarterly is normalized into the
  // monthly recurring section so its standing cost still flows into
  // the monthly-recurring tile (catalogCost = cost/3 monthly equivalent).
  for (const m of manualExpenses) {
    const paidCount = m.paidCount > 0 ? m.paidCount : 1;
    const totalYtdUsd = m.cost * paidCount;
    const freq = m.frequency.trim().toLowerCase();
    const manualDomain = domainForTool(m.name) ?? undefined;
    if (freq === "monthly") {
      recurringMonthly.push({
        key: `manual-mo-${m.id}`,
        toolName: m.name,
        catalogCost: m.cost,
        totalYtdUsd,
        paidCount,
        matched: false,
        subline: m.notes ?? undefined,
        toolExpenseId: m.id,
        startDate: m.startDate ?? null,
        notes: m.notes ?? undefined,
        domain: manualDomain,
      });
    } else if (freq === "quarterly") {
      recurringMonthly.push({
        key: `manual-q-${m.id}`,
        toolName: m.name,
        catalogCost: m.cost / 3,
        totalYtdUsd,
        paidCount,
        matched: false,
        subline: m.notes ?? undefined,
        toolExpenseId: m.id,
        startDate: m.startDate ?? null,
        notes: m.notes ?? undefined,
        domain: manualDomain,
      });
    } else if (freq === "annual" || freq === "annually" || freq === "yearly") {
      recurringAnnual.push({
        key: `manual-yr-${m.id}`,
        toolName: m.name,
        catalogCost: m.cost,
        totalYtdUsd,
        paidCount,
        matched: false,
        subline: m.notes ?? undefined,
        toolExpenseId: m.id,
        startDate: m.startDate ?? null,
        notes: m.notes ?? undefined,
        domain: manualDomain,
      });
    } else {
      // "One-time" and any other unrecognized frequency falls through
      // to the one-time list — best surface for a single charge.
      oneTimeRowsRaw.push({
        key: `manual-onetime-${m.id}`,
        toolName: m.name,
        amountUsd: totalYtdUsd,
        date: m.startDate ?? m.createdAt ?? null,
        matched: false,
        notes: m.notes ?? undefined,
        toolExpenseId: m.id,
        domain: manualDomain,
      });
    }
  }

  // Hardcoded one-time manual entries (paid outside Mercury or pre-dating
  // the Mercury connection). Surface them alongside Mercury-matched rows
  // so the section is comprehensive.
  const HARDCODED_ONE_TIME: OneTimeRow[] = [
    {
      key: "manual-amazon-usbc",
      toolName: "Amazon",
      amountUsd: 7.33,
      date: new Date(2026, 2, 30),
      notes: "USBC to USB converter",
      matched: false,
      domain: "amazon.com",
    },
    {
      key: "manual-lone-wolf",
      toolName: "Lone Wolf Course",
      amountUsd: 1600,
      date: new Date(2026, 2, 16),
      notes: "biz dev expense",
      matched: false,
    },
    {
      key: "manual-llc-formation",
      toolName: "LLC Formation Filing",
      amountUsd: 99,
      date: new Date(2026, 2, 10),
      notes: "startup legal fee",
      matched: false,
    },
    {
      key: "manual-trade-name",
      toolName: "Trade Name Filing",
      amountUsd: 39,
      date: new Date(2026, 2, 18),
      notes: "startup legal fee",
      matched: false,
    },
    {
      key: "manual-claude-pro",
      toolName: "Claude Pro 1 month",
      amountUsd: 100,
      date: new Date(2026, 3, 1),
      notes: "1 month Claude Pro",
      matched: false,
      domain: "claude.ai",
    },
  ];
  oneTimeRowsRaw.push(...HARDCODED_ONE_TIME);

  oneTimeRowsRaw.sort((a, b) => {
    const at = a.date?.getTime() ?? 0;
    const bt = b.date?.getTime() ?? 0;
    return bt - at;
  });
  const oneTimeRows = oneTimeRowsRaw;

  // ---- Money In section data ----
  // Money In reflects REAL bank-side cash only — Mercury (and QuickBooks
  // once wired) transactions. Ace-entered placement fees are NOT money in:
  // they are projected/earned revenue, tracked on the Placements + Revenue
  // surfaces. Folding placement rows in here let cancelled/test placement
  // amounts (e.g. the stray $18k) leak into the cash tally and double-count
  // against Net Profit / Loss, so they are deliberately excluded.
  const cashbackMoneyInRows: MoneyInRow[] = cashbackTxns.map((c) => ({
    key: c.key,
    source: "Mercury Cashback",
    amountUsd: c.amount,
    date: c.date,
  }));
  const moneyInRows = [...cashbackMoneyInRows].sort(
    (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0),
  );

  // ---- Aggregates ----
  const monthlyRecurringSubtotal = recurringMonthly.reduce(
    (s, r) => s + r.totalYtdUsd,
    0,
  );
  const annualRecurringSubtotal = recurringAnnual.reduce(
    (s, r) => s + r.totalYtdUsd,
    0,
  );
  const every3YearsRecurringSubtotal = recurringEvery3Years.reduce(
    (s, r) => s + r.totalYtdUsd,
    0,
  );
  const oneTimeSubtotal = oneTimeRows.reduce((s, r) => s + r.amountUsd, 0);
  // `subscriptionsYtdUsd` is the canonical YTD expense total. The
  // "YTD expenses" footer on the Subscriptions card AND the P&L's
  // "Total Expenses" row both render this exact number — so the four
  // section subtotals (monthly + annual + every-3-years + one-time)
  // must add up here and only here.
  const subscriptionsYtdUsd =
    monthlyRecurringSubtotal +
    annualRecurringSubtotal +
    every3YearsRecurringSubtotal +
    oneTimeSubtotal;

  const activeSubscriptionsCount =
    recurringMonthly.filter((r) => r.paidCount > 0).length +
    recurringAnnual.filter((r) => r.paidCount > 0).length;

  // Monthly recurring cost — sum of catalog monthly costs + annual/12,
  // counting only catalog rows that Mercury has actually charged YTD.
  const monthlyRecurringUsd =
    recurringMonthly
      .filter((r) => r.paidCount > 0)
      .reduce((s, r) => s + r.catalogCost, 0) +
    recurringAnnual
      .filter((r) => r.paidCount > 0)
      .reduce((s, r) => s + r.catalogCost / 12, 0);

  // Revenue attribution by source name (case-insensitive). Each
  // invoice carries the placement.candidateSource that the recruiter
  // tagged at the sourcing step — the first-touch attribution model.
  const revByLowerSource = new Map<string, number>();
  for (const inv of revenueInvoices) {
    const src = inv.placement?.candidateSource?.trim();
    if (!src) continue;
    const key = src.toLowerCase();
    revByLowerSource.set(
      key,
      (revByLowerSource.get(key) ?? 0) + decimalToNumber(inv.feeAmount),
    );
  }

  // Roll up YTD spend per display name across all three expense sections
  // so ROI lines can show one row per tool family rather than separate
  // recurring vs one-time entries.
  const spendByDisplayName = new Map<string, number>();
  const bump = (name: string, usd: number) => {
    spendByDisplayName.set(name, (spendByDisplayName.get(name) ?? 0) + usd);
  };
  for (const r of recurringMonthly) {
    if (r.totalYtdUsd > 0) bump(r.toolName, r.totalYtdUsd);
  }
  for (const r of recurringAnnual) {
    if (r.totalYtdUsd > 0) bump(r.toolName, r.totalYtdUsd);
  }
  for (const r of recurringEvery3Years) {
    if (r.totalYtdUsd > 0) bump(r.toolName, r.totalYtdUsd);
  }
  for (const r of oneTimeRows) bump(r.toolName, r.amountUsd);

  // Whitelist for the ROI card — the desk only weights ROI on its
  // active sourcing channels. Other tools (Vercel, Anthropic, Zoho,
  // etc.) cost money but aren't tracked against revenue attribution.
  const ROI_WHITELIST_ARRAY = [
    "Pin",
    "Apollo",
    "TheirStack",
    "LinkedIn",
    "Indeed",
  ] as const;
  const ROI_WHITELIST = new Set<string>(ROI_WHITELIST_ARRAY);
  for (const name of ROI_WHITELIST_ARRAY) {
    if (!spendByDisplayName.has(name)) spendByDisplayName.set(name, 0);
  }

  const roiRows: RoiRow[] = Array.from(spendByDisplayName.entries())
    .filter(([toolName]) => ROI_WHITELIST.has(toolName))
    .map(([toolName, spendUsd]) => {
      const rev = revByLowerSource.get(toolName.toLowerCase()) ?? 0;
      const roiPct =
        spendUsd > 0 && rev > 0
          ? ((rev - spendUsd) / spendUsd) * 100
          : null;
      return {
        key: `roi-${toolName}`,
        toolName,
        spendUsd,
        revUsd: rev,
        roiPct,
      };
    })
    .sort((a, b) => b.spendUsd - a.spendUsd);

  const totalRoiSpend = roiRows.reduce((s, r) => s + r.spendUsd, 0);
  const totalRoiRev = roiRows.reduce((s, r) => s + r.revUsd, 0);
  const blendedExpensesRoiPct =
    totalRoiSpend > 0
      ? ((totalRoiRev - totalRoiSpend) / totalRoiSpend) * 100
      : null;

  const eyebrowLabel = "SUBSCRIPTIONS, TOOLS & SPEND";
  // Mercury status sits inline with the eyebrow on the Expenses tab so
  // the cards rise to the top of the column instead of being pushed
  // down by a dedicated status row. Mirrors the Clubhouse tab pattern
  // (eyebrow + period selector share one row).
  const mercuryStatusLine = mercuryConnected
    ? "Auto-matched from Mercury · last sync just now"
    : "Mercury not connected";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          {eyebrowLabel}
        </p>
        <p
          className={
            "text-xs " +
            (mercuryConnected ? "text-court-fg-muted" : "text-court-fg-dim")
          }
        >
          {mercuryStatusLine}
        </p>
      </div>

      <ExpensesSection
        recurringMonthly={recurringMonthly}
        recurringAnnual={recurringAnnual}
        recurringEvery3Years={recurringEvery3Years}
        oneTimeRows={oneTimeRows}
        moneyInRows={moneyInRows}
        subscriptionsYtdUsd={subscriptionsYtdUsd}
        activeSubscriptionsCount={activeSubscriptionsCount}
        monthlyRecurringUsd={monthlyRecurringUsd}
        roiRows={roiRows}
        blendedExpensesRoiPct={blendedExpensesRoiPct}
      />
    </div>
  );
}

type RoiRow = {
  key: string;
  toolName: string;
  spendUsd: number;
  revUsd: number;
  roiPct: number | null;
};

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-court-border bg-court-surface-subtle px-3 py-4 text-center text-xs text-court-fg-muted">
      {children}
    </div>
  );
}

const ROI_INT_FMT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

// minmax(0, …) on the Tool column lets the avatar + label compress and
// truncate at narrow card widths (e.g. when the ROI card sits alongside
// Subscriptions at 1280px viewport, before the xl breakpoint stacks
// them). The numeric columns hold their minimum so dollar amounts never
// collide with the Tool name.
const ROI_GRID =
  "grid grid-cols-[minmax(0,1.6fr)_minmax(70px,1fr)_minmax(80px,1.2fr)_minmax(56px,0.9fr)]";

function avatarFor(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "");
  return (cleaned.slice(0, 2) || "??").toUpperCase();
}

function ExpensesSection({
  recurringMonthly,
  recurringAnnual,
  recurringEvery3Years,
  oneTimeRows,
  moneyInRows,
  subscriptionsYtdUsd,
  activeSubscriptionsCount,
  monthlyRecurringUsd,
  roiRows,
  blendedExpensesRoiPct,
}: {
  recurringMonthly: RecurringRow[];
  recurringAnnual: RecurringRow[];
  recurringEvery3Years: RecurringRow[];
  oneTimeRows: OneTimeRow[];
  moneyInRows: MoneyInRow[];
  subscriptionsYtdUsd: number;
  activeSubscriptionsCount: number;
  monthlyRecurringUsd: number;
  roiRows: RoiRow[];
  blendedExpensesRoiPct: number | null;
}) {
  return (
    <section className="flex flex-col gap-5">
      <ExpenseAddForm />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SubscriptionsCard
          recurringMonthly={recurringMonthly}
          recurringAnnual={recurringAnnual}
          recurringEvery3Years={recurringEvery3Years}
          oneTimeRows={oneTimeRows}
          moneyInRows={moneyInRows}
          subscriptionsYtdUsd={subscriptionsYtdUsd}
          activeSubscriptionsCount={activeSubscriptionsCount}
          monthlyRecurringUsd={monthlyRecurringUsd}
        />
        <div className="flex flex-col gap-5">
          <MonthlyOperatingCostCard
            recurringMonthly={recurringMonthly}
            recurringAnnual={recurringAnnual}
            recurringEvery3Years={recurringEvery3Years}
          />
          <RoiCard
            rows={roiRows}
            blendedRoiPct={blendedExpensesRoiPct}
          />
        </div>
      </div>
    </section>
  );
}

function SubscriptionsCard({
  recurringMonthly,
  recurringAnnual,
  recurringEvery3Years,
  oneTimeRows,
  moneyInRows,
  subscriptionsYtdUsd,
  activeSubscriptionsCount,
  monthlyRecurringUsd,
}: {
  recurringMonthly: RecurringRow[];
  recurringAnnual: RecurringRow[];
  recurringEvery3Years: RecurringRow[];
  oneTimeRows: OneTimeRow[];
  moneyInRows: MoneyInRow[];
  subscriptionsYtdUsd: number;
  activeSubscriptionsCount: number;
  monthlyRecurringUsd: number;
}) {
  const moneyInTotal = moneyInRows.reduce((s, r) => s + r.amountUsd, 0);
  const netProfit = moneyInTotal - subscriptionsYtdUsd;
  const netProfitPositive = netProfit >= 0;
  const marginPctLabel =
    moneyInTotal > 0
      ? `${((netProfit / moneyInTotal) * 100).toFixed(1)}% margin`
      : "— margin";

  return (
    <div className="flex flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
      <div>
        <p className="font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
          Subscriptions &amp; tools
        </p>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          Catalog of recurring and one-time spend, plus money in
        </p>
      </div>

      <SubscriptionsList
        recurringMonthly={recurringMonthly}
        recurringAnnual={recurringAnnual}
        recurringEvery3Years={recurringEvery3Years}
        oneTime={oneTimeRows}
        moneyIn={moneyInRows}
        monthlyRecurringUsd={monthlyRecurringUsd}
      />

      <div className="mt-4 flex items-center justify-between border-t border-court-border-soft pt-3 text-xs text-court-fg-muted">
        <span>
          {activeSubscriptionsCount} active subscription
          {activeSubscriptionsCount === 1 ? "" : "s"}
        </span>
        <span className="text-sm font-semibold tabular-nums text-court-fg">
          YTD expenses {formatUsd(subscriptionsYtdUsd)}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-court-border-soft pt-3 text-sm">
        <span className="font-semibold text-court-fg">Net Profit / Loss</span>
        <span className="flex items-baseline gap-2">
          <span
            className={
              "font-bold tabular-nums " +
              (netProfitPositive ? "text-court-brand" : "text-red-600")
            }
          >
            {formatUsd(netProfit)}
          </span>
          <span className="text-xs text-court-fg-muted">
            ({marginPctLabel})
          </span>
        </span>
      </div>

    </div>
  );
}

function RoiCard({
  rows,
  blendedRoiPct,
}: {
  rows: RoiRow[];
  blendedRoiPct: number | null;
}) {
  return (
    <div className="flex flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
      <div>
        <p className="font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
          ROI per tool
        </p>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          Spend vs revenue attributed to deals sourced through it
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock>
          ROI lands once a subscription is logged or Mercury matches a tool.
        </EmptyBlock>
      ) : (
        <div className="mt-4">
          <div className={`${ROI_GRID} gap-2 px-1 pb-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-court-fg-muted`}>
            <span>Tool</span>
            <span className="text-right">Spend</span>
            <span className="text-right">Rev. Attr.</span>
            <span className="text-right">ROI</span>
          </div>
          <ul className="divide-y divide-court-border-soft">
            {rows.map((r) => (
              <RoiRowItem key={r.key} row={r} />
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-court-border-soft pt-3 text-xs text-court-fg-muted">
        <span>Attribution: first-touch from sourcing record</span>
        <span className="text-sm font-semibold tabular-nums text-court-fg">
          Blended {blendedRoiPct != null ? `${ROI_INT_FMT.format(Math.round(blendedRoiPct))}%` : "—"}
        </span>
      </div>
    </div>
  );
}

function RoiRowItem({ row }: { row: RoiRow }) {
  const roiLabel =
    row.roiPct != null
      ? `${ROI_INT_FMT.format(Math.round(row.roiPct))}%`
      : "—";
  const initials = avatarFor(row.toolName);
  return (
    <li className={`${ROI_GRID} items-center gap-2 px-1 py-2 text-sm`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-court-surface-subtle text-xs font-bold text-court-fg-muted">
          {initials}
        </span>
        <span
          className="min-w-0 truncate font-medium text-court-fg"
          title={row.toolName}
        >
          {row.toolName}
        </span>
      </div>
      <span className="text-right tabular-nums text-court-fg">
        {formatUsd(row.spendUsd)}
      </span>
      <span className="text-right tabular-nums text-court-fg">
        {row.revUsd > 0 ? formatUsd(row.revUsd) : "—"}
      </span>
      <span
        className={
          "text-right font-semibold tabular-nums " +
          (row.roiPct == null
            ? "text-court-fg-dim"
            : row.roiPct >= 0
              ? "text-court-fg"
              : "text-red-600")
        }
      >
        {roiLabel}
      </span>
    </li>
  );
}

// Monthly Operating Cost answers: "what does it cost to keep the lights
// on each month?". Every recurring subscription is normalized to a
// monthly equivalent — annual / 12, every-3-years / 36 — so the desk
// can see the true monthly burn at a glance. One-time charges are
// excluded by construction (they're not operating costs).
const USD_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function formatUsdCents(n: number): string {
  return USD_CENTS.format(n);
}

type OperatingCostRow = {
  key: string;
  toolName: string;
  monthlyEquivUsd: number;
};

function buildOperatingCostRows(
  recurringMonthly: RecurringRow[],
  recurringAnnual: RecurringRow[],
  recurringEvery3Years: RecurringRow[],
): OperatingCostRow[] {
  const rows: OperatingCostRow[] = [];
  for (const r of recurringMonthly) {
    rows.push({
      key: `op-${r.key}`,
      toolName: r.toolName,
      monthlyEquivUsd: r.catalogCost,
    });
  }
  for (const r of recurringAnnual) {
    rows.push({
      key: `op-${r.key}`,
      toolName: r.toolName,
      monthlyEquivUsd: r.catalogCost / 12,
    });
  }
  for (const r of recurringEvery3Years) {
    rows.push({
      key: `op-${r.key}`,
      toolName: r.toolName,
      monthlyEquivUsd: r.catalogCost / 36,
    });
  }
  return rows.sort((a, b) => b.monthlyEquivUsd - a.monthlyEquivUsd);
}

const OPERATING_COST_GRID =
  "grid grid-cols-[minmax(0,1.6fr)_minmax(120px,1fr)]";

function MonthlyOperatingCostCard({
  recurringMonthly,
  recurringAnnual,
  recurringEvery3Years,
}: {
  recurringMonthly: RecurringRow[];
  recurringAnnual: RecurringRow[];
  recurringEvery3Years: RecurringRow[];
}) {
  const rows = buildOperatingCostRows(
    recurringMonthly,
    recurringAnnual,
    recurringEvery3Years,
  );
  const totalMonthlyRunRate = rows.reduce(
    (s, r) => s + r.monthlyEquivUsd,
    0,
  );

  return (
    <div className="flex flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
      <div>
        <p className="font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
          Monthly Operating Cost
        </p>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          What it costs to keep the lights on each month.
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-court-brand-tint/50 px-4 py-2">
        <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-court-brand-dark">
          Total Monthly Run Rate
        </span>
        <span className="text-xs font-extrabold tabular-nums text-court-brand-dark">
          {formatUsdCents(totalMonthlyRunRate)}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock>
          No recurring subscriptions logged yet. Monthly run rate will land here once tools are tracked.
        </EmptyBlock>
      ) : (
        <div className="mt-4">
          <div
            className={`${OPERATING_COST_GRID} gap-2 px-1 pb-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-court-fg-muted`}
          >
            <span>Tool</span>
            <span className="text-right">Monthly Cost</span>
          </div>
          <ul className="divide-y divide-court-border-soft">
            {rows.map((r) => (
              <li
                key={r.key}
                className={`${OPERATING_COST_GRID} items-center gap-2 px-1 py-2 text-sm`}
              >
                <span
                  className="min-w-0 truncate font-medium text-court-fg"
                  title={r.toolName}
                >
                  {r.toolName}
                </span>
                <span className="text-right font-semibold tabular-nums text-court-fg">
                  {formatUsdCents(r.monthlyEquivUsd)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


