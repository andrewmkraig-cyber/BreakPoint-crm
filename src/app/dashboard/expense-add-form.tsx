"use client";

import { useEffect, useState, useTransition } from "react";
import { X } from "lucide-react";

import { createToolExpense } from "@/app/dashboard/expense-actions";

const FREQUENCY_OPTIONS = [
  "Monthly",
  "Quarterly",
  "Annual",
  "One-time",
] as const;

export function ExpenseAddForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [frequency, setFrequency] = useState<string>(FREQUENCY_OPTIONS[0]);
  const [paidCount, setPaidCount] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // TopBar action "+ New expense" dispatches this event. The form mounts
  // once on the Expenses tab and opens itself when the topbar fires.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("ace:expense:new", handler);
    return () => window.removeEventListener("ace:expense:new", handler);
  }, []);

  function reset() {
    setName("");
    setCost("");
    setFrequency(FREQUENCY_OPTIONS[0]);
    setPaidCount("1");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const costNum = Number(cost);
    const paidNum = Number(paidCount);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!Number.isFinite(costNum) || costNum < 0) {
      setError("Cost must be a non-negative number.");
      return;
    }
    startTransition(async () => {
      const res = await createToolExpense({
        name: name.trim(),
        cost: costNum,
        frequency,
        paidCount: Number.isFinite(paidNum) && paidNum > 0 ? paidNum : 1,
      });
      if (res.ok) {
        reset();
        setOpen(false);
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) return null;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-xl border border-court-border bg-court-surface-subtle/60 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-[140px] flex-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-sm text-court-fg placeholder:text-court-fg-dim focus:border-court-brand focus:outline-none"
          autoFocus
        />
        <input
          type="number"
          step="0.01"
          min="0"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="w-24 rounded-md border border-court-border bg-court-surface px-2 py-1 text-sm tabular-nums text-court-fg placeholder:text-court-fg-dim focus:border-court-brand focus:outline-none"
        />
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          className="rounded-md border border-court-border bg-court-surface px-2 py-1 text-sm text-court-fg focus:border-court-brand focus:outline-none"
        >
          {FREQUENCY_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="1"
          step="1"
          value={paidCount}
          onChange={(e) => setPaidCount(e.target.value)}
          className="w-16 rounded-md border border-court-border bg-court-surface px-2 py-1 text-sm tabular-nums text-court-fg placeholder:text-court-fg-dim focus:border-court-brand focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-court-brand px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-court-brand-dark disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-court-fg-muted transition-colors hover:bg-court-surface hover:text-court-fg"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : null}
    </form>
  );
}
