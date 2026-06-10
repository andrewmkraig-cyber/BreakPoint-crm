"use client";

// Shared placement / interview UI primitives and helpers, extracted verbatim
// from placement-flows.tsx (Ace 69.0, Phase A). Behavior-neutral move so both
// the legacy RF placement flow (placement-flows.tsx) and the Ace-native
// surfaces (local-placement-rows.tsx, local-candidate-actions.tsx) import the
// same code from one neutral location instead of from the legacy file.
import { useEffect, useRef, useState, useTransition, type ChangeEvent, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Edit3, Loader2, RotateCcw, Save, UploadCloud, UserX, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TEAM_BCC_OPTIONS } from "@/lib/team-contacts";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  useDraggableResizable,
  MODAL_MIN_W,
  MODAL_MIN_H,
} from "@/lib/use-draggable-resizable";
import { confirmStart } from "@/app/candidates/[id]/placement-actions";

export type ClientContactRef = {
  id: number;
  name: string;
  title: string;
  email: string;
};

export function ConfirmStartDialog({
  placementId,
  jobTitle,
  onClose,
  onEditPlacement,
}: {
  placementId: string;
  jobTitle: string;
  onClose: () => void;
  // Called when Andrew wants to amend placement fields (fee, start date,
  // billing contacts) before actually confirming the start. Parent handles
  // the transition — we just close Confirm and let the parent open Edit.
  onEditPlacement: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  // Block the browser's default behavior of opening a dropped image in a new
  // tab if the user releases the mouse outside the dropzone. Use capture phase
  // so we preventDefault before any handler (inside or outside React) can react.
  useEffect(() => {
    const block = (e: Event) => {
      e.preventDefault();
    };
    window.addEventListener("dragenter", block, true);
    window.addEventListener("dragover", block, true);
    window.addEventListener("drop", block, true);
    return () => {
      window.removeEventListener("dragenter", block, true);
      window.removeEventListener("dragover", block, true);
      window.removeEventListener("drop", block, true);
    };
  }, []);

  function handleFile(f: File | null) {
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
    setErr(null);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    handleFile(e.target.files?.[0] ?? null);
  }

  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (!dragActive) setDragActive(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const dropped = e.dataTransfer?.files?.[0];
    if (!dropped) return;
    if (!dropped.type.startsWith("image/")) {
      setErr("Only image files are supported.");
      return;
    }
    handleFile(dropped);
  }

  async function onSave() {
    setErr(null);
    if (!file) {
      setErr("Upload a screenshot confirming the start.");
      return;
    }
    startSave(async () => {
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const result = await confirmStart({ placementId, screenshotBase64: base64, mimeType: file.type || "image/png" });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't confirm start", { description: result.error });
        return;
      }
      if (result.value?.customTermsFired) {
        toast.success("Start confirmed - invoice draft created for installment 1", {
          description:
            result.value.remindersSet > 0
              ? `Reminders set for ${result.value.remindersSet} remaining installment${
                  result.value.remindersSet === 1 ? "" : "s"
                }`
              : undefined,
        });
      } else {
        toast.success("Start confirmed. Candidate moved to Hired", {
          description: "Opening invoice email composer…",
        });
      }
      onClose();
      // 2026-05-27: Confirm Start now hands off to the invoice email
      // composer instead of leaving the recruiter on the candidate page.
      // ?compose=1 tells the invoice page to auto-pop handleEmailDraft on
      // mount so Andrew lands in a ready-to-review-and-send composer
      // without an extra click. Falls back to router.refresh() when the
      // draft creation failed and we have no invoice id to navigate to.
      if (result.value?.invoiceId) {
        router.push(`/invoices/${result.value.invoiceId}?compose=1`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <Modal title="Confirm start" subtitle={jobTitle} onClose={onClose}>
      <p className="text-sm text-court-fg-muted">
        Upload a screenshot of the start confirmation (email, portal, HR tool). This seals the placement and flags it
        for invoicing.
      </p>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-court-border bg-court-surface-subtle/40 px-6 py-8 text-center transition hover:border-brand/40 hover:bg-brand-tint/20",
          (file || dragActive) && "border-brand/40 bg-brand-tint/20",
        )}
      >
        <UploadCloud className="h-5 w-5 text-court-fg-muted" />
        <div className="text-sm font-semibold text-court-fg">
          {file ? file.name : dragActive ? "Drop screenshot here" : "Click or drag a screenshot here"}
        </div>
        <div className="text-xs text-court-fg-muted">PNG / JPG up to 4MB</div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onPick}
        />
      </div>
      {previewUrl && (
        <div className="mt-3 overflow-hidden rounded-lg border border-court-border/40 bg-court-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Start confirmation preview" className="max-h-64 w-full object-contain" />
        </div>
      )}
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      {/* Edit Placement prompt sits ABOVE the Cancel / Confirm Start
          footer so the recruiter sees the "fix something first?" escape
          hatch BEFORE committing — flipped from the prior order on
          2026-05-07 because the buried prompt below the footer was easy
          to miss. Closes Confirm and hands off to the parent, which
          opens the pre-filled PlacementDialog for the same (candidate,
          job). */}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-court-border/40 bg-court-surface-subtle/40 px-3 py-2 text-xs">
        <span className="text-court-fg-muted">
          Need to fix the fee, start date, or billing contacts first?
        </span>
        <button
          type="button"
          onClick={() => {
            onClose();
            onEditPlacement();
          }}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2.5 py-1 text-[11px] font-semibold text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg disabled:opacity-60"
        >
          <Edit3 className="h-3 w-3" /> Edit Placement
        </button>
      </div>
      <ModalFooter onCancel={onClose} onSave={onSave} saving={isPending} saveLabel="Confirm start" />
    </Modal>
  );
}

export function formatOpenJobOption(j: {
  jobTitle: string;
  jobLocation?: string | null;
  jobCompensation?: string | null;
  clientName: string;
  alreadyLinked: boolean;
  linkedStage?: string | null;
}): string {
  const head = j.clientName ? `${j.clientName}: ${j.jobTitle}` : j.jobTitle;
  const tail: string[] = [];
  if (j.jobLocation) tail.push(j.jobLocation);
  if (j.jobCompensation) tail.push(j.jobCompensation);
  const line = tail.length > 0 ? `${head} · ${tail.join(" · ")}` : head;
  if (!j.alreadyLinked) return line;
  const stageHint = j.linkedStage ? `already ${j.linkedStage.toLowerCase()}` : "already linked";
  return `${line} (${stageHint})`;
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
  dismissOnOverlay = true,
  draggable = false,
  resizable = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  // Default true preserves the original "click outside to close"
  // behavior every existing consumer of <Modal> relies on. The Offer
  // dialog passes false so the recruiter can only close via the X
  // (or the Cancel button) — half-filled offer fields shouldn't get
  // discarded by a stray click on the dim backdrop.
  dismissOnOverlay?: boolean;
  // Opt-in drag (header) + resize (bottom-right corner). Ace 67.11 — the
  // OfferDialog passes both true so the recruiter can move/resize the
  // offer popup without losing the row underneath. Every other Modal
  // consumer leaves these false and behaves exactly as before.
  draggable?: boolean;
  resizable?: boolean;
}) {
  // Defensive Escape guard. The custom Modal has no native Escape
  // handler today, so Escape already does nothing — but if this modal
  // is ever rendered inside a Radix Dialog ancestor in the future,
  // Escape would close the ancestor and unmount us. Installing a
  // capture-phase listener that swallows Escape while dismissOnOverlay
  // is false makes the "Escape inert" guarantee resilient to that
  // future change.
  useEffect(() => {
    if (dismissOnOverlay) return;
    function block(e: KeyboardEvent) {
      if (e.key === "Escape") e.stopPropagation();
    }
    window.addEventListener("keydown", block, { capture: true });
    return () => window.removeEventListener("keydown", block, { capture: true });
  }, [dismissOnOverlay]);

  // Opt-in drag + resize. Default width when resizable matches the prior
  // max-w-lg / max-w-2xl Tailwind cap (32rem / 42rem = 512 / 672 px) so the
  // panel's first paint is visually identical to the pre-67.11 layout —
  // the recruiter only notices the difference when they grab the header
  // or the corner. State lives in the hook; component unmount on close
  // resets it, so reopening the modal snaps back to centered + default.
  const { position, size, isDragging, isResizing, headerHandlers, resizeHandlers } =
    useDraggableResizable({
      enableDrag: draggable,
      enableResize: resizable,
      initialWidth: resizable ? (wide ? 672 : 512) : null,
    });

  // Portal to document.body so the overlay escapes the candidate
  // profile's React tree. Without the portal, ancestor stacking
  // contexts / containing blocks (e.g. backdrop-filter, transform,
  // contain) can trap `fixed inset-0` inside the page layout — the
  // visible symptom is the app shell (sidebar / topbar) bleeding
  // through the modal because the overlay no longer covers the full
  // viewport. Guard SSR with typeof document === "undefined".
  if (typeof document === "undefined") return null;
  return createPortal(
    // Two-layer overlay: the outer fixed container handles the dim
    // backdrop and the scroll fallback if a panel ever does exceed
    // the viewport; the inner flex wrapper (min-h-full items-center)
    // vertically centers the panel inside the available space. This
    // avoids the failure mode where a single-layer `flex items-center`
    // overlay can push the panel's top above the viewport on a short
    // laptop screen — symptom is the title and the first form fields
    // sit above the top of the screen even though the body scrolls
    // internally. Outer padding (p-4 sm:p-6) plus the responsive panel
    // max-height (calc(100dvh - 2rem) / -3rem) together guarantee a
    // breathing margin between the panel edge and the viewport edge.
    <div
      className="fixed inset-0 z-[200] overflow-y-auto bg-ink/40 p-4 sm:p-6"
      // When dismissOnOverlay is false the backdrop swallows clicks
      // (still stopPropagation so the panel below doesn't double-fire)
      // but never calls onClose. The X button in the header is the
      // only close path in that mode.
      onClick={dismissOnOverlay ? onClose : (e) => e.stopPropagation()}
    >
      <div className="flex min-h-full items-center justify-center">
        {/* Flex-column shell capped at viewport height so header +
            scrollable body + footer together can never exceed the
            screen. Header and footer are flex-none so the title and
            action buttons stay pinned; the middle body gets flex-1 +
            min-h-0 so it shrinks and scrolls internally instead of
            pushing the modal off-screen.

            When resizable, the max-w-lg / max-h-... Tailwind caps come
            off and we govern the panel size via inline width/height +
            inline 90vw/90vh maxes so the corner handle can drag past
            the old 32rem ceiling. relative anchors the corner handle
            inside the panel rect. */}
        <div
          className={cn(
            "flex w-full flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-xl",
            !resizable && "max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)]",
            !resizable && (wide ? "max-w-2xl" : "max-w-lg"),
            (draggable || resizable) && "relative",
            (isDragging || isResizing) && "select-none",
          )}
          style={
            draggable || resizable
              ? {
                  width: size.w ?? undefined,
                  height: size.h ?? undefined,
                  minWidth: resizable ? MODAL_MIN_W : undefined,
                  minHeight: resizable ? MODAL_MIN_H : undefined,
                  maxWidth: resizable ? "90vw" : undefined,
                  maxHeight: resizable ? "90vh" : undefined,
                  transform:
                    draggable && (position.x !== 0 || position.y !== 0)
                      ? `translate3d(${position.x}px, ${position.y}px, 0)`
                      : undefined,
                }
              : undefined
          }
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={cn(
              "flex flex-none items-start justify-between border-b border-court-border px-5 py-3",
              draggable && "cursor-move touch-none",
            )}
            {...headerHandlers}
          >
            <div>
              <h2 className="font-serif text-lg font-semibold text-court-fg">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-court-fg-muted">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
          {footer && (
            <div className="flex flex-none items-center justify-end gap-2 border-t border-court-border bg-court-surface px-5 py-3">
              {footer}
            </div>
          )}
          {resizable && (
            // Corner resize handle. cursor-nwse-resize matches the
            // OS-standard SE-corner cursor; touch-none disables the
            // browser's default touch-scroll on this hit area so the
            // resize gesture starts cleanly on tablets. The two diagonal
            // ticks reuse the same currentColor / muted token the Notes
            // textarea's native resize affordance reads as.
            <div
              {...resizeHandlers}
              aria-hidden
              className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize touch-none"
            >
              <svg viewBox="0 0 16 16" className="h-full w-full text-court-fg-muted/70">
                <path
                  d="M13 7v6h-6M13 11v2h-2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ModalFooter({
  onCancel,
  onSave,
  saving,
  saveLabel = "Save",
}: {
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel?: string;
}) {
  const lowered = saveLabel.toLowerCase();
  const SaveIcon = lowered === "reject"
    ? UserX
    : lowered === "reactivate"
      ? RotateCcw
      : Save;
  // Variant chooses by intent so "Apply" → amber chip, "Reject" →
  // red chip, everything else → primary green. Keeps the hierarchy
  // consistent across every modal that uses this footer.
  const variant: "primary" | "apply" | "danger" =
    lowered === "apply" ? "apply" : lowered === "reject" ? "danger" : "primary";
  return (
    <div className="mt-5 flex items-center justify-end gap-2 border-t border-court-border pt-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
      >
        <X className="h-3 w-3" /> Cancel
      </button>
      <Button
        type="button"
        size="sm"
        variant={variant}
        onClick={onSave}
        disabled={saving}
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <SaveIcon className="h-3 w-3" />}
        {saveLabel}
      </Button>
    </div>
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

// 15-min-stepped duration picker. Matches the DateTime15Picker so scheduled
// interviews never end at :07 or :53 — Google Calendar handles odd intervals
// fine but recruiters expect 15/30/45 increments.
const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 105, 120] as const;

export function DurationSelect({
  value,
  onChange,
  label = "Duration",
  compact = false,
}: {
  value: number;
  onChange: (n: number) => void;
  label?: string;
  // When true the picker sizes to its content (a tight ~7rem pill)
  // instead of stretching to fill its parent. Used in the schedule
  // dialog row where date+time | timezone | duration share one line;
  // the previous w-full layout made "30 min" sit alone in a column
  // wide enough to fit "120 min" with ~50% whitespace to the right.
  compact?: boolean;
}) {
  return (
    <label className={compact ? "block w-28 text-sm" : "block text-sm"}>
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</span>
      <Select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        frameClassName="mt-1"
      >
        {DURATION_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n} min
          </option>
        ))}
      </Select>
    </label>
  );
}

export function parseEmailCsv(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildCcBccOptions(
  clientContacts: ClientContactRef[],
): { id: string; name: string; email: string }[] {
  return clientContacts
    .filter((c) => c.email)
    .map((c) => ({ id: String(c.id), name: c.name, email: c.email }));
}

// Pre-composer Cc / Bcc picker shown on the Schedule Interview dialog.
// Emits CSV strings so the existing state model doesn't need to change.
export function CcBccPicker({
  clientContacts,
  cc,
  onCcChange,
  bcc,
  onBccChange,
}: {
  clientContacts: ClientContactRef[];
  cc: string;
  onCcChange: (v: string) => void;
  bcc: string;
  onBccChange: (v: string) => void;
}) {
  // Cc draws from the current job's client contacts and becomes a visible
  // guest on the client-facing calendar event. Bcc is a private team copy:
  // the calendar invite itself has no hidden Bcc bucket, so a Bcc recipient
  // (Austin) is delivered a separate email copy of the invite at send time,
  // hidden from the candidate and client. Cc and Bcc draw from SEPARATE
  // pools on purpose — client contacts must never appear as a Bcc option
  // (that's a private team field), so Bcc is seeded only from the team
  // roster. Both still accept any typed-in address.
  const ccOptions = buildCcBccOptions(clientContacts);
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          Cc (optional) · client contacts
        </span>
        <InlineContactMultiInput
          value={cc}
          onChange={onCcChange}
          options={ccOptions}
          placeholder="Pick a client contact or type email…"
        />
      </label>
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          Bcc (optional) · private team copy
        </span>
        <InlineContactMultiInput
          value={bcc}
          onChange={onBccChange}
          options={TEAM_BCC_OPTIONS}
          placeholder="Bcc Austin, or type an email…"
        />
      </label>
    </div>
  );
}

// One row in the dropdown. Uses onMouseDown + preventDefault so focus
// never leaves the typed input (no blur → no stale-closure addTyped
// race) AND onClick with stopPropagation so the add commits cleanly
// without bubbling to the container / document outside-click handler.
// Click semantics are add-only — clicking an already-selected contact
// is a no-op rather than toggling off; that's the X on the chip's job.
function PickerOption({
  name,
  email,
  checked,
  onAdd,
}: {
  name: string;
  email: string;
  checked: boolean;
  onAdd: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onMouseDown={(e) => {
          if (!email) return;
          e.preventDefault();
        }}
        onClick={(e) => {
          if (!email) return;
          e.preventDefault();
          e.stopPropagation();
          onAdd();
        }}
        disabled={!email}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-court-fg hover:bg-court-brand-tint disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
            checked ? "border-brand bg-brand text-white" : "border-court-border bg-court-surface",
          )}
        >
          {checked && (
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 6.5l2.5 2.5L10 3" />
            </svg>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{name}</span>
          <span className="truncate text-[11px] text-court-fg-muted">
            {email || "No email on file"}
          </span>
        </span>
      </button>
    </li>
  );
}

// Smaller sibling of the composer's ContactComboMulti that lives outside
// a modal. Intentionally duplicated (not imported from email-composer.tsx)
// to keep the composer module's client dependency tree focused on email
// concerns. Exported so the Ace-native Submit modal can reuse the same
// picker semantics (same chip rendering, same rapid-click-safe latest-
// value ref, same dropdown close-on-outside-click behaviour).
export function InlineContactMultiInput({
  value,
  onChange,
  options,
  pinned,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string; email: string }[];
  pinned?: { id: string; name: string; email: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const selected = new Set(parseEmailCsv(value));
  // Already-selected addresses are dropped from the dropdown (the chip above
  // already represents the pick) so a picked option disappears from the list
  // without needing to click away — matching the other multi-recipient
  // pickers. The chip's X is how you remove it.
  const selectedLower = new Set(Array.from(selected).map((e) => e.toLowerCase()));
  const pinnedList = (pinned ?? []).filter((p) => !selectedLower.has(p.email.toLowerCase()));
  const pinnedEmails = new Set(pinnedList.map((p) => p.email.toLowerCase()));
  const rest = options.filter(
    (o) => !pinnedEmails.has(o.email.toLowerCase()) && !selectedLower.has(o.email.toLowerCase()),
  );

  // Ref holds the authoritative chip string in sync with mutations.
  // Rapid-fire clicks on dropdown options (pick contact A, then B
  // before React re-renders) used to lose the first chip because the
  // second click's handler still saw the stale `selected` closure
  // derived from the unchanged prop `value`. We now read and write
  // through the ref so each mutation sees the freshest state.
  const latestValueRef = useRef(value);
  latestValueRef.current = value;

  function commit(next: Set<string>) {
    const joined = Array.from(next).join(", ");
    latestValueRef.current = joined;
    onChange(joined);
  }
  function add(email: string) {
    if (!email) return;
    const next = new Set(parseEmailCsv(latestValueRef.current));
    if (next.has(email)) return;
    next.add(email);
    commit(next);
  }
  function addTyped() {
    // Early-return when typed is empty so blur events don't replay
    // an empty commit and wipe chips committed by a concurrent
    // dropdown toggle.
    const raw = typedRef.current.trim();
    if (!raw) return;
    const next = new Set(parseEmailCsv(latestValueRef.current));
    for (const p of parseEmailCsv(raw)) next.add(p);
    commit(next);
    setTyped("");
  }
  function remove(email: string) {
    const next = new Set(parseEmailCsv(latestValueRef.current));
    next.delete(email);
    commit(next);
  }

  // Outside-click guard: a document-level mousedown listener gated by
  // `open` and scoped to this picker's container. Earlier code rendered
  // a `fixed inset-0 z-[60]` overlay to catch outside clicks, but that
  // overlay sat ON TOP of the surrounding email composer and ate every
  // click on the body editor, toolbar buttons, and the X close — leaving
  // the composer "frozen" until refresh after a chip was added. Using a
  // document listener instead lets clicks reach their real targets
  // while still dismissing the picker when the click lands outside.
  const containerRef = useRef<HTMLDivElement>(null);
  const typedRef = useRef(typed);
  typedRef.current = typed;
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const node = containerRef.current;
      if (node && node.contains(e.target as Node)) return;
      // Commit whatever's typed before dismissing, so clicking outside
      // chips a partial entry — same intent as the prior overlay.
      addTyped();
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={containerRef} className="relative mt-1">
      <div
        className="flex min-h-[34px] w-full flex-wrap items-center gap-1 rounded-lg border border-court-border bg-court-surface px-2 py-1 text-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20"
        onClick={() => setOpen(true)}
      >
        {Array.from(selected).map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 rounded-full bg-court-surface-subtle px-2 py-0.5 text-[11px] text-court-fg"
          >
            {email}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(email);
              }}
              aria-label={`Remove ${email}`}
              className="text-court-fg-muted hover:text-court-fg"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          type="email"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";") {
              e.preventDefault();
              addTyped();
            } else if (e.key === "Tab") {
              // Don't preventDefault — let native Tab move focus — but
              // still commit the chip so Tab-out-of-field chips what's
              // typed, same as onBlur would.
              addTyped();
            }
          }}
          onBlur={addTyped}
          onFocus={() => setOpen(true)}
          placeholder={selected.size === 0 ? placeholder : ""}
          className="min-w-[160px] flex-1 bg-transparent px-1 py-0.5 text-sm text-court-fg outline-none placeholder:text-court-fg-muted"
        />
      </div>
      {open && (
        <>
          {/* Outside-click handled by the document mousedown listener
              above. Earlier code rendered a fixed-inset overlay here
              to catch the dismiss click; that overlay sat on top of
              the entire viewport and ate clicks on the surrounding
              email composer (body editor, toolbar buttons, X close),
              leaving the composer frozen until page refresh after a
              chip was added. */}
          <div className="absolute left-0 top-full z-[70] mt-1 w-full overflow-hidden rounded-lg border border-court-border bg-court-surface shadow-lg">
            <ul className="max-h-56 overflow-y-auto py-1">
              {pinnedList.length > 0 && (
                <>
                  <li className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                    Quick pick
                  </li>
                  {pinnedList.map((c) => (
                    <PickerOption
                      key={`pinned-${c.id}`}
                      name={c.name}
                      email={c.email}
                      checked={selected.has(c.email)}
                      onAdd={() => add(c.email)}
                    />
                  ))}
                  <li className="mx-2 my-1 border-t border-court-border" />
                </>
              )}
              {rest.length === 0 && pinnedList.length === 0 && (
                <li className="px-3 py-2 text-xs text-court-fg-muted">
                  No contacts on file. Type an email + Enter to add.
                </li>
              )}
              {rest.map((c) => (
                <PickerOption
                  key={c.id}
                  name={c.name}
                  email={c.email}
                  checked={selected.has(c.email)}
                  onAdd={() => add(c.email)}
                />
              ))}
            </ul>
            <div className="border-t border-court-border bg-court-surface-subtle/40 px-3 py-1.5 text-[10px] text-court-fg-muted">
              Or type an email and press Enter.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Always-on interviewer picker. Fixes two real bugs:
//   1. Previously hidden entirely when the client had no contacts. Now
//      always shows with "Other (enter manually)" + "+ Add new contact"
//      so recruiters can proceed regardless of how stocked the client's
//      contact list is.
//   2. Free-text name/email fields were getting Chrome-autofilled with
//      the recruiter's own Google profile. Raw inputs with autoComplete
//      off, non-semantic name attrs, and data-lpignore stop that.
// Phase 5: id widened to number | string. Legacy RF-imported contacts
// keep a numeric legacyRfId; Ace-native contacts (created via
// createClientContact or /clients/new) carry a cuid. Either shape
// survives the picker + server-action round-trip.
export type InterviewerContact = { id: number | string; name: string; title: string; email: string };

export function InterviewerPicker({
  initialContacts,
  name,
  email,
  onChange,
}: {
  initialContacts: InterviewerContact[];
  name: string;
  email: string;
  onChange: (name: string, email: string) => void;
}) {
  const [mode, setMode] = useState<string>("");
  // Contacts come from the parent (placement edit page) and aren't mutated
  // here anymore now that the inline "+ Add new contact" flow has been
  // removed — adding contacts lives on the client detail page.
  const contacts = initialContacts;

  function setSelection(next: string) {
    setMode(next);
    if (next === "" || next === "custom") {
      onChange("", "");
      return;
    }
    const match = contacts.find((c) => String(c.id) === next);
    if (match) onChange(match.name, match.email ?? "");
  }

  const nonceRef = useRef<string>(Math.random().toString(36).slice(2, 10));
  const nonce = nonceRef.current;

  const showManualFields = mode !== "";

  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          Interviewer (client contact)
        </span>
        <Select
          value={mode}
          onChange={(e) => setSelection(e.target.value)}
          frameClassName="mt-1"
        >
          <option value="">
            {contacts.length === 0 ? "No contacts on file. Pick an option…" : "Select an interviewer…"}
          </option>
          {contacts.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
              {c.title ? ` · ${c.title}` : ""}
              {c.email ? ` · ${c.email}` : ""}
            </option>
          ))}
          <option value="custom">Other (enter manually)</option>
        </Select>
      </label>

      {showManualFields && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <BareInput
            value={name}
            onChange={(v) => onChange(v, email)}
            name={`ace-interviewer-name-${nonce}`}
          />
          <BareInput
            type="email"
            value={email}
            onChange={(v) => onChange(name, v)}
            name={`ace-interviewer-email-${nonce}`}
          />
        </div>
      )}
    </div>
  );
}

// Raw text input with defensive anti-autofill attributes. Chrome,
// Safari, and 1Password/LastPass key on input name/type/surrounding
// context to decide whether to offer autofill. autoComplete=off +
// non-semantic name + data-lpignore + data-form-type together suppress
// all three without limiting user editability.
function BareInput({
  value,
  onChange,
  placeholder,
  type = "text",
  name,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  name: string;
}) {
  return (
    <Input
      type={type}
      value={value}
      name={name}
      placeholder={placeholder}
      autoComplete="off"
      data-lpignore="true"
      data-form-type="other"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
