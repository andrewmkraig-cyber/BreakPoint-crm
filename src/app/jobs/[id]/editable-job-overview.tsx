"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  CheckCircle2,
  CircleDashed,
  DollarSign,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  Save,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import {
  updateJobOverview,
  type JobOverviewPatch,
} from "@/app/jobs/[id]/job-overview-actions";
import { LabeledField } from "@/app/candidates/[id]/editable-helpers";

// Sidebar card for /jobs/[id]. Each row is a self-contained inline
// editor (Pencil → input → Save / Cancel) so the recruiter can edit
// one field at a time without entering a full-card "edit mode" — same
// in-place rhythm the candidate profile uses for Contact / Employment,
// just one row at a time. Read state lives in this component so saves
// echo immediately; on success we also kick router.refresh() so the
// rest of the page (header chips, AiWorkspace context, find-matches
// reads) sees the updated Job row.

export type JobOverviewInitial = {
  // Numeric inputs that the form normalizes to whole-dollar currency
  // and integer counts. Null when not set.
  salaryRangeStart: number | null;
  salaryRangeEnd: number | null;
  salaryCurrency: string | null;
  locations: string[];
  numberOfOpenings: number | null;
  isOpen: boolean;
  employmentType: string | null;
  // Read-only context.
  billingContact: string;
  lastEditedAt: string | null;
  applyLink: string | null;
};

export function EditableJobOverview({
  jobRfId,
  jobCuid,
  initial,
}: {
  jobRfId: number | null;
  jobCuid: string | null;
  initial: JobOverviewInitial;
}) {
  const [state, setState] = useState<JobOverviewInitial>(initial);

  return (
    <aside className="rounded-xl border border-court-border bg-court-surface shadow-sm">
      <div className="border-b border-court-border px-4 py-3">
        <h2 className="font-serif text-base font-semibold text-court-fg">Overview</h2>
      </div>
      <dl className="divide-y divide-court-border">
        <CompensationRow
          jobRfId={jobRfId}
          jobCuid={jobCuid}
          state={state}
          setState={setState}
        />
        <LocationRow
          jobRfId={jobRfId}
          jobCuid={jobCuid}
          state={state}
          setState={setState}
        />
        <OpeningsRow
          jobRfId={jobRfId}
          jobCuid={jobCuid}
          state={state}
          setState={setState}
        />
        <StatusRow
          jobRfId={jobRfId}
          jobCuid={jobCuid}
          state={state}
          setState={setState}
        />
        <EmploymentTypeRow
          jobRfId={jobRfId}
          jobCuid={jobCuid}
          state={state}
          setState={setState}
        />
        <ReadOnlyRow
          icon={<Users className="h-3 w-3" />}
          label="Billing Contact"
          value={state.billingContact || "—"}
        />
        <ReadOnlyRow label="Last Edited" value={formatDate(state.lastEditedAt)} />
      </dl>
      {state.applyLink && (
        <div className="border-t border-court-border px-4 py-3">
          <a
            href={state.applyLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brand-dark hover:underline"
          >
            Public apply link <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </aside>
  );
}

// Generic row chassis. Holds the editing-flag flip so each row has
// independent edit state; when not editing, renders `display`; when
// editing, renders `form` plus Save / Cancel controls. Save calls the
// passed-in onSave (which performs the server action and resolves to
// next state) — generic enough for every row to reuse.
function EditRow({
  icon,
  label,
  display,
  form,
  onSave,
  onCancelDraft,
  saveDisabled = false,
}: {
  icon?: ReactNode;
  label: string;
  display: ReactNode;
  form: (editing: boolean) => ReactNode;
  onSave: () => Promise<{ ok: true } | { ok: false; error: string }>;
  onCancelDraft: () => void;
  saveDisabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function commit() {
    setError(null);
    startSave(async () => {
      const res = await onSave();
      if (!res.ok) {
        setError(res.error);
        toast.error(`Couldn't save ${label.toLowerCase()}`, { description: res.error });
        return;
      }
      setEditing(false);
      toast.success(`${label} saved`);
      router.refresh();
    });
  }

  function cancel() {
    onCancelDraft();
    setEditing(false);
    setError(null);
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <dt className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
          {icon}
          {label}
        </dt>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${label}`}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 text-[10px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 text-[10px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
            >
              <X className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={pending || saveDisabled}
              className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
        )}
      </div>
      <dd className="mt-1 text-sm text-court-fg">
        {editing ? form(true) : display}
      </dd>
      {error && editing && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}

function ReadOnlyRow({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="px-4 py-3">
      <dt className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-sm text-court-fg">{value}</dd>
    </div>
  );
}

// --- Per-field rows ---

function formatComp(state: JobOverviewInitial): string {
  const { salaryRangeStart: lo, salaryRangeEnd: hi, salaryCurrency } = state;
  if (lo == null && hi == null) return "—";
  const ccy = (salaryCurrency ?? "USD").toUpperCase();
  const symbol = ccy === "USD" ? "$" : `${ccy} `;
  const fmt = (n: number) => `${symbol}${n.toLocaleString()}`;
  if (lo != null && hi != null && lo !== hi) return `${fmt(lo)} – ${fmt(hi)}`;
  const only = lo ?? hi!;
  return fmt(only);
}

function CompensationRow({
  jobRfId,
  jobCuid,
  state,
  setState,
}: {
  jobRfId: number | null;
  jobCuid: string | null;
  state: JobOverviewInitial;
  setState: React.Dispatch<React.SetStateAction<JobOverviewInitial>>;
}) {
  const [draftLo, setDraftLo] = useState<string>(
    state.salaryRangeStart != null ? String(state.salaryRangeStart) : "",
  );
  const [draftHi, setDraftHi] = useState<string>(
    state.salaryRangeEnd != null ? String(state.salaryRangeEnd) : "",
  );
  const [draftCcy, setDraftCcy] = useState<string>(state.salaryCurrency ?? "USD");

  return (
    <EditRow
      icon={<DollarSign className="h-3 w-3" />}
      label="Compensation"
      display={<span>{formatComp(state)}</span>}
      form={() => (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <LabeledField
            label="Low"
            value={draftLo}
            onChange={setDraftLo}
            placeholder="80000"
          />
          <LabeledField
            label="High"
            value={draftHi}
            onChange={setDraftHi}
            placeholder="120000"
          />
          <div className="sm:col-span-2">
            <LabeledField
              label="Currency"
              value={draftCcy}
              onChange={setDraftCcy}
              placeholder="USD"
            />
          </div>
        </div>
      )}
      onCancelDraft={() => {
        setDraftLo(state.salaryRangeStart != null ? String(state.salaryRangeStart) : "");
        setDraftHi(state.salaryRangeEnd != null ? String(state.salaryRangeEnd) : "");
        setDraftCcy(state.salaryCurrency ?? "USD");
      }}
      onSave={async () => {
        const lo = parseMoney(draftLo);
        const hi = parseMoney(draftHi);
        if (lo === "invalid") return { ok: false, error: "Salary low must be a number." };
        if (hi === "invalid") return { ok: false, error: "Salary high must be a number." };
        const patch: JobOverviewPatch = {
          salaryRangeStart: lo,
          salaryRangeEnd: hi,
          salaryCurrency: draftCcy.trim() || null,
        };
        const res = await updateJobOverview({ jobRfId, jobCuid, patch });
        if (!res.ok) return res;
        setState((s) => ({ ...s, salaryRangeStart: lo, salaryRangeEnd: hi, salaryCurrency: patch.salaryCurrency ?? null }));
        return { ok: true };
      }}
    />
  );
}

function LocationRow({
  jobRfId,
  jobCuid,
  state,
  setState,
}: {
  jobRfId: number | null;
  jobCuid: string | null;
  state: JobOverviewInitial;
  setState: React.Dispatch<React.SetStateAction<JobOverviewInitial>>;
}) {
  const [draft, setDraft] = useState(state.locations.join(", "));
  return (
    <EditRow
      icon={<MapPin className="h-3 w-3" />}
      label="Location"
      display={<span>{state.locations.length > 0 ? state.locations.join(", ") : "—"}</span>}
      form={() => (
        <LabeledField
          label="Locations (comma-separated)"
          value={draft}
          onChange={setDraft}
          placeholder="Cleveland, OH"
        />
      )}
      onCancelDraft={() => setDraft(state.locations.join(", "))}
      onSave={async () => {
        const next = draft
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        const res = await updateJobOverview({
          jobRfId,
          jobCuid,
          patch: { locations: next },
        });
        if (!res.ok) return res;
        setState((s) => ({ ...s, locations: next }));
        return { ok: true };
      }}
    />
  );
}

function OpeningsRow({
  jobRfId,
  jobCuid,
  state,
  setState,
}: {
  jobRfId: number | null;
  jobCuid: string | null;
  state: JobOverviewInitial;
  setState: React.Dispatch<React.SetStateAction<JobOverviewInitial>>;
}) {
  const [draft, setDraft] = useState(
    state.numberOfOpenings != null ? String(state.numberOfOpenings) : "",
  );
  return (
    <EditRow
      icon={<Users className="h-3 w-3" />}
      label="Openings"
      display={<span>{state.numberOfOpenings != null ? String(state.numberOfOpenings) : "—"}</span>}
      form={() => (
        <LabeledField
          label="Number of openings"
          value={draft}
          onChange={setDraft}
          placeholder="1"
        />
      )}
      onCancelDraft={() => setDraft(state.numberOfOpenings != null ? String(state.numberOfOpenings) : "")}
      onSave={async () => {
        const trimmed = draft.trim();
        let openings: number | null;
        if (!trimmed) {
          openings = null;
        } else {
          const n = Number(trimmed);
          if (!Number.isFinite(n) || !Number.isInteger(n)) {
            return { ok: false, error: "Openings must be a whole number." };
          }
          openings = n;
        }
        const res = await updateJobOverview({
          jobRfId,
          jobCuid,
          patch: { numberOfOpenings: openings },
        });
        if (!res.ok) return res;
        setState((s) => ({ ...s, numberOfOpenings: openings }));
        return { ok: true };
      }}
    />
  );
}

function StatusRow({
  jobRfId,
  jobCuid,
  state,
  setState,
}: {
  jobRfId: number | null;
  jobCuid: string | null;
  state: JobOverviewInitial;
  setState: React.Dispatch<React.SetStateAction<JobOverviewInitial>>;
}) {
  const [draft, setDraft] = useState(state.isOpen);
  return (
    <EditRow
      icon={state.isOpen ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
      label="Status"
      display={
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
            state.isOpen
              ? "bg-brand-tint text-brand-dark"
              : "bg-court-surface-subtle text-court-fg-muted",
          )}
        >
          {state.isOpen ? "Active" : "Inactive"}
        </span>
      }
      form={() => (
        <div className="flex items-center gap-3 text-sm">
          <label className="inline-flex items-center gap-1">
            <input
              type="radio"
              name="job-status"
              checked={draft}
              onChange={() => setDraft(true)}
            />
            Active
          </label>
          <label className="inline-flex items-center gap-1">
            <input
              type="radio"
              name="job-status"
              checked={!draft}
              onChange={() => setDraft(false)}
            />
            Inactive
          </label>
        </div>
      )}
      onCancelDraft={() => setDraft(state.isOpen)}
      onSave={async () => {
        const res = await updateJobOverview({
          jobRfId,
          jobCuid,
          patch: { isOpen: draft },
        });
        if (!res.ok) return res;
        setState((s) => ({ ...s, isOpen: draft }));
        return { ok: true };
      }}
    />
  );
}

function EmploymentTypeRow({
  jobRfId,
  jobCuid,
  state,
  setState,
}: {
  jobRfId: number | null;
  jobCuid: string | null;
  state: JobOverviewInitial;
  setState: React.Dispatch<React.SetStateAction<JobOverviewInitial>>;
}) {
  const [draft, setDraft] = useState(state.employmentType ?? "");
  return (
    <EditRow
      icon={<Briefcase className="h-3 w-3" />}
      label="Employment Type"
      display={<span>{state.employmentType || "—"}</span>}
      form={() => (
        <LabeledField
          label="Employment type"
          value={draft}
          onChange={setDraft}
          placeholder="Full-time"
        />
      )}
      onCancelDraft={() => setDraft(state.employmentType ?? "")}
      onSave={async () => {
        const next = draft.trim();
        const res = await updateJobOverview({
          jobRfId,
          jobCuid,
          patch: { employmentType: next || null },
        });
        if (!res.ok) return res;
        setState((s) => ({ ...s, employmentType: next || null }));
        return { ok: true };
      }}
    />
  );
}

// Tolerates "$120,000" / "120k" / "120000" / "" forms. Returns null
// for empty input, "invalid" sentinel for unparseable, number otherwise.
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
