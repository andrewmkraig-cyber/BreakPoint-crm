"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  setBulkSendSpacing,
  setBulkDailyCap,
} from "@/app/settings/preferences-actions";

// Bulk email pacing controls. Spacing = minutes between each candidate
// send in a throttled "Send to N candidates" batch (0 = send as fast as
// the per-minute queue allows). Daily cap = max bulk emails per Eastern
// calendar day before overflow rolls to the next day at 8am ET. Both
// persist org-wide via the app preferences blob.
//
// Chrome uses the shared <Button> (primary = the canonical Save) and
// <Input> field components - no hand-rolled control styling.
export function BulkSendSettingsView({
  initialSpacing,
  initialDailyCap,
}: {
  initialSpacing: number;
  initialDailyCap: number;
}) {
  const router = useRouter();
  const [spacing, setSpacing] = useState(String(initialSpacing));
  const [cap, setCap] = useState(String(initialDailyCap));
  const [savingSpacing, startSpacing] = useTransition();
  const [savingCap, startCap] = useTransition();

  function onSaveSpacing() {
    const n = Number(spacing);
    startSpacing(async () => {
      const res = await setBulkSendSpacing(n);
      if (!res.ok) {
        toast.error("Couldn't save spacing", { description: res.error });
        return;
      }
      toast.success("Bulk send spacing saved");
      router.refresh();
    });
  }

  function onSaveCap() {
    const n = Number(cap);
    startCap(async () => {
      const res = await setBulkDailyCap(n);
      if (!res.ok) {
        toast.error("Couldn't save daily cap", { description: res.error });
        return;
      }
      toast.success("Daily bulk send cap saved");
      router.refresh();
    });
  }

  const spacingChanged = spacing.trim() !== String(initialSpacing);
  const capChanged = cap.trim() !== String(initialDailyCap);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <label className="flex-1">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
            Bulk send spacing (minutes)
          </span>
          <div className="mt-1 text-xs text-court-fg-muted">
            Minutes between each candidate email in a bulk batch. The send runs
            on the server, so it keeps going after you close the tab. Each gap is
            randomized ±20% so it doesn&apos;t look robotic. Set to{" "}
            <span className="font-semibold text-court-fg">0</span> to send as fast
            as the queue allows.
          </div>
          <Input
            type="number"
            min={0}
            max={120}
            step={1}
            inputMode="numeric"
            value={spacing}
            onChange={(e) => setSpacing(e.target.value)}
            containerClassName="mt-2 w-32"
          />
        </label>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onSaveSpacing}
          disabled={savingSpacing || !spacingChanged || spacing.trim() === ""}
        >
          {savingSpacing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>

      <div className="flex items-end justify-between gap-4 border-t border-court-border pt-5">
        <label className="flex-1">
          <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
            Daily bulk send cap
          </span>
          <div className="mt-1 text-xs text-court-fg-muted">
            Most bulk candidate emails to send in one day (Eastern). Anything over
            the cap is queued for the next day starting 8am ET, so a big batch
            spreads out instead of torching your domain&apos;s reputation. Spacing
            alone doesn&apos;t limit volume; this does.
          </div>
          <Input
            type="number"
            min={1}
            max={5000}
            step={1}
            inputMode="numeric"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            containerClassName="mt-2 w-32"
          />
        </label>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onSaveCap}
          disabled={savingCap || !capChanged || cap.trim() === ""}
        >
          {savingCap ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}
