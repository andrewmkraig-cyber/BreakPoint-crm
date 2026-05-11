"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  Download,
  Eye,
  ListFilter,
  Search,
  Settings2,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Button } from "@/components/ui/button";

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
  lastAction: string;
};

type Filters = {
  q: string;
  skills: string[];
  jobTitles: string[];
  minComp: string;
  maxComp: string;
  location: string;
  distance: string;
  employer: string;
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
  location: "",
  distance: "25",
  employer: "",
  tenure: "any",
  workAuth: "all",
  lastApply: "any",
  lastAction: "any",
};

function buildQuery(f: Filters): string {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set("q", f.q.trim());
  if (f.skills.length > 0) sp.set("skills", f.skills.join(","));
  if (f.jobTitles.length > 0) sp.set("jobTitles", f.jobTitles.join(","));
  if (f.minComp.trim()) sp.set("minComp", f.minComp.trim());
  if (f.maxComp.trim()) sp.set("maxComp", f.maxComp.trim());
  if (f.location.trim()) sp.set("location", f.location.trim());
  if (f.distance) sp.set("distance", f.distance);
  if (f.employer.trim()) sp.set("employer", f.employer.trim());
  if (f.tenure && f.tenure !== "any") sp.set("tenure", f.tenure);
  if (f.workAuth && f.workAuth !== "all") sp.set("workAuth", f.workAuth);
  return sp.toString();
}

const inputCls =
  "block h-8 w-full rounded-md border border-court-border bg-white px-2.5 text-xs text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:outline-none focus:ring-2 focus:ring-court-accent/20";

// Bare select class. Wrap with SelectField so the inline chevron paints
// over the native arrow we strip with appearance-none.
const selectBareCls =
  "block h-8 w-full appearance-none rounded-md border border-court-border bg-white pl-2.5 pr-7 text-xs text-court-fg focus:border-court-accent focus:outline-none focus:ring-2 focus:ring-court-accent/20";

function SelectField({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
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

// Sentence-case field label. Replaces the old all-caps eyebrow.
function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1 block text-[10.5px] font-semibold tracking-normal text-court-fg-muted">
      {children}
    </label>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 text-xs font-semibold tracking-normal text-court-fg">
      {children}
    </div>
  );
}

// Tag-pill input. Each committed value renders as a removable pill;
// the trailing text input stays inline so the field reads like a
// continuation of the pill row. Enter or comma commits the buffer;
// Backspace on an empty buffer pops the last pill (standard tag-input
// affordance). Duplicates are silently dropped — matching against the
// same value twice would just dedupe at query time anyway.
function TagInput({
  values,
  buffer,
  onBufferChange,
  onCommit,
  onRemove,
  placeholder,
  ariaLabel,
}: {
  values: string[];
  buffer: string;
  onBufferChange: (v: string) => void;
  onCommit: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
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
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === "Backspace" && buffer === "" && values.length > 0) {
      e.preventDefault();
      onRemove(values[values.length - 1]);
    }
  }

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-court-border bg-white px-1.5 py-0.5 focus-within:border-court-accent focus-within:ring-2 focus-within:ring-court-accent/20">
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-0.5 rounded bg-court-accent-tint px-1 py-0.5 text-[10px] font-medium text-court-accent-dark"
        >
          {v}
          <button
            type="button"
            onClick={() => onRemove(v)}
            aria-label={`Remove ${v}`}
            className="rounded-sm text-court-accent-dark/70 transition hover:bg-court-surface/40 hover:text-court-accent-dark"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
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
        <ChevronsUpDown className="h-3 w-3 opacity-60" />
      </span>
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
    f.location.trim() !== "" ||
    f.employer.trim() !== "" ||
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

// Best-effort bucketing on the lastAction "X mins ago" string. The
// search API returns these as humanized relative strings, so we parse
// back into rough buckets for the sticky sidebar group headers. Falls
// through to "older" when the string is missing or unparseable so the
// grouping never crashes.
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

// Compact subtitle that drops missing fields cleanly so we never render
// a stranded ` ·  · ` separator pair.
function joinDot(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(" · ");
}

const SUGGESTIONS: Array<{
  label: string;
  jobTitle: string;
  location: string;
}> = [
  { label: "Tax Manager · Cleveland", jobTitle: "Tax Manager", location: "Cleveland" },
  { label: "CFO · Remote", jobTitle: "CFO", location: "Remote" },
  { label: "Sr. Auditor · NEO", jobTitle: "Sr. Auditor", location: "NEO" },
];

export default function CandidatesPage() {
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [skillsBuffer, setSkillsBuffer] = useState("");
  const [jobTitlesBuffer, setJobTitlesBuffer] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  // Split-view: when set, the filter rail collapses to 0 and the
  // results pane swaps to a narrow name list + iframe of the
  // candidate's profile. Cleared by the close X.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"all" | "submitted" | "hot">("all");

  // Cancel any in-flight request when a newer one starts so a slow
  // earlier response can't overwrite a fresher result set.
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasFilters = hasAnyFilter(filters);
  // Stable string identity for the array filters so useEffect's dep
  // compare retriggers on pill add/remove.
  const skillsKey = filters.skills.join("|");
  const jobTitlesKey = filters.jobTitles.join("|");

  function setField<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function addPill(key: "skills" | "jobTitles", value: string) {
    setFilters((prev) => {
      const existing = prev[key];
      if (existing.includes(value)) return prev;
      return { ...prev, [key]: [...existing, value] };
    });
    if (key === "skills") setSkillsBuffer("");
    else setJobTitlesBuffer("");
  }

  function removePill(key: "skills" | "jobTitles", value: string) {
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].filter((v) => v !== value),
    }));
  }

  function resetFilters() {
    setFilters(INITIAL_FILTERS);
    setSkillsBuffer("");
    setJobTitlesBuffer("");
  }

  function applySuggestion(s: { jobTitle: string; location: string }) {
    setFilters((prev) => ({
      ...prev,
      jobTitles: prev.jobTitles.includes(s.jobTitle)
        ? prev.jobTitles
        : [...prev.jobTitles, s.jobTitle],
      location: s.location,
    }));
  }

  async function runFetch(f: Filters) {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const qs = buildQuery(f);
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
      // On error keep prior rows so the table doesn't blank out;
      // surface no toast — this surface is still being shelled in.
      setTotal(0);
    } finally {
      if (abortRef.current === ctrl) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }

  // Debounced refetch on any filter change. Gated on hasFilters: with
  // every field at its empty/default value the page sits in its empty
  // start state — no fetch fires on mount, the count reads "—", and
  // the table shows the placeholder. As soon as any field carries a
  // user-entered value the debounce kicks in and results populate.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!hasFilters) {
      // Drop any stale results so clearing the last filter snaps back
      // to the empty placeholder rather than showing the prior page.
      if (abortRef.current) abortRef.current.abort();
      setRows([]);
      setTotal(null);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runFetch(filters);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasFilters,
    filters.q,
    skillsKey,
    jobTitlesKey,
    filters.minComp,
    filters.maxComp,
    filters.location,
    filters.distance,
    filters.employer,
    filters.tenure,
    filters.workAuth,
    filters.lastApply,
    filters.lastAction,
  ]);

  function onRunSearch() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!hasFilters) return;
    void runFetch(filters);
  }

  // Split-view prev/next. The narrow name list and the iframe both
  // index off rows[], so the position of selectedId in rows[] drives
  // the "X of Y" counter and the disabled state of the arrows. When
  // the active candidate falls off the filtered set (e.g. user tweaks
  // a filter while the slide-over is open), currentIndex is -1; both
  // arrows disable and the counter shows "— of N" rather than crashing.
  const currentIndex = useMemo(
    () => (selectedId ? rows.findIndex((r) => r.id === selectedId) : -1),
    [rows, selectedId],
  );
  const canPrev = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < rows.length - 1;

  function goPrev() {
    if (!canPrev) return;
    setSelectedId(rows[currentIndex - 1].id);
  }
  function goNext() {
    if (!canNext) return;
    setSelectedId(rows[currentIndex + 1].id);
  }

  // Local-only filter for the sidebar list — narrows the visible rows
  // by name / title / employer substring without re-querying the API.
  const sidebarRows = useMemo(() => {
    const q = sidebarFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      return (
        r.name.toLowerCase().includes(q) ||
        (r.title || "").toLowerCase().includes(q) ||
        (r.employer || "").toLowerCase().includes(q)
      );
    });
  }, [rows, sidebarFilter]);

  // Bucket the visible rows by activity recency for the sticky group
  // headers. Insertion order inside each bucket follows rows[] so the
  // list stays sorted by whatever the API returned.
  const groupedSidebar = useMemo(() => {
    const out: { recent: Row[]; earlier: Row[]; older: Row[] } = {
      recent: [],
      earlier: [],
      older: [],
    };
    for (const r of sidebarRows) out[activityBucket(r.lastAction || "")].push(r);
    return out;
  }, [sidebarRows]);

  // Scroll the active name into view inside the narrow left pane each
  // time prev/next changes the selection. block: "nearest" only scrolls
  // when the row is actually outside the viewport, so a click on a row
  // that's already visible doesn't jerk the list.
  const nameRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  useEffect(() => {
    if (!selectedId) return;
    const el = nameRefs.current.get(selectedId);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <div className="-mb-6 -ml-3 -mr-6 -mt-4 flex min-h-[calc(100vh-72px)] md:-mb-8 md:-ml-4 md:-mr-8 md:-mt-4">
      <aside
        className={
          "flex shrink-0 flex-col overflow-hidden bg-court-surface transition-[width,border] duration-200 " +
          (selectedId
            ? "w-0 border-r-0"
            : "w-[300px] border-r border-court-border")
        }
      >
        {/* Header block — title + Reset */}
        <div className="flex items-center justify-between border-b border-court-border/60 px-[18px] py-2.5">
          <h2 className="text-sm font-semibold text-court-fg">
            Search Candidates
          </h2>
          <button
            type="button"
            onClick={resetFilters}
            disabled={!hasFilters}
            className="text-xs text-court-fg-muted transition hover:text-court-fg hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
          >
            Reset
          </button>
        </div>

        {/* Scrollable body — five sections */}
        <div className="flex-1 overflow-y-auto">
          {/* Identity */}
          <section className="border-b border-court-border/60 px-[18px] py-2">
            <SectionTitle>Identity</SectionTitle>
            <div className="space-y-2">
              <div>
                <FieldLabel>Keyword / Boolean</FieldLabel>
                <input
                  type="text"
                  value={filters.q}
                  onChange={(e) => setField("q", e.target.value)}
                  placeholder='e.g. ("CPA" AND "audit")'
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
                  placeholder="Add a skill, press Enter"
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
                  placeholder="Add a title, press Enter"
                  ariaLabel="Job titles"
                />
              </div>
            </div>
          </section>

          {/* Compensation */}
          <section className="border-b border-court-border/60 px-[18px] py-2">
            <SectionTitle>Compensation</SectionTitle>
            <div>
              <FieldLabel>Base salary range</FieldLabel>
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
            </div>
          </section>

          {/* Location */}
          <section className="border-b border-court-border/60 px-[18px] py-2">
            <SectionTitle>Location</SectionTitle>
            <div>
              <FieldLabel>City / state</FieldLabel>
              <div className="grid grid-cols-[1fr_92px] gap-2">
                <input
                  type="text"
                  value={filters.location}
                  onChange={(e) => setField("location", e.target.value)}
                  placeholder="City, State"
                  className={inputCls}
                />
                <SelectField
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
            </div>
          </section>

          {/* Employment */}
          <section className="border-b border-court-border/60 px-[18px] py-2">
            <SectionTitle>Employment</SectionTitle>
            <div className="space-y-2">
              <div>
                <FieldLabel>Current employer</FieldLabel>
                <input
                  type="text"
                  value={filters.employer}
                  onChange={(e) => setField("employer", e.target.value)}
                  placeholder="Company name"
                  className={inputCls}
                />
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

          {/* Activity */}
          <section className="px-[18px] py-2">
            <SectionTitle>Activity</SectionTitle>
            <div className="space-y-2">
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
        </div>

        {/* Sticky footer — Save / Run search + Saved Lists card */}
        <div className="flex flex-col gap-2 border-t border-court-border bg-white px-3 py-2.5">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!hasFilters}
              onClick={() => {
                /* save-search flow not yet wired */
              }}
              className="h-8 rounded-full"
            >
              Save
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onRunSearch}
              disabled={!hasFilters}
              className="h-8 flex-1 rounded-full"
            >
              <Search className="h-3.5 w-3.5" />
              Run search
            </Button>
          </div>
          <Link
            href="/candidates/lists"
            className="group flex items-center justify-between rounded-lg border border-court-border bg-court-bg px-2.5 py-1.5 transition hover:border-court-accent/40 hover:bg-court-accent-tint"
          >
            <div className="flex items-center gap-2">
              <span className="text-court-accent-dark">
                <ClipboardList className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <div>
                <div className="text-xs font-semibold text-court-fg">
                  Saved Lists
                </div>
                <div className="text-[10.5px] text-court-fg-muted">
                  Saved searches & shortlists
                </div>
              </div>
            </div>
            <ChevronRight
              className="h-3.5 w-3.5 text-court-fg-muted transition group-hover:text-court-accent-dark"
              strokeWidth={2}
            />
          </Link>
        </div>
      </aside>

      {selectedId ? (
        <>
          <section className="flex h-[calc(100vh-72px)] w-[300px] shrink-0 flex-col overflow-hidden border-r border-court-border bg-court-surface">
            {/* Sidebar header — title + count pill + filter input */}
            <div className="border-b border-court-border/60 px-3.5 py-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-court-fg">
                  Search results
                </h3>
                <span className="rounded-full bg-court-accent-tint px-2 py-0.5 text-[11px] font-bold text-court-accent-dark">
                  {sidebarRows.length} candidate
                  {sidebarRows.length === 1 ? "" : "s"}
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

            {/* Tabs row. Submitted / Hot are presentation-only until the
                row payload exposes per-candidate stage data — they show
                the count but don't filter the list. */}
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

            {/* Scrollable list — sticky group headers, two-line rows */}
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
            {/* Split-view nav bar. Sits flush above the iframe with a
                topbar-height (~40px) chrome strip so the prev/next +
                counter read as a control row, not a floating widget.
                Close X moves into this row at the far right so it
                doesn't overlay the bar's content. */}
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-court-border bg-court-surface px-3">
              {/* Bail-out back to the full two-column results layout.
                  Pairs with the trailing X — same behavior, but framed
                  as a labeled affordance so the recruiter knows where
                  the click leads instead of inferring "close" from a
                  bare X icon. */}
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                All Candidates
              </button>
              <span className="mx-1 h-4 w-px bg-court-border" aria-hidden="true" />
              <button
                type="button"
                onClick={goPrev}
                disabled={!canPrev}
                aria-label="Previous candidate"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-court-fg-muted"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-medium tabular-nums text-court-fg-muted">
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
          {/* Results header strip — count + sort/columns/export */}
          <div className="flex items-center justify-between border-b border-court-border/60 bg-court-surface-subtle px-6 py-4">
            <div className="flex items-baseline gap-2.5">
              <span
                className="text-[28px] font-bold leading-none text-court-fg"
                style={{ fontFamily: "var(--font-playfair, ui-serif)" }}
              >
                {total ?? 0}
              </span>
              <span className="text-sm text-court-fg-muted">
                {!hasFilters
                  ? "No filters applied yet"
                  : (total ?? 0) === 0
                    ? "candidates match"
                    : `candidate${total === 1 ? "" : "s"} match · sorted by Recent activity`}
              </span>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" className="rounded-full">
                <ListFilter className="h-3.5 w-3.5" />
                Sort
              </Button>
              <Button type="button" variant="secondary" size="sm" className="rounded-full">
                <Settings2 className="h-3.5 w-3.5" />
                Columns
              </Button>
              <Button type="button" variant="secondary" size="sm" className="rounded-full">
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </div>
          </div>

          {!hasFilters ? (
            <div className="flex flex-1 items-center justify-center px-6 py-16">
              <div className="flex max-w-md flex-col items-center text-center">
                <div className="mb-5 flex h-[88px] w-[88px] items-center justify-center rounded-full bg-court-accent-tint">
                  <Search
                    className="h-7 w-7 text-court-accent-dark"
                    strokeWidth={2}
                  />
                </div>
                <h3
                  className="text-[23px] font-semibold text-court-fg"
                  style={{ fontFamily: "var(--font-playfair, ui-serif)" }}
                >
                  Apply a filter to start searching
                </h3>
                <p className="mt-1.5 text-sm text-court-fg-muted">
                  Use the rail on the left to search the BreakPoint roster —
                  accounting & finance candidates indexed across the desk.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <Button
                      key={s.label}
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="rounded-full"
                      onClick={() => applySuggestion(s)}
                    >
                      {s.label}
                    </Button>
                  ))}
                </div>
                <div className="mt-3 text-[11px] uppercase tracking-wide text-court-fg-muted/80">
                  Try a recent search
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-court-border bg-court-surface-subtle">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        className="h-4 w-4 cursor-pointer accent-brand"
                      />
                    </th>
                    <SortHeader label="Candidate" />
                    <SortHeader label="Current Title" />
                    <SortHeader label="Employer" />
                    <SortHeader label="Location" />
                    <SortHeader label="Salary" align="right" />
                    <SortHeader label="Last Apply" />
                    <SortHeader label="Last Action" />
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
                  {rows.length === 0 && !loading && (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-5 py-12 text-center text-sm text-court-fg-muted"
                      >
                        No candidates match your filters
                      </td>
                    </tr>
                  )}
                  {rows.map((c) => (
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
                          className="h-4 w-4 cursor-pointer accent-brand"
                        />
                      </td>
                      <td className="px-3 font-medium text-court-fg">
                        {c.name}
                      </td>
                      <td className="px-3 text-court-fg-muted">
                        {c.title || "—"}
                      </td>
                      <td className="px-3 text-court-fg-muted">
                        {c.employer || "—"}
                      </td>
                      <td className="px-3 text-court-fg-muted">
                        {c.location || "—"}
                      </td>
                      <td className="px-3 text-right tabular-nums text-court-fg-muted">
                        {c.salary}
                      </td>
                      <td className="px-3 text-court-fg-muted">
                        {c.lastApply}
                      </td>
                      <td className="px-3 text-court-fg-muted">
                        {c.lastAction}
                      </td>
                      <td className="px-3 text-center text-court-fg-muted">
                        —
                      </td>
                      <td className="w-10 px-3 text-right">
                        <Link
                          href={`/candidates/${c.id}`}
                          aria-label={`View ${c.name}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-court-fg-muted transition hover:bg-court-surface hover:text-court-fg"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
