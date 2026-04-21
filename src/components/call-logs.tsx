"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Phone, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { cn } from "@/lib/utils";

type CallRow = {
  id: string;
  candidateId: string;
  direction: string;
  fromNumber: string;
  toNumber: string;
  duration: number | null;
  status: string;
  recordingUrl: string | null;
  krispcallId: string | null;
  createdAt: string;
  transcript: { id: string; summary: string | null } | null;
};

// Collapsible call-log thread for a single candidate. Fetches lazily when the
// accordion opens (same pattern as TextingExchanges), renders newest-first
// rows with a direction icon, timestamp, duration, status pill, and a
// recording link when present. No polling — call rows land via the Krispcall
// webhook after the call completes; a quick close/reopen of the accordion is
// the recruiter's refresh affordance.
export function CallLogs({ candidateId }: { candidateId: string }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<CallRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastKey = useRef<string>("");

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/calls?candidateId=${encodeURIComponent(candidateId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setError(`Couldn't load calls (${res.status})`);
        return;
      }
      const rows = (await res.json()) as CallRow[];
      // Dedupe re-renders — if nothing changed since the last fetch, don't
      // flash the list. Keyed on (id, status, duration) since duration
      // typically gets filled in after the call completes.
      const key = rows.map((r) => `${r.id}:${r.status}:${r.duration ?? ""}`).join("|");
      if (key === lastKey.current) return;
      lastKey.current = key;
      setLogs(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load calls.");
    } finally {
      setLoaded(true);
    }
  }, [candidateId]);

  useEffect(() => {
    if (!open) return;
    void fetchLogs();
  }, [open, fetchLogs]);

  return (
    <section className="rounded-xl border border-border bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-serif text-base font-semibold text-navy">Call Logs</h2>
          {loaded && logs.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-navy-400">
              {logs.length}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="border-t border-border p-4">
          {!loaded ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading calls…</div>
          ) : logs.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No calls logged yet</div>
          ) : (
            <ul className="divide-y divide-border">
              {logs.map((row) => (
                <CallRowView key={row.id} row={row} />
              ))}
            </ul>
          )}
          {error && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-800">
              {error}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CallRowView({ row }: { row: CallRow }) {
  const outbound = row.direction === "outbound";
  const Icon = outbound ? PhoneOutgoing : PhoneIncoming;
  const directionLabel = outbound ? "Outbound" : "Inbound";
  const counterpartNumber = outbound ? row.toNumber : row.fromNumber;

  return (
    <li className="flex items-start justify-between gap-3 py-3 text-sm">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            outbound ? "bg-emerald-50 text-emerald-700" : "bg-muted text-navy-400",
          )}
          title={directionLabel}
          aria-label={directionLabel}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold text-navy">{directionLabel}</span>
            {counterpartNumber && (
              <span className="text-xs text-muted-foreground">· {counterpartNumber}</span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {formatTs(row.createdAt)}
            {row.duration != null && <span className="ml-2">· {formatDuration(row.duration)}</span>}
          </div>
          {row.recordingUrl && (
            <a
              href={row.recordingUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-dark hover:underline"
            >
              Recording <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
      <StatusPill status={row.status} />
    </li>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "bg-emerald-50 text-emerald-700"
      : status === "failed" || status === "missed"
        ? "bg-red-50 text-red-700"
        : status === "initiated" || status === "in_progress"
          ? "bg-amber-50 text-amber-700"
          : "bg-muted text-navy-400";
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", tone)}>
      {status}
    </span>
  );
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay) return time;
    const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    return `${date} · ${time}`;
  } catch {
    return iso;
  }
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
