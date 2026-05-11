"use client";

import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  Loader2,
  Minus,
  Search,
  Target,
  X,
} from "lucide-react";
import { toggleCandidateKept } from "@/app/candidates/[id]/keep-actions";
import {
  Fragment,
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

const DISTANCE_OPTIONS = [10, 25, 50, 100];
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
  // Server-side keyword hit inside the candidate's parsed resume text.
  // Null when q is empty or no resume on file matched all tokens.
  resumeSnippet: string | null;
};

type SortColumn = "lastApply" | "lastAction";
type SortDirection = "asc" | "desc";
type SortState = { column: SortColumn; direction: SortDirection } | null;

// Pill with include/exclude semantics. Each chip on Skills / Job titles
// / Employer carries its own toggle so the same input can express "tax
// AND NOT manager" inline. The server OR's the includes within a field
// and AND-NOTs the excludes — see buildQuery for the wire format and
// /api/candidates/search/route.ts for the resolution.
type Pill = { value: string; exclude: boolean };

type Filters = {
  q: string;
  skills: Pill[];
  jobTitles: Pill[];
  minComp: string;
  maxComp: string;
  // Multiple pills, each a free-form "City, ST" string. OR'd together
  // on the server — a candidate matches if they fall in ANY of the
  // resolved bounding boxes (or text-contains-match for pills that
  // fail to geocode). Locations don't carry exclude semantics, so they
  // stay as plain strings.
  locations: string[];
  distance: string;
  // Multiple employer pills with per-pill include/exclude. The single
  // scope select below applies uniformly to every employer pill.
  employers: Pill[];
  // "current" (default) restricts the employer filter to the candidate's
  // current employer column. "any" widens it to include any historical
  // employer recorded in the experience JSON.
  employerScope: string;
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
  lastApply: "any",
  lastAction: "any",
};

// Split a Pill[] into (includes, excludes) lists of raw string values.
// Centralizes the inclusion/exclusion partition so buildQuery and the
// label generator never disagree about the boundary.
function partitionPills(pills: Pill[]): { include: string[]; exclude: string[] } {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const p of pills) (p.exclude ? exclude : include).push(p.value);
  return { include, exclude };
}

// Coerce one of {Pill[], string[], single string} into Pill[]. Used to
// migrate localStorage saved searches written before the include/exclude
// split (skills/jobTitles were string[], employer was a single string).
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

function buildQuery(f: Filters): string {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set("q", f.q.trim());
  // Skills/Job titles: comma-delimited since neither value family
  // typically embeds commas. Includes and excludes ride on separate
  // params so the server doesn't need an in-band sigil to tell them
  // apart.
  const skills = partitionPills(f.skills);
  if (skills.include.length > 0) sp.set("skills", skills.include.join(","));
  if (skills.exclude.length > 0) sp.set("excludeSkills", skills.exclude.join(","));
  const titles = partitionPills(f.jobTitles);
  if (titles.include.length > 0) sp.set("jobTitles", titles.include.join(","));
  if (titles.exclude.length > 0)
    sp.set("excludeJobTitles", titles.exclude.join(","));
  if (f.minComp.trim()) sp.set("minComp", f.minComp.trim());
  if (f.maxComp.trim()) sp.set("maxComp", f.maxComp.trim());
  // Pipe-delimited because each location ("Akron, OH") already contains
  // a comma. The server splits on `|` to recover the pill list.
  if (f.locations.length > 0) sp.set("locations", f.locations.join("|"));
  if (f.distance) sp.set("distance", f.distance);
  // Employers also pipe-delimited — company names ("Microsoft, Inc.")
  // can carry commas. Scope is only emitted when at least one employer
  // pill is set and the scope is non-default.
  const emps = partitionPills(f.employers);
  if (emps.include.length > 0) sp.set("employers", emps.include.join("|"));
  if (emps.exclude.length > 0)
    sp.set("excludeEmployers", emps.exclude.join("|"));
  if (f.employers.length > 0 && f.employerScope === "any") {
    sp.set("employerScope", "any");
  }
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

// Tag-pill input. Each committed value renders as a removable pill;
// the trailing text input stays inline so the field reads like a
// continuation of the pill row. Enter or comma commits the buffer;
// Backspace on an empty buffer pops the last pill (standard tag-input
// affordance). Duplicates (by value) are silently dropped.
//
// Values arrive as Pill[] so the same component handles include and
// exclude modes uniformly. When onToggleExclude is supplied each pill
// renders a checkmark (include) / minus (exclude) toggle at its head;
// when omitted the pill is render-only (used by Locations, which has no
// exclude semantics).
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
  // Skill / Job-Title pills commit on both Enter and `,` — those values
  // never embed commas. Location/Employer pills can ("Akron, OH" /
  // "Microsoft, Inc.") so the caller passes enterOnly to disable
  // comma-commit there.
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

// Sortable variant — mirrors the Matches tab pattern. Click cycles
// descending → ascending → cleared. Active column shows a directional
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

// Mirror of the server's tokenize: split on whitespace, drop the
// boolean connective stopwords ("and"/"or") so they don't render as
// highlighted hits.
const HIGHLIGHT_STOPWORDS = new Set(["and", "or"]);
function highlightTokens(q: string): string[] {
  return q
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0 && !HIGHLIGHT_STOPWORDS.has(s.toLowerCase()));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Wrap any case-insensitive match of the active search tokens in a
// <mark> so the recruiter sees at a glance which field carried the
// match. Falls through to plain text when there are no tokens.
function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (!text) return null;
  if (tokens.length === 0) return <>{text}</>;
  const re = new RegExp(`(${tokens.map(escapeRegex).join("|")})`, "gi");
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <mark
        key={`${m.index}-${m[0]}`}
        className="rounded-sm bg-yellow-100 px-0.5 text-yellow-900"
      >
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

// Saved-search persistence. Stored client-side in localStorage so the
// recruiter can park 3-5 frequent searches behind the empty-state pill
// row without a Postgres round-trip. Per-job saved searches live in
// Job.savedSearchFilters and are written by /jobs/[id] Matches —
// that's the durable shape; this is just the candidates rail's "recent
// stops" memory.
type SavedSearch = {
  label: string;
  filters: Filters;
  savedAt: string;
};
const SAVED_SEARCHES_KEY = "ace.saved-searches";
const SAVED_SEARCHES_MAX = 5;

// Migrate a localStorage Filters blob into the current shape. Pre-pill
// snapshots stored skills/jobTitles as string[] and employer as a
// single string; we lift each into the new Pill[] (everything reads as
// include) so an old saved search still applies cleanly.
function coerceFilters(value: unknown): Filters {
  if (!value || typeof value !== "object") return INITIAL_FILTERS;
  const v = value as Record<string, unknown>;
  const locations = Array.isArray(v.locations)
    ? v.locations.filter((x): x is string => typeof x === "string")
    : [];
  return {
    q: typeof v.q === "string" ? v.q : INITIAL_FILTERS.q,
    skills: coercePills(v.skills),
    jobTitles: coercePills(v.jobTitles),
    minComp: typeof v.minComp === "string" ? v.minComp : INITIAL_FILTERS.minComp,
    maxComp: typeof v.maxComp === "string" ? v.maxComp : INITIAL_FILTERS.maxComp,
    locations,
    distance:
      typeof v.distance === "string" ? v.distance : INITIAL_FILTERS.distance,
    // Prefer the new `employers` array; fall back to the legacy
    // `employer` singleton so a pre-migration save keeps working.
    employers:
      v.employers !== undefined ? coercePills(v.employers) : coercePills(v.employer),
    employerScope:
      typeof v.employerScope === "string"
        ? v.employerScope
        : INITIAL_FILTERS.employerScope,
    lastApply:
      typeof v.lastApply === "string" ? v.lastApply : INITIAL_FILTERS.lastApply,
    lastAction:
      typeof v.lastAction === "string"
        ? v.lastAction
        : INITIAL_FILTERS.lastAction,
  };
}

function loadSavedSearches(): SavedSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is { label: string; savedAt: string; filters: unknown } =>
          e &&
          typeof e === "object" &&
          typeof e.label === "string" &&
          typeof e.savedAt === "string" &&
          e.filters !== undefined,
      )
      .map((e) => ({
        label: e.label,
        savedAt: e.savedAt,
        filters: coerceFilters(e.filters),
      }));
  } catch {
    return [];
  }
}

function persistSavedSearches(list: SavedSearch[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // Quota exceeded or storage disabled — fail silently. The current
    // session keeps its in-memory list and a recruiter retry on a
    // fresh tab restores from whatever did land in storage.
  }
}

// Build a human-readable label out of the most distinctive filter
// fields. Mirrors the previous hardcoded "Tax Manager · Cleveland"
// shape so the pill row visually carries over.
function generateSearchLabel(f: Filters): string {
  const parts: string[] = [];
  const firstIncludeTitle = f.jobTitles.find((p) => !p.exclude)?.value;
  const headline =
    firstIncludeTitle ?? (f.q.trim() ? f.q.trim() : "") ?? "";
  if (headline) {
    parts.push(headline.length > 40 ? headline.slice(0, 40) + "…" : headline);
  }
  if (f.locations[0]) parts.push(f.locations[0]);
  const firstIncludeEmp = f.employers.find((p) => !p.exclude)?.value;
  if (firstIncludeEmp && parts.length < 3) parts.push(firstIncludeEmp);
  const firstIncludeSkill = f.skills.find((p) => !p.exclude)?.value;
  if (parts.length === 0 && firstIncludeSkill) parts.push(firstIncludeSkill);
  if (parts.length === 0) parts.push("Saved search");
  return parts.join(" · ");
}

export default function CandidatesPage() {
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [skillsBuffer, setSkillsBuffer] = useState("");
  const [jobTitlesBuffer, setJobTitlesBuffer] = useState("");
  const [locationsBuffer, setLocationsBuffer] = useState("");
  const [employersBuffer, setEmployersBuffer] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  // Split-view: when set, the filter rail collapses to 0 and the
  // results pane swaps to a narrow name list + iframe of the
  // candidate's profile. Cleared by the close X.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Per-candidate Keep in-flight flag for the split-view chrome's Keep
  // button so a slow round-trip can't be fired twice.
  const [keepInFlight, setKeepInFlight] = useState<string | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"all" | "submitted">("all");
  // Column-sort state. Click cycles: idle → desc → asc → cleared. Null
  // means "follow the API's default ordering" (Recent activity).
  const [sort, setSort] = useState<SortState>(null);
  // Saved-search pills shown in the empty state. Hydrated from
  // localStorage in a useEffect so the first SSR pass renders the empty
  // pill row and no hydration-mismatch fires.
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  useEffect(() => {
    setSavedSearches(loadSavedSearches());
  }, []);

  // Cancel any in-flight request when a newer one starts so a slow
  // earlier response can't overwrite a fresher result set.
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Imperative handle on the split-view iframe so Apply to Job can
  // navigate it to `?openApply=true` without remounting the iframe
  // (a `src` prop change would only fire when React diffs, and the
  // iframe's key is bound to selectedId so re-applying the same id
  // wouldn't trigger a reload).
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const hasFilters = hasAnyFilter(filters);
  // Stable string identity for the array filters so useEffect's dep
  // compare retriggers on pill add/remove and on exclude-toggle. Each
  // Pill collapses to `value:0|1` so a toggle without an add or remove
  // still bumps the key.
  const pillKey = (pills: Pill[]) =>
    pills.map((p) => `${p.value}:${p.exclude ? 1 : 0}`).join("|");
  const skillsKey = pillKey(filters.skills);
  const jobTitlesKey = pillKey(filters.jobTitles);
  const employersKey = pillKey(filters.employers);
  const locationsKey = filters.locations.join("|");

  // Tokens used to drive <mark> highlighting in the results table.
  // Mirrors the server tokenizer so what gets highlighted matches what
  // actually drove the row into the result set.
  const matchTokens = useMemo(() => highlightTokens(filters.q), [filters.q]);

  function setField<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  // Pill[] mutators (skills / jobTitles / employers). New pills default
  // to include mode; togglePill flips a pill into exclude (or back).
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

  // Locations stay a flat string[] — no exclude semantics, dedicated
  // helpers to keep the typing clean alongside the Pill[] mutators.
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

  // Restore a saved snapshot into the rail. Merge over INITIAL_FILTERS so
  // a stale save (e.g. missing employerScope from before we added it)
  // doesn't end up with undefined values flowing into the inputs.
  // Clearing the buffers keeps the TagInput trailing fields visually
  // empty rather than carrying whatever the recruiter was mid-typing
  // before they clicked the pill.
  function applySavedSearch(s: SavedSearch) {
    // s.filters is already coerced at load time, but re-merge with
    // INITIAL_FILTERS so anything missing from an old snapshot falls
    // back to the default rather than `undefined`.
    const merged: Filters = { ...INITIAL_FILTERS, ...s.filters };
    setFilters(merged);
    setSkillsBuffer("");
    setJobTitlesBuffer("");
    setLocationsBuffer("");
    setEmployersBuffer("");
    // The filter-change useEffect picks this up and fires the
    // debounced fetch; no explicit runFetch needed.
  }

  // Push the current filter shape onto the saved-searches list. Dedupes
  // on label (most recent save wins) and trims the oldest off the tail
  // when the list exceeds SAVED_SEARCHES_MAX.
  function onSaveCurrent() {
    if (!hasFilters) return;
    const entry: SavedSearch = {
      label: generateSearchLabel(filters),
      filters,
      savedAt: new Date().toISOString(),
    };
    const next = [
      entry,
      ...savedSearches.filter((p) => p.label !== entry.label),
    ].slice(0, SAVED_SEARCHES_MAX);
    setSavedSearches(next);
    persistSavedSearches(next);
    toast.success("Saved");
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
    locationsKey,
    filters.distance,
    employersKey,
    filters.employerScope,
    filters.lastApply,
    filters.lastAction,
  ]);

  // Apply the column sort on top of whatever the server returned.
  // Falls back to ISO-string compare on the raw timestamp; rows without
  // a timestamp sink to the bottom so they don't reorder unexpectedly.
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

  // Split-view prev/next. The narrow name list and the iframe both
  // index off sortedRows[], so the position of selectedId in
  // sortedRows[] drives the "X of Y" counter and the disabled state of
  // the arrows. When the active candidate falls off the filtered set
  // (e.g. user tweaks a filter while the slide-over is open),
  // currentIndex is -1; both arrows disable and the counter shows
  // "— of N" rather than crashing.
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

  // Apply to Job from the candidates split-view. The candidates page
  // isn't job-specific, so we hand the picker step off to the embedded
  // candidate profile by navigating its iframe to `?openApply=true`.
  // local-candidate-actions.tsx already reads that param on mount and
  // auto-opens its existing job-picker modal — keeping a single source
  // of truth for the apply flow instead of duplicating the picker here.
  function openApplyInIframe() {
    if (!selectedId || !iframeRef.current) return;
    iframeRef.current.src = `/candidates/${selectedId}?embed=true&openApply=true`;
  }

  // Keep is candidate-scoped — no job picker needed. toggleCandidateKept
  // is the same server action used by KeepCandidateButton on the
  // candidate profile.
  async function onKeepSelected() {
    if (!selectedId || keepInFlight === selectedId) return;
    const candidateId = selectedId;
    setKeepInFlight(candidateId);
    try {
      const res = await toggleCandidateKept({ candidateId });
      if (!res.ok) {
        toast.error("Couldn't update Keep", { description: res.error });
        return;
      }
      toast.success(res.value.isKept ? "Kept" : "Removed from Kept");
    } catch (e) {
      toast.error("Couldn't update Keep", {
        description: e instanceof Error ? e.message : "Network error.",
      });
    } finally {
      setKeepInFlight((prev) => (prev === candidateId ? null : prev));
    }
  }

  // Local-only filter for the sidebar list — narrows the visible rows
  // by name / title / employer substring without re-querying the API.
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
    // Viewport-bound shell so the candidate table scrolls inside its
    // own container instead of the page. Pinning height (h, not min-h)
    // plus overflow-hidden keeps the sidebar's Save search + Saved
    // Lists footer permanently visible no matter how long the result
    // list gets — the result list scrolls within its own wrapper
    // below.
    <div className="-mb-6 -ml-3 -mr-6 -mt-4 flex h-[calc(100vh-72px)] overflow-hidden md:-mb-8 md:-ml-4 md:-mr-8 md:-mt-4 xl:-ml-8 xl:-mr-8 2xl:-ml-12 2xl:-mr-12">
      <aside
        className={
          "flex shrink-0 flex-col overflow-hidden bg-court-surface transition-[width,border] duration-200 " +
          (selectedId
            ? "w-0 border-r-0"
            : "w-[220px] min-w-[220px] border-r border-court-border")
        }
      >
        {/* Header block — title + Reset. Faint top border separates
            the sidebar from the global topbar chrome; no bottom border
            so the section blocks below flow together as one panel. */}
        <div className="flex items-center justify-between border-t border-court-border/30 px-[18px] py-2">
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
          <section className="px-[18px] py-1.5">
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

          {/* Compensation — section title doubles as the field label */}
          <section className="px-[18px] py-1.5">
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

          {/* Location — section title doubles as the field label.
              TagInput accepts multiple "City, ST" pills which OR
              together server-side via bounding-box union. enterOnly is
              critical here: the comma in "Akron, OH" is part of the
              value, not a commit delimiter. */}
          <section className="px-[18px] py-1.5">
            <SectionTitle>Location</SectionTitle>
            {/* Stacked: location pill input full-width on top, distance
                full-width below it. Matches the matches-tab sidebar
                structure — the prior 1fr/92px grid clipped both inputs
                on laptop-width viewports. */}
            <div className="w-full space-y-1.5">
              <TagInput
                // Locations have no exclude semantics — render as plain
                // pills by upgrading the string[] state into Pill[] at
                // the boundary and omitting onToggleExclude so the
                // toggle button is hidden.
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

          {/* Employment */}
          <section className="px-[18px] py-1.5">
            <SectionTitle>Employment</SectionTitle>
            <div>
              <FieldLabel>Employer</FieldLabel>
              {/* Stacked: employer pill input full-width on top, scope
                  toggle full-width below it. Matches the Location
                  section structure — the prior 1fr/130px grid clipped
                  both inputs on laptop-width viewports. */}
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
          </section>

          {/* Activity */}
          <section className="px-[18px] py-1.5">
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

        {/* Sticky footer — Save Search only. Saved Lists moved to the
            results header so it pairs visually with the count row and
            stays visible without competing for sidebar real estate.
            Search fires on every filter change, so a separate Run
            button would be redundant; Save is the only durable
            affordance here. */}
        <div className="border-t border-court-border bg-white px-3 py-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onSaveCurrent}
            disabled={!hasFilters}
            className="h-8 w-full rounded-full"
          >
            <Bookmark className="h-3.5 w-3.5" />
            Save search
          </Button>
        </div>
      </aside>

      {selectedId ? (
        <>
          <section className="flex h-[calc(100vh-72px)] w-[300px] shrink-0 flex-col overflow-hidden border-r border-court-border bg-court-surface">
            {/* Sidebar header — title + count pill + filter input.
                border-t mirrors the default-view sidebar's top divider
                so the rule above the header reads as continuous chrome
                whether or not the candidate-search rail is collapsed. */}
            <div className="border-b border-b-court-border/60 border-t border-t-court-border/30 px-3.5 py-3">
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

            {/* Tabs row. Submitted is presentation-only until the row
                payload exposes per-candidate stage data — it shows the
                count but doesn't filter the list. */}
            <div className="flex border-b border-court-border/60 bg-white">
              {(
                [
                  { id: "all", label: "All", n: sidebarRows.length },
                  { id: "submitted", label: "Submitted", n: 0 },
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
                {currentIndex >= 0 ? currentIndex + 1 : "—"} of {sortedRows.length}
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
              {/* Apply / Keep mirror the matches-tab chrome treatment.
                  Reject is intentionally absent — there's no job
                  context on /candidates, and rejection without a job
                  has no meaning. */}
              <span className="mx-1 h-4 w-px bg-court-border" aria-hidden="true" />
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={openApplyInIframe}
                className="h-7 rounded-md px-2.5 text-[11px]"
              >
                <Target className="h-3 w-3" />
                Apply to Job
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void onKeepSelected()}
                disabled={keepInFlight === selectedId}
                className="h-7 rounded-md px-2.5 text-[11px]"
              >
                {keepInFlight === selectedId ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Bookmark className="h-3 w-3" />
                )}
                Keep
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
              ref={iframeRef}
              key={selectedId}
              src={`/candidates/${selectedId}?embed=true`}
              title="Candidate profile"
              className="w-full flex-1 border-0"
            />
          </section>
        </>
      ) : (
        <section className="flex flex-1 flex-col bg-court-bg">
          {/* Results header strip — count on the left, Saved Lists pill
              on the right. justify-between pins the two ends; the count
              + label keep items-baseline alignment internally while the
              outer row uses items-center so the pill verticals balance
              against the big count number. */}
          <div className="flex items-center justify-between border-b border-court-border/60 bg-court-surface-subtle px-6 py-4">
            <div className="flex items-baseline gap-2.5">
              <span className="font-serif text-[28px] font-extrabold leading-none text-court-fg">
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
            <Link
              href="/candidates/lists"
              className="group inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-bg px-3 py-1.5 transition hover:border-court-accent/40 hover:bg-court-accent-tint"
            >
              <ClipboardList className="h-3.5 w-3.5 text-court-accent-dark" strokeWidth={1.8} />
              <span className="text-xs font-semibold text-court-fg">Saved Lists</span>
              <ChevronRight
                className="h-3.5 w-3.5 text-court-fg-muted transition group-hover:text-court-accent-dark"
                strokeWidth={2}
              />
            </Link>
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
                <h3 className="font-serif text-[23px] font-extrabold text-court-fg">
                  Apply a filter to start searching
                </h3>
                <p className="mt-1.5 text-sm text-court-fg-muted">
                  Use the rail on the left to search the BreakPoint roster —
                  accounting & finance candidates indexed across the desk.
                </p>
                {savedSearches.length > 0 ? (
                  <>
                    <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                      {savedSearches.map((s) => (
                        <Button
                          key={`${s.label}-${s.savedAt}`}
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="rounded-full"
                          onClick={() => applySavedSearch(s)}
                        >
                          {s.label}
                        </Button>
                      ))}
                    </div>
                    <div className="mt-3 text-[11px] uppercase tracking-wide text-court-fg-muted/80">
                      Saved searches
                    </div>
                  </>
                ) : (
                  <div className="mt-5 text-[11px] text-court-fg-muted/70">
                    Tip — set some filters and hit Save search to park a
                    quick pill here.
                  </div>
                )}
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
                        colSpan={8}
                        className="px-5 py-12 text-center text-sm text-court-fg-muted"
                      >
                        No candidates match your filters
                      </td>
                    </tr>
                  )}
                  {sortedRows.map((c) => (
                    <Fragment key={c.id}>
                    <tr
                      onClick={() => setSelectedId(c.id)}
                      className={
                        "h-12 cursor-pointer transition hover:bg-court-accent-tint/40 " +
                        (c.resumeSnippet ? "border-b-0" : "")
                      }
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
                        <Highlight text={c.name} tokens={matchTokens} />
                      </td>
                      <td className="px-3 text-court-fg-muted">
                        {c.title ? (
                          <Highlight text={c.title} tokens={matchTokens} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 text-court-fg-muted">
                        {c.employer ? (
                          <Highlight text={c.employer} tokens={matchTokens} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 text-court-fg-muted">
                        {c.location ? (
                          <Highlight text={c.location} tokens={matchTokens} />
                        ) : (
                          "—"
                        )}
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
                    </tr>
                    {c.resumeSnippet ? (
                      <tr
                        onClick={() => setSelectedId(c.id)}
                        className="cursor-pointer transition hover:bg-court-accent-tint/40"
                      >
                        <td className="px-3" />
                        <td
                          colSpan={7}
                          className="px-3 pb-2 pt-0 text-[11px] italic leading-snug text-court-fg-muted"
                        >
                          <span className="font-semibold not-italic text-court-fg-muted/80">
                            Resume:
                          </span>{" "}
                          <Highlight
                            text={c.resumeSnippet}
                            tokens={matchTokens}
                          />
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
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
