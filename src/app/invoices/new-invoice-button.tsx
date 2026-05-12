"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { createBlankInvoiceAction } from "./actions";

export function NewInvoiceButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await createBlankInvoiceAction({});
          if (result.ok) router.push(`/invoices/${result.data.id}`);
        })
      }
      className="inline-flex shrink-0 items-center gap-2 rounded-full bg-court-fg px-4 py-2 text-[12px] font-semibold uppercase tracking-wider text-court-surface shadow-sm transition hover:bg-court-brand-dark disabled:opacity-60"
    >
      {isPending ? "Creating…" : "New invoice"}
    </button>
  );
}
