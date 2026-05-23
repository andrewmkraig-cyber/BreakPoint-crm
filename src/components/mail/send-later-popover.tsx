"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Clock, Loader2, X } from "lucide-react";
import {
  DEFAULT_TIMEZONE,
  TIMEZONE_OPTIONS,
  defaultScheduleInputs,
  scheduleInputToUtcISO,
} from "@/lib/timezone";
import { TimeSelect } from "@/components/calendar/time-select";

// Shared "Send Later" picker. useSendLater returns a trigger ref, an
// open/close handle, and the popover node to render. Each email surface
// keeps its own Send Later button styled to match its footer, wires the
// ref + onClick, and drops {popover} into the tree. onConfirm receives the
// resolved absolute instant (ISO UTC) plus the chosen IANA zone; throw
// from it to surface an inline error and keep the popover open.

type OnConfirm = (scheduledSendAtISO: string, timezone: string) => Promise<void>;

export function useSendLater(onConfirm: OnConfirm): {
  triggerRef: React.RefObject<HTMLButtonElement>;
  open: boolean;
  setOpen: (open: boolean) => void;
  popover: ReactNode;
} {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const popover = open ? (
    <SendLaterPopover
      triggerRef={triggerRef}
      onClose={() => setOpen(false)}
      onConfirm={onConfirm}
    />
  ) : null;

  return { triggerRef, open, setOpen, popover };
}

function SendLaterPopover({
  triggerRef,
  onClose,
  onConfirm,
}: {
  triggerRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
  onConfirm: OnConfirm;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const initial = useRef(defaultScheduleInputs(DEFAULT_TIMEZONE));
  const [date, setDate] = useState(initial.current.date);
  const [time, setTime] = useState(initial.current.time);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Anchor the popover's bottom-right just above the trigger so it never
  // needs to know its own height before painting. fixed positioning keeps
  // it correct inside portal'd / transformed composer parents.
  useEffect(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      right: Math.max(8, window.innerWidth - rect.right),
      bottom: Math.max(8, window.innerHeight - rect.top + 8),
    });
  }, [triggerRef]);

  // Close on outside click + Escape.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, triggerRef]);

  const confirm = useCallback(async () => {
    setErr(null);
    const iso = scheduleInputToUtcISO(date, time, timezone);
    if (!iso) {
      setErr("Pick a valid date and time.");
      return;
    }
    if (new Date(iso).getTime() < Date.now()) {
      setErr("Pick a time in the future.");
      return;
    }
    setBusy(true);
    try {
      await onConfirm(iso, timezone);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not schedule.");
    } finally {
      setBusy(false);
    }
  }, [date, time, timezone, onConfirm, onClose]);

  if (typeof document === "undefined") return null;

  const todayStr = defaultScheduleInputs(timezone).date;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Schedule send"
      style={{
        position: "fixed",
        right: pos?.right ?? 16,
        bottom: pos?.bottom ?? 16,
        zIndex: 2147483000,
        visibility: pos ? "visible" : "hidden",
      }}
      className="w-72 rounded-xl backdrop-blur-md bg-court-surface/90 border border-court-border/40 p-3 shadow-[0_8px_32px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.12)]"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-court-fg">
          <Clock className="h-3.5 w-3.5 text-court-brand-dark" />
          Schedule send
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-court-border bg-court-surface text-court-fg-muted transition hover:text-court-fg"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-court-fg-muted">
        Date
      </label>
      <input
        type="date"
        value={date}
        min={todayStr}
        onChange={(e) => setDate(e.target.value)}
        className="mb-2 w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-xs text-court-fg focus:border-court-brand focus:outline-none"
      />

      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-court-fg-muted">
        Time
      </label>
      <div className="mb-2">
        <TimeSelect value={time} onChange={setTime} ariaLabel="Time" />
      </div>

      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-court-fg-muted">
        Timezone
      </label>
      <select
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
        className="mb-2 w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-xs text-court-fg focus:border-court-brand focus:outline-none"
      >
        {TIMEZONE_OPTIONS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      {err ? (
        <p className="mb-2 text-[11px] text-red-600">{err}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark transition hover:bg-court-brand/25 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Clock className="h-3.5 w-3.5" />
          )}
          Schedule
        </button>
      </div>
    </div>,
    document.body,
  );
}
