"use client";

import {
  Briefcase,
  CheckCircle2,
  CircleDashed,
  Copy,
  DollarSign,
  ExternalLink,
  EyeOff,
  MapPin,
  Percent,
  Users,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { INPUT_FRAME_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";
import { JobOverviewActionButtons } from "@/app/jobs/[id]/job-overview-action-buttons";
import {
  updateJobOverview,
  type JobLifecycle,
  type JobOverviewPatch,
} from "@/app/jobs/[id]/job-overview-actions";

// Overview tab body. Full-width single card with click-to-edit cells.
// Lifecycle actions (Inactivate / Make Private / Reactivate / Delete)
// still ride the top bar; per-field saves call updateJobOverview and
// router.refresh() so downstream readers (find-matches, Game Plan
// context, pipeline) pick up the new values immediately.

export type JobOverviewSnapshot = {
  jobId: string;
  title: string;
  clientName: string;
  locations: string[];
  lifecycle: JobLifecycle;
  employmentType: string | null;
  compensation: string;
  feePct: number | null;
  numberOfOpenings: number | null;
  lastEditedAt: string | null;
  applyLink: string | null;
  // Granular comp fields back the Compensation cell so save-on-blur can
  // patch lo / hi / currency / frequency without rebuilding from the
  // formatted display string.
  salaryRangeStart: number | null;
  salaryRangeEnd: number | null;
  salaryCurrency: string | null;
  salaryFrequency: "yearly" | "hourly" | null;
};

export function JobOverviewTab({
  snapshot,
  jobRfId,
  jobCuid,
}: {
  snapshot: JobOverviewSnapshot;
  jobRfId: number | null;
  jobCuid: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<JobOverviewSnapshot>(snapshot);

  useEffect(() => {
    setState(snapshot);
  }, [snapshot]);

  async function save(
    patch: JobOverviewPatch,
    apply: (s: JobOverviewSnapshot) => JobOverviewSnapshot,
  ): Promise<boolean> {
    const res = await updateJobOverview({ jobRfId, jobCuid, patch });
    if (!res.ok) {
      toast.error("Couldn't save", { description: res.error });
      return false;
    }
    setState(apply);
    toast.success("Saved");
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-end">
        <JobOverviewActionButtons jobId={state.jobId} lifecycle={state.lifecycle} />
      </section>

      <section className="rounded-xl border border-court-border/40 bg-court-surface p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <InlineTextCell
            icon={<Briefcase className="h-3.5 w-3.5" />}
            label="Employment"
            value={state.employmentType ?? ""}
            placeholder="Full-time"
            onSave={(next) =>
              save(
                { employmentType: next || null },
                (s) => ({ ...s, employmentType: next || null }),
              )
            }
          />
          <InlineTextCell
            icon={<MapPin className="h-3.5 w-3.5" />}
            label="Location"
            value={state.locations.join(", ")}
            placeholder="Cleveland, OH"
            onSave={(next) => {
              const list = next
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
              return save({ locations: list }, (s) => ({ ...s, locations: list }));
            }}
          />
          <StatusCell lifecycle={state.lifecycle} />
          <CompensationCell
            state={state}
            onSave={(patch, next) =>
              save(patch, (s) => ({
                ...s,
                salaryRangeStart: next.salaryRangeStart,
                salaryRangeEnd: next.salaryRangeEnd,
                salaryCurrency: next.salaryCurrency,
                salaryFrequency: next.salaryFrequency,
                compensation: formatCompSummary(next),
              }))
            }
          />
          <ReadOnlyCell
            icon={<Percent className="h-3.5 w-3.5" />}
            label="Fee"
            value={state.feePct != null ? `${state.feePct}%` : "—"}
          />
          <InlineNumberCell
            icon={<Users className="h-3.5 w-3.5" />}
            label="Openings"
            value={state.numberOfOpenings}
            onSave={(next) =>
              save(
                { numberOfOpenings: next },
                (s) => ({ ...s, numberOfOpenings: next }),
              )
            }
          />
          <ReadOnlyCell label="Last Edited" value={formatDate(state.lastEditedAt)} />
        </div>

        {state.applyLink && <ApplyLinkSection url={state.applyLink} />}
      </section>
    </div>
  );
}

function CellShell({
  icon,
  label,
  children,
}: {
  icon?: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm text-court-fg">{children}</div>
    </div>
  );
}

function ReadOnlyCell({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <CellShell icon={icon} label={label}>
      {value}
    </CellShell>
  );
}

function StatusCell({ lifecycle }: { lifecycle: JobLifecycle }) {
  const icon =
    lifecycle === "active" ? (
      <CheckCircle2 className="h-3.5 w-3.5" />
    ) : lifecycle === "private" ? (
      <EyeOff className="h-3.5 w-3.5" />
    ) : (
      <CircleDashed className="h-3.5 w-3.5" />
    );
  return (
    <CellShell icon={icon} label="Status">
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
          lifecycle === "active"
            ? "bg-brand-tint text-brand-dark"
            : lifecycle === "private"
              ? "bg-amber-50 text-amber-700"
              : "bg-red-100 text-red-700",
        )}
      >
        {lifecycle === "active"
          ? "Active"
          : lifecycle === "private"
            ? "Private"
            : "Inactive"}
      </span>
    </CellShell>
  );
}

const inlineFrameCls = `${INPUT_FRAME_CLASS} w-full`;
const inlineInputCls = `${INPUT_CONTROL_CLASS} text-sm`;

const cellButtonCls =
  "block w-full rounded text-left text-sm text-court-fg hover:bg-court-surface-subtle hover:text-court-accent-dark";

function InlineTextCell({
  icon,
  label,
  value,
  placeholder,
  onSave,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  placeholder?: string;
  onSave: (next: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  async function commit() {
    if (saving) return;
    if (draft.trim() === value.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(draft.trim());
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <CellShell icon={icon} label={label}>
      {editing ? (
        <div className={inlineFrameCls}>
          <input
            autoFocus
            type="text"
            value={draft}
            disabled={saving}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setDraft(value);
                setEditing(false);
              }
            }}
            className={inlineInputCls}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${label}`}
          className={cellButtonCls}
        >
          {value || <span className="text-court-fg-muted">—</span>}
        </button>
      )}
    </CellShell>
  );
}

function InlineNumberCell({
  icon,
  label,
  value,
  onSave,
}: {
  icon?: ReactNode;
  label: string;
  value: number | null;
  onSave: (next: number | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value != null ? String(value) : "");
  }, [value, editing]);

  async function commit() {
    if (saving) return;
    const trimmed = draft.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (
      parsed != null &&
      (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0)
    ) {
      toast.error("Must be a positive whole number.");
      setDraft(value != null ? String(value) : "");
      setEditing(false);
      return;
    }
    if (parsed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(parsed);
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <CellShell icon={icon} label={label}>
      {editing ? (
        <div className={inlineFrameCls}>
          <input
            autoFocus
            type="number"
            inputMode="numeric"
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setDraft(value != null ? String(value) : "");
                setEditing(false);
              }
            }}
            className={inlineInputCls}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${label}`}
          className={cellButtonCls}
        >
          {value != null ? (
            String(value)
          ) : (
            <span className="text-court-fg-muted">—</span>
          )}
        </button>
      )}
    </CellShell>
  );
}

type CompState = {
  salaryRangeStart: number | null;
  salaryRangeEnd: number | null;
  salaryCurrency: string | null;
  salaryFrequency: "yearly" | "hourly";
};

function CompensationCell({
  state,
  onSave,
}: {
  state: JobOverviewSnapshot;
  onSave: (patch: JobOverviewPatch, next: CompState) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftLo, setDraftLo] = useState("");
  const [draftHi, setDraftHi] = useState("");
  const [draftCcy, setDraftCcy] = useState("USD");
  const [draftFreq, setDraftFreq] = useState<"yearly" | "hourly">("yearly");
  const [saving, setSaving] = useState(false);
  const groupRef = useRef<HTMLDivElement | null>(null);

  function startEditing() {
    setDraftLo(state.salaryRangeStart != null ? String(state.salaryRangeStart) : "");
    setDraftHi(state.salaryRangeEnd != null ? String(state.salaryRangeEnd) : "");
    setDraftCcy(state.salaryCurrency ?? "USD");
    setDraftFreq(state.salaryFrequency === "hourly" ? "hourly" : "yearly");
    setEditing(true);
  }

  async function commit() {
    if (saving) return;
    const lo = parseMoney(draftLo);
    const hi = parseMoney(draftHi);
    if (lo === "invalid" || hi === "invalid") {
      toast.error("Salary must be a number.");
      setEditing(false);
      return;
    }
    const ccy = draftCcy.trim().toUpperCase().slice(0, 3) || null;
    const next: CompState = {
      salaryRangeStart: lo,
      salaryRangeEnd: hi,
      salaryCurrency: ccy,
      salaryFrequency: draftFreq,
    };
    if (
      next.salaryRangeStart === state.salaryRangeStart &&
      next.salaryRangeEnd === state.salaryRangeEnd &&
      next.salaryCurrency === state.salaryCurrency &&
      next.salaryFrequency === state.salaryFrequency
    ) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(
      {
        salaryRangeStart: next.salaryRangeStart,
        salaryRangeEnd: next.salaryRangeEnd,
        salaryCurrency: next.salaryCurrency,
        salaryFrequency: next.salaryFrequency,
      },
      next,
    );
    setSaving(false);
    if (ok) setEditing(false);
  }

  // Group blur — only commit when focus leaves the entire compensation
  // group. setTimeout lets the next focus settle before we read it.
  function handleBlur() {
    setTimeout(() => {
      if (!groupRef.current) return;
      if (!groupRef.current.contains(document.activeElement)) {
        void commit();
      }
    }, 0);
  }

  return (
    <CellShell icon={<DollarSign className="h-3.5 w-3.5" />} label="Compensation">
      {editing ? (
        <div ref={groupRef} onBlur={handleBlur} className="space-y-1.5">
          <div className="flex items-center gap-3 text-[11px] text-court-fg-muted">
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="comp-freq"
                checked={draftFreq === "yearly"}
                onChange={() => setDraftFreq("yearly")}
              />
              Salary
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="comp-freq"
                checked={draftFreq === "hourly"}
                onChange={() => setDraftFreq("hourly")}
              />
              Hourly
            </label>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div className={inlineFrameCls}>
              <input
                autoFocus
                type="text"
                value={draftLo}
                disabled={saving}
                onChange={(e) => setDraftLo(e.target.value)}
                placeholder="Low"
                aria-label="Salary low"
                className={inlineInputCls}
              />
            </div>
            <div className={inlineFrameCls}>
              <input
                type="text"
                value={draftHi}
                disabled={saving}
                onChange={(e) => setDraftHi(e.target.value)}
                placeholder="High"
                aria-label="Salary high"
                className={inlineInputCls}
              />
            </div>
            <div className={inlineFrameCls}>
              <input
                type="text"
                value={draftCcy}
                disabled={saving}
                onChange={(e) => setDraftCcy(e.target.value)}
                placeholder="USD"
                aria-label="Currency"
                className={inlineInputCls}
              />
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={startEditing}
          aria-label="Edit compensation"
          className={cellButtonCls}
        >
          {state.compensation}
        </button>
      )}
    </CellShell>
  );
}

function ApplyLinkSection({ url }: { url: string }) {
  return (
    <div className="mt-4 space-y-1.5 border-t border-court-border pt-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        Public Apply Link
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast.success("Apply link copied");
            } catch {
              toast.error("Couldn't copy link");
            }
          }}
          title="Copy public apply link"
          className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          <Copy className="h-3.5 w-3.5" /> Copy link
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Open public apply link in a new tab"
          className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open
        </a>
      </div>
    </div>
  );
}

// Tolerates "$120,000" / "120k" / "120000" / "" forms. Returns null for
// empty input, "invalid" sentinel for unparseable, number otherwise.
function parseMoney(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  if (/^\d+k$/i.test(cleaned)) {
    const n = Number(cleaned.slice(0, -1)) * 1000;
    return Number.isFinite(n) ? n : "invalid";
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return "invalid";
  return n;
}

function formatCompSummary(state: CompState): string {
  const { salaryRangeStart: lo, salaryRangeEnd: hi, salaryCurrency, salaryFrequency } = state;
  if (lo == null && hi == null) return "—";
  const ccy = (salaryCurrency ?? "USD").toUpperCase();
  const symbol = ccy === "USD" ? "$" : `${ccy} `;
  const fmt = (n: number) => `${symbol}${n.toLocaleString()}`;
  const suffix = salaryFrequency === "hourly" ? " / hr" : " / yr";
  if (lo != null && hi != null && lo !== hi) return `${fmt(lo)} – ${fmt(hi)}${suffix}`;
  const only = lo ?? hi!;
  return `${fmt(only)}${suffix}`;
}
