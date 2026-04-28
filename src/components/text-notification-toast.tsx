"use client";

import { useRouter } from "next/navigation";
import { MessageSquare, Phone, Reply, X } from "lucide-react";
import { toast } from "sonner";
import {
  getStoredTextToastTheme,
  toastBoxShadow,
  type ToastThemeSpec,
} from "@/lib/toast-theme";

// In-app inbound text + inbound call toast. Shares the design
// language of the email toast (rounded-2xl card, glow ring, themed
// chrome) but wires its own theme key (ace_text_toast_theme) and a
// mode discriminator so a text and a call render with the same
// component using slightly different content.
//
// "View" navigates to the candidate profile when the inbound was
// matched to a candidate by the webhook; X just dismisses the
// toast and never touches Quo state.

export type InboundTextEvent = {
  id: string;
  candidateId: string;
  candidateName: string;
  fromNumber: string;
  body: string;
  createdAtIso: string;
};

export type InboundCallEvent = {
  id: string;
  candidateId: string;
  candidateName: string;
  fromNumber: string;
  duration: number | null;
  status: string;
  createdAtIso: string;
};

export function renderNewTextToast(event: InboundTextEvent) {
  toast.custom(
    (id) => <QuoToast mode="text" event={event} toastId={id} />,
    { duration: 8_000 },
  );
}

export function renderNewCallToast(event: InboundCallEvent) {
  toast.custom(
    (id) => <QuoToast mode="call" event={event} toastId={id} />,
    { duration: 8_000 },
  );
}

type QuoToastProps =
  | { mode: "text"; event: InboundTextEvent; toastId: string | number }
  | { mode: "call"; event: InboundCallEvent; toastId: string | number };

function QuoToast(props: QuoToastProps) {
  const router = useRouter();
  const theme = getStoredTextToastTheme();
  const candidateId = props.event.candidateId;
  const candidateName = props.event.candidateName || props.event.fromNumber;

  // Phone icon for both inbound text and inbound call — per the
  // notification redesign, SMS and calls share the same telephony
  // surface, so they share an icon.
  const Icon = props.mode === "text" ? MessageSquare : Phone;
  const subtitle =
    props.mode === "text"
      ? truncate(props.event.body || "(no message)", 60).toUpperCase()
      : truncate(callSubtitle(props.event), 60);

  function onView() {
    if (candidateId) router.push(`/candidates/${candidateId}`);
    toast.dismiss(props.toastId);
  }

  return (
    <div
      className="relative flex min-w-[280px] items-center gap-3 overflow-hidden rounded-[14px]"
      style={{
        background: theme.bg,
        color: theme.text,
        border: `1px solid ${theme.border}`,
        boxShadow: toastBoxShadow(),
        padding: "12px 14px",
      }}
    >
      {theme.leftStrip && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ background: theme.accent }}
        />
      )}
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: theme.iconBg, color: theme.iconFg }}
      >
        <Icon className="h-[17px] w-[17px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span
            className="truncate text-[13.5px] font-semibold"
            style={{ color: theme.text }}
          >
            {candidateName}
          </span>
          <span
            className="shrink-0 text-[11px]"
            style={{ color: theme.subText }}
          >
            · {props.mode === "text" ? "Text" : "Call"}
          </span>
        </div>
        <div
          className="mt-0.5 truncate text-[12.5px]"
          style={{ color: theme.subText }}
        >
          {subtitle}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {props.mode === "text" && (
          <ChipButton theme={theme} variant="primary" onClick={onView} ariaLabel="Reply">
            <Reply className="h-3 w-3" />
            <span>Reply</span>
          </ChipButton>
        )}
        <ChipButton theme={theme} onClick={onView} ariaLabel="View candidate">
          <span>View</span>
        </ChipButton>
        <ChipButton
          theme={theme}
          onClick={() => toast.dismiss(props.toastId)}
          ariaLabel="Dismiss"
          iconOnly
        >
          <X className="h-3 w-3" />
        </ChipButton>
      </div>
    </div>
  );
}

function ChipButton({
  theme,
  onClick,
  ariaLabel,
  iconOnly,
  variant,
  children,
}: {
  theme: ToastThemeSpec;
  onClick: () => void;
  ariaLabel: string;
  iconOnly?: boolean;
  variant?: "primary";
  children: React.ReactNode;
}) {
  const isPrimary = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={
        "inline-flex items-center justify-center gap-1 rounded-[8px] text-[12px] font-semibold transition " +
        (iconOnly ? "h-7 w-7 p-0" : "h-7 px-2.5")
      }
      style={{
        background: isPrimary ? theme.primaryBg : theme.buttonBg,
        color: isPrimary ? theme.primaryText : theme.buttonText,
        border: `1px solid ${isPrimary ? "transparent" : theme.buttonBorder}`,
      }}
    >
      {children}
    </button>
  );
}

function callSubtitle(call: InboundCallEvent): string {
  if (call.status === "missed" || call.status === "no-answer") return "MISSED CALL";
  if (call.duration && call.duration > 0) {
    return `CALL · ${formatDuration(call.duration)}`;
  }
  return "INCOMING CALL";
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
