"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// TopBar mini-calendar popover. The trigger is a square date stamp —
// green weekday-abbrev band on top, month label + bold day number
// underneath — sitting flush in the topbar between the weather widget
// and the profile pill. Clicking it opens a month-grid popover that
// reads event days for the current org from /api/calendar/event-days.

const ZONE = "America/New_York";
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type TodayParts = {
  year: number;
  month0: number;
  day: number;
  weekdayLong: string;
  weekdayShort: string;
  monthLong: string;
  monthShort: string;
};

function formatYmd(year: number, month0: number, day: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayParts(): TodayParts {
  const now = new Date();
  const numericFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const numericParts = numericFmt.formatToParts(now);
  const nGet = (t: string) =>
    Number(numericParts.find((p) => p.type === t)?.value ?? "0");
  const labelFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "long",
    month: "long",
  });
  const labelParts = labelFmt.formatToParts(now);
  const lGet = (t: string) =>
    labelParts.find((p) => p.type === t)?.value ?? "";
  const shortFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "short",
  });
  const weekdayShort =
    shortFmt.formatToParts(now).find((p) => p.type === "weekday")?.value ?? "";
  const monthShortFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    month: "short",
  });
  const monthShort =
    monthShortFmt.formatToParts(now).find((p) => p.type === "month")?.value ??
    "";
  return {
    year: nGet("year"),
    month0: nGet("month") - 1,
    day: nGet("day"),
    weekdayLong: lGet("weekday"),
    weekdayShort,
    monthLong: lGet("month"),
    monthShort,
  };
}

type Cell =
  | { kind: "in"; day: number; ymd: string; isToday: boolean }
  | { kind: "out" };

// Build a 6-row Mon-Sun matrix for the given month. Leading cells
// before the 1st (Mon-indexed) and trailing cells after the last day
// render as ghost slots so the grid keeps a stable 6x7 footprint.
function buildMonthGrid(
  year: number,
  month0: number,
  today: { year: number; month0: number; day: number },
): Cell[] {
  const firstDow = new Date(year, month0, 1).getDay(); // 0=Sun
  const monIdx = (firstDow + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const cells: Cell[] = [];
  for (let i = 0; i < monIdx; i += 1) cells.push({ kind: "out" });
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push({
      kind: "in",
      day: d,
      ymd: formatYmd(year, month0, d),
      isToday:
        year === today.year && month0 === today.month0 && d === today.day,
    });
  }
  while (cells.length % 7 !== 0) cells.push({ kind: "out" });
  while (cells.length < 42) cells.push({ kind: "out" });
  return cells;
}

function monthLabel(year: number, month0: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month0, 1));
}

export function CalendarPopoverButton() {
  const [open, setOpen] = useState(false);
  const today = useMemo(() => todayParts(), []);
  const [viewYear, setViewYear] = useState(today.year);
  const [viewMonth, setViewMonth] = useState(today.month0);
  const [eventDays, setEventDays] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const node = rootRef.current;
      if (!node) return;
      if (e.target instanceof Node && node.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Fetch event-days for the viewed month each time it changes while
  // the popover is open. Aborts in-flight fetches so a fast prev/next
  // tap doesn't paint stale dots.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const monthParam = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;
    fetch(`/api/calendar/event-days?month=${monthParam}`, {
      signal: ctrl.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body?.ok || !Array.isArray(body.days)) return;
        setEventDays(new Set(body.days as string[]));
      })
      .catch(() => {
        // Silent: dots just won't render. The popover is read-only and
        // already useful without them.
      });
    return () => ctrl.abort();
  }, [open, viewYear, viewMonth]);

  const cells = useMemo(
    () => buildMonthGrid(viewYear, viewMonth, today),
    [viewYear, viewMonth, today],
  );

  const goPrev = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const goNext = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Calendar - ${today.weekdayLong} ${today.monthLong} ${today.day}`}
        aria-expanded={open}
        className={
          // Fixed 44x40 date stamp. h-10 (40px) matches the avatar and
          // icon buttons exactly so the chip sits even/centered with the
          // profile icon in the items-center topbar row. A defined width
          // (vs. content-sizing) guarantees the green weekday band can run
          // edge to edge with no dead space on the right.
          "group inline-flex h-10 w-11 shrink-0 flex-col overflow-hidden rounded-lg shadow-sm ring-1 transition-all duration-150 ease-out hover:-translate-y-0.5 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-court-brand/40 " +
          (open ? "ring-court-brand" : "ring-court-border")
        }
      >
        {/* Weekday band: block w-full forces it flush to the full chip
            width (left + right), independent of any flex stretch quirk,
            so the green fills all the way to the right edge. py-px (vs
            py-0.5) trims the band so the month + day stack rides higher. */}
        <span className="block w-full bg-court-brand-tint px-1 py-px text-center text-[9px] font-extrabold uppercase leading-none text-court-brand">
          {today.weekdayShort}
        </span>
        {/* Month + day sit directly under the band (no flex-1 stretch /
            justify-center, which previously centered them in the lower
            two-thirds and dropped the bold day number below the row's
            center line). Top-anchored, the day number now lands on the
            same vertical center as the weather chip number and the avatar.
            The unused space below is court-surface (the topbar's own bg) so
            it stays invisible. */}
        <span className="flex w-full flex-col items-center bg-court-surface px-1 pt-px leading-none">
          <span className="text-[8px] font-semibold uppercase text-court-fg-muted">
            {today.monthShort}
          </span>
          <span className="text-sm font-black leading-none text-court-fg">
            {today.day}
          </span>
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Calendar overview"
          className="absolute right-0 top-full z-40 mt-2 w-72 rounded-2xl border border-court-border bg-court-surface p-3 shadow-[0_8px_28px_rgba(0,0,0,0.12)]"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous month"
              className="grid h-7 w-7 place-items-center rounded-full border border-court-border bg-court-surface text-court-fg-muted transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <p className="font-serif text-sm font-bold tracking-tight text-court-fg">
              {monthLabel(viewYear, viewMonth)}
            </p>
            <button
              type="button"
              onClick={goNext}
              aria-label="Next month"
              className="grid h-7 w-7 place-items-center rounded-full border border-court-border bg-court-surface text-court-fg-muted transition hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-y-1 text-center text-[10px] font-semibold uppercase tracking-wide text-court-fg-muted">
            {WEEKDAY_LABELS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-y-1">
            {cells.map((cell, i) => (
              <div
                key={i}
                className="flex h-9 flex-col items-center justify-center text-[12px] tabular-nums"
              >
                {cell.kind === "in" ? (
                  <>
                    <span
                      className={
                        "grid h-6 w-6 place-items-center rounded-full " +
                        (cell.isToday
                          ? "bg-court-brand font-semibold text-white"
                          : "text-court-fg")
                      }
                    >
                      {cell.day}
                    </span>
                    <span
                      className={
                        "mt-0.5 h-1 w-1 rounded-full " +
                        (eventDays.has(cell.ymd)
                          ? "bg-court-brand"
                          : "bg-transparent")
                      }
                      aria-hidden
                    />
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
