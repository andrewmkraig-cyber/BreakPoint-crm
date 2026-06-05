"use client";

import { useState } from "react";

import { SignalRow, type SignalRowData } from "./signal-row";

// Client wrapper around the signal rows. Owns the set of optimistically
// removed ids so a Dismiss drops the row from view instantly (before the
// server round-trip resolves) and a failed dismissal can restore it. The
// server already excludes DISMISSED from the "all" list, so removed rows
// never reappear on refresh.
export function SignalList({ signals }: { signals: SignalRowData[] }) {
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());

  const remove = (id: string) =>
    setRemoved((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  const restore = (id: string) =>
    setRemoved((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const visible = signals.filter((s) => !removed.has(s.id));

  if (visible.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-court-border bg-court-surface-subtle p-10 text-center">
        <p className="text-sm font-semibold text-court-fg">No client signals yet.</p>
        <p className="mt-1 text-sm text-court-fg-muted">
          TheirStack flags an existing client posting publicly and it lands here.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-court-border rounded-2xl border border-court-border bg-court-surface shadow-sm">
      {visible.map((s) => (
        <SignalRow key={s.id} {...s} onRemove={remove} onRestore={restore} />
      ))}
    </div>
  );
}
