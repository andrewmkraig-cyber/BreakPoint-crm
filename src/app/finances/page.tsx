import Link from "next/link";
import { FinancialPerformanceTab } from "@/app/dashboard/financial-performance-tab";
import { PeriodPillToggle } from "@/app/dashboard/period-pill-toggle";
import { resolveDashboardPeriod } from "@/app/dashboard/period-tabs-shared";
import { InvoiceRow } from "@/app/invoices/invoice-row";
import { SendTestInvoiceButton } from "@/app/invoices/send-test-invoice-button";
import { cn } from "@/lib/utils";
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

// Spec rule 4: PAID / PENDING / OVERDUE chips. DRAFT + VOID stay
// outside the spec list — render with the neutral subtle treatment so
// they still read as chips alongside the spec'd three.
type ChipTone = "paid" | "pending" | "overdue" | "neutral";

function statusFor(
  rawStatus: string,
  isOverdue: boolean,
): { label: string; tone: ChipTone } {
  if (isOverdue) return { label: "Overdue", tone: "overdue" };
  switch (rawStatus) {
    case "PAID":
      return { label: "Paid", tone: "paid" };
    case "SENT":
      return { label: "Pending", tone: "pending" };
    case "DRAFT":
      return { label: "Draft", tone: "neutral" };
    case "VOID":
      return { label: "Void", tone: "neutral" };
    default:
      return { label: rawStatus, tone: "neutral" };
  }
}

function StatusChip({ tone, label }: { tone: ChipTone; label: string }) {
  const cls =
    tone === "paid"
      ? "bg-court-accent-tint text-court-brand-dark"
      : tone === "pending"
        ? "bg-amber-50 text-amber-700"
        : tone === "overdue"
          ? "bg-red-50 text-red-500"
          : "bg-court-surface-subtle text-court-fg-muted";
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full px-3 text-[11px] font-semibold uppercase tracking-wider",
        cls,
      )}
    >
      {label}
    </span>
  );
}

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

type RawParams = { tab?: string; filter?: string; period?: string };
type ParamsInput = Promise<RawParams> | RawParams;

// Spec rule 1: underline tab strip with active 2px border-court-accent
// bottom border + brand-dark semibold label, h-10. Inactive: muted with
// hover bump to court-fg.
function FinancesTabStrip({ tab }: { tab: FinancesTab }) {
  return (
    <nav
      role="tablist"
      aria-label="Finances sections"
      className="flex flex-wrap gap-0 border-b border-court-border"
    >
      {TAB_ITEMS.map((item) => {
        const active = item.id === tab;
        return (
          <Link
            key={item.id}
            role="tab"
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            href={item.href}
            scroll={false}
            className={cn(
              "-mb-px inline-flex h-10 items-center border-b-2 px-4 text-[13px] transition-colors",
              active
                ? "border-court-accent font-semibold text-court-brand-dark"
                : "border-transparent text-court-fg-muted hover:text-court-fg",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default async function FinancesPage({
  searchParams,
}: {
  searchParams?: ParamsInput;
}) {
  const params = (await Promise.resolve(searchParams ?? {})) as RawParams;
  const tab = resolveFinancesTab(params.tab);
  const period = resolveDashboardPeriod(params.period);

  return (
    <div className="-m-4 min-h-[calc(100vh-6rem)] bg-court-surface-subtle p-4 sm:-m-6 sm:p-6">
      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FinancesTabStrip tab={tab} />
          {tab === "overview" ? <PeriodPillToggle period={period} /> : null}
        </div>
        {tab === "overview" && (
          <FinancialPerformanceTab mode="revenue-profitability" period={period} />
        )}
        {tab === "invoices" && <InvoicesTab rawFilter={params.filter} />}
        {tab === "expenses" && <FinancialPerformanceTab mode="expenses" />}
      </div>
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
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
        Billed, Collected &amp; Outstanding
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <InvoicesKpiCard label="Outstanding" value={formatUsd(summary.outstandingCents)} isEmpty={summary.outstandingCents === 0} />
        <InvoicesKpiCard label="Overdue" value={formatUsd(summary.overdueCents)} isEmpty={summary.overdueCents === 0} />
        <InvoicesKpiCard label="Billed This Quarter" value={formatUsd(summary.billedThisQuarterCents)} isEmpty={summary.billedThisQuarterCents === 0} />
        <InvoicesKpiCard label="Collected This Quarter" value={formatUsd(summary.collectedThisQuarterCents)} isEmpty={summary.collectedThisQuarterCents === 0} />
      </div>

      <div className="overflow-hidden rounded-2xl border-0 bg-court-surface shadow-sm">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
              Invoices
            </p>
            <h2 className="font-serif text-[18px] font-bold tracking-tight text-court-fg">
              {INVOICE_FILTERS.find((f) => f.value === filter)?.label ?? "All"} invoices
            </h2>
          </div>
          <InvoiceFilterChips filter={filter} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-court-surface-subtle">
              <tr>
                {["Invoice", "Client", "Candidate / Role", "Amount", "Issued", "Due", "Status"].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-court-border-soft">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-14 text-center text-[13px] text-court-fg-muted">
                    No invoices yet.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => {
                  const billing = parseInvoiceContacts(inv.billingContacts);
                  const primary = billing[0];
                  const candName = inv.candidate
                    ? `${inv.candidate.firstName} ${inv.candidate.lastName ?? ""}`.trim()
                    : "—";
                  const isOverdue = !!(
                    inv.status === "SENT" &&
                    inv.dueDate &&
                    inv.dueDate < new Date()
                  );
                  const status = statusFor(inv.status, isOverdue);
                  return (
                    <InvoiceRow key={inv.id} href={`/invoices/${inv.id}`}>
                      <td className="px-5 py-3 align-middle">
                        <span className="font-mono text-[12px] font-semibold text-court-fg">
                          {inv.invoiceNumber}
                        </span>
                      </td>
                      <td className="px-5 py-3 align-middle">
                        <div className="font-medium text-court-fg">{inv.client?.name ?? "—"}</div>
                        {primary?.name ? (
                          <div className="text-[11px] text-court-fg-muted">{primary.name}</div>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 align-middle">
                        <div className="font-medium text-court-fg">{candName}</div>
                        <div className="text-[11px] text-court-fg-muted">{inv.roleTitle ?? "—"}</div>
                      </td>
                      <td className="px-5 py-3 align-middle font-bold tabular-nums text-court-fg">
                        {formatUsdDecimal(inv.feeAmount)}
                      </td>
                      <td className="px-5 py-3 align-middle text-[11px] text-court-fg-muted">{formatDate(inv.startDate)}</td>
                      <td className={cn("px-5 py-3 align-middle text-[11px]", isOverdue ? "font-semibold text-red-700" : "text-court-fg-muted")}>
                        {formatDate(inv.dueDate)}
                      </td>
                      <td className="px-5 py-3 align-middle">
                        <StatusChip tone={status.tone} label={status.label} />
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

function InvoicesKpiCard({
  label,
  value,
  isEmpty,
}: {
  label: string;
  value: string;
  isEmpty: boolean;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border-0 bg-court-surface p-5 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
        {label}
      </p>
      <p
        className={cn(
          "mt-3 font-serif text-[36px] font-extrabold leading-none tabular-nums",
          isEmpty ? "text-court-border opacity-50" : "text-court-fg",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function InvoiceFilterChips({ filter }: { filter: InvoiceListFilter }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {INVOICE_FILTERS.map((f) => {
        const active = f.value === filter;
        const href = f.value === "all" ? "/finances?tab=invoices" : `/finances?tab=invoices&filter=${f.value}`;
        return (
          <Link
            key={f.value}
            href={href}
            aria-current={active ? "page" : undefined}
            scroll={false}
            className={cn(
              "inline-flex h-8 items-center rounded-full px-3 text-[11px] font-semibold transition",
              active
                ? "bg-court-accent-tint text-court-brand-dark"
                : "bg-court-surface-subtle text-court-fg-muted hover:text-court-fg",
            )}
          >
            {f.label}
          </Link>
        );
      })}
    </div>
  );
}
