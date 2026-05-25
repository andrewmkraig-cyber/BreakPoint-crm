import { AlertTriangle, CheckCircle, Clock, Receipt } from "lucide-react";
import { TabStrip } from "@/components/ui/tab-strip";
import { FinancialPerformanceTab } from "@/app/dashboard/financial-performance-tab";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { PeriodTabs } from "@/app/dashboard/period-tabs";
import { resolveDashboardPeriod } from "@/app/dashboard/period-tabs-shared";
import { InvoiceRow } from "@/app/invoices/invoice-row";
import { SendTestInvoiceButton } from "@/app/invoices/send-test-invoice-button";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  getInvoiceSummary,
  listInvoices,
  parseInvoiceContacts,
  type InvoiceListFilter,
} from "@/lib/invoices";

export const dynamic = "force-dynamic";

type FinancesTab = "overview" | "invoices" | "expenses";

const TAB_ITEMS: ReadonlyArray<{ id: FinancesTab; label: string; href: string }> = [
  { id: "overview", label: "Revenue & Profitability", href: "/finances" },
  { id: "invoices", label: "Invoices", href: "/finances?tab=invoices" },
  { id: "expenses", label: "Expenses", href: "/finances?tab=expenses" },
];

function resolveFinancesTab(raw: string | undefined): FinancesTab {
  if (raw === "invoices" || raw === "expenses") return raw;
  return "overview";
}

const INVOICE_FILTERS: Array<{ value: InvoiceListFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "drafts", label: "Drafts" },
  { value: "sent", label: "Sent" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
];

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "Draft", tone: "rounded-full bg-court-surface-subtle text-court-fg" },
  SENT: { label: "Sent", tone: "rounded-full bg-amber-50 text-amber-800 border border-amber-200" },
  PAID: { label: "Paid", tone: "rounded-md border border-court-brand bg-transparent text-court-brand" },
  VOID: { label: "Void", tone: "rounded-full bg-slate-100 text-slate-500 border border-slate-200" },
};

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatUsdDecimal(amount: unknown): string {
  if (amount == null) return "—";
  const n = Number(amount.toString());
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Render an em-dash when a string field is null, undefined, or whitespace-only
// so empty cells share the same typographic anchor as our null money / null
// date fallbacks instead of leaving a visually blank gap in the row.
function orDash(v: string | null | undefined): string {
  return v && v.trim() !== "" ? v : "—";
}

type RawParams = { tab?: string; filter?: string; period?: string };
type ParamsInput = Promise<RawParams> | RawParams;

export default async function FinancesPage({
  searchParams,
}: {
  searchParams?: ParamsInput;
}) {
  const params = (await Promise.resolve(searchParams ?? {})) as RawParams;
  const tab = resolveFinancesTab(params.tab);
  const period = resolveDashboardPeriod(params.period);

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabStrip<FinancesTab>
          ariaLabel="Finances sections"
          activeId={tab}
          items={TAB_ITEMS}
        />
        {tab === "overview" ? <PeriodTabs period={period} /> : null}
      </div>
      {tab === "overview" && (
        <FinancialPerformanceTab mode="revenue-profitability" period={period} />
      )}
      {tab === "invoices" && <InvoicesTab rawFilter={params.filter} />}
      {tab === "expenses" && <FinancialPerformanceTab mode="expenses" />}
    </div>
  );
}

async function InvoicesTab({ rawFilter }: { rawFilter: string | undefined }) {
  const filter: InvoiceListFilter = (INVOICE_FILTERS.find(
    (f) => f.value === rawFilter,
  )?.value ?? "all") as InvoiceListFilter;
  const org = await getCurrentOrg();
  const [invoices, summary] = await Promise.all([
    listInvoices(org.id, filter),
    getInvoiceSummary(org.id),
  ]);

  return (
    <div className="flex w-full flex-col gap-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
        BILLED, COLLECTED &amp; OUTSTANDING
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="Outstanding"
          value={formatUsd(summary.outstandingCents)}
          icon={Clock}
          live={summary.outstandingCents > 0}
        />
        <KpiTile
          label="Overdue"
          value={formatUsd(summary.overdueCents)}
          icon={AlertTriangle}
          live={summary.overdueCents > 0}
        />
        <KpiTile
          label="Billed This Quarter"
          value={formatUsd(summary.billedThisQuarterCents)}
          icon={Receipt}
          live={summary.billedThisQuarterCents > 0}
        />
        <KpiTile
          label="Collected This Quarter"
          value={formatUsd(summary.collectedThisQuarterCents)}
          icon={CheckCircle}
          live={summary.collectedThisQuarterCents > 0}
        />
      </div>

      <div className="rounded-3xl bg-court-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
        <div className="flex flex-col gap-3 border-b border-court-border p-6 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
              Invoices
            </p>
            <h2 className="mt-1 font-serif text-xl font-bold tracking-tight text-court-fg">
              {INVOICE_FILTERS.find((f) => f.value === filter)?.label ?? "All"} invoices
            </h2>
          </div>
          <TabStrip<InvoiceListFilter>
            ariaLabel="Invoice filter"
            activeId={filter}
            items={INVOICE_FILTERS.map((f) => ({
              id: f.value,
              label: f.label,
              href:
                f.value === "all"
                  ? "/finances?tab=invoices"
                  : `/finances?tab=invoices&filter=${f.value}`,
            }))}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-court-border bg-court-surface-subtle/50">
                {[
                  "Invoice",
                  "Client",
                  "Candidate / Role",
                  "Amount",
                  "Issued",
                  "Due",
                  "Status",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-6 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-14 text-center text-[13px] text-court-fg-muted">
                    No invoices yet.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => {
                  const billing = parseInvoiceContacts(inv.billingContacts);
                  const primary = billing[0];
                  const candName = inv.candidate
                    ? orDash(`${inv.candidate.firstName ?? ""} ${inv.candidate.lastName ?? ""}`.trim())
                    : "—";
                  const status = STATUS_COPY[inv.status] ?? { label: inv.status, tone: "rounded-full bg-court-surface-subtle text-court-fg" };
                  const isOverdue = inv.status === "SENT" && inv.dueDate && inv.dueDate < new Date();
                  return (
                    <InvoiceRow key={inv.id} href={`/invoices/${inv.id}`}>
                      <td className="px-6 py-3 align-top">
                        <span className="font-mono text-[12px] font-semibold text-court-fg">
                          {orDash(inv.invoiceNumber)}
                        </span>
                      </td>
                      <td className="px-6 py-3 align-top">
                        <div className="font-medium text-court-fg">{orDash(inv.client?.name)}</div>
                        <div className="text-[12px] text-court-fg-muted">{orDash(primary?.name)}</div>
                      </td>
                      <td className="px-6 py-3 align-top">
                        <div className="font-medium text-court-fg">{candName}</div>
                        <div className="text-[12px] text-court-fg-muted">{orDash(inv.roleTitle)}</div>
                      </td>
                      <td className="px-6 py-3 align-top tabular-nums">{formatUsdDecimal(inv.feeAmount)}</td>
                      <td className="px-6 py-3 align-top text-court-fg-muted">{formatDate(inv.startDate)}</td>
                      <td className={"px-6 py-3 align-top " + (isOverdue ? "font-semibold text-red-700" : "text-court-fg-muted")}>
                        {formatDate(inv.dueDate)}
                      </td>
                      <td className="px-6 py-3 align-top">
                        <span
                          className={
                            "inline-flex items-center px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider " +
                            status.tone
                          }
                        >
                          {status.label}
                        </span>
                      </td>
                    </InvoiceRow>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <SendTestInvoiceButton />
      </div>
    </div>
  );
}

