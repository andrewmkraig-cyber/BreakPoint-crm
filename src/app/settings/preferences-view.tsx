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
  TOAST_THEMES,
  TOAST_THEME_ORDER,
  type ToastThemeId,
} from "@/lib/toast-theme";

export function PreferencesView({
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
  // Mail notifications toggle is local-only — no server roundtrip.
  // Stored in localStorage as the same key MailContext reads on each
  // poll tick so flipping it takes effect on the next 30s window
  // without requiring a refresh. Default OFF per spec.
  const [mailNotifs, setMailNotifs] = useState(false);
  const [toastTheme, setToastTheme] = useState<ToastThemeId>(DEFAULT_TOAST_THEME);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setMailNotifs(window.localStorage.getItem(MAIL_NOTIFICATIONS_PREF_KEY) === "true");
    const storedTheme = window.localStorage.getItem(MAIL_TOAST_THEME_KEY);
    if (storedTheme && storedTheme in TOAST_THEMES) {
      setToastTheme(storedTheme as ToastThemeId);
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

  function onToggle(next: boolean) {
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
      <div className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
        <label className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-court-fg">Auto-send candidate confirmation after submittal</div>
            <div className="mt-1 text-xs text-court-fg-muted">
              When on, the &quot;BreakPoint Talent has reviewed…&quot; email is sent immediately after a successful client
              submittal. When off, it lands in your Gmail Drafts for review.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => onToggle(!enabled)}
            disabled={isTogglePending}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
              // `bg-brand` on the ON state stays the BreakPoint green in
              // every mode (intentional — the brand color is consistent).
              // OFF state swaps `bg-muted-foreground/30` for a mode-aware
              // `bg-court-fg-muted/40` so the track reads against the
              // themed card background in Clay / Grass.
              enabled ? "bg-brand" : "bg-court-fg-muted/40",
              isTogglePending && "opacity-60",
            )}
          >
            <span
              className={cn(
                "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
                enabled ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </button>
        </label>
      </div>

      <div className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
        <label className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-court-fg">In-app notifications</div>
            <div className="mt-1 text-xs text-court-fg-muted">
              Show a popup when new mail arrives.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={mailNotifs}
            onClick={() => onToggleMailNotifs(!mailNotifs)}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
              mailNotifs ? "bg-brand" : "bg-court-fg-muted/40",
            )}
          >
            <span
              className={cn(
                "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
                mailNotifs ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </button>
        </label>
        <div className="mt-4 border-t border-court-border pt-4">
          <div className="text-[11px] uppercase tracking-wider text-court-fg-muted">
            Notification style
          </div>
          <div className="mt-2 flex items-center gap-2">
            {TOAST_THEME_ORDER.map((id) => {
              const theme = TOAST_THEMES[id];
              const active = toastTheme === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onPickToastTheme(id)}
                  aria-label={`Use ${theme.label} toast theme`}
                  aria-pressed={active}
                  title={theme.label}
                  className={cn(
                    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition",
                    active
                      ? "ring-2 ring-court-accent ring-offset-2 ring-offset-court-surface"
                      : "ring-1 ring-court-border hover:ring-court-fg/40",
                  )}
                  style={{
                    background: theme.bg,
                    border: theme.border ?? "1px solid transparent",
                  }}
                />
              );
            })}
            <span className="ml-2 text-xs text-court-fg-muted">
              {TOAST_THEMES[toastTheme].label}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
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

      <div className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
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
