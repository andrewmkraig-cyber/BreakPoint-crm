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

// Sidebar card for /jobs/[id]. Single Edit toggle at the top: when
// not editing every row renders read-only; when editing every row
// renders its input simultaneously and a single Save commits all
// changes in one server-action call. Reads stay in sync via
// router.refresh() so the AiWorkspace context, find-matches scoring,
// and any other Job-row consumer see the new values immediately.

export type JobOverviewInitial = {
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
  const router = useRouter();
  const [state, setState] = useState<JobOverviewInitial>(initial);
  const [editing, setEditing] = useState(false);
  const [pending, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Drafts mirror state when edit mode opens. Stored as strings for
  // text inputs so the recruiter can type freely (number coercion
  // happens at save time); booleans / arrays stay native.
  const [draftLo, setDraftLo] = useState("");
  const [draftHi, setDraftHi] = useState("");
  const [draftCcy, setDraftCcy] = useState("");
  const [draftLocations, setDraftLocations] = useState("");
  const [draftOpenings, setDraftOpenings] = useState("");
  const [draftIsOpen, setDraftIsOpen] = useState(true);
  const [draftEmpType, setDraftEmpType] = useState("");

  function startEditing() {
    setError(null);
    setDraftLo(state.salaryRangeStart != null ? String(state.salaryRangeStart) : "");
    setDraftHi(state.salaryRangeEnd != null ? String(state.salaryRangeEnd) : "");
    setDraftCcy(state.salaryCurrency ?? "USD");
    setDraftLocations(state.locations.join(", "));
    setDraftOpenings(state.numberOfOpenings != null ? String(state.numberOfOpenings) : "");
    setDraftIsOpen(state.isOpen);
    setDraftEmpType(state.employmentType ?? "");
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  function commit() {
    setError(null);

    // Validate + coerce in one pass; bail with the first failure so
    // the recruiter sees a single clear error instead of a wall.
    const lo = parseMoney(draftLo);
    if (lo === "invalid") {
      setError("Salary low must be a number.");
      return;
    }
    const hi = parseMoney(draftHi);
    if (hi === "invalid") {
      setError("Salary high must be a number.");
      return;
    }
    let openings: number | null;
    const trimmedOpenings = draftOpenings.trim();
    if (!trimmedOpenings) {
      openings = null;
    } else {
      const n = Number(trimmedOpenings);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        setError("Openings must be a whole number.");
        return;
      }
      openings = n;
    }
    const nextLocations = draftLocations
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const empType = draftEmpType.trim();
    const ccy = draftCcy.trim() || null;

    const patch: JobOverviewPatch = {
      salaryRangeStart: lo,
      salaryRangeEnd: hi,
      salaryCurrency: ccy,
      locations: nextLocations,
      numberOfOpenings: openings,
      isOpen: draftIsOpen,
      employmentType: empType || null,
    };

    startSave(async () => {
      const res = await updateJobOverview({ jobRfId, jobCuid, patch });
      if (!res.ok) {
        setError(res.error);
        toast.error("Couldn't save overview", { description: res.error });
        return;
      }
      setState((s) => ({
        ...s,
        salaryRangeStart: lo,
        salaryRangeEnd: hi,
        salaryCurrency: ccy,
        locations: nextLocations,
        numberOfOpenings: openings,
        isOpen: draftIsOpen,
        employmentType: empType || null,
      }));
      setEditing(false);
      toast.success("Overview saved");
      router.refresh();
    });
  }

  return (
    <aside className="rounded-xl border border-court-border bg-court-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-court-border px-4 py-3">
        <h2 className="font-serif text-base font-semibold text-court-fg">Overview</h2>
        {!editing ? (
          <button
            type="button"
            onClick={startEditing}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
        )}
      </div>
      <dl className="divide-y divide-court-border">
        <Row icon={<DollarSign className="h-3 w-3" />} label="Compensation">
          {editing ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <LabeledField label="Low" value={draftLo} onChange={setDraftLo} placeholder="80000" />
              <LabeledField label="High" value={draftHi} onChange={setDraftHi} placeholder="120000" />
              <div className="sm:col-span-2">
                <LabeledField label="Currency" value={draftCcy} onChange={setDraftCcy} placeholder="USD" />
              </div>
            </div>
          ) : (
            <span>{formatComp(state)}</span>
          )}
        </Row>
        <Row icon={<MapPin className="h-3 w-3" />} label="Location">
          {editing ? (
            <LabeledField
              label="Locations (comma-separated)"
              value={draftLocations}
              onChange={setDraftLocations}
              placeholder="Cleveland, OH"
            />
          ) : (
            <span>{state.locations.length > 0 ? state.locations.join(", ") : "—"}</span>
          )}
        </Row>
        <Row icon={<Users className="h-3 w-3" />} label="Openings">
          {editing ? (
            <LabeledField
              label="Number of openings"
              value={draftOpenings}
              onChange={setDraftOpenings}
              placeholder="1"
            />
          ) : (
            <span>{state.numberOfOpenings != null ? String(state.numberOfOpenings) : "—"}</span>
          )}
        </Row>
        <Row
          icon={state.isOpen ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
          label="Status"
        >
          {editing ? (
            <div className="flex items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  name="job-status"
                  checked={draftIsOpen}
                  onChange={() => setDraftIsOpen(true)}
                />
                Active
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  name="job-status"
                  checked={!draftIsOpen}
                  onChange={() => setDraftIsOpen(false)}
                />
                Inactive
              </label>
            </div>
          ) : (
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
          )}
        </Row>
        <Row icon={<Briefcase className="h-3 w-3" />} label="Employment Type">
          {editing ? (
            <LabeledField
              label="Employment type"
              value={draftEmpType}
              onChange={setDraftEmpType}
              placeholder="Full-time"
            />
          ) : (
            <span>{state.employmentType || "—"}</span>
          )}
        </Row>
        <Row icon={<Users className="h-3 w-3" />} label="Billing Contact">
          <span>{state.billingContact || "—"}</span>
        </Row>
        <Row label="Last Edited">
          <span>{formatDate(state.lastEditedAt)}</span>
        </Row>
      </dl>
      {error && editing && (
        <div className="border-t border-court-border bg-red-50 px-4 py-2 text-[11px] text-red-800">
          {error}
        </div>
      )}
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

function Row({
  icon,
  label,
  children,
}: {
  icon?: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <dt className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-sm text-court-fg">{children}</dd>
    </div>
  );
}

// --- Helpers ---

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
