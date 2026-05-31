"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
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

// Collapsible call-log thread scoped either to one candidate or to one
// client. Fetches lazily when the accordion opens (same pattern as
// TextingExchanges), renders newest-first rows with a direction icon,
// timestamp, duration, status pill, and a recording link when present.
// Each row is independently click-to-expand, revealing the auto-saved
// transcript + AI summary that Quo's webhook writes through the
// call.transcript.completed / call.summary.completed events.
//
// Discriminated prop: pass exactly one of candidateId or clientId.
// candidateId wins when both are supplied (defensive — should not
// happen with TS narrowing).
export type CallLogsProps =
  | { candidateId: string; clientId?: undefined; defaultOpen?: boolean }
  | { clientId: string; candidateId?: undefined; defaultOpen?: boolean };

const VISIBLE_CALLS_DEFAULT = 3;

export function CallLogs(props: CallLogsProps) {
  const { candidateId, clientId, defaultOpen } = props;
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [logs, setLogs] = useState<CallRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Truncation: collapse to the 3 most recent rows by default. Recruiter
  // hits "Show all N calls" to expand to the full list. Resets back to
  // collapsed if the candidate/client switches (component remounts) or
  // if the underlying list shrinks below the threshold.
  const [showAll, setShowAll] = useState(false);
  const lastKey = useRef<string>("");

  const fetchLogs = useCallback(async () => {
    try {
      const queryParam = candidateId
        ? `candidateId=${encodeURIComponent(candidateId)}`
        : `clientId=${encodeURIComponent(clientId!)}`;
      const res = await fetch(`/api/calls?${queryParam}`, { cache: "no-store" });
      if (!res.ok) {
        setError(`Couldn't load calls (${res.status})`);
        return;
      }
      const rows = (await res.json()) as CallRow[];
      // Dedupe re-renders — if nothing changed since the last fetch, don't
      // flash the list. Keyed on (id, status, duration, summary-presence)
      // so a transcript/summary arriving via webhook re-renders the row.
      const key = rows
        .map(
          (r) =>
            `${r.id}:${r.status}:${r.duration ?? ""}:${r.transcript?.transcript ? "t" : ""}:${r.transcript?.summary ? "s" : ""}`,
        )
        .join("|");
      if (key === lastKey.current) return;
      lastKey.current = key;
      setLogs(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load calls.");
    } finally {
      setLoaded(true);
    }
  }, [candidateId, clientId]);

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
            <>
              <ul className="divide-y divide-border">
                {(showAll ? logs : logs.slice(0, VISIBLE_CALLS_DEFAULT)).map((row) => (
                  <CallRowView key={row.id} row={row} />
                ))}
              </ul>
              {logs.length > VISIBLE_CALLS_DEFAULT && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-2 inline-flex w-auto items-center justify-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-[11px] font-semibold text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
                >
                  {showAll
                    ? `Show 3 most recent`
                    : `Show all ${logs.length} calls`}
                </button>
              )}
            </>
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

  // Whole-row click toggles inline Transcript + Summary. Quo writes
  // both through call.transcript.completed / call.summary.completed
  // webhook events — the recruiter no longer pastes anything by hand.
  // Empty-string transcripts (out-of-order summary-first arrival) read
  // as "not yet available" until the transcript event lands.
  const [expanded, setExpanded] = useState(false);
  const transcriptText = row.transcript?.transcript?.trim() ?? "";
  const summaryText = row.transcript?.summary?.trim() ?? "";
  const hasAnything = Boolean(transcriptText) || Boolean(summaryText);

  return (
    <li className="flex flex-col py-3 text-sm">
      {/* Click target uses role="button" instead of <button> so the
          inline "Generate Summary" action button can be nested without
          violating the no-button-in-button HTML rule. Keyboard parity:
          Enter / Space toggle expand. The recording link and the
          generate-summary button both stopPropagation so clicking
          either doesn't also collapse/expand the row. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        aria-expanded={expanded}
        className="-mx-2 flex w-full cursor-pointer items-start justify-between gap-3 rounded-lg px-2 py-1 text-left transition hover:bg-court-surface-subtle/50"
      >
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
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-court-fg">{directionLabel}</span>
              {counterpartNumber && (
                <span className="text-xs text-court-fg-muted">· {counterpartNumber}</span>
              )}
              {hasAnything && (
                <span className="rounded-full bg-brand-tint px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-brand-dark">
                  Transcript
                </span>
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
                onClick={(e) => e.stopPropagation()}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-dark hover:underline"
              >
                Recording <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={row.status} />
          <ChevronDown
            className={cn(
              "h-4 w-4 text-court-fg-muted transition-transform",
              expanded && "rotate-180",
            )}
          />
        </div>
      </div>

      {expanded && (
        <div className="ml-10 mt-3 space-y-3">
          {/* Transcript — pre-formatted text from Quo (one line per turn,
              "0:00 Speaker: text"). whitespace-pre-wrap preserves the
              line breaks Quo bakes in. */}
          <div className="rounded-lg border border-court-border bg-court-surface-subtle/40 px-3 py-2 text-xs text-court-fg">
            <div className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
              <Phone className="h-2.5 w-2.5" /> Transcript
            </div>
            {transcriptText ? (
              <div className="whitespace-pre-wrap">{transcriptText}</div>
            ) : (
              <div className="italic text-court-fg-muted">
                Transcript not yet available.
              </div>
            )}
          </div>

          {/* Summary — Quo's "Powered by AI" callout, brand-tinted to
              echo the in-app Claude-output styling. */}
          <div className="rounded-lg border border-brand/20 bg-brand-tint/20 px-3 py-2 text-xs text-court-fg">
            <div className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-brand-dark">
              <Sparkles className="h-2.5 w-2.5" /> Summary
            </div>
            {summaryText ? (
              <div className="whitespace-pre-wrap">{summaryText}</div>
            ) : (
              <div className="italic text-court-fg-muted">
                Summary not yet available.
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

// Manual transcript-paste modal. Kept intentionally as dead code so we
// can re-enable a manual override path if Quo's auto-transcription
// drops a call. Quo's webhook (call.transcript.completed /
// call.summary.completed) is the live path. /api/calls/transcript stays
// available for any future caller.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
            className="inline-flex items-center gap-1 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
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
