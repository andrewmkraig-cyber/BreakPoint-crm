"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Save, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveContactTargeting } from "./actions";

export type ContactTargetingRow = {
  verticalId: string;
  verticalName: string;
  primaryTitles: string[];
  smallFirmFallbackTitles: string[];
  practiceSpecificTitles: string[];
  maxPerFirm: number;
};

export function ContactTargetingSection({ rows }: { rows: ContactTargetingRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-court-border bg-court-surface-subtle p-6 text-center text-sm text-court-fg-muted">
        Add a vertical first to configure contact targeting.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {rows.map((row) => (
        <VerticalTargetingCard key={row.verticalId} row={row} />
      ))}
    </div>
  );
}

function VerticalTargetingCard({ row }: { row: ContactTargetingRow }) {
  const router = useRouter();
  const [primary, setPrimary] = useState(row.primaryTitles);
  const [smallFirm, setSmallFirm] = useState(row.smallFirmFallbackTitles);
  const [practice, setPractice] = useState(row.practiceSpecificTitles);
  const [maxPerFirm, setMaxPerFirm] = useState(row.maxPerFirm);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSave() {
    setError(null);
    startTransition(async () => {
      try {
        await saveContactTargeting({
          verticalId: row.verticalId,
          primaryTitles: primary,
          smallFirmFallbackTitles: smallFirm,
          practiceSpecificTitles: practice,
          maxPerFirm,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <div className="rounded-lg border border-court-border bg-court-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-court-brand-dark">
        {row.verticalName}
      </p>

      <div className="mt-4 flex flex-col gap-4">
        <TitleTierField
          label="Primary titles"
          hint="Decision-makers Ace prefers first. Always considered; up to the per-firm cap."
          titles={primary}
          onChange={setPrimary}
        />
        <TitleTierField
          label="Small-firm fallback"
          hint="Only used when no primary contact is returned for a firm."
          titles={smallFirm}
          onChange={setSmallFirm}
        />
        <TitleTierField
          label="Practice-specific"
          hint="Max 1 per firm; only fills remaining slots after primary / small-firm."
          titles={practice}
          onChange={setPractice}
        />
        <label className="block max-w-[14rem]">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-court-fg-muted">
            Max contacts per firm
          </span>
          <input
            type="number"
            min={1}
            max={20}
            value={maxPerFirm}
            onChange={(e) => setMaxPerFirm(Number(e.target.value) || 1)}
            className="mt-1 block w-full rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
          />
        </label>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save targeting
          </button>
        </div>
      </div>
    </div>
  );
}

function TitleTierField({
  label,
  hint,
  titles,
  onChange,
}: {
  label: string;
  hint: string;
  titles: string[];
  onChange: (titles: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const tokens = draft
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) return;
    onChange(Array.from(new Set([...titles, ...tokens])));
    setDraft("");
  }

  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-court-fg-muted">
        {label}
      </span>
      <span className="mt-0.5 block text-[11px] text-court-fg-dim">{hint}</span>
      <div
        className={cn(
          "mt-1 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2 py-1.5",
        )}
      >
        {titles.map((t, i) => (
          <span
            key={`${t}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-court-brand-tint px-2 py-0.5 text-[11px] font-medium text-court-brand-dark"
          >
            {t}
            <button
              type="button"
              onClick={() => onChange(titles.filter((x) => x !== t))}
              aria-label={`Remove ${t}`}
              className="text-court-brand-dark/70 hover:text-court-brand-dark"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "," || e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            } else if (e.key === "Backspace" && !draft && titles.length > 0) {
              onChange(titles.slice(0, -1));
            }
          }}
          onBlur={commitDraft}
          placeholder={titles.length === 0 ? "Type a title, press Enter or comma" : ""}
          className="flex-1 min-w-[160px] bg-transparent text-sm text-court-fg placeholder:text-court-fg-dim focus:outline-none"
        />
      </div>
    </label>
  );
}
