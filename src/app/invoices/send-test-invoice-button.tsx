"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createTestInvoice } from "./actions";

export function SendTestInvoiceButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await createTestInvoice();
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.push(`/invoices/${result.data.id}`);
          })
        }
        className="inline-flex shrink-0 items-center gap-2 rounded-full border border-court-border bg-court-surface px-4 py-2 text-[12px] font-semibold uppercase tracking-wider text-court-fg shadow-sm transition hover:bg-court-surface-subtle disabled:opacity-60"
      >
        {isPending ? "Creating…" : "Send test invoice to myself"}
      </button>
      {error ? (
        <span className="text-[11px] font-semibold text-red-700">{error}</span>
      ) : null}
    </div>
  );
}
