"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setAutoSendCandidateConfirmation, setMyEmailSignature, setMyRecruiterPhone } from "@/app/settings/preferences-actions";
import { MAIL_NOTIFICATIONS_PREF_KEY } from "@/lib/mail-context";
import {
  DEFAULT_TOAST_THEME,
  MAIL_TOAST_THEME_KEY,
  TEXT_TOAST_THEME_KEY,
  TOAST_THEMES,
  TOAST_THEME_ORDER,
  type ToastThemeId,
  type ToastThemeSpec,
} from "@/lib/toast-theme";
import { renderNewMailToast } from "@/components/mail-notification-toast";
import { renderNewTextToast, renderNewCallToast } from "@/components/text-notification-toast";

// ----------------------------------------------------------------
// NotificationPreferencesView — in-app notif master switch + email
// and phone toast style pickers. The master switch gates mail, text,
// and call toasts (per Phone Tab Phase 3 wiring; today only mail
// auto-fires, but the gate is set up to cover all three).
// ----------------------------------------------------------------

export function NotificationPreferencesView() {
  const [mailNotifs, setMailNotifs] = useState(false);
  const [toastTheme, setToastTheme] = useState<ToastThemeId>(DEFAULT_TOAST_THEME);
  const [textToastTheme, setTextToastTheme] = useState<ToastThemeId>(DEFAULT_TOAST_THEME);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setMailNotifs(window.localStorage.getItem(MAIL_NOTIFICATIONS_PREF_KEY) === "true");
    const storedMailTheme = window.localStorage.getItem(MAIL_TOAST_THEME_KEY);
    if (storedMailTheme && storedMailTheme in TOAST_THEMES) {
      setToastTheme(storedMailTheme as ToastThemeId);
    }
    const storedTextTheme = window.localStorage.getItem(TEXT_TOAST_THEME_KEY);
    if (storedTextTheme && storedTextTheme in TOAST_THEMES) {
      setTextToastTheme(storedTextTheme as ToastThemeId);
    }
  }, []);

  function onToggleMailNotifs(next: boolean) {
    setMailNotifs(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MAIL_NOTIFICATIONS_PREF_KEY, next ? "true" : "false");
    }
  }
  function onPickToastTheme(next: ToastThemeId) {
    setToastTheme(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MAIL_TOAST_THEME_KEY, next);
    }
  }
  function onPickTextToastTheme(next: ToastThemeId) {
    setTextToastTheme(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TEXT_TOAST_THEME_KEY, next);
    }
  }

  return (
    <div className="space-y-3">
      <ToggleRow
        label="In-app notifications"
        description="Show a popup when new mail, texts, or calls arrive. Off silences all three."
        checked={mailNotifs}
        onChange={onToggleMailNotifs}
      />
      <div className="border-t border-court-border pt-5">
        <div className="text-sm font-semibold text-court-fg">
          Email notification style
        </div>
        <NotifStylePicker value={toastTheme} onPick={onPickToastTheme} kind="email" />
      </div>
      <div className="border-t border-court-border pt-5">
        <div className="text-sm font-semibold text-court-fg">
          Phone notification style
        </div>
        <div className="mt-0.5 text-xs text-court-fg-muted">
          Applies once Quo text notifications are wired up.
        </div>
        <NotifStylePicker value={textToastTheme} onPick={onPickTextToastTheme} kind="text" />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// EmailPreferencesView — Triggers (auto-send), recruiter phone,
// email signature. The "Triggers" subheading is the user-requested
// home for the auto-send-after-submittal toggle.
// ----------------------------------------------------------------

export function EmailPreferencesView({
  autoSend,
  myPhone,
  mySignature,
  myEmail,
}: {
  autoSend: boolean;
  myPhone: string;
  mySignature: string;
  myEmail: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(autoSend);
  const [phone, setPhone] = useState(myPhone);
  const [signature, setSignature] = useState(mySignature);
  const [isTogglePending, startToggle] = useTransition();
  const [isPhonePending, startPhone] = useTransition();
  const [isSigPending, startSig] = useTransition();

  function onToggleAutoSend(next: boolean) {
    setEnabled(next);
    startToggle(async () => {
      const result = await setAutoSendCandidateConfirmation(next);
      if (!result.ok) {
        setEnabled(!next);
        toast.error("Couldn't save setting", { description: result.error });
        return;
      }
      toast.success(next ? "Auto-send on" : "Auto-send off");
      router.refresh();
    });
  }

  function onSavePhone() {
    startPhone(async () => {
      const result = await setMyRecruiterPhone(phone);
      if (!result.ok) {
        toast.error("Couldn't save phone", { description: result.error });
        return;
      }
      toast.success("Phone saved");
      router.refresh();
    });
  }

  function onSaveSignature() {
    startSig(async () => {
      const result = await setMyEmailSignature(signature);
      if (!result.ok) {
        toast.error("Couldn't save signature", { description: result.error });
        return;
      }
      toast.success("Signature saved");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-[11px] uppercase tracking-wider text-court-fg-muted">
          Triggers
        </div>
        <ToggleRow
          label="Auto-send candidate confirmation after submittal"
          description={
            'When on, the "BreakPoint Talent has reviewed…" email is sent immediately after a successful client submittal. When off, it lands in your Gmail Drafts for review.'
          }
          checked={enabled}
          onChange={onToggleAutoSend}
          disabled={isTogglePending}
        />
      </div>

      <div className="border-t border-court-border pt-5">
        <div className="flex items-end justify-between gap-4">
          <label className="flex-1">
            <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Your phone number</span>
            <div className="mt-1 text-xs text-court-fg-muted">
              Populates <code className="rounded bg-court-surface-subtle px-1 py-0.5 text-[10px] text-court-fg">[Recruiter Phone]</code> in templates when you send. Signed in as {myEmail}.
            </div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="216-488-5565"
              className="mt-2 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-court-accent focus:outline-none focus:ring-2 focus:ring-court-accent/20"
            />
          </label>
          <button
            type="button"
            onClick={onSavePhone}
            disabled={isPhonePending || phone.trim() === myPhone.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
          >
            {isPhonePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
          </button>
        </div>
      </div>

      <div className="border-t border-court-border pt-5">
        <div className="mb-2">
          <div className="text-[11px] uppercase tracking-wider text-court-fg-muted">Email signature</div>
          <div className="mt-1 text-xs text-court-fg-muted">
            Auto-appended to every email sent from Ace — submittals, rejections, candidate confirmations, reference
            requests, manual emails. Don&apos;t paste a signature inside a template body or you&apos;ll duplicate.
          </div>
        </div>
        <textarea
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          rows={6}
          className="mt-2 w-full resize-vertical whitespace-pre-wrap rounded-lg border border-court-border bg-court-surface px-3 py-2 font-sans text-sm leading-relaxed text-court-fg placeholder:text-court-fg-muted/60 focus:border-court-accent focus:outline-none focus:ring-2 focus:ring-court-accent/20"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onSaveSignature}
            disabled={isSigPending || signature === mySignature}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
          >
            {isSigPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save signature
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-court-fg">{label}</div>
        {description && (
          <div className="mt-1 text-xs text-court-fg-muted">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-brand" : "bg-court-fg-muted/40",
          disabled && "opacity-60",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  );
}

function NotifStyleCard({
  spec,
  kind,
  selected,
  onClick,
}: {
  spec: ToastThemeSpec;
  kind: "email" | "text";
  selected: boolean;
  onClick: () => void;
}) {
  const previewName = kind === "email" ? "New email" : "New text";
  const previewSub = kind === "email" ? "Meeting request" : "Reply needed";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-2.5 text-left transition",
        selected
          ? "border-court-accent shadow-[0_0_0_3px_rgb(var(--court-accent-tint))]"
          : "border-court-border hover:border-court-fg/40",
      )}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderRadius: 8,
          border: `1px solid ${spec.border}`,
          background: spec.bg,
          overflow: "hidden",
          minHeight: 44,
        }}
      >
        {spec.leftStrip && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: "0 auto 0 0",
              width: 2,
              background: spec.accent,
            }}
          />
        )}
        <span
          style={{
            flexShrink: 0,
            width: 22,
            height: 22,
            borderRadius: 6,
            background: spec.iconBg,
            color: spec.iconFg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2.5" />
            <path d="m3 7 9 6 9-6" />
          </svg>
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: "block", fontSize: 9.5, fontWeight: 600, color: spec.fg, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {previewName}
          </span>
          <span style={{ display: "block", fontSize: 8.5, color: spec.fgMuted, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {previewSub}
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px]",
              selected
                ? "border-court-accent bg-court-accent"
                : "border-court-border bg-transparent",
            )}
          >
            {selected && <span className="h-1 w-1 rounded-full bg-white" />}
          </span>
          <span className="text-[12.5px] font-semibold text-court-fg">{spec.label}</span>
        </div>
        <span className="text-[11px] leading-snug text-court-fg-muted">{spec.desc}</span>
      </div>
    </button>
  );
}

function NotifStylePicker({
  value,
  onPick,
  kind,
}: {
  value: ToastThemeId;
  onPick: (id: ToastThemeId) => void;
  kind: "email" | "text";
}) {
  return (
    <div className="mt-2 flex max-w-[640px] flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {TOAST_THEME_ORDER.map((id) => {
          const spec = TOAST_THEMES[id];
          return (
            <NotifStyleCard
              key={id}
              spec={spec}
              kind={kind}
              selected={value === id}
              onClick={() => onPick(id)}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          Try it:
        </span>
        {/* Each picker only previews the toasts it actually styles —
            email picker fires the email toast; phone picker fires
            text + call toasts. Cross-firing was confusing because a
            test toast that doesn't use the picker's theme looks like
            a bug. */}
        {kind === "email" && (
          <button
            type="button"
            onClick={fireSampleEmailToast}
            className="inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-surface-subtle px-2.5 py-1 text-xs font-medium text-court-fg transition hover:bg-court-surface"
          >
            Email
          </button>
        )}
        {kind === "text" && (
          <>
            <button
              type="button"
              onClick={fireSampleTextToast}
              className="inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-surface-subtle px-2.5 py-1 text-xs font-medium text-court-fg transition hover:bg-court-surface"
            >
              Text
            </button>
            <button
              type="button"
              onClick={fireSampleCallToast}
              className="inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-surface-subtle px-2.5 py-1 text-xs font-medium text-court-fg transition hover:bg-court-surface"
            >
              Call
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function fireSampleEmailToast() {
  renderNewMailToast({
    id: `sample-${Date.now()}`,
    fromName: "Sample Sender",
    fromEmail: "sender@example.com",
    subject: "Meeting request",
    timestampIso: new Date().toISOString(),
  });
}

function fireSampleTextToast() {
  renderNewTextToast({
    id: `sample-${Date.now()}`,
    candidateId: "",
    candidateName: "Sample Sender",
    fromNumber: "+15555550100",
    body: "Reply needed on the offer",
    createdAtIso: new Date().toISOString(),
  });
}

function fireSampleCallToast() {
  renderNewCallToast({
    id: `sample-${Date.now()}`,
    candidateId: "",
    candidateName: "Sample Sender",
    fromNumber: "+15555550100",
    duration: null,
    status: "missed",
    createdAtIso: new Date().toISOString(),
  });
}
