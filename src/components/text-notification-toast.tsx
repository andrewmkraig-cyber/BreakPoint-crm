"use client";

import { useRouter } from "next/navigation";
import { MessageSquare, Phone, Reply, Eye } from "lucide-react";
import { toast } from "sonner";
import { getStoredTextToastTheme, toastBoxShadow } from "@/lib/toast-theme";
import { ActionChip, DismissBtn } from "@/components/_toast-chrome";

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
  const candidateId = props.event.candidateId;
  const candidateName = props.event.candidateName || props.event.fromNumber;

  const subtitle =
    props.mode === "text"
      ? truncate(props.event.body || "(no message)", 60).toUpperCase()
      : truncate(callSubtitle(props.event), 60);

  // TODO: split Reply and View handlers once the SMS composer is
  // exposed via a single-call ID. Today both chips fire onView, which
  // jumps to the candidate profile (where the activity card has the
  // SMS composer); good enough as a Reply target until the composer
  // can be opened directly from a toast.
  function onView() {
    if (candidateId) router.push(`/candidates/${candidateId}`);
    toast.dismiss(props.toastId);
  }

  const theme = getStoredTextToastTheme();
  const Icon = props.mode === "text" ? MessageSquare : Phone;
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        minWidth: "360px",
        maxWidth: "420px",
        padding: "12px 14px",
        borderRadius: "14px",
        border: `1px solid ${theme.border}`,
        background: theme.bg,
        color: theme.fg,
        boxShadow: toastBoxShadow(),
        overflow: "hidden",
      }}
    >
      {theme.leftStrip && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "0 auto 0 0",
            width: "3px",
            background: theme.accent,
          }}
        />
      )}
      <div
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: 10,
          background: theme.iconBg,
          color: theme.iconFg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={17} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: theme.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {candidateName}
          </span>
          <span style={{ fontSize: 11, color: theme.fgMuted, flexShrink: 0 }}>
            · {props.mode === "text" ? "Text" : "Call"}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: theme.fgMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
          {subtitle}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 12 }}>
        {props.mode === "text" && (
          <ActionChip theme={theme} onClick={onView} label="Reply" icon={<Reply size={12} />} primary />
        )}
        <ActionChip theme={theme} onClick={onView} label="View" icon={<Eye size={12} />} />
        <DismissBtn theme={theme} onClick={() => toast.dismiss(props.toastId)} />
      </div>
    </div>
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
