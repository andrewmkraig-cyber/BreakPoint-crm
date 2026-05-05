"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared score badge + portal-rendered popover. Originally lived inside
// the Find Matches panel; lifted out so any surface that renders a
// score (the panel itself, the /jobs/[id] Matched tab, future Game Plan
// surfaces) can use the same click-for-breakdown UX without
// duplicating positioning + a11y code.
//
// The popover anchors to the badge's getBoundingClientRect, then portals
// into document.body so it never clips against an overflow-hidden
// ancestor — important for the find-matches panel (its panel container
// sets overflow: hidden) and for the inside-card placement in the
// Matched tab.

export type ScoreBreakdown = {
  titleMatch: string;
  locationFit: string;
  experienceFit: string;
  compensationFit: string;
  overallSummary: string;
};

// Score color bands. Six bands so a 92 reads visibly stronger than an
// 86 even though both are "green". Hardcoded color names per the spec —
// these are intentional brand signals that should read identically
// across all six Court modes.
export function scoreTone(score: number): string {
  if (score >= 95) return "bg-green-400 text-white";
  if (score >= 90) return "bg-green-500 text-white";
  if (score >= 85) return "bg-green-600 text-white";
  if (score >= 80) return "bg-green-700 text-white";
  if (score >= 70) return "bg-orange-500 text-white";
  return "bg-gray-400 text-white";
}

const POPOVER_W = 280;
const POPOVER_EST_H = 280;
const POPOVER_PAD = 8;

type PopoverPlacement = { left: number; top: number };

// Loose runtime guard: accepts a ScoreBreakdown-shaped object (every
// field a string) and returns null otherwise. Lets the caller pass the
// raw `scoreBreakdown` JSON column from Prisma without TS-asserting it
// blindly, since legacy rows written before the column existed will
// arrive as null.
export function normalizeBreakdown(
  raw: unknown,
  rationaleFallback: string,
): ScoreBreakdown {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const pickStr = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      titleMatch: pickStr(r.titleMatch),
      locationFit: pickStr(r.locationFit),
      experienceFit: pickStr(r.experienceFit),
      compensationFit: pickStr(r.compensationFit),
      overallSummary: pickStr(r.overallSummary) || rationaleFallback,
    };
  }
  // Legacy / pre-breakdown rows: synthesize an empty breakdown whose
  // overallSummary echoes the rationale, so the popover still has
  // something to show. The four per-axis rows are filtered out below
  // when their value is empty, so the popover collapses to just the
  // score + rationale line.
  return {
    titleMatch: "",
    locationFit: "",
    experienceFit: "",
    compensationFit: "",
    overallSummary: rationaleFallback,
  };
}

export function ScoreBadge({
  score,
  breakdown,
}: {
  score: number;
  breakdown: ScoreBreakdown;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPlacement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const computePos = useCallback((): PopoverPlacement | null => {
    const btn = buttonRef.current;
    if (!btn || typeof window === "undefined") return null;
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.right - POPOVER_W;
    left = Math.max(POPOVER_PAD, Math.min(left, vw - POPOVER_W - POPOVER_PAD));
    const spaceBelow = vh - r.bottom - POPOVER_PAD;
    const spaceAbove = r.top - POPOVER_PAD;
    let top: number;
    if (spaceBelow >= POPOVER_EST_H || spaceBelow >= spaceAbove) {
      top = r.bottom + POPOVER_PAD;
    } else {
      top = Math.max(POPOVER_PAD, r.top - POPOVER_EST_H - POPOVER_PAD);
    }
    return { left, top };
  }, []);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    setPos(computePos());
    const onUpdate = () => setPos(computePos());
    window.addEventListener("scroll", onUpdate, true);
    window.addEventListener("resize", onUpdate);
    return () => {
      window.removeEventListener("scroll", onUpdate, true);
      window.removeEventListener("resize", onUpdate);
    };
  }, [open, computePos]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={`Score ${score} - click for breakdown`}
        aria-expanded={open}
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition focus:outline-none focus:ring-2 focus:ring-court-accent/40",
          scoreTone(score),
        )}
      >
        {score}
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <ScorePopover
              score={score}
              breakdown={breakdown}
              pos={pos}
              ref={popoverRef}
            />,
            document.body,
          )
        : null}
    </>
  );
}

const ScorePopover = forwardRef<
  HTMLDivElement,
  { score: number; breakdown: ScoreBreakdown; pos: PopoverPlacement }
>(function ScorePopover({ score, breakdown, pos }, ref) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Title match", value: breakdown.titleMatch },
    { label: "Location fit", value: breakdown.locationFit },
    { label: "Experience fit", value: breakdown.experienceFit },
    { label: "Compensation fit", value: breakdown.compensationFit },
  ].filter((r) => r.value);
  const copyText = formatBreakdownAsText(score, breakdown, rows);
  return (
    <div
      ref={ref}
      role="dialog"
      style={{
        left: pos.left,
        top: pos.top,
        width: POPOVER_W,
        maxHeight: `calc(100vh - ${pos.top + POPOVER_PAD}px)`,
      }}
      className="group fixed z-[2000] overflow-y-auto rounded-lg border border-court-border bg-court-surface p-3 shadow-2xl"
    >
      <ScoreCopyButton text={copyText} />
      <div className="flex items-center gap-2 pr-7">
        <span className={cn("rounded-full px-2.5 py-1 text-sm font-bold", scoreTone(score))}>
          {score}
        </span>
      </div>
      {breakdown.overallSummary && (
        <p className="mt-2 text-xs leading-relaxed text-court-fg">
          {breakdown.overallSummary}
        </p>
      )}
      {rows.length > 0 && (
        <dl className="mt-3 space-y-2 border-t border-court-border pt-2">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-court-fg">
                {r.label}
              </dt>
              <dd className="mt-0.5 text-[11px] leading-relaxed text-court-fg">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
});

function formatBreakdownAsText(
  score: number,
  breakdown: ScoreBreakdown,
  rows: Array<{ label: string; value: string }>,
): string {
  const lines: string[] = [];
  lines.push(`Score: ${score}`);
  if (breakdown.overallSummary) lines.push(breakdown.overallSummary);
  if (rows.length > 0) {
    lines.push("");
    for (const r of rows) lines.push(`${r.label}: ${r.value}`);
  }
  return lines.join("\n");
}

function ScoreCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in non-secure contexts; silent fail is
      // fine — Ace runs on HTTPS in production and localhost in dev.
    }
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void onCopy();
      }}
      aria-label={copied ? "Copied" : "Copy breakdown"}
      title={copied ? "Copied" : "Copy"}
      className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-court-fg-muted/70 opacity-0 transition group-hover:opacity-100 hover:bg-court-border/40 hover:text-court-fg focus:opacity-100"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-600" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
