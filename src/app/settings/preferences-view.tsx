"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setAutoSendCandidateConfirmation, setMyRecruiterPhone } from "@/app/settings/preferences-actions";

export function PreferencesView({
  autoSend,
  myPhone,
  myEmail,
}: {
  autoSend: boolean;
  myPhone: string;
  myEmail: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(autoSend);
  const [phone, setPhone] = useState(myPhone);
  const [isTogglePending, startToggle] = useTransition();
  const [isPhonePending, startPhone] = useTransition();

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

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
        <label className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-navy">Auto-send candidate confirmation after submittal</div>
            <div className="mt-1 text-xs text-muted-foreground">
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
              enabled ? "bg-brand" : "bg-muted-foreground/30",
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

      <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
        <div className="flex items-end justify-between gap-4">
          <label className="flex-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Your phone number</span>
            <div className="mt-1 text-xs text-muted-foreground">
              Populates <code className="rounded bg-muted px-1 py-0.5 text-[10px]">[Recruiter Phone]</code> in templates when you send. Signed in as {myEmail}.
            </div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="216-488-5565"
              className="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
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
    </div>
  );
}
