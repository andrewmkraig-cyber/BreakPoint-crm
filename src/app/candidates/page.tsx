"use client";

import Link from "next/link";
import { ChevronsUpDown, Eye, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

const DISTANCE_OPTIONS = [10, 25, 50, 100];
const TENURE_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "lt1", label: "Under 1 yr" },
  { value: "1to3", label: "1–3 yrs" },
  { value: "3to5", label: "3–5 yrs" },
  { value: "gt5", label: "5+ yrs" },
];
const WORK_AUTH_OPTIONS = [
  { value: "all", label: "All" },
  { value: "us-citizen", label: "US Citizen" },
  { value: "green-card", label: "Green Card" },
  { value: "h1b", label: "H1B" },
  { value: "other", label: "Other" },
];
const DATE_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "1y", label: "Last year" },
];

const DEBOUNCE_MS = 300;

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

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-xs text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:outline-none focus:ring-1 focus:ring-court-accent/30";

const selectCls =
  "w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-xs text-court-fg focus:border-court-accent focus:outline-none focus:ring-1 focus:ring-court-accent/30";

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
    <div className="mt-1 flex flex-wrap items-center gap-1 rounded-md border border-court-border bg-court-surface px-1.5 py-1 focus-within:border-court-accent focus-within:ring-1 focus-within:ring-court-accent/30">
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 rounded bg-court-accent-tint px-1.5 py-0.5 text-[11px] font-medium text-court-accent-dark"
        >
          {v}
          <button
            type="button"
            onClick={() => onRemove(v)}
            aria-label={`Remove ${v}`}
            className="rounded-sm text-court-accent-dark/70 transition hover:bg-court-surface/40 hover:text-court-accent-dark"
          >
            <X className="h-3 w-3" />
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

  function onQuickSearch() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!hasFilters) return;
    void runFetch(filters);
  }

  return (
    <div className="-mb-6 -ml-3 -mr-6 -mt-4 flex min-h-[calc(100vh-72px)] md:-mb-8 md:-ml-4 md:-mr-8 md:-mt-4">
      <aside
        className={
          "flex shrink-0 flex-col overflow-hidden bg-court-surface transition-[width,border] duration-200 " +
          (selectedId
            ? "w-0 border-r-0"
            : "w-[280px] border-r border-court-border")
        }
      >
        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          <div>
            <FilterLabel>Keyword / Boolean</FilterLabel>
            <input
              type="text"
              value={filters.q}
              onChange={(e) => setField("q", e.target.value)}
              placeholder='e.g. ("python" AND "aws")'
              className={`${inputCls} mt-1`}
            />
          </div>

          <div>
            <FilterLabel>Skills</FilterLabel>
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
            <FilterLabel>Job Titles</FilterLabel>
            <TagInput
              values={filters.jobTitles}
              buffer={jobTitlesBuffer}
              onBufferChange={setJobTitlesBuffer}
              onCommit={(v) => addPill("jobTitles", v)}
              onRemove={(v) => removePill("jobTitles", v)}
              placeholder="Add a title, press Enter"
              ariaLabel="Job Titles"
            />
          </div>

          <div>
            <FilterLabel>Compensation</FilterLabel>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <input
                type="number"
                value={filters.minComp}
                onChange={(e) => setField("minComp", e.target.value)}
                placeholder="Min"
                className={inputCls}
              />
              <input
                type="number"
                value={filters.maxComp}
                onChange={(e) => setField("maxComp", e.target.value)}
                placeholder="Max"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <FilterLabel>Location</FilterLabel>
            <div className="mt-1 grid grid-cols-[1fr_auto] gap-2">
              <input
                type="text"
                value={filters.location}
                onChange={(e) => setField("location", e.target.value)}
                placeholder="City, State"
                className={inputCls}
              />
              <select
                value={filters.distance}
                onChange={(e) => setField("distance", e.target.value)}
                className={selectCls}
              >
                {DISTANCE_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} mi
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <FilterLabel>Current Employer</FilterLabel>
            <input
              type="text"
              value={filters.employer}
              onChange={(e) => setField("employer", e.target.value)}
              placeholder="Company name"
              className={`${inputCls} mt-1`}
            />
          </div>

          <div>
            <FilterLabel>Employer Tenure</FilterLabel>
            <select
              value={filters.tenure}
              onChange={(e) => setField("tenure", e.target.value)}
              className={`${selectCls} mt-1`}
            >
              {TENURE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FilterLabel>Work Authorization</FilterLabel>
            <select
              value={filters.workAuth}
              onChange={(e) => setField("workAuth", e.target.value)}
              className={`${selectCls} mt-1`}
            >
              {WORK_AUTH_OPTIONS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FilterLabel>Last Apply Date</FilterLabel>
            <select
              value={filters.lastApply}
              onChange={(e) => setField("lastApply", e.target.value)}
              className={`${selectCls} mt-1`}
            >
              {DATE_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FilterLabel>Last Action Date</FilterLabel>
            <select
              value={filters.lastAction}
              onChange={(e) => setField("lastAction", e.target.value)}
              className={`${selectCls} mt-1`}
            >
              {DATE_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-1 flex items-center justify-between gap-3 border-t border-court-border-soft pt-3">
            <button
              type="button"
              onClick={onQuickSearch}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
            >
              Quick Search
            </button>
            <div className="flex flex-col items-end gap-0.5 leading-tight">
              <span className="text-xs font-medium text-court-fg">
                {total == null ? "—" : total.toLocaleString()} Candidate
                {total === 1 ? "" : "s"}
              </span>
              <Link
                href="/candidates/lists"
                className="text-[11px] text-court-fg-muted underline underline-offset-2 hover:text-court-fg"
              >
                View Lists
              </Link>
            </div>
          </div>
        </div>
      </aside>

      {selectedId ? (
        <>
          <section className="flex h-[calc(100vh-72px)] w-[280px] shrink-0 flex-col overflow-y-auto border-r border-court-border bg-court-surface">
            {rows.map((c) => {
              const active = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={
                    "border-b border-court-border-soft px-4 py-3 text-left text-sm font-medium transition " +
                    (active
                      ? "bg-brand text-white"
                      : "text-court-fg hover:bg-court-accent-tint/40")
                  }
                >
                  {c.name}
                </button>
              );
            })}
          </section>
          <section className="relative flex-1 bg-court-bg">
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Close profile"
              className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-court-border bg-court-surface text-court-fg-muted shadow-sm transition hover:bg-court-surface-subtle hover:text-court-fg"
            >
              <X className="h-4 w-4" />
            </button>
            <iframe
              key={selectedId}
              src={`/candidates/${selectedId}`}
              title="Candidate profile"
              className="h-[calc(100vh-72px)] w-full border-0"
            />
          </section>
        </>
      ) : (
        <section className="flex-1 overflow-x-auto bg-court-bg">
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
                    {hasFilters
                      ? "No candidates match your filters"
                      : "Apply a filter to start searching"}
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
                  <td className="px-3 font-medium text-court-fg">{c.name}</td>
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
                  <td className="px-3 text-court-fg-muted">{c.lastApply}</td>
                  <td className="px-3 text-court-fg-muted">{c.lastAction}</td>
                  <td className="px-3 text-center text-court-fg-muted">—</td>
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
        </section>
      )}
    </div>
  );
}
