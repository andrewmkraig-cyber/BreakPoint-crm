"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Eye,
  Loader2,
  Minus,
  RotateCcw,
  Search,
  Target,
  X,
  XCircle,
} from "lucide-react";
import { toggleCandidateKept } from "@/app/candidates/[id]/keep-actions";
import { saveJobSearchFilters } from "@/app/jobs/[id]/save-search-actions";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Per-job sourcing surface. Structurally a clone of /candidates' rail +
// results table + split-view from src/app/candidates/page.tsx, scoped
// here to a single job. The only material differences:
//   - Footer drops the Save / Saved Lists block — sourcing for a single
//     job doesn't need a separate persistence flow.
//   - The split-view nav bar gains Apply-to-Job and Reject actions that
//     POST to /api/placements and pop the candidate from the local
//     rows[]/total state so the list shrinks without a refetch.
//
// Implementation duplicates the helpers (TagInput, SelectField, hash
// avatar palette, etc.) verbatim. They could live in a shared module —
// noted as a future refactor — but the matches surface diverging on
// behavior (action bar, scope) made copy-paste the lower-risk move
// for this pass.

const DISTANCE_OPTIONS = [10, 25, 50, 100];
const TENURE_OPTIONS = [
  { value: "any", label: "Any tenure" },
  { value: "lt1", label: "0–1 years" },
  { value: "1to3", label: "1–3 years" },
  { value: "3to5", label: "3–5 years" },
  { value: "gt5", label: "5+ years" },
];
const WORK_AUTH_OPTIONS = [
  { value: "all", label: "All" },
  { value: "us-citizen", label: "U.S. Citizen" },
  { value: "green-card", label: "Green Card" },
  { value: "h1b", label: "H1-B" },
  { value: "other", label: "Other" },
];
const DATE_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "30d", label: "Past 30 days" },
  { value: "90d", label: "Past 90 days" },
  { value: "1y", label: "Past year" },
];

const DEBOUNCE_MS = 300;

const AVATAR_PALETTE = [
  "#7B6CC4",
  "#C46C8E",
  "#3F7C9A",
  "#5A9642",
  "#9A7B3F",
  "#6F8E55",
];

type Row = {
  id: string;
  name: string;
  title: string;
  employer: string;
  location: string;
  salary: string;
  lastApply: string;
  // Raw ISO timestamp riding alongside the formatted relative string so
  // client-side column sort can order by date without re-parsing the
  // display string. Optional because legacy responses may omit it.
  lastApplyAt?: string;
  lastAction: string;
  lastActionAt?: string;
};

type SortColumn = "lastApply" | "lastAction";
type SortDirection = "asc" | "desc";
type SortState = { column: SortColumn; direction: SortDirection } | null;

type ResultsView = "all" | "rejected";

// Mirror of the page.tsx Pill type. Each chip on Skills / Job titles /
// Employer carries its own include / exclude flag; the server splits
// the lists into OR-includes and AND-NOT-excludes per field.
type Pill = { value: string; exclude: boolean };

type Filters = {
  q: string;
  skills: Pill[];
  jobTitles: Pill[];
  minComp: string;
  maxComp: string;
  locations: string[];
  distance: string;
  // Multiple employer pills with per-pill include/exclude. employerScope
  // applies uniformly to every pill.
  employers: Pill[];
  // "current" (default) restricts the employer filter to the candidate's
  // currentOrganization column. "any" widens to anywhere in the
  // experience JSON so former employees match. Matches the param the
  // /api/candidates/search route already understands.
  employerScope: string;
  tenure: string;
  workAuth: string;
  lastApply: string;
  lastAction: string;
};

const INITIAL_FILTERS: Filters = {
  q: "",
  skills: [],
  jobTitles: [],
  minComp: "",
  maxComp: "",
  locations: [],
  distance: "25",
  employers: [],
  employerScope: "current",
  tenure: "any",
  workAuth: "all",
  lastApply: "any",
  lastAction: "any",
};

function partitionPills(pills: Pill[]): { include: string[]; exclude: string[] } {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const p of pills) (p.exclude ? exclude : include).push(p.value);
  return { include, exclude };
}

// Coerce one of {Pill[], string[], string, undefined} into Pill[].
// Used by coerceFilters below to migrate pre-pill snapshots stored on
// Job.savedSearchFilters before the include/exclude split.
function coercePills(value: unknown): Pill[] {
  if (Array.isArray(value)) {
    const out: Pill[] = [];
    for (const x of value) {
      if (typeof x === "string" && x.trim()) {
        out.push({ value: x, exclude: false });
      } else if (
        x &&
        typeof x === "object" &&
        typeof (x as { value?: unknown }).value === "string"
      ) {
        out.push({
          value: (x as { value: string }).value,
          exclude: Boolean((x as { exclude?: unknown }).exclude),
        });
      }
    }
    return out;
  }
  if (typeof value === "string" && value.trim()) {
    return [{ value: value.trim(), exclude: false }];
  }
  return [];
}

function buildQuery(
  f: Filters,
  jobCuid: string | undefined,
  view: ResultsView,
): string {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set("q", f.q.trim());
  // Include and exclude lists ride on separate params so the server
  // never needs an in-band sigil to tell them apart.
  const skills = partitionPills(f.skills);
  if (skills.include.length > 0) sp.set("skills", skills.include.join(","));
  if (skills.exclude.length > 0)
    sp.set("excludeSkills", skills.exclude.join(","));
  const titles = partitionPills(f.jobTitles);
  if (titles.include.length > 0) sp.set("jobTitles", titles.include.join(","));
  if (titles.exclude.length > 0)
    sp.set("excludeJobTitles", titles.exclude.join(","));
  if (f.minComp.trim()) sp.set("minComp", f.minComp.trim());
  if (f.maxComp.trim()) sp.set("maxComp", f.maxComp.trim());
  if (f.locations.length > 0) sp.set("locations", f.locations.join("|"));
  if (f.distance) sp.set("distance", f.distance);
  // Employers pipe-delimited — company names ("Microsoft, Inc.") may
  // embed commas. Scope only emitted when at least one employer pill
  // is set and the scope is non-default.
  const emps = partitionPills(f.employers);
  if (emps.include.length > 0) sp.set("employers", emps.include.join("|"));
  if (emps.exclude.length > 0)
    sp.set("excludeEmployers", emps.exclude.join("|"));
  if (f.employers.length > 0 && f.employerScope === "any") {
    sp.set("employerScope", "any");
  }
  if (f.tenure && f.tenure !== "any") sp.set("tenure", f.tenure);
  if (f.workAuth && f.workAuth !== "all") sp.set("workAuth", f.workAuth);
  // Scope the search to this job. In "all" view, jobId lets the API
  // exclude candidates already rejected for this job (they live in the
  // Rejected tab). In "rejected" view, the inverse param asks the API
  // for the rejected bucket and bypasses the regular filter pipeline's
  // hide-rejected branch.
  if (jobCuid) {
    if (view === "rejected") sp.set("rejectedForJobId", jobCuid);
    else sp.set("jobId", jobCuid);
  }
  return sp.toString();
}

const inputCls =
  "block h-8 w-full rounded-md border border-court-border bg-white px-2.5 text-xs text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:outline-none focus:ring-2 focus:ring-court-accent/20";

const selectBareCls =
  "block h-8 w-full appearance-none truncate rounded-md border border-court-border bg-white pl-2.5 pr-7 text-xs text-court-fg focus:border-court-accent focus:outline-none focus:ring-2 focus:ring-court-accent/20";

function SelectField({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    // w-full + min-w-0 on the wrapper so the select never overflows
    // its grid column (Location / Employer rows pair this with a
    // fixed-width sibling and rely on the second column staying
    // exactly that width).
    <div className="relative w-full min-w-0">
      <select className={`${selectBareCls}${className ? ` ${className}` : ""}`} {...rest}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-court-fg-muted"
        strokeWidth={2}
      />
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-0.5 block text-[10.5px] font-semibold tracking-normal text-court-fg-muted">
      {children}
    </label>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 text-xs font-semibold tracking-normal text-court-fg">
      {children}
    </div>
  );
}

// Mirror of TagInput in src/app/candidates/page.tsx. Values are always
// Pill[]; when onToggleExclude is supplied each pill renders an
// include/exclude toggle (green check / red minus) at its head. The
// background tint follows the pill mode — green for include, red for
// exclude — so the rail reads as "filter to this AND not that".
function TagInput({
  values,
  buffer,
  onBufferChange,
  onCommit,
  onRemove,
  onToggleExclude,
  placeholder,
  ariaLabel,
  enterOnly = false,
}: {
  values: Pill[];
  buffer: string;
  onBufferChange: (v: string) => void;
  onCommit: (v: string) => void;
  onRemove: (v: string) => void;
  onToggleExclude?: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  enterOnly?: boolean;
}) {
  function commit() {
    const v = buffer.trim().replace(/,$/, "").trim();
    if (!v) {
      if (buffer !== "") onBufferChange("");
      return;
    }
    onCommit(v);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || (!enterOnly && e.key === ",")) {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === "Backspace" && buffer === "" && values.length > 0) {
      e.preventDefault();
      onRemove(values[values.length - 1].value);
    }
  }

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-court-border bg-white px-1.5 py-0.5 focus-within:border-court-accent focus-within:ring-2 focus-within:ring-court-accent/20">
      {values.map((p) => {
        const tintCls = p.exclude
          ? "bg-red-100 text-red-700"
          : "bg-court-accent-tint text-court-accent-dark";
        const subCls = p.exclude
          ? "text-red-600/80 hover:text-red-700"
          : "text-court-accent-dark/70 hover:text-court-accent-dark";
        return (
          <span
            key={p.value}
            className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium ${tintCls}`}
          >
            {onToggleExclude ? (
              <button
                type="button"
                onClick={() => onToggleExclude(p.value)}
                aria-label={p.exclude ? `Include ${p.value}` : `Exclude ${p.value}`}
                title={p.exclude ? "Click to include" : "Click to exclude"}
                className={`rounded-sm transition ${subCls}`}
              >
                {p.exclude ? (
                  <Minus className="h-2.5 w-2.5" strokeWidth={3} />
                ) : (
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                )}
              </button>
            ) : null}
            {p.value}
            <button
              type="button"
              onClick={() => onRemove(p.value)}
              aria-label={`Remove ${p.value}`}
              className={`rounded-sm transition ${subCls}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        );
      })}
      <input
        type="text"
        value={buffer}
        onChange={(e) => onBufferChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={values.length === 0 ? placeholder : ""}
        aria-label={ariaLabel}
        className="min-w-[60px] flex-1 bg-transparent px-1 py-0.5 text-xs text-court-fg placeholder:text-court-fg-muted focus:outline-none"
      />
    </div>
  );
}

function SortHeader({
  label,
  align = "left",
}: {
  label: string;
  align?: "left" | "center" | "right";
}) {
  const justify =
    align === "right"
      ? "justify-end"
      : align === "center"
        ? "justify-center"
        : "justify-start";
  return (
    <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
      <span className={`inline-flex items-center gap-1 ${justify}`}>
        {label}
      </span>
    </th>
  );
}

// Sortable variant. Click cycles the column between descending (default
// when activating) and ascending. Active column shows a directional
// arrow; inactive shows the dimmed up/down stack.
function SortableHeader({
  label,
  column,
  sort,
  onToggle,
}: {
  label: string;
  column: SortColumn;
  sort: SortState;
  onToggle: (column: SortColumn) => void;
}) {
  const active = sort?.column === column;
  return (
    <th
      className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted"
      aria-sort={
        active ? (sort?.direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onToggle(column)}
        className={
          "inline-flex items-center gap-1 transition " +
          (active
            ? "text-court-accent-dark"
            : "text-court-fg-muted hover:text-court-fg")
        }
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active ? (
          sort?.direction === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-60" />
        )}
      </button>
    </th>
  );
}

function hasAnyFilter(f: Filters): boolean {
  return (
    f.q.trim() !== "" ||
    f.skills.length > 0 ||
    f.jobTitles.length > 0 ||
    f.minComp.trim() !== "" ||
    f.maxComp.trim() !== "" ||
    f.locations.length > 0 ||
    f.employers.length > 0 ||
    (f.tenure !== "" && f.tenure !== "any") ||
    (f.workAuth !== "" && f.workAuth !== "all") ||
    (f.lastApply !== "" && f.lastApply !== "any") ||
    (f.lastAction !== "" && f.lastAction !== "any")
  );
}

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function activityBucket(s: string): "recent" | "earlier" | "older" {
  if (!s) return "older";
  const low = s.toLowerCase();
  if (low.includes("just now") || low.includes("min") || low.includes("hour")) return "recent";
  const dayM = low.match(/(\d+)\s*day/);
  if (dayM) {
    const d = parseInt(dayM[1], 10);
    if (d <= 3) return "recent";
    if (d <= 7) return "earlier";
    return "older";
  }
  return "older";
}

function joinDot(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(" · ");
}

// Defensive coerce of a persisted Filters blob (read from
// Job.savedSearchFilters as `unknown`). Each field is validated against
// the current schema and falls through to INITIAL_FILTERS when stale or
// malformed — so a snapshot saved before we added employerScope (or
// the pill include/exclude split) keeps loading cleanly. coercePills
// upgrades the legacy `skills: string[]` / `jobTitles: string[]` /
// `employer: string` shapes into Pill[] (everything reads as include).
function asStringArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}
function coerceFilters(value: unknown): Filters {
  if (!value || typeof value !== "object") return INITIAL_FILTERS;
  const v = value as Record<string, unknown>;
  return {
    q: typeof v.q === "string" ? v.q : INITIAL_FILTERS.q,
    skills: coercePills(v.skills),
    jobTitles: coercePills(v.jobTitles),
    minComp: typeof v.minComp === "string" ? v.minComp : INITIAL_FILTERS.minComp,
    maxComp: typeof v.maxComp === "string" ? v.maxComp : INITIAL_FILTERS.maxComp,
    locations: asStringArr(v.locations),
    distance:
      typeof v.distance === "string" ? v.distance : INITIAL_FILTERS.distance,
    // Prefer the new `employers` array; fall back to the legacy
    // `employer` singleton so a pre-migration save keeps applying.
    employers:
      v.employers !== undefined ? coercePills(v.employers) : coercePills(v.employer),
    employerScope:
      typeof v.employerScope === "string"
        ? v.employerScope
        : INITIAL_FILTERS.employerScope,
    tenure: typeof v.tenure === "string" ? v.tenure : INITIAL_FILTERS.tenure,
    workAuth:
      typeof v.workAuth === "string" ? v.workAuth : INITIAL_FILTERS.workAuth,
    lastApply:
      typeof v.lastApply === "string" ? v.lastApply : INITIAL_FILTERS.lastApply,
    lastAction:
      typeof v.lastAction === "string"
        ? v.lastAction
        : INITIAL_FILTERS.lastAction,
  };
}

export function MatchesTab({
  jobCuid,
  jobRfId,
  jobTitle,
  savedFilters,
}: {
  jobCuid: string;
  // jobRfId stays in the prop contract for callers that pass it in — the
  // /api/placements route resolves the RF mirrors server-side from
  // jobCuid, so we don't need it here. Marked as accepted-but-unused.
  jobRfId: number | null;
  jobTitle: string;
  // Persisted filter snapshot from Job.savedSearchFilters (one per job).
  // Coerced through coerceFilters so a stale shape can't crash the tab.
  savedFilters: unknown;
}) {
  void jobRfId;

  // Initial state comes from the persisted job snapshot when present;
  // otherwise the standard empty INITIAL_FILTERS. useState's lazy
  // initializer keeps the coerce off the hot path.
  const [filters, setFilters] = useState<Filters>(() =>
    coerceFilters(savedFilters),
  );
  const [skillsBuffer, setSkillsBuffer] = useState("");
  const [jobTitlesBuffer, setJobTitlesBuffer] = useState("");
  const [locationsBuffer, setLocationsBuffer] = useState("");
  const [employersBuffer, setEmployersBuffer] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"all" | "submitted" | "hot">("all");
  // Per-candidate disable while Apply / Reject is in flight so the
  // recruiter can't double-click and create a 409 (apply) or a no-op
  // double-update (reject).
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [keepInFlight, setKeepInFlight] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saveInFlight, setSaveInFlight] = useState(false);
  // Outer tab. "all" runs the filter pipeline; "rejected" pulls the
  // rejected bucket for this job and ignores the filter rail's
  // empty-state gate so the bucket shows even when no filters are set.
  const [view, setView] = useState<ResultsView>("all");
  // Column sort. Only Last Apply / Last Action are sortable per the
  // matches-cleanup pass; null means insertion order (server default,
  // updatedAt desc).
  const [sort, setSort] = useState<SortState>(null);
  // Bulk action concurrency. Disables the bar while a multi-row apply
  // / keep is in flight to keep a double-click from firing N+M requests.
  const [bulkInFlight, setBulkInFlight] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasFilters = hasAnyFilter(filters);
  // Pill collapses to `value:0|1` so an exclude-toggle without an add or
  // remove still bumps the key and retriggers the debounced fetch.
  const pillKey = (pills: Pill[]) =>
    pills.map((p) => `${p.value}:${p.exclude ? 1 : 0}`).join("|");
  const skillsKey = pillKey(filters.skills);
  const jobTitlesKey = pillKey(filters.jobTitles);
  const employersKey = pillKey(filters.employers);
  const locationsKey = filters.locations.join("|");

  function setField<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  type PillKey = "skills" | "jobTitles" | "employers";
  function addPill(key: PillKey, value: string) {
    setFilters((prev) => {
      const existing = prev[key];
      if (existing.some((p) => p.value === value)) return prev;
      return { ...prev, [key]: [...existing, { value, exclude: false }] };
    });
    if (key === "skills") setSkillsBuffer("");
    else if (key === "jobTitles") setJobTitlesBuffer("");
    else setEmployersBuffer("");
  }

  function removePill(key: PillKey, value: string) {
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].filter((p) => p.value !== value),
    }));
  }

  function togglePill(key: PillKey, value: string) {
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].map((p) =>
        p.value === value ? { ...p, exclude: !p.exclude } : p,
      ),
    }));
  }

  function addLocation(value: string) {
    setFilters((prev) => {
      if (prev.locations.includes(value)) return prev;
      return { ...prev, locations: [...prev.locations, value] };
    });
    setLocationsBuffer("");
  }
  function removeLocation(value: string) {
    setFilters((prev) => ({
      ...prev,
      locations: prev.locations.filter((v) => v !== value),
    }));
  }

  function resetFilters() {
    setFilters(INITIAL_FILTERS);
    setSkillsBuffer("");
    setJobTitlesBuffer("");
    setLocationsBuffer("");
    setEmployersBuffer("");
  }

  async function runFetch(f: Filters, currentView: ResultsView) {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const qs = buildQuery(f, jobCuid, currentView);
      const url = qs
        ? `/api/candidates/search?${qs}`
        : "/api/candidates/search";
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { candidates: Row[]; total: number };
      setRows(data.candidates ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setTotal(0);
    } finally {
      if (abortRef.current === ctrl) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Rejected tab bypasses the filter-rail empty-state gate — the
    // recruiter wants to see the bucket regardless of filter state.
    if (view === "all" && !hasFilters) {
      if (abortRef.current) abortRef.current.abort();
      setRows([]);
      setTotal(null);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runFetch(filters, view);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    view,
    hasFilters,
    filters.q,
    skillsKey,
    jobTitlesKey,
    filters.minComp,
    filters.maxComp,
    locationsKey,
    filters.distance,
    employersKey,
    filters.employerScope,
    filters.tenure,
    filters.workAuth,
    filters.lastApply,
    filters.lastAction,
  ]);

  // Switching tabs drops any per-row selection and dismisses the split
  // view so the active candidate doesn't reference a row from the
  // previous bucket.
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectedId(null);
    setSort(null);
  }, [view]);

  // Apply the column sort on top of whatever the server returned.
  // Falls back to ISO-string compare on the raw timestamp; rows
  // without a timestamp sink to the bottom so they don't reorder
  // unexpectedly.
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const key: "lastApplyAt" | "lastActionAt" =
      sort.column === "lastApply" ? "lastApplyAt" : "lastActionAt";
    const dir = sort.direction === "asc" ? 1 : -1;
    const withKey: Array<{ row: Row; t: string | null }> = rows.map((r) => ({
      row: r,
      t: r[key] ?? null,
    }));
    withKey.sort((a, b) => {
      if (a.t === b.t) return 0;
      if (a.t == null) return 1;
      if (b.t == null) return -1;
      return a.t < b.t ? -dir : dir;
    });
    return withKey.map((x) => x.row);
  }, [rows, sort]);

  function toggleSort(column: SortColumn) {
    setSort((prev) => {
      if (!prev || prev.column !== column) {
        return { column, direction: "desc" };
      }
      if (prev.direction === "desc") return { column, direction: "asc" };
      return null;
    });
  }

  // Persist the current filter snapshot to Job.savedSearchFilters via
  // the server action. One snapshot per job — overwrites whatever was
  // there. Disabled while a save is in flight to keep a slow Neon RTT
  // from double-firing.
  async function onSaveSearch() {
    if (!hasFilters || saveInFlight) return;
    setSaveInFlight(true);
    try {
      const res = await saveJobSearchFilters(jobCuid, filters);
      if (res.ok) {
        toast.success("Saved");
      } else {
        toast.error("Couldn't save search", { description: res.error });
      }
    } catch (e) {
      toast.error("Couldn't save search", {
        description: e instanceof Error ? e.message : "Network error.",
      });
    } finally {
      setSaveInFlight(false);
    }
  }

  const currentIndex = useMemo(
    () => (selectedId ? sortedRows.findIndex((r) => r.id === selectedId) : -1),
    [sortedRows, selectedId],
  );
  const canPrev = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < sortedRows.length - 1;

  function goPrev() {
    if (!canPrev) return;
    setSelectedId(sortedRows[currentIndex - 1].id);
  }
  function goNext() {
    if (!canNext) return;
    setSelectedId(sortedRows[currentIndex + 1].id);
  }

  // After Apply / Reject lands, drop the candidate from the local
  // rows[] so the list shrinks immediately. selectedId follows the
  // next row in line; when the popped row was the last, the split
  // view closes back to the table view.
  function removeRowAndAdvance(id: string) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === id);
      if (idx === -1) return prev;
      const next = prev.slice(0, idx).concat(prev.slice(idx + 1));
      if (selectedId === id) {
        if (next.length === 0) {
          setSelectedId(null);
        } else if (idx >= next.length) {
          setSelectedId(next[next.length - 1].id);
        } else {
          setSelectedId(next[idx].id);
        }
      }
      return next;
    });
    setTotal((prev) => (prev == null ? prev : Math.max(0, prev - 1)));
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (prev.size === rows.length && rows.length > 0) return new Set();
      return new Set(rows.map((r) => r.id));
    });
  }

  async function onKeep(candidateId: string, candidateName: string) {
    if (keepInFlight === candidateId) return;
    setKeepInFlight(candidateId);
    try {
      const res = await toggleCandidateKept({ candidateId });
      if (!res.ok) {
        toast.error("Couldn't update Keep", { description: res.error });
        return;
      }
      toast.success(
        res.value.isKept ? `Kept ${candidateName}` : `Removed ${candidateName} from Kept`,
      );
    } catch (e) {
      toast.error("Couldn't update Keep", {
        description: e instanceof Error ? e.message : "Network error.",
      });
    } finally {
      setKeepInFlight((prev) => (prev === candidateId ? null : prev));
    }
  }

  // Reapply path. DELETE /api/placements drops the rejected Placement
  // row entirely so the candidate falls back to having no stage on
  // this job — they reappear in the All-tab matches search next time
  // the recruiter looks. Clean-slate semantics, not a stage bump.
  async function reapplyCandidate(candidateId: string, _candidateName: string) {
    void _candidateName;
    if (actionInFlight === candidateId) return;
    setActionInFlight(candidateId);
    try {
      const res = await fetch("/api/placements", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, jobId: jobCuid }),
      });
      const data: unknown = await res.json().catch(() => null);
      const okFlag =
        data &&
        typeof data === "object" &&
        "ok" in data &&
        (data as { ok: unknown }).ok !== false;
      if (!res.ok || !okFlag) {
        const errMsg =
          data &&
          typeof data === "object" &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : `Request failed (${res.status})`;
        toast.error("Couldn't reapply", { description: errMsg });
        return;
      }
      removeRowAndAdvance(candidateId);
      toast.success("Candidate restored to search");
    } catch (e) {
      toast.error("Couldn't reapply", {
        description: e instanceof Error ? e.message : "Network error.",
      });
    } finally {
      setActionInFlight((prev) => (prev === candidateId ? null : prev));
    }
  }

  // Bulk apply — fire POST /api/placements stage=APPLIED for every
  // selected row in parallel. Each settled response decides whether
  // its row drops out of the local list. Disabled while in flight to
  // keep a double-click from firing N requests twice.
  async function bulkApply() {
    if (bulkInFlight || selectedIds.size === 0) return;
    setBulkInFlight(true);
    const ids = Array.from(selectedIds);
    const targets = ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is Row => !!r);
    try {
      const results = await Promise.allSettled(
        targets.map(async (r) => {
          const res = await fetch("/api/placements", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ candidateId: r.id, jobId: jobCuid, stage: "APPLIED" }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return r.id;
        }),
      );
      let success = 0;
      let failed = 0;
      const successIds: string[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled") {
          success++;
          successIds.push(r.value);
        } else {
          failed++;
        }
      }
      if (successIds.length > 0) {
        const removeSet = new Set(successIds);
        setRows((prev) => prev.filter((r) => !removeSet.has(r.id)));
        setTotal((prev) => (prev == null ? prev : Math.max(0, prev - successIds.length)));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of successIds) next.delete(id);
          return next;
        });
        if (selectedId && removeSet.has(selectedId)) setSelectedId(null);
      }
      if (success > 0) {
        toast.success(
          success === 1
            ? `Applied 1 candidate to ${jobTitle}`
            : `Applied ${success} candidates to ${jobTitle}`,
        );
      }
      if (failed > 0) {
        toast.error(
          failed === 1
            ? "Couldn't apply 1 candidate"
            : `Couldn't apply ${failed} candidates`,
        );
      }
    } finally {
      setBulkInFlight(false);
    }
  }

  // Bulk reject — fire POST /api/placements stage=REJECTED for every
  // selected row in parallel. The API route upserts a Placement at
  // stage=rejected with source=recruiter_rejected (Ace-only, no RF
  // sync) so the candidate persists on the Rejected tab and is
  // filtered from future All-tab searches for this job. On success
  // each row drops out of the local list immediately.
  async function bulkReject() {
    if (bulkInFlight || selectedIds.size === 0) return;
    setBulkInFlight(true);
    const ids = Array.from(selectedIds);
    const targets = ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is Row => !!r);
    try {
      const results = await Promise.allSettled(
        targets.map(async (r) => {
          const res = await fetch("/api/placements", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ candidateId: r.id, jobId: jobCuid, stage: "REJECTED" }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return r.id;
        }),
      );
      let success = 0;
      let failed = 0;
      const successIds: string[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") {
          success++;
          successIds.push(r.value);
        } else {
          failed++;
        }
      }
      if (successIds.length > 0) {
        const removeSet = new Set(successIds);
        setRows((prev) => prev.filter((r) => !removeSet.has(r.id)));
        setTotal((prev) => (prev == null ? prev : Math.max(0, prev - successIds.length)));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of successIds) next.delete(id);
          return next;
        });
        if (selectedId && removeSet.has(selectedId)) setSelectedId(null);
      }
      if (success > 0) {
        toast.success(
          success === 1 ? "1 candidate rejected" : `${success} candidates rejected`,
        );
      }
      if (failed > 0) {
        toast.error(
          failed === 1
            ? "Couldn't reject 1 candidate"
            : `Couldn't reject ${failed} candidates`,
        );
      }
    } finally {
      setBulkInFlight(false);
    }
  }

  // Bulk keep — toggle the Keep flag for each selected candidate. Does
  // not remove them from the results list; Keep is an annotation, not
  // a triage state.
  async function bulkKeep() {
    if (bulkInFlight || selectedIds.size === 0) return;
    setBulkInFlight(true);
    const ids = Array.from(selectedIds);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => toggleCandidateKept({ candidateId: id })),
      );
      let success = 0;
      let failed = 0;
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.ok) success++;
        else failed++;
      }
      if (success > 0) {
        toast.success(success === 1 ? "Updated Keep" : `Updated Keep on ${success} candidates`);
      }
      if (failed > 0) {
        toast.error(
          failed === 1 ? "Couldn't update Keep on 1 candidate" : `Couldn't update Keep on ${failed} candidates`,
        );
      }
    } finally {
      setBulkInFlight(false);
    }
  }

  async function postPlacement(
    candidateId: string,
    candidateName: string,
    stage: "APPLIED" | "REJECTED",
  ) {
    if (actionInFlight === candidateId) return;
    setActionInFlight(candidateId);
    try {
      const res = await fetch("/api/placements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, jobId: jobCuid, stage }),
      });
      const data: unknown = await res.json().catch(() => null);
      const okFlag =
        data &&
        typeof data === "object" &&
        "ok" in data &&
        (data as { ok: unknown }).ok !== false;
      if (!res.ok || !okFlag) {
        const errMsg =
          data &&
          typeof data === "object" &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : `Request failed (${res.status})`;
        toast.error(stage === "APPLIED" ? "Couldn't apply" : "Couldn't reject", {
          description: errMsg,
        });
        return;
      }
      removeRowAndAdvance(candidateId);
      toast.success(
        stage === "APPLIED"
          ? `Applied ${candidateName} to ${jobTitle}`
          : `Rejected ${candidateName} for ${jobTitle}`,
      );
    } catch (e) {
      toast.error(stage === "APPLIED" ? "Couldn't apply" : "Couldn't reject", {
        description: e instanceof Error ? e.message : "Network error.",
      });
    } finally {
      setActionInFlight((prev) => (prev === candidateId ? null : prev));
    }
  }

  const sidebarRows = useMemo(() => {
    const q = sidebarFilter.trim().toLowerCase();
    if (!q) return sortedRows;
    return sortedRows.filter((r) => {
      return (
        r.name.toLowerCase().includes(q) ||
        (r.title || "").toLowerCase().includes(q) ||
        (r.employer || "").toLowerCase().includes(q)
      );
    });
  }, [sortedRows, sidebarFilter]);

  const groupedSidebar = useMemo(() => {
    const out: { recent: Row[]; earlier: Row[]; older: Row[] } = {
      recent: [],
      earlier: [],
      older: [],
    };
    for (const r of sidebarRows) out[activityBucket(r.lastAction || "")].push(r);
    return out;
  }, [sidebarRows]);

  const nameRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  useEffect(() => {
    if (!selectedId) return;
    const el = nameRefs.current.get(selectedId);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const selectedRow = useMemo(
    () => (selectedId ? rows.find((r) => r.id === selectedId) ?? null : null),
    [rows, selectedId],
  );
  const inFlightForSelected =
    selectedId !== null && actionInFlight === selectedId;
  const keepInFlightForSelected =
    selectedId !== null && keepInFlight === selectedId;

  return (
    // min-h-[640px] floors the surface at a usable height even when the
    // viewport is short — the iframe needs room to read. The negative
    // ml-* on the outer wrapper isn't used here because the parent
    // already controls the column geometry; matches tab fits inside its
    // col-span-7 region.
    <div className="flex min-h-[640px] overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm">
      <aside
        className={
          "flex shrink-0 flex-col overflow-hidden border-r border-court-border bg-court-surface transition-[width,border] duration-200 " +
          // min-w-[240px] belt-and-suspenders against any future flex
          // pressure from the right pane — the outer container has
          // overflow-hidden for the rounded corners, so without an
          // explicit floor a shrunk aside would silently clip its
          // dropdowns. Collapsed (split-view) state stays at w-0.
          (selectedId ? "w-0 border-r-0" : "w-[240px] min-w-[240px]")
        }
      >
        <div className="flex items-center justify-between border-b border-court-border/60 px-3 py-2">
          <h2 className="text-sm font-semibold text-court-fg">Find Candidates</h2>
          <button
            type="button"
            onClick={resetFilters}
            disabled={!hasFilters}
            className="text-xs text-court-fg-muted transition hover:text-court-fg hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
          >
            Reset
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <section className="border-b border-court-border/60 px-3 py-1.5">
            <SectionTitle>Identity</SectionTitle>
            <div className="space-y-1.5">
              <div>
                <FieldLabel>Keyword / Boolean</FieldLabel>
                <input
                  type="text"
                  value={filters.q}
                  onChange={(e) => setField("q", e.target.value)}
                  placeholder=""
                  className={inputCls}
                />
              </div>
              <div>
                <FieldLabel>Skills</FieldLabel>
                <TagInput
                  values={filters.skills}
                  buffer={skillsBuffer}
                  onBufferChange={setSkillsBuffer}
                  onCommit={(v) => addPill("skills", v)}
                  onRemove={(v) => removePill("skills", v)}
                  onToggleExclude={(v) => togglePill("skills", v)}
                  placeholder=""
                  ariaLabel="Skills"
                />
              </div>
              <div>
                <FieldLabel>Job titles</FieldLabel>
                <TagInput
                  values={filters.jobTitles}
                  buffer={jobTitlesBuffer}
                  onBufferChange={setJobTitlesBuffer}
                  onCommit={(v) => addPill("jobTitles", v)}
                  onRemove={(v) => removePill("jobTitles", v)}
                  onToggleExclude={(v) => togglePill("jobTitles", v)}
                  placeholder=""
                  ariaLabel="Job titles"
                />
              </div>
            </div>
          </section>

          <section className="border-b border-court-border/60 px-3 py-1.5">
            <SectionTitle>Compensation</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={filters.minComp}
                onChange={(e) => setField("minComp", e.target.value)}
                placeholder="Min $"
                className={inputCls}
              />
              <input
                type="number"
                value={filters.maxComp}
                onChange={(e) => setField("maxComp", e.target.value)}
                placeholder="Max $"
                className={inputCls}
              />
            </div>
          </section>

          <section className="border-b border-court-border/60 px-3 py-1.5">
            <SectionTitle>Location</SectionTitle>
            <div className="grid w-full grid-cols-[1fr_84px] gap-2">
              <TagInput
                // Locations have no exclude semantics — lift the
                // string[] state into Pill[] at the boundary and
                // omit onToggleExclude so the toggle is hidden.
                values={filters.locations.map((v) => ({
                  value: v,
                  exclude: false,
                }))}
                buffer={locationsBuffer}
                onBufferChange={setLocationsBuffer}
                onCommit={addLocation}
                onRemove={removeLocation}
                placeholder=""
                ariaLabel="Locations"
                enterOnly
              />
              <SelectField
                className="truncate"
                value={filters.distance}
                onChange={(e) => setField("distance", e.target.value)}
                aria-label="Distance"
              >
                {DISTANCE_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} mi
                  </option>
                ))}
              </SelectField>
            </div>
          </section>

          <section className="border-b border-court-border/60 px-3 py-1.5">
            <SectionTitle>Employment</SectionTitle>
            <div className="space-y-1.5">
              <div>
                <FieldLabel>Employer</FieldLabel>
                {/* Paired pill input + scope select. Per-pill toggle
                    flips a company name between "must match" and "must
                    NOT match"; the scope dropdown applies uniformly to
                    every pill. enterOnly because company names embed
                    commas ("Microsoft, Inc."). Scope stacks below the
                    input on a separate row so the dropdown gets the
                    full sidebar width — "Current only" / "Current +
                    Past" were clipping when paired in a 130px column. */}
                <div className="w-full space-y-1.5">
                  <TagInput
                    values={filters.employers}
                    buffer={employersBuffer}
                    onBufferChange={setEmployersBuffer}
                    onCommit={(v) => addPill("employers", v)}
                    onRemove={(v) => removePill("employers", v)}
                    onToggleExclude={(v) => togglePill("employers", v)}
                    placeholder=""
                    ariaLabel="Employers"
                    enterOnly
                  />
                  <SelectField
                    className="truncate"
                    value={filters.employerScope}
                    onChange={(e) => setField("employerScope", e.target.value)}
                    aria-label="Employer scope"
                  >
                    <option value="current">Current only</option>
                    <option value="any">Current + Past</option>
                  </SelectField>
                </div>
              </div>
              <div>
                <FieldLabel>Tenure at employer</FieldLabel>
                <SelectField
                  value={filters.tenure}
                  onChange={(e) => setField("tenure", e.target.value)}
                  aria-label="Tenure at employer"
                >
                  {TENURE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </SelectField>
              </div>
              <div>
                <FieldLabel>Work authorization</FieldLabel>
                <SelectField
                  value={filters.workAuth}
                  onChange={(e) => setField("workAuth", e.target.value)}
                  aria-label="Work authorization"
                >
                  {WORK_AUTH_OPTIONS.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </SelectField>
              </div>
            </div>
          </section>

          <section className="px-3 py-1.5">
            <SectionTitle>Activity</SectionTitle>
            <div className="space-y-1.5">
              <div>
                <FieldLabel>Last apply</FieldLabel>
                <SelectField
                  value={filters.lastApply}
                  onChange={(e) => setField("lastApply", e.target.value)}
                  aria-label="Last apply"
                >
                  {DATE_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </SelectField>
              </div>
              <div>
                <FieldLabel>Last action</FieldLabel>
                <SelectField
                  value={filters.lastAction}
                  onChange={(e) => setField("lastAction", e.target.value)}
                  aria-label="Last action"
                >
                  {DATE_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </SelectField>
              </div>
            </div>
          </section>

          {/* Save Search persists the filter snapshot to the Job row so
              this Matches tab restores the same filters on next visit.
              Auto-search-on-type already fires the underlying fetch, so
              there's no separate "Run" affordance — the button is solely
              the persistence handle. */}
          <section className="px-3 pb-3 pt-1">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onSaveSearch}
              disabled={!hasFilters || saveInFlight}
              className="h-8 w-full rounded-full"
            >
              {saveInFlight ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Bookmark className="h-3.5 w-3.5" />
              )}
              Save search
            </Button>
          </section>
        </div>
      </aside>

      {selectedId ? (
        <>
          <section className="flex w-[260px] shrink-0 flex-col overflow-hidden border-r border-court-border bg-court-surface">
            <div className="border-b border-court-border/60 px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-court-fg">Search results</h3>
                <span className="rounded-full bg-court-accent-tint px-2 py-0.5 text-[11px] font-bold text-court-accent-dark">
                  {sidebarRows.length} candidate{sidebarRows.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-court-fg-muted"
                  strokeWidth={2}
                />
                <input
                  type="text"
                  value={sidebarFilter}
                  onChange={(e) => setSidebarFilter(e.target.value)}
                  placeholder="Filter list…"
                  aria-label="Filter list"
                  className="h-8 w-full rounded-lg border border-court-border bg-court-surface-subtle pl-8 pr-2 text-xs text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div className="flex border-b border-court-border/60 bg-white">
              {(
                [
                  { id: "all", label: "All", n: sidebarRows.length },
                  { id: "submitted", label: "Submitted", n: 0 },
                  { id: "hot", label: "Hot", n: 0 },
                ] as const
              ).map((t) => {
                const active = sidebarTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSidebarTab(t.id)}
                    className={
                      "flex-1 border-b-2 py-2.5 text-xs font-semibold transition " +
                      (active
                        ? "border-court-accent text-court-fg"
                        : "border-transparent text-court-fg-muted hover:text-court-fg")
                    }
                  >
                    {t.label}
                    <span className="ml-1 text-court-fg-muted/70">{t.n}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto">
              {(
                [
                  { key: "recent" as const, label: "Recent activity" },
                  { key: "earlier" as const, label: "Earlier this week" },
                  { key: "older" as const, label: "Older" },
                ]
              ).map((group) => {
                const list = groupedSidebar[group.key];
                if (list.length === 0) return null;
                return (
                  <div key={group.key}>
                    <div className="sticky top-0 z-10 border-b border-court-border/60 bg-court-surface-subtle px-3.5 pb-1.5 pt-2.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-court-fg-muted/80">
                      {group.label}
                    </div>
                    {list.map((c) => {
                      const active = c.id === selectedId;
                      const subtitle = joinDot([c.title, c.employer, c.location]);
                      return (
                        <button
                          key={c.id}
                          ref={(el) => {
                            nameRefs.current.set(c.id, el);
                          }}
                          type="button"
                          onClick={() => setSelectedId(c.id)}
                          className={
                            "grid w-full cursor-pointer grid-cols-[32px_1fr] items-center gap-2.5 border-b border-court-border/40 px-3.5 py-2.5 text-left transition " +
                            (active
                              ? "bg-court-fg text-white"
                              : "hover:bg-court-surface-subtle")
                          }
                        >
                          <span
                            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
                            style={{ backgroundColor: avatarColor(c.name) }}
                            aria-hidden="true"
                          >
                            {initials(c.name)}
                          </span>
                          <span className="min-w-0">
                            <span
                              className={
                                "block truncate text-[13.5px] font-semibold leading-tight " +
                                (active ? "text-white" : "text-court-fg")
                              }
                            >
                              {c.name}
                            </span>
                            {subtitle ? (
                              <span
                                className={
                                  "mt-0.5 block truncate text-[11.5px] leading-tight " +
                                  (active
                                    ? "text-white/65"
                                    : "text-court-fg-muted")
                                }
                              >
                                {subtitle}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {sidebarRows.length === 0 && (
                <div className="px-3.5 py-8 text-center text-xs text-court-fg-muted">
                  No matches in this list.
                </div>
              )}
            </div>
          </section>
          <section className="flex flex-1 flex-col bg-court-bg">
            {/* Split-view nav bar. Adds Apply-to-Job + Reject pills
                inline with prev/next; both POST /api/placements and
                pop the row from local state. overflow-x-auto lets the
                bar scroll on the rare cramped viewport. */}
            <div className="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-court-border bg-court-surface px-2">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                All
              </button>
              <span className="h-4 w-px bg-court-border" aria-hidden="true" />
              <button
                type="button"
                onClick={goPrev}
                disabled={!canPrev}
                aria-label="Previous candidate"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-court-fg-muted"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="whitespace-nowrap text-xs font-medium tabular-nums text-court-fg-muted">
                {currentIndex >= 0 ? currentIndex + 1 : "—"} of {rows.length}
              </span>
              <button
                type="button"
                onClick={goNext}
                disabled={!canNext}
                aria-label="Next candidate"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-court-fg-muted"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="mx-1 h-4 w-px bg-court-border" aria-hidden="true" />
              {view === "rejected" ? (
                // Rejected split-view: the only meaningful next step is
                // bringing this candidate back into All. Hide Apply /
                // Keep / Reject — they're either nonsensical here
                // (Reject would target an already-rejected row) or
                // duplicative of Reapply.
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={inFlightForSelected || !selectedRow}
                  onClick={() => {
                    if (!selectedRow) return;
                    void reapplyCandidate(selectedRow.id, selectedRow.name);
                  }}
                  className="h-7 rounded-md px-2.5 text-[11px]"
                >
                  {inFlightForSelected ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  Reapply
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={inFlightForSelected || !selectedRow}
                    onClick={() => {
                      if (!selectedRow) return;
                      void postPlacement(selectedRow.id, selectedRow.name, "APPLIED");
                    }}
                    className="h-7 rounded-md px-2.5 text-[11px]"
                  >
                    {inFlightForSelected ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Target className="h-3 w-3" />
                    )}
                    Apply to Job
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="keep"
                    disabled={keepInFlightForSelected || !selectedRow}
                    onClick={() => {
                      if (!selectedRow) return;
                      void onKeep(selectedRow.id, selectedRow.name);
                    }}
                    className="h-7 rounded-md px-2.5 text-[11px]"
                  >
                    {keepInFlightForSelected ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Bookmark className="h-3 w-3" />
                    )}
                    Keep
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="reject"
                    disabled={inFlightForSelected || !selectedRow}
                    onClick={() => {
                      if (!selectedRow) return;
                      void postPlacement(selectedRow.id, selectedRow.name, "REJECTED");
                    }}
                    className="h-7 rounded-md px-2.5 text-[11px]"
                  >
                    {inFlightForSelected ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <XCircle className="h-3 w-3" />
                    )}
                    Reject
                  </Button>
                </>
              )}
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label="Close profile"
                className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <iframe
              key={selectedId}
              src={`/candidates/${selectedId}?embed=true`}
              title="Candidate profile"
              className="w-full flex-1 border-0"
            />
          </section>
        </>
      ) : (
        <section className="flex flex-1 flex-col bg-court-bg">
          {/* Outer tabs: "All" runs the filter pipeline; "Rejected"
              pulls the rejected bucket for this job (no filter
              required). Rejected count surfaces here once a fetch
              lands so the recruiter can see triage volume at a glance. */}
          <div className="flex border-b border-court-border bg-court-surface">
            {(
              [
                { id: "all" as const, label: "All" },
                { id: "rejected" as const, label: "Rejected" },
              ]
            ).map((t) => {
              const active = view === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setView(t.id)}
                  className={
                    "border-b-2 px-4 py-2.5 text-xs font-semibold transition " +
                    (active
                      ? "border-court-accent text-court-fg"
                      : "border-transparent text-court-fg-muted hover:text-court-fg")
                  }
                  aria-current={active ? "page" : undefined}
                >
                  {t.label}
                  {active && total != null ? (
                    <span className="ml-1.5 text-court-fg-muted/70">{total}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-b border-court-border/60 bg-court-surface-subtle px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-2xl font-extrabold leading-none text-court-fg">
                {total ?? 0}
              </span>
              <span className="text-xs text-court-fg-muted">
                {view === "rejected"
                  ? (total ?? 0) === 1
                    ? "candidate rejected for this job"
                    : "candidates rejected for this job"
                  : !hasFilters
                    ? "No filters applied yet"
                    : (total ?? 0) === 0
                      ? "candidates match"
                      : `candidate${total === 1 ? "" : "s"} match · sorted by Recent activity`}
              </span>
            </div>
          </div>

          {view === "all" && !hasFilters ? (
            <div className="flex flex-1 items-center justify-center px-6 py-12">
              <div className="flex max-w-md flex-col items-center text-center">
                <div className="mb-4 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-court-accent-tint">
                  <Search className="h-6 w-6 text-court-accent-dark" strokeWidth={2} />
                </div>
                <h3 className="font-serif text-xl font-extrabold text-court-fg">
                  Source candidates for this job
                </h3>
                <p className="mt-1.5 text-sm text-court-fg-muted">
                  Use the rail on the left to filter the BreakPoint roster. Apply
                  to Job lands the candidate on this pipeline at the Applied
                  stage.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden">
              {selectedIds.size > 0 && (
                <div className="flex items-center justify-between gap-3 border-b border-court-border bg-court-accent-tint/40 px-4 py-2">
                  <span className="text-xs font-semibold text-court-fg">
                    {selectedIds.size} selected
                  </span>
                  <div className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => void bulkApply()}
                      disabled={bulkInFlight}
                      className="rounded-full"
                    >
                      {bulkInFlight ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Target className="h-3.5 w-3.5" />
                      )}
                      Apply to Job
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void bulkKeep()}
                      disabled={bulkInFlight}
                      className="rounded-full"
                    >
                      <Bookmark className="h-3.5 w-3.5" />
                      Keep
                    </Button>
                    <Button
                      type="button"
                      variant="reject"
                      size="sm"
                      onClick={() => void bulkReject()}
                      disabled={bulkInFlight}
                      className="rounded-full"
                    >
                      {bulkInFlight ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      Reject
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-court-border bg-court-surface-subtle">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={sortedRows.length > 0 && selectedIds.size === sortedRows.length}
                        ref={(el) => {
                          if (el) {
                            el.indeterminate =
                              selectedIds.size > 0 && selectedIds.size < sortedRows.length;
                          }
                        }}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 cursor-pointer accent-brand"
                      />
                    </th>
                    <SortHeader label="Candidate" />
                    <SortHeader label="Current Title" />
                    <SortHeader label="Employer" />
                    <SortHeader label="Location" />
                    <SortHeader label="Salary" align="right" />
                    <SortableHeader
                      label="Last Apply"
                      column="lastApply"
                      sort={sort}
                      onToggle={toggleSort}
                    />
                    <SortableHeader
                      label="Last Action"
                      column="lastAction"
                      sort={sort}
                      onToggle={toggleSort}
                    />
                    <SortHeader label="Score" align="center" />
                    <th className="w-10 px-3 py-2" />
                  </tr>
                </thead>
                <tbody
                  className={
                    "divide-y divide-court-border-soft transition-opacity " +
                    (loading ? "opacity-50" : "opacity-100")
                  }
                >
                  {sortedRows.length === 0 && !loading && (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-5 py-12 text-center text-sm text-court-fg-muted"
                      >
                        {view === "rejected"
                          ? "No candidates rejected for this job yet"
                          : "No candidates match your filters"}
                      </td>
                    </tr>
                  )}
                  {sortedRows.map((c) => {
                    const rowInFlight = actionInFlight === c.id;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        className="h-12 cursor-pointer transition hover:bg-court-accent-tint/40"
                      >
                        <td
                          className="w-10 px-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Select ${c.name}`}
                            checked={selectedIds.has(c.id)}
                            onChange={() => toggleSelected(c.id)}
                            className="h-4 w-4 cursor-pointer accent-brand"
                          />
                        </td>
                        <td className="px-3 font-medium text-court-fg">{c.name}</td>
                        <td className="px-3 text-court-fg-muted">{c.title || "—"}</td>
                        <td className="px-3 text-court-fg-muted">
                          {c.employer || "—"}
                        </td>
                        <td className="px-3 text-court-fg-muted">
                          {c.location || "—"}
                        </td>
                        <td className="px-3 text-right tabular-nums text-court-fg-muted">
                          {c.salary}
                        </td>
                        <td className="px-3 text-court-fg-muted">{c.lastApply}</td>
                        <td className="px-3 text-court-fg-muted">{c.lastAction}</td>
                        <td className="px-3 text-center text-court-fg-muted">—</td>
                        <td
                          className="w-10 px-3 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {view === "rejected" ? (
                            <button
                              type="button"
                              onClick={() => void reapplyCandidate(c.id, c.name)}
                              disabled={rowInFlight}
                              aria-label={`Reapply ${c.name}`}
                              title="Reapply to job"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-court-fg-muted transition hover:bg-court-surface hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {rowInFlight ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4" />
                              )}
                            </button>
                          ) : (
                            <Link
                              href={`/candidates/${c.id}`}
                              aria-label={`View ${c.name}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-court-fg-muted transition hover:bg-court-surface hover:text-court-fg"
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
