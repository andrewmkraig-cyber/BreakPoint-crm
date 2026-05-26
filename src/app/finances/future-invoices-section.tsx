"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// Collapsible chrome for the Future Invoices section on /finances. The
// header is a button: click anywhere on it to toggle. Collapsed by
// default per spec - Andrew shouldn't see a wall of scheduled rows
// unless he asks for them. The rows themselves are rendered server-side
// and passed in as children so the server query stays in page.tsx.
export function FutureInvoicesSection({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <div className="rounded-3xl bg-court-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="future-invoices-body"
        className="flex w-full items-center justify-between gap-3 rounded-3xl p-6 text-left transition hover:bg-court-surface-subtle/40"
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
            Future Installments
          </p>
          <h2 className="mt-1 font-serif text-xl font-bold tracking-tight text-court-fg">
            Future Invoices{count > 0 ? ` (${count})` : ""}
          </h2>
        </div>
        <Chevron className="h-5 w-5 shrink-0 text-court-fg-muted" aria-hidden="true" />
      </button>
      {open ? (
        <div id="future-invoices-body" className="border-t border-court-border">
          {children}
        </div>
      ) : null}
    </div>
  );
}
