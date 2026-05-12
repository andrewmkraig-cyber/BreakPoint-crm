import Link from "next/link";
import { CheckCircle2, FileText, Mail, Send, Wallet } from "lucide-react";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  getInvoiceSummary,
  listInvoices,
  parseInvoiceContacts,
} from "@/lib/invoices";

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "Draft", tone: "bg-court-surface-subtle text-court-fg" },
  SENT: { label: "Sent", tone: "bg-amber-50 text-amber-800 border border-amber-200" },
  PAID: { label: "Paid", tone: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  VOID: { label: "Void", tone: "bg-slate-100 text-slate-500 border border-slate-200" },
};

function formatUsdCents(cents: number): string {
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

export async function Invoicing() {
  const org = await getCurrentOrg();
  const [summary, drafts, recent] = await Promise.all([
    getInvoiceSummary(org.id),
    listInvoices(org.id, "drafts"),
    listInvoices(org.id, "all"),
  ]);

  return (
    <div className="flex flex-col gap-7">
      <InvoicingHeader />
      <KpiRow summary={summary} />
      <AutomationStrip />
      <DraftsAwaitingSend drafts={drafts.slice(0, 5)} />
      <InvoiceList invoices={recent.slice(0, 12)} />
    </div>
  );
}

function InvoicingHeader() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
          Billing Summary
        </p>
        <h2 className="mt-1 font-serif text-2xl font-extrabold tracking-tight text-court-fg sm:text-3xl">
          Bill, collect, automate.
        </h2>
        <p className="mt-1 max-w-xl text-sm text-court-fg-muted">
          Drafts are auto-created when you confirm a start. Send from Accounts Receivable with the PDF attached.
        </p>
      </div>
      <Link
        href="/invoices"
        className="inline-flex shrink-0 items-center gap-2 rounded-full bg-court-fg px-4 py-2 text-[12px] font-semibold uppercase tracking-wider text-court-surface shadow-sm hover:bg-court-brand-dark"
      >
        Open invoices
      </Link>
    </div>
  );
}

function KpiRow({
  summary,
}: {
  summary: Awaited<ReturnType<typeof getInvoiceSummary>>;
}) {
  const tiles = [
    {
      label: "Outstanding",
      value: formatUsdCents(summary.outstandingCents),
      sub: `${summary.outstandingCount} sent · awaiting payment`,
    },
    {
      label: "Overdue",
      value: formatUsdCents(summary.overdueCents),
      sub: `${summary.overdueCount} past due`,
      warn: summary.overdueCount > 0,
    },
    {
      label: "Billed this quarter",
      value: formatUsdCents(summary.billedThisQuarterCents),
      sub: "Sent + paid in current quarter",
    },
    {
      label: "Collected this quarter",
      value: formatUsdCents(summary.collectedThisQuarterCents),
      sub: "Cash in bank",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className={
            "rounded-2xl border p-5 shadow-sm " +
            (t.warn ? "border-red-200 bg-red-50" : "border-court-border bg-court-surface")
          }
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
            {t.label}
          </p>
          <div className="mt-2 text-[36px] font-extrabold leading-none tracking-[-0.035em] tabular-nums text-court-fg">
            {t.value}
          </div>
          <p className="mt-3 text-[11px] text-court-fg-muted">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}

function AutomationStrip() {
  const steps = [
    { i: 1, label: "Confirm start date", sub: "Upload proof in pipeline", icon: CheckCircle2 },
    { i: 2, label: "Draft auto-created", sub: "Local invoice with placement details", icon: FileText },
    { i: 3, label: "Pick contacts + send", sub: "Billing (To) + Hiring (CC) + AR signs", icon: Mail },
    { i: 4, label: "PDF attaches", sub: "BreakPoint-branded · bank details inside", icon: Send },
    { i: 5, label: "Mark paid", sub: "Manual flip once cash hits the bank", icon: Wallet },
  ];
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-7 shadow-sm">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
          Automation
        </p>
        <h3 className="mt-1 font-serif text-lg font-bold tracking-tight text-court-fg sm:text-xl">
          Start date → cash in bank
        </h3>
        <p className="text-xs text-court-fg-muted">
          Confirming a start in Pipeline auto-creates a DRAFT invoice. Bank details + payment instructions are inside the PDF — no pay links, no external invoicing tools.
        </p>
      </div>
      <ol className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {steps.map((s) => {
          const Ic = s.icon;
          return (
            <li
              key={s.i}
              className="flex flex-col gap-2 rounded-xl border border-court-border bg-court-surface p-4"
            >
              <div className="grid h-8 w-8 place-items-center rounded-full bg-court-surface-subtle text-court-fg-muted">
                <Ic className="h-3.5 w-3.5" />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-court-fg">
                  <span className="mr-1.5 text-court-fg-muted">{s.i}.</span>
                  {s.label}
                </div>
                <p className="mt-0.5 text-[11px] text-court-fg-muted">{s.sub}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function DraftsAwaitingSend({
  drafts,
}: {
  drafts: Awaited<ReturnType<typeof listInvoices>>;
}) {
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-7 shadow-sm">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
            Drafts ready to send
          </p>
          <h3 className="mt-1 font-serif text-lg font-bold tracking-tight text-court-fg sm:text-xl">
            Awaiting send
          </h3>
          <p className="text-xs text-court-fg-muted">
            Auto-created when you upload start-date proof. Open one to review, attach the PDF, and send.&nbsp;
          </p>
        </div>
        {drafts.length > 0 ? (
          <Link
            href="/invoices?filter=drafts"
            className="text-[11px] font-semibold uppercase tracking-wider text-court-brand-dark hover:underline"
          >
            View all drafts
          </Link>
        ) : null}
      </div>
      {drafts.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-court-border bg-court-surface-subtle px-4 py-10 text-center text-[13px] text-court-fg-muted">
          Nothing here yet. Drafts will appear once a placement&apos;s start date is confirmed.
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-court-border rounded-xl border border-court-border">
          {drafts.map((d) => {
            const billing = parseInvoiceContacts(d.billingContacts);
            const candName = d.candidate
              ? `${d.candidate.firstName} ${d.candidate.lastName ?? ""}`.trim()
              : "—";
            return (
              <li key={d.id}>
                <Link
                  href={`/invoices/${d.id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-court-surface-subtle/40"
                >
                  <span className="font-mono text-[12px] font-semibold text-court-fg">
                    {d.invoiceNumber}
                  </span>
                  <span className="text-sm font-medium text-court-fg">{d.client?.name ?? "—"}</span>
                  <span className="text-xs text-court-fg-muted">
                    {candName}
                    {d.roleTitle ? ` · ${d.roleTitle}` : ""}
                  </span>
                  <span className="ml-auto text-[12px] tabular-nums text-court-fg">
                    {formatUsdDecimal(d.feeAmount)}
                  </span>
                  {billing[0]?.email ? (
                    <span className="hidden text-[11px] text-court-fg-muted md:inline">
                      → {billing[0].email}
                    </span>
                  ) : (
                    <span className="hidden text-[11px] font-semibold text-amber-700 md:inline">
                      Needs billing contact
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function InvoiceList({
  invoices,
}: {
  invoices: Awaited<ReturnType<typeof listInvoices>>;
}) {
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface shadow-sm">
      <div className="flex flex-col gap-3 border-b border-court-border p-7 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
            Recent
          </p>
          <h3 className="mt-1 font-serif text-lg font-bold tracking-tight text-court-fg sm:text-xl">
            Latest invoices
          </h3>
        </div>
        <Link
          href="/invoices"
          className="text-[12px] font-semibold uppercase tracking-wider text-court-brand-dark hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-court-border">
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
                  className="px-7 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-7 py-14 text-center text-[13px] text-court-fg-muted">
                  No invoices yet.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => {
                const candName = inv.candidate
                  ? `${inv.candidate.firstName} ${inv.candidate.lastName ?? ""}`.trim()
                  : "—";
                const status = STATUS_COPY[inv.status] ?? { label: inv.status, tone: "bg-court-surface-subtle text-court-fg" };
                const isOverdue = inv.status === "SENT" && inv.dueDate && inv.dueDate < new Date();
                return (
                  <tr key={inv.id} className="border-b border-court-border last:border-b-0 hover:bg-court-surface-subtle/30">
                    <td className="px-7 py-3 align-top">
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="font-mono text-[12px] font-semibold text-court-fg hover:text-court-brand-dark"
                      >
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-7 py-3 align-top">{inv.client?.name ?? "—"}</td>
                    <td className="px-7 py-3 align-top">
                      <div className="font-medium text-court-fg">{candName}</div>
                      <div className="text-[12px] text-court-fg-muted">{inv.roleTitle ?? "—"}</div>
                    </td>
                    <td className="px-7 py-3 align-top tabular-nums">{formatUsdDecimal(inv.feeAmount)}</td>
                    <td className="px-7 py-3 align-top text-court-fg-muted">{formatDate(inv.startDate)}</td>
                    <td className={"px-7 py-3 align-top " + (isOverdue ? "font-semibold text-red-700" : "text-court-fg-muted")}>
                      {formatDate(inv.dueDate)}
                    </td>
                    <td className="px-7 py-3 align-top">
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
      <div className="border-t border-court-border bg-court-surface-subtle/30 px-7 py-3 text-[11px] text-court-fg-muted">
        Sent from <span className="font-semibold text-court-fg">Accounts Receivable</span>. PDF carries bank, ACH, and check details.
      </div>
    </div>
  );
}
