"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Toggle } from "./limits-section";
import { updateBDSettings } from "./actions";
import {
  BD_NUMBER_INPUT,
  BD_ROW,
  BD_ROW_DESC,
  BD_ROW_GROUP,
  BD_ROW_LABEL,
  BD_SAVE_BUTTON,
  BD_SECTION_CARD,
} from "./spec-classes";

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
    <section id="bd-engine" className={`${BD_SECTION_CARD} scroll-mt-24 p-6`}>
      <p className="mb-1 text-[10px] font-semibold uppercase leading-none tracking-[0.18em] text-court-brand-dark">
        Engine
      </p>
      <h2 className="mb-1 font-serif text-[18px] font-bold leading-tight text-court-fg">
        BD Engine
      </h2>
      <p className="mb-4 text-[12px] leading-relaxed text-court-fg-muted">
        Master switch + daily enrollment ceiling for the discovery cron and
        TheirStack webhook.
      </p>

      <div className={BD_ROW_GROUP}>
        <div className={BD_ROW}>
          <div className="min-w-0">
            <p className={BD_ROW_LABEL}>BD Engine</p>
            <p className={`mt-0.5 ${BD_ROW_DESC}`}>
              When off, the discovery cron and TheirStack webhook are both
              paused. No companies will surface in the approval queue.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={
                engineActive
                  ? "inline-flex h-6 items-center rounded-full bg-court-brand-tint px-2.5 text-[10px] font-semibold uppercase tracking-wider text-court-brand-dark"
                  : "inline-flex h-6 items-center rounded-full bg-court-surface-subtle px-2.5 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted"
              }
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

        <div className={BD_ROW}>
          <div className="min-w-0">
            <p className={BD_ROW_LABEL}>Daily Enrollment Cap</p>
            <p className={`mt-0.5 ${BD_ROW_DESC}`}>
              Maximum contacts enrolled into Apollo per day across all runs.
            </p>
          </div>
          <input
            type="number"
            min={1}
            max={200}
            value={Number.isNaN(dailyCap) ? "" : dailyCap}
            onChange={(e) => setDailyCap(Number(e.target.value))}
            className={`${BD_NUMBER_INPUT} w-24 text-right tabular-nums`}
          />
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={pending || !dirty}
          className={BD_SAVE_BUTTON}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </button>
      </div>
    </section>
  );
}
