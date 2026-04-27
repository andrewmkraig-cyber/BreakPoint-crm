"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Loader2,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type TranscriptShape = {
  id?: string;
  summary: string | null;
  transcript?: string;
};

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
  transcript: TranscriptShape | null;
};

// Collapsible call-log thread for a single candidate. Fetches lazily when the
// accordion opens (same pattern as TextingExchanges), renders newest-first
// rows with a direction icon, timestamp, duration, status pill, and a
// recording link when present. No polling — call rows land via the Krispcall
// webhook after the call completes; a quick close/reopen of the accordion is
// the recruiter's refresh affordance.
export function CallLogs({ candidateId, defaultOpen }: { candidateId: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
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
    <section className="rounded-xl border border-court-border bg-court-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-court-fg-muted" />
          <h2 className="font-serif text-base font-semibold text-court-fg">Call Logs</h2>
          {loaded && logs.length > 0 && (
            <span className="rounded-full bg-court-surface-subtle px-2 py-0.5 text-[11px] font-semibold text-court-fg-muted">
              {logs.length}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-court-fg-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="border-t border-court-border p-4">
          {!loaded ? (
            <div className="py-6 text-center text-sm text-court-fg-muted">Loading calls…</div>
          ) : logs.length === 0 ? (
            <div className="py-6 text-center text-sm text-court-fg-muted">No calls logged yet</div>
          ) : (
            <ul className="divide-y divide-border">
              {logs.map((row) => (
                <CallRowView key={row.id} row={row} onChanged={fetchLogs} />
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

function CallRowView({ row, onChanged }: { row: CallRow; onChanged: () => void }) {
  const outbound = row.direction === "outbound";
  const Icon = outbound ? PhoneOutgoing : PhoneIncoming;
  const directionLabel = outbound ? "Outbound" : "Inbound";
  const counterpartNumber = outbound ? row.toNumber : row.fromNumber;

  const [transcriptModalOpen, setTranscriptModalOpen] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  // Optimistic in-session override for the summary text. The server persists
  // to CallTranscript.summary and the parent's fetchLogs refresh would pick
  // it up, but we also mirror it here so the result appears instantly without
  // a round-trip.
  const [liveSummary, setLiveSummary] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const hasTranscript = Boolean(row.transcript);
  const currentSummary = liveSummary ?? row.transcript?.summary ?? null;

  async function onGenerateSummary() {
    setSummaryError(null);
    setSummarizing(true);
    try {
      const res = await fetch("/api/calls/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callLogId: row.id }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setSummaryError(text || `Summary failed (${res.status})`);
        return;
      }
      const json = (await res.json()) as { summary?: string };
      if (json.summary) {
        setLiveSummary(json.summary);
        onChanged();
      }
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : "Summary failed.");
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <>
      <li className="flex flex-col gap-2 py-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                outbound ? "bg-emerald-50 text-emerald-700" : "bg-court-surface-subtle text-court-fg-muted",
              )}
              title={directionLabel}
              aria-label={directionLabel}
            >
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-court-fg">{directionLabel}</span>
                {counterpartNumber && (
                  <span className="text-xs text-court-fg-muted">· {counterpartNumber}</span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-court-fg-muted">
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
        </div>

        {/* Action bar — sits below the meta row so it never crowds the
            direction/number line. Paste Transcript is always available (an
            upsert on the server so re-paste just overwrites). Generate
            Summary only appears once a transcript row exists. */}
        <div className="flex flex-wrap items-center gap-2 pl-10">
          <button
            type="button"
            onClick={() => setTranscriptModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-semibold text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
          >
            <FileText className="h-3 w-3" />
            {hasTranscript ? "Edit Transcript" : "Paste Transcript"}
          </button>
          {hasTranscript && (
            <button
              type="button"
              onClick={() => void onGenerateSummary()}
              disabled={summarizing}
              className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand-tint px-2 py-1 text-[11px] font-semibold text-brand-dark shadow-sm transition hover:bg-brand-tint/70 disabled:opacity-60"
            >
              {summarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {currentSummary ? "Regenerate Summary" : "Generate Summary"}
            </button>
          )}
        </div>

        {currentSummary && (
          <div className="ml-10 rounded-lg border border-brand/20 bg-brand-tint/20 px-3 py-2 text-xs text-court-fg whitespace-pre-wrap">
            <div className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-brand-dark">
              <Sparkles className="h-2.5 w-2.5" /> Summary
            </div>
            <div>{currentSummary}</div>
          </div>
        )}
        {summaryError && (
          <div className="ml-10 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-800">
            {summaryError}
          </div>
        )}
      </li>

      {transcriptModalOpen && (
        <TranscriptModal
          callLogId={row.id}
          initial={row.transcript?.transcript ?? ""}
          onClose={() => setTranscriptModalOpen(false)}
          onSaved={() => {
            setTranscriptModalOpen(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function TranscriptModal({
  callLogId,
  initial,
  onClose,
  onSaved,
}: {
  callLogId: string;
  initial: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    if (!text.trim()) {
      setError("Paste a transcript before saving.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/calls/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callLogId, transcript: text }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        setError(msg || `Save failed (${res.status})`);
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-xl">
        <div className="flex items-start justify-between border-b border-court-border px-5 py-3">
          <div>
            <h3 className="font-serif text-base font-semibold text-court-fg">Paste call transcript</h3>
            <p className="mt-0.5 text-[11px] text-court-fg-muted">
              Save verbatim text; Claude will summarize on demand via Generate Summary.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle disabled:opacity-60"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder="Paste the transcript here…"
            className="w-full flex-1 resize-y rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-court-border bg-court-surface-subtle/40 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save Transcript
          </button>
        </div>
      </div>
    </div>
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
          : "bg-court-surface-subtle text-court-fg-muted";
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
