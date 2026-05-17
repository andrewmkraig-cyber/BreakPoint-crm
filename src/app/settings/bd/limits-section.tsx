"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateBdOrgConfig, updateVerticalDailyCap } from "./actions";
import {
  BD_NUMBER_INPUT,
  BD_ROW,
  BD_ROW_DESC,
  BD_ROW_GROUP,
  BD_ROW_LABEL,
  BD_SAVE_BUTTON,
} from "./spec-classes";

export type LimitsConfig = {
  globalDailyCap: number;
  pauseAll: boolean;
  blackoutWeekends: boolean;
  blackoutHolidays: boolean;
  blackoutBefore7am: boolean;
  blackoutAfter530pm: boolean;
};

type VerticalSummary = { id: string; name: string; dailyCap: number | null };

export function LimitsSection({
  config,
  verticals,
}: {
  config: LimitsConfig;
  verticals: VerticalSummary[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggleConfig = (key: keyof LimitsConfig, value: boolean) => {
    startTransition(async () => {
      await updateBdOrgConfig({ [key]: value });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className={BD_ROW_GROUP}>
        <PauseAllRow
          pauseAll={config.pauseAll}
          onToggle={(value) => toggleConfig("pauseAll", value)}
          pending={pending}
        />
        <GlobalCapRow value={config.globalDailyCap} />
      </div>

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
          Per-vertical caps
        </p>
        {verticals.length === 0 ? (
          <p className="rounded-xl border border-dashed border-court-border bg-court-surface-subtle p-3 text-xs text-court-fg-muted">
            Add a vertical above to set per-vertical caps.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {verticals.map((v) => (
              <VerticalCapCard
                key={v.id}
                id={v.id}
                name={v.name}
                value={v.dailyCap}
                globalFallback={config.globalDailyCap}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
          Blackout windows
        </p>
        <div className="flex flex-wrap gap-2">
          <BlackoutPill
            label="Weekends"
            on={config.blackoutWeekends}
            onChange={(v) => toggleConfig("blackoutWeekends", v)}
          />
          <BlackoutPill
            label="US Federal Holidays"
            on={config.blackoutHolidays}
            onChange={(v) => toggleConfig("blackoutHolidays", v)}
          />
          <BlackoutPill
            label="Before 7 AM ET"
            on={config.blackoutBefore7am}
            onChange={(v) => toggleConfig("blackoutBefore7am", v)}
          />
          <BlackoutPill
            label="After 5:30 PM ET"
            on={config.blackoutAfter530pm}
            onChange={(v) => toggleConfig("blackoutAfter530pm", v)}
          />
        </div>
      </div>
    </div>
  );
}

function PauseAllRow({
  pauseAll,
  onToggle,
  pending,
}: {
  pauseAll: boolean;
  onToggle: (v: boolean) => void;
  pending: boolean;
}) {
  return (
    <div className={BD_ROW}>
      <div className="min-w-0">
        <p
          className={cn(
            BD_ROW_LABEL,
            pauseAll && "text-red-700 dark:text-red-200",
          )}
        >
          Pause all sends
        </p>
        <p
          className={cn(
            "mt-0.5",
            BD_ROW_DESC,
            pauseAll && "text-red-700/80 dark:text-red-200/80",
          )}
        >
          Global kill switch. Disables Launch BD Run across every vertical.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {pauseAll && (
          <span className="inline-flex h-6 items-center rounded-full bg-red-100 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-red-700 dark:bg-red-950 dark:text-red-200">
            Paused
          </span>
        )}
        <Toggle on={pauseAll} onChange={onToggle} disabled={pending} accent={pauseAll ? "red" : "brand"} />
      </div>
    </div>
  );
}

function GlobalCapRow({ value }: { value: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, startTransition] = useTransition();

  const onSave = () => {
    startTransition(async () => {
      await updateBdOrgConfig({ globalDailyCap: draft });
      router.refresh();
      setEditing(false);
    });
  };

  return (
    <div className={BD_ROW}>
      <div className="min-w-0">
        <p className={BD_ROW_LABEL}>Global daily contact cap</p>
        <p className={`mt-0.5 ${BD_ROW_DESC}`}>
          Default ceiling on contacts enrolled per BD run. Per-vertical and per-search caps override.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {editing ? (
          <>
            <input
              type="number"
              min={0}
              value={draft}
              onChange={(e) => setDraft(Number(e.target.value))}
              className={`${BD_NUMBER_INPUT} w-24 text-right tabular-nums`}
            />
            <button
              type="button"
              onClick={() => {
                setDraft(value);
                setEditing(false);
              }}
              className="rounded-full p-2 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={pending}
              className={BD_SAVE_BUTTON}
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save
            </button>
          </>
        ) : (
          <>
            <span className="font-serif text-2xl font-bold tabular-nums text-court-fg">{value}</span>
            <button
              type="button"
              onClick={() => {
                setDraft(value);
                setEditing(true);
              }}
              aria-label="Edit global cap"
              className="rounded-full p-2 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function VerticalCapCard({
  id,
  name,
  value,
  globalFallback,
}: {
  id: string;
  name: string;
  value: number | null;
  globalFallback: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number>(value ?? globalFallback);
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-2xl bg-court-surface-subtle p-4 shadow-sm">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">{name}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        {editing ? (
          <input
            type="number"
            min={0}
            value={draft}
            onChange={(e) => setDraft(Number(e.target.value))}
            className={`${BD_NUMBER_INPUT} w-24 text-right tabular-nums`}
          />
        ) : (
          <span className="font-serif text-2xl font-bold tabular-nums text-court-fg">
            {value ?? globalFallback}
            {value == null && (
              <span className="ml-1 text-[10px] font-normal uppercase tracking-wider text-court-fg-dim">
                inherits
              </span>
            )}
          </span>
        )}
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraft(value ?? globalFallback);
                  setEditing(false);
                }}
                aria-label="Cancel"
                className="rounded-full p-1.5 text-court-fg-muted hover:bg-court-surface hover:text-court-fg"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    await updateVerticalDailyCap(id, draft);
                    router.refresh();
                    setEditing(false);
                  });
                }}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-court-brand px-2.5 text-[11px] font-semibold text-white transition hover:bg-court-brand-dark disabled:opacity-60"
              >
                {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(value ?? globalFallback);
                setEditing(true);
              }}
              aria-label="Edit cap"
              className="rounded-full p-1.5 text-court-fg-muted hover:bg-court-surface hover:text-court-fg"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BlackoutPill({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-[11px] font-medium transition",
        on
          ? "bg-court-brand-tint text-court-brand-dark"
          : "bg-court-surface-subtle text-court-fg-muted hover:text-court-fg",
      )}
    >
      {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </button>
  );
}

export function Toggle({
  on,
  onChange,
  disabled,
  accent = "brand",
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  accent?: "brand" | "red";
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition disabled:opacity-60",
        on
          ? accent === "red"
            ? "border-red-300 bg-red-500"
            : "border-court-brand bg-court-brand"
          : "border-court-border bg-court-surface-subtle",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-court-surface shadow transition",
          on ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
