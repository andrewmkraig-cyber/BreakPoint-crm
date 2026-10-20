"use client";

// "Who is this person replacing?" Shown under Deal Type when it reads
// Replacement, in both placement editors. Renders the current pick with
// a Change button, and a popup list to choose from: the client's fell-off
// candidates first (the ones a replacement is owed on), then the client's
// other hires, then a search across every hired placement.
//
// The pick is held by the parent form and saved with the rest of the deal
// (Placement.replacesPlacementId). This component never writes.

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, UserMinus, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatDate } from "@/lib/utils";
import {
  listReplacementOptions,
  type ReplacementOption,
} from "@/app/pipeline/replacement-options-action";

export function ReplacementPicker({
  placementId,
  value,
  onChange,
  disabled,
  className,
}: {
  // The deal being booked. Null for a row that has not been saved yet.
  placementId: string | null;
  value: string | null;
  onChange: (next: { placementId: string; candidateName: string } | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [options, setOptions] = useState<ReplacementOption[] | null>(null);
  const [q, setQ] = useState("");
  const [allClients, setAllClients] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    const res = await listReplacementOptions({ placementId });
    setLoading(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setOptions(res.options);
  }

  // Load once so the current pick can be named even before the popup opens.
  useEffect(() => {
    if (options == null && !loading) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => options?.find((o) => o.placementId === value) ?? null,
    [options, value],
  );

  const sameClientCount = useMemo(
    () => options?.filter((o) => o.sameClient).length ?? 0,
    [options],
  );

  function pick(o: ReplacementOption) {
    onChange({ placementId: o.placementId, candidateName: o.candidateName });
    setOpen(false);
  }

  const visible = useMemo(() => {
    if (!options) return [];
    const needle = q.trim().toLowerCase();
    return options.filter((o) => {
      if (!allClients && !needle && sameClientCount > 0 && !o.sameClient) return false;
      if (!needle) return true;
      return (
        o.candidateName.toLowerCase().includes(needle) ||
        o.clientName.toLowerCase().includes(needle) ||
        (o.roleTitle ?? "").toLowerCase().includes(needle)
      );
    });
  }, [options, q, allClients, sameClientCount]);

  return (
    <div className={cn("rounded-lg border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-900 dark:bg-amber-950/20", className)}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
        Replacing
      </div>
      {value ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-court-fg">
            <UserMinus className="h-3.5 w-3.5 text-amber-600" />
            {selected?.candidateName ?? (loading ? "Loading…" : "Selected candidate")}
          </span>
          {selected ? (
            <span className="text-[12px] text-court-fg-muted">
              {selected.roleTitle ?? "—"} · {selected.clientName}
              {selected.fellOffAtIso ? ` · fell off ${formatDate(selected.fellOffAtIso)}` : ""}
            </span>
          ) : null}
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={disabled}>
            Change
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} disabled={disabled}>
            <X className="h-3 w-3" /> Clear
          </Button>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Button type="button" variant="apply" size="sm" onClick={() => setOpen(true)} disabled={disabled}>
            <Users className="h-3 w-3" />
            Choose who they are replacing
          </Button>
          <span className="text-[11px] text-court-fg-muted">
            Picks from this client&apos;s fell-off candidates first.
          </span>
        </div>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Who is this person replacing?"
            className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl border border-court-border bg-court-surface shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-court-border px-5 py-4">
              <div>
                <h2 className="font-serif text-base font-semibold text-court-fg">
                  Who is this person replacing?
                </h2>
                <p className="mt-0.5 text-[12px] text-court-fg-muted">
                  Candidates this client is owed a replacement on come first.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
              <div className="min-w-[220px] flex-1">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name, client or role"
                  autoFocus
                />
              </div>
              {sameClientCount > 0 ? (
                <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-court-fg-muted">
                  <input
                    type="checkbox"
                    checked={allClients}
                    onChange={(e) => setAllClients(e.target.checked)}
                    className="h-3.5 w-3.5 accent-amber-600"
                  />
                  Show every client
                </label>
              ) : null}
            </div>
            <div className="mt-3 flex-1 overflow-y-auto px-5 pb-4">
              {loading && !options ? (
                <div className="flex items-center gap-2 py-6 text-sm text-court-fg-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading placements…
                </div>
              ) : err ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>
              ) : visible.length === 0 ? (
                <div className="flex items-center gap-2 py-6 text-sm text-court-fg-muted">
                  <Search className="h-4 w-4" />
                  {q.trim()
                    ? "No hired placement matches that."
                    : "No hired placements at this client yet. Tick Show every client or search."}
                </div>
              ) : (
                <ul role="listbox" aria-label="Hired placements" className="divide-y divide-court-border-soft">
                  {visible.map((o) => (
                    <li key={o.placementId}>
                      {/* A selectable row, not an action button: role="option"
                          with Enter / Space so it stays keyboard-reachable. */}
                      <div
                        role="option"
                        aria-selected={o.placementId === value}
                        tabIndex={0}
                        onClick={() => pick(o)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            pick(o);
                          }
                        }}
                        className={cn(
                          "flex w-full cursor-pointer items-start justify-between gap-3 rounded-md px-2 py-2.5 text-left transition hover:bg-court-surface-subtle focus:outline-none focus:ring-2 focus:ring-brand/30",
                          o.placementId === value && "bg-amber-50 dark:bg-amber-950/30",
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-court-fg">{o.candidateName}</span>
                            {o.fellOffAtIso && o.replacementOwed && !o.replacedBy ? (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                                Replacement owed
                              </span>
                            ) : o.fellOffAtIso ? (
                              <span className="rounded-full border border-court-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-court-fg-muted">
                                Fell off
                              </span>
                            ) : null}
                            {o.replacedBy ? (
                              <span className="text-[11px] text-court-fg-muted">already replaced by {o.replacedBy}</span>
                            ) : null}
                          </div>
                          <div className="truncate text-[12px] text-court-fg-muted">
                            {o.roleTitle ?? "—"} · {o.clientName}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-[11px] tabular-nums text-court-fg-muted">
                          {o.fellOffAtIso ? (
                            <div>Fell off {formatDate(o.fellOffAtIso)}</div>
                          ) : null}
                          {o.startDateIso ? <div>Started {formatDate(o.startDateIso)}</div> : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
