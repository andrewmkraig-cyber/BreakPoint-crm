import Link from "next/link";
import { ChevronsUpDown, Eye } from "lucide-react";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { formatLocation } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

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

function composeName(first: string | null, last: string | null): string {
  const parts = [first, last].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : "(unnamed)";
}

function formatSalary(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "—";
  const n = (raw as { number?: unknown }).number;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "—";
  const ccy = (raw as { currency?: unknown }).currency;
  const symbol = ccy === "USD" || !ccy ? "$" : `${String(ccy)} `;
  return `${symbol}${n.toLocaleString()}`;
}

function relativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo} mo${mo === 1 ? "" : "s"} ago`;
  const yr = Math.round(mo / 12);
  return `${yr} yr${yr === 1 ? "" : "s"} ago`;
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

function SortHeader({
  label,
  align = "left",
  className = "",
}: {
  label: string;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const justify =
    align === "right"
      ? "justify-end"
      : align === "center"
        ? "justify-center"
        : "justify-start";
  return (
    <th
      className={
        "px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted " +
        className
      }
    >
      <span className={`inline-flex items-center gap-1 ${justify}`}>
        {label}
        <ChevronsUpDown className="h-3 w-3 opacity-60" />
      </span>
    </th>
  );
}

export default async function CandidatesPage() {
  const org = await getCurrentOrg();

  const [rowsRaw, total] = await Promise.all([
    prisma.candidate.findMany({
      where: { organizationId: org.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        currentDesignation: true,
        currentOrganization: true,
        location: true,
        expectedSalary: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: PAGE_SIZE,
    }),
    prisma.candidate.count({ where: { organizationId: org.id } }),
  ]);

  const rows: Row[] = rowsRaw.map((r) => ({
    id: r.id,
    name: composeName(r.firstName, r.lastName),
    title: r.currentDesignation ?? "",
    employer: r.currentOrganization ?? "",
    location: formatLocation(r.location) || "",
    salary: formatSalary(r.expectedSalary),
    lastApply: relativeTime(r.createdAt),
    lastAction: relativeTime(r.updatedAt),
  }));

  return (
    <div className="-mb-6 -ml-3 -mr-6 -mt-4 flex min-h-[calc(100vh-72px)] md:-mb-8 md:-ml-4 md:-mr-8 md:-mt-4">
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-court-border bg-court-surface">
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div>
            <FilterLabel>Keyword / Boolean</FilterLabel>
            <input
              type="text"
              placeholder='e.g. ("python" AND "aws")'
              className={`${inputCls} mt-1`}
            />
          </div>

          <div>
            <FilterLabel>Skills</FilterLabel>
            <input
              type="text"
              placeholder="Add skills…"
              className={`${inputCls} mt-1`}
            />
          </div>

          <div>
            <FilterLabel>Job Titles</FilterLabel>
            <input
              type="text"
              placeholder="e.g. Software Engineer"
              className={`${inputCls} mt-1`}
            />
          </div>

          <div>
            <FilterLabel>Compensation</FilterLabel>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <input
                type="number"
                placeholder="Min"
                className={inputCls}
              />
              <input
                type="number"
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
                placeholder="City, State"
                className={inputCls}
              />
              <select className={selectCls} defaultValue="25">
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
              placeholder="Company name"
              className={`${inputCls} mt-1`}
            />
          </div>

          <div>
            <FilterLabel>Employer Tenure</FilterLabel>
            <select className={`${selectCls} mt-1`} defaultValue="any">
              {TENURE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FilterLabel>Work Authorization</FilterLabel>
            <select className={`${selectCls} mt-1`} defaultValue="all">
              {WORK_AUTH_OPTIONS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FilterLabel>Last Apply Date</FilterLabel>
            <select className={`${selectCls} mt-1`} defaultValue="any">
              {DATE_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FilterLabel>Last Action Date</FilterLabel>
            <select className={`${selectCls} mt-1`} defaultValue="any">
              {DATE_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="border-t border-court-border bg-court-surface-subtle p-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
            >
              Quick Search
            </button>
            <span className="text-xs font-medium text-court-fg-muted">
              {total.toLocaleString()} Candidate{total === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </aside>

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
          <tbody className="divide-y divide-court-border-soft">
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-5 py-12 text-center text-sm text-court-fg-muted"
                >
                  No candidates yet
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr
                key={c.id}
                className="h-12 transition hover:bg-court-accent-tint/40"
              >
                <td className="w-10 px-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${c.name}`}
                    className="h-4 w-4 cursor-pointer accent-brand"
                  />
                </td>
                <td className="px-3 font-medium text-court-fg">
                  <Link
                    href={`/candidates/${c.id}`}
                    className="hover:text-court-accent-dark"
                  >
                    {c.name}
                  </Link>
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
                <td className="px-3 text-court-fg-muted">{c.lastApply}</td>
                <td className="px-3 text-court-fg-muted">{c.lastAction}</td>
                <td className="px-3 text-center text-court-fg-muted">—</td>
                <td className="w-10 px-3 text-right">
                  <Link
                    href={`/candidates/${c.id}`}
                    aria-label={`View ${c.name}`}
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
    </div>
  );
}
