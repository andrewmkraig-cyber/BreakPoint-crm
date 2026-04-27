"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";

type Activity = {
  id: string;
  actionType: string;
  description: string;
  createdAt: string;
  metadata: unknown;
  candidateId: string | null;
  jobId: string | null;
  clientId: string | null;
};

export function ActivityFeed({
  entityType,
  entityId,
}: {
  entityType: "candidate" | "client";
  entityId: string;
}) {
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    fetch(`/api/activity/${entityType}/${encodeURIComponent(entityId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { activities: Activity[] }) => {
        if (!cancelled) setRows(Array.isArray(data?.activities) ? data.activities : []);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load activity");
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  if (rows === null && error === null) {
    return (
      <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
        <Header />
        <p className="mt-3 text-sm text-court-fg-muted">Loading activity…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
        <Header />
        <p className="mt-3 text-sm text-red-700">Couldn&apos;t load activity ({error}).</p>
      </section>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
        <Header />
        <p className="mt-3 text-sm text-court-fg-muted">No activity yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-court-border bg-court-surface shadow-sm">
      <div className="flex items-center gap-2 border-b border-court-border px-5 py-3">
        <History className="h-4 w-4 text-court-fg-muted" />
        <h2 className="font-serif text-base font-semibold text-court-fg">Activity</h2>
        <span className="text-xs text-court-fg-muted">{rows.length} {rows.length === 1 ? "event" : "events"}</span>
      </div>
      <ul className="divide-y divide-court-border">
        {rows.map((r) => (
          <ActivityRow key={r.id} row={r} />
        ))}
      </ul>
    </section>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <History className="h-4 w-4 text-court-fg-muted" />
      <h2 className="font-serif text-base font-semibold text-court-fg">Activity</h2>
    </div>
  );
}

function ActivityRow({ row }: { row: Activity }) {
  const when = new Date(row.createdAt);
  const absolute = when.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const relative = formatRelative(when);
  return (
    <li className="px-5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm text-court-fg">{row.description}</div>
        <div className="shrink-0 text-[11px] text-court-fg-muted" title={absolute}>
          {relative}
        </div>
      </div>
      <div className="mt-0.5 text-[11px] text-court-fg-muted">{absolute}</div>
    </li>
  );
}

function formatRelative(when: Date): string {
  const diffMs = Date.now() - when.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(day / 365);
  return `${yr}y ago`;
}
