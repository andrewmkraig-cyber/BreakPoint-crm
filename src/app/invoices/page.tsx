import Link from "next/link";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  getInvoiceSummary,
  listInvoices,
  parseInvoiceContacts,
  type InvoiceListFilter,
} from "@/lib/invoices";

import { NewInvoiceButton } from "./new-invoice-button";
import { SendTestInvoiceButton } from "./send-test-invoice-button";

export const dynamic = "force-dynamic";

const FILTERS: Array<{ value: InvoiceListFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "drafts", label: "Drafts" },
  { value: "sent", label: "Sent" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
];

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "Draft", tone: "bg-court-surface-subtle text-court-fg" },
  SENT: { label: "Sent", tone: "bg-amber-50 text-amber-800 border border-amber-200" },
  PAID: { label: "Paid", tone: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  VOID: { label: "Void", tone: "bg-slate-100 text-slate-500 border border-slate-200" },
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

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string }> | { filter?: string };
}) {
  const params = (await Promise.resolve(searchParams ?? {})) as { filter?: string };
  const filter: InvoiceListFilter = (FILTERS.find((f) => f.value === params.filter)?.value ?? "all") as InvoiceListFilter;
  const org = await getCurrentOrg();
  const [invoices, summary] = await Promise.all([
    listInvoices(org.id, filter),
    getInvoiceSummary(org.id),
  ]);

  return (
    <div className="flex w-full flex-col gap-6 px-6 py-7 lg:px-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
            Billing Tower
          </p>
          <h1 className="mt-1 font-serif text-3xl font-bold tracking-tight text-court-fg">
            Invoices
          </h1>
          <p className="mt-1 max-w-xl text-sm text-court-fg-muted">
            Draft, send, and track placement invoices. Bank details live inside each PDF — no pay links, no Mercury sync.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SendTestInvoiceButton />
          <NewInvoiceButton />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label="Outstanding"
          value={formatUsd(summary.outstandingCents)}
          hint={`${summary.outstandingCount} sent · awaiting payment`}
        />
        <KpiCard
          label="Overdue"
          value={formatUsd(summary.overdueCents)}
          hint={`${summary.overdueCount} past due date`}
          tone={summary.overdueCount > 0 ? "warn" : "default"}
        />
        <KpiCard
          label="Billed this quarter"
          value={formatUsd(summary.billedThisQuarterCents)}
          hint="Sent + paid in current quarter"
        />
        <KpiCard
          label="Collected this quarter"
          value={formatUsd(summary.collectedThisQuarterCents)}
          hint="Marked paid in current quarter"
        />
      </div>

      <div className="rounded-2xl border border-court-border bg-court-surface shadow-sm">
        <div className="flex flex-col gap-3 border-b border-court-border p-6 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
              Invoices
            </p>
            <h2 className="mt-1 font-serif text-xl font-bold tracking-tight text-court-fg">
              {FILTERS.find((f) => f.value === filter)?.label ?? "All"} invoices
            </h2>
          </div>
          <div className="inline-flex rounded-full border border-court-border bg-court-surface p-0.5 text-sm">
            {FILTERS.map((f) => (
              <Link
                key={f.value}
                href={f.value === "all" ? "/invoices" : `/invoices?filter=${f.value}`}
                aria-current={filter === f.value ? "page" : undefined}
                className={
                  "rounded-full px-3 py-1 text-[12px] transition " +
                  (filter === f.value
                    ? "bg-court-fg text-court-surface font-semibold"
                    : "text-court-fg-muted hover:text-court-fg")
                }
              >
                {f.label}
              </Link>
            ))}
          </div>
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
                    ? `${inv.candidate.firstName} ${inv.candidate.lastName ?? ""}`.trim()
                    : "—";
                  const status = STATUS_COPY[inv.status] ?? { label: inv.status, tone: "bg-court-surface-subtle text-court-fg" };
                  const isOverdue = inv.status === "SENT" && inv.dueDate && inv.dueDate < new Date();
                  return (
                    <tr key={inv.id} className="border-b border-court-border last:border-b-0 hover:bg-court-surface-subtle/30">
                      <td className="px-6 py-3 align-top">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="font-mono text-[12px] font-semibold text-court-fg hover:text-court-brand-dark"
                        >
                          {inv.invoiceNumber}
                        </Link>
                      </td>
                      <td className="px-6 py-3 align-top">
                        <div className="font-medium text-court-fg">{inv.client?.name ?? "—"}</div>
                        {primary?.name ? (
                          <div className="text-[12px] text-court-fg-muted">{primary.name}</div>
                        ) : null}
                      </td>
                      <td className="px-6 py-3 align-top">
                        <div className="font-medium text-court-fg">{candName}</div>
                        <div className="text-[12px] text-court-fg-muted">{inv.roleTitle ?? "—"}</div>
                      </td>
                      <td className="px-6 py-3 align-top tabular-nums">{formatUsdDecimal(inv.feeAmount)}</td>
                      <td className="px-6 py-3 align-top text-court-fg-muted">{formatDate(inv.startDate)}</td>
                      <td className={"px-6 py-3 align-top " + (isOverdue ? "font-semibold text-red-700" : "text-court-fg-muted")}>
                        {formatDate(inv.dueDate)}
                      </td>
                      <td className="px-6 py-3 align-top">
                        <span
                          className={
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider " +
                            status.tone
                          }
                        >
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "warn";
}) {
  const wrapper =
    tone === "warn"
      ? "rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm"
      : "rounded-2xl border border-court-border bg-court-surface p-5 shadow-sm";
  return (
    <div className={wrapper}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
        {label}
      </p>
      <div className="mt-2 font-serif text-3xl font-extrabold leading-none tracking-[-0.035em] tabular-nums text-court-fg">
        {value}
      </div>
      <p className="mt-3 text-[11px] text-court-fg-muted">{hint}</p>
    </div>
  );
}
