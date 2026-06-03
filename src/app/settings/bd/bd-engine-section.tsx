"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Power, Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Toggle } from "./limits-section";
import { updateBDSettings } from "./actions";

export type BdEngineConfig = {
  engineActive: boolean;
  globalDailyCap: number;
};

export function BdEngineSection({ config }: { config: BdEngineConfig }) {
  const router = useRouter();
  const [engineActive, setEngineActive] = useState(config.engineActive);
  const [dailyCap, setDailyCap] = useState<number>(config.globalDailyCap);
  const [pending, startTransition] = useTransition();

  const dirty =
    engineActive !== config.engineActive || dailyCap !== config.globalDailyCap;

  const onSave = () => {
    if (Number.isNaN(dailyCap) || dailyCap < 1 || dailyCap > 200) {
      toast.error("Daily cap must be between 1 and 200");
      return;
    }
    startTransition(async () => {
      try {
        await updateBDSettings({ engineActive, globalDailyCap: dailyCap });
        toast.success("BD Engine settings saved");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save");
      }
    });
  };

  return (
    <section
      id="bd-engine"
      className="scroll-mt-24 rounded-xl border border-court-border bg-court-surface shadow-sm"
    >
      <div className="flex items-start justify-between gap-3 px-6 py-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-2 h-4 w-1 shrink-0 rounded-full bg-court-accent"
          />
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-xl font-semibold leading-tight text-court-fg">
              BD Engine
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-court-fg-muted">
              Master switch + daily enrollment ceiling for the discovery
              cron and TheirStack webhook.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-court-border px-6 py-5">
        <div
          className={cn(
            "flex items-center justify-between rounded-lg border px-4 py-3 transition-colors",
            engineActive
              ? "border-court-brand/40 bg-court-brand-tint"
              : "border-court-border bg-court-surface",
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            <Power
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                engineActive ? "text-court-brand-dark" : "text-court-fg-muted",
              )}
            />
            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm font-semibold",
                  engineActive ? "text-court-brand-dark" : "text-court-fg",
                )}
              >
                BD Engine
              </p>
              <p
                className={cn(
                  "text-xs",
                  engineActive
                    ? "text-court-brand-dark/80"
                    : "text-court-fg-muted",
                )}
              >
                When off, the discovery cron and TheirStack webhook are both
                paused. No companies will surface in the approval queue.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                engineActive
                  ? "bg-court-brand text-white"
                  : "bg-court-surface-subtle text-court-fg-muted",
              )}
            >
              {engineActive ? "Active" : "Off"}
            </span>
            <Toggle
              on={engineActive}
              onChange={setEngineActive}
              disabled={pending}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-court-border bg-court-surface px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-court-fg">
              Daily Enrollment Cap
            </p>
            <p className="text-xs text-court-fg-muted">
              Maximum contacts enrolled into Apollo per day across all runs.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={200}
              value={Number.isNaN(dailyCap) ? "" : dailyCap}
              onChange={(e) =>
                setDailyCap(e.target.value === "" ? NaN : Number(e.target.value))
              }
              className="w-24 rounded-md border border-court-border bg-court-surface px-2 py-1 text-right text-sm tabular-nums text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={pending || !dirty}
            className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      </div>
    </section>
  );
}
