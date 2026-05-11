"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Download,
  Eye,
  EyeOff,
  ListFilter,
  Loader2,
  Search,
  Settings2,
  Target,
  X,
  XCircle,
} from "lucide-react";
import { toggleCandidateKept } from "@/app/candidates/[id]/keep-actions";
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
  lastAction: string;
};

type Filters = {
  q: string;
  skills: string[];
  jobTitles: string[];
  minComp: string;
  maxComp: string;
  locations: string[];
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
  locations: [],
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
  if (f.locations.length > 0) sp.set("locations", f.locations.join("|"));
  if (f.distance) sp.set("distance", f.distance);
  if (f.employer.trim()) sp.set("employer", f.employer.trim());
  if (f.tenure && f.tenure !== "any") sp.set("tenure", f.tenure);
  if (f.workAuth && f.workAuth !== "all") sp.set("workAuth", f.workAuth);
  return sp.toString();
}

const inputCls =
  "block h-8 w-full rounded-md border border-court-border bg-white px-2.5 text-xs text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:outline-none focus:ring-2 focus:ring-court-accent/20";

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

function TagInput({
  values,
  buffer,
  onBufferChange,
  onCommit,
  onRemove,
  placeholder,
  ariaLabel,
  enterOnly = false,
}: {
  values: string[];
  buffer: string;
  onBufferChange: (v: string) => void;
  onCommit: (v: string) => void;
  onRemove: (v: string) => void;
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
    f.locations.length > 0 ||
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

export function MatchesTab({
  jobCuid,
  jobRfId,
  jobTitle,
}: {
  jobCuid: string;
  // jobRfId stays in the prop contract for callers that pass it in — the
  // /api/placements route resolves the RF mirrors server-side from
  // jobCuid, so we don't need it here. Marked as accepted-but-unused.
  jobRfId: number | null;
  jobTitle: string;
}) {
  void jobRfId;

  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [skillsBuffer, setSkillsBuffer] = useState("");
  const [jobTitlesBuffer, setJobTitlesBuffer] = useState("");
  const [locationsBuffer, setLocationsBuffer] = useState("");
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

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasFilters = hasAnyFilter(filters);
  const skillsKey = filters.skills.join("|");
  const jobTitlesKey = filters.jobTitles.join("|");
  const locationsKey = filters.locations.join("|");

  function setField<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function addPill(key: "skills" | "jobTitles" | "locations", value: string) {
    setFilters((prev) => {
      const existing = prev[key];
      if (existing.includes(value)) return prev;
      return { ...prev, [key]: [...existing, value] };
    });
    if (key === "skills") setSkillsBuffer("");
    else if (key === "jobTitles") setJobTitlesBuffer("");
    else setLocationsBuffer("");
  }

  function removePill(
    key: "skills" | "jobTitles" | "locations",
    value: string,
  ) {
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].filter((v) => v !== value),
    }));
  }

  function resetFilters() {
    setFilters(INITIAL_FILTERS);
    setSkillsBuffer("");
    setJobTitlesBuffer("");
    setLocationsBuffer("");
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
    if (!hasFilters) {
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
    locationsKey,
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

  // Client-side hide for already-reviewed candidates: pull selected
  // rows out of the local results list. No DB write — this is a
  // recruiter's view-state shortcut, not a soft-delete.
  function removeSelectedFromResults() {
    if (selectedIds.size === 0) return;
    const removed = selectedIds.size;
    setRows((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    setTotal((prev) => (prev == null ? prev : Math.max(0, prev - removed)));
    if (selectedId && selectedIds.has(selectedId)) setSelectedId(null);
    setSelectedIds(new Set());
    toast.success(
      removed === 1
        ? "Removed 1 candidate from results"
        : `Removed ${removed} candidates from results`,
    );
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
    if (!q) return rows;
    return rows.filter((r) => {
      return (
        r.name.toLowerCase().includes(q) ||
        (r.title || "").toLowerCase().includes(q) ||
        (r.employer || "").toLowerCase().includes(q)
      );
    });
  }, [rows, sidebarFilter]);

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
          (selectedId ? "w-0 border-r-0" : "w-[260px]")
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
            <div className="grid grid-cols-[1fr_84px] gap-2">
              <TagInput
                values={filters.locations}
                buffer={locationsBuffer}
                onBufferChange={setLocationsBuffer}
                onCommit={(v) => addPill("locations", v)}
                onRemove={(v) => removePill("locations", v)}
                placeholder="City, ST — press Enter"
                ariaLabel="Locations"
                enterOnly
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
          </section>

          <section className="border-b border-court-border/60 px-3 py-1.5">
            <SectionTitle>Employment</SectionTitle>
            <div className="space-y-1.5">
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
        </div>

        {/* Footer — only the Run search action. No Save / Saved Lists
            here; sourcing for a single job is the workflow, not building
            a separate saved-search artifact. */}
        <div className="border-t border-court-border bg-white px-3 py-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onRunSearch}
            disabled={!hasFilters}
            className="h-8 w-full rounded-full"
          >
            <Search className="h-3.5 w-3.5" />
            Run search
          </Button>
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
          <div className="flex items-center justify-between border-b border-court-border/60 bg-court-surface-subtle px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-2xl font-extrabold leading-none text-court-fg">
                {total ?? 0}
              </span>
              <span className="text-xs text-court-fg-muted">
                {!hasFilters
                  ? "No filters applied yet"
                  : (total ?? 0) === 0
                    ? "candidates match"
                    : `candidate${total === 1 ? "" : "s"} match · sorted by Recent activity`}
              </span>
            </div>
            <div className="flex gap-1.5">
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
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedIds(new Set())}
                      className="rounded-full"
                    >
                      Clear
                    </Button>
                    <Button
                      type="button"
                      variant="reject"
                      size="sm"
                      onClick={removeSelectedFromResults}
                      className="rounded-full"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                      Remove from results
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
                        checked={rows.length > 0 && selectedIds.size === rows.length}
                        ref={(el) => {
                          if (el) {
                            el.indeterminate =
                              selectedIds.size > 0 && selectedIds.size < rows.length;
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
            </div>
          )}
        </section>
      )}
    </div>
  );
}
