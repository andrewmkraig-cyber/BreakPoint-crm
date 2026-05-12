import {
  CheckCircle2,
  Clock,
  Mail,
  Sparkles,
  Wallet,
  Send,
} from "lucide-react";

// Invoicing tab — UI shell only. No Invoice model exists yet, no
// Mercury integration, no auto-draft trigger. This page renders the
// final shape so Andrew can see/feel the chrome; every dollar value
// shows "—" and every list shows its empty state until the backend
// lands in a follow-up session.
export function Invoicing() {
  return (
    <div className="flex flex-col gap-7">
      <InvoicingHeader />
      <KpiRow />
      <AutomationStrip />
      <DraftsAwaitingApproval />
      <InvoiceList />
    </div>
  );
}

function InvoicingHeader() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">Invoicing</p>
        <h2 className="mt-1 font-serif text-2xl font-extrabold tracking-tight text-court-fg sm:text-3xl">
          Bill, collect, automate.
        </h2>
        <p className="mt-1 max-w-xl text-sm text-court-fg-muted">
          Invoices will be drafted automatically when you confirm a start date. Approve to send.
        </p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-800">
        <Sparkles className="h-3 w-3" /> Backend wiring · next session
      </span>
    </div>
  );
}

function KpiRow() {
  const tiles = [
    { label: "Outstanding", sub: "Unpaid invoices" },
    { label: "Overdue", sub: "Past due date" },
    { label: "Billed Q2", sub: "Apr 1 – Jun 30" },
    { label: "Collected Q2", sub: "Cash in bank" },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl border border-court-border bg-court-surface p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">{t.label}</p>
          <div className="mt-2 text-[36px] font-extrabold leading-none tracking-[-0.035em] tabular-nums text-court-fg-dim">
            —
          </div>
          <p className="mt-3 text-[11px] text-court-fg-muted">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}

type AutomationState = "done" | "current" | "next";

function AutomationStrip() {
  const steps: Array<{
    i: number;
    label: string;
    sub: string;
    state: AutomationState;
    icon: typeof Mail;
  }> = [
    { i: 1, label: "Confirm start date", sub: "In placement record", state: "next", icon: CheckCircle2 },
    { i: 2, label: "Draft invoice email", sub: "Auto-generated · waits for you", state: "next", icon: Mail },
    { i: 3, label: "Approve & send", sub: "One click, attaches PDF + pay-link", state: "next", icon: Send },
    { i: 4, label: "Auto follow-ups", sub: "Net-aware nudge cadence", state: "next", icon: Clock },
    { i: 5, label: "Mark paid", sub: "Mercury webhook · auto", state: "next", icon: Wallet },
  ];
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-7 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">Automation</p>
          <h3 className="mt-1 font-serif text-lg font-bold tracking-tight text-court-fg sm:text-xl">
            Start date → cash in bank
          </h3>
          <p className="text-xs text-court-fg-muted">
            When you confirm a start in Pipeline or on a candidate profile, this flow will kick off. Every email gets a preview + approve before sending.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-court-border bg-court-surface-subtle px-3 py-1.5 text-xs text-court-fg-muted">
          <span className="font-medium text-court-fg">Mercury sync</span>
          <span className="inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-court-fg-dim/40">
            <span className="ml-0.5 inline-block h-4 w-4 rounded-full bg-court-surface shadow" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">Off</span>
        </span>
      </div>
      <ol className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {steps.map((s) => {
          const Ic = s.icon;
          return (
            <li
              key={s.i}
              className="flex flex-col gap-2 rounded-xl border border-court-border bg-court-surface p-4"
            >
              <div className="flex items-center justify-between">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-court-surface-subtle text-court-fg-muted">
                  <Ic className="h-3.5 w-3.5" />
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-dim">
                  Pending
                </span>
              </div>
              <div>
                <div className="text-[13px] font-semibold text-court-fg">
                  <span className="mr-1.5 text-court-fg-dim">{s.i}.</span>
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

function DraftsAwaitingApproval() {
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-7 shadow-sm">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">Awaiting your approval</p>
          <h3 className="mt-1 font-serif text-lg font-bold tracking-tight text-court-fg sm:text-xl">Drafts ready to send</h3>
          <p className="text-xs text-court-fg-muted">Generated when you upload start-date proof. Approve, edit, or cancel each one.</p>
        </div>
      </div>
      <div className="mt-5 rounded-xl border border-dashed border-court-border bg-court-surface-subtle px-4 py-10 text-center text-[13px] text-court-fg-muted">
        Nothing here yet. Drafts will appear once invoice automation is wired up.
      </div>
    </div>
  );
}

function InvoiceList() {
  const tabs = ["All", "Overdue", "Sent", "Paid", "Drafts"] as const;
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface shadow-sm">
      <div className="flex flex-col gap-3 border-b border-court-border p-7 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">Invoices</p>
          <h3 className="mt-1 font-serif text-lg font-bold tracking-tight text-court-fg sm:text-xl">All invoices</h3>
        </div>
        <div className="inline-flex rounded-full border border-court-border bg-court-surface p-0.5 text-sm">
          {tabs.map((t, i) => (
            <button
              key={t}
              type="button"
              disabled
              aria-pressed={i === 0}
              className={
                "rounded-full px-3 py-1 text-[12px] " +
                (i === 0
                  ? "bg-court-fg text-court-surface font-semibold"
                  : "text-court-fg-muted")
              }
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-court-border">
              {["Invoice", "Client / Contact", "Candidate / Role", "Amount", "Issued", "Due", "Status", "Automation"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-7 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={8} className="px-7 py-14 text-center text-[13px] text-court-fg-muted">
                No invoices yet — this list populates once the Invoice model ships.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
