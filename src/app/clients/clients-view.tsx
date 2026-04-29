"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, LayoutGrid, List, Search } from "lucide-react";
import { ClientLogo } from "@/components/clients/client-logo";
import { PipelinePill } from "@/components/clients/pipeline-pill";

// Existing data shape — unchanged. Owned by the server side; the
// client-side renderer reads it directly. id is the Neon cuid (for
// the pipeline filter href); slug is the human URL segment.
export type ClientCard = {
  id: string;
  slug: string;
  legacyRfId: number | null;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  linkedIn: string | null;
  location: string;
  phone: string | null;
  openJobsCount: number;
  closedJobsCount: number;
  isVerified: boolean;
  isActive: boolean;
  feePct: number | null;
  submittedCount: number;
  interviewingCount: number;
  offerCount: number;
  pendingStartCount: number;
  hiredCount: number;
};

type ViewKind = "grid" | "list";

const PIPELINE_STAGES = [
  { key: "submitted", countField: "submittedCount" },
  { key: "interviewing", countField: "interviewingCount" },
  { key: "offer", countField: "offerCount" },
  { key: "pending_start", countField: "pendingStartCount" },
  { key: "hired", countField: "hiredCount" },
] as const;

type StageEntry = (typeof PIPELINE_STAGES)[number];

function ViewToggle({ view, onChange }: { view: ViewKind; onChange: (v: ViewKind) => void }) {
  return (
    <div className="inline-flex shrink-0 items-center rounded-full border border-court-border bg-court-surface p-0.5">
      {([
        { k: "grid" as const, label: "Grid", Icon: LayoutGrid },
        { k: "list" as const, label: "List", Icon: List },
      ]).map(({ k, label, Icon }) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            view === k ? "bg-ink text-white" : "text-court-fg-muted hover:text-court-fg"
          }`}
        >
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

// Inline shield SVG — kept distinct from lucide ShieldCheck so the
// design crop matches the spec exactly (slightly thicker stroke).
function ShieldCheck() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function ClientGridCard({ card }: { card: ClientCard }) {
  const activeStages = PIPELINE_STAGES.filter((s: StageEntry) => (card[s.countField] ?? 0) > 0);
  return (
    <Link
      href={`/clients/${card.slug}`}
      className="group relative flex cursor-pointer flex-col rounded-2xl border border-court-border bg-court-surface p-5 transition hover:border-brand/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
    >
      <div className="flex items-start gap-3">
        <ClientLogo domain={card.domain} name={card.name || "(unnamed)"} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate font-serif text-lg font-semibold text-court-fg">
              {card.name || "(unnamed)"}
            </h3>
            {card.isVerified && (
              <span title="Signed fee agreement on file" className="shrink-0 text-brand">
                <ShieldCheck />
              </span>
            )}
          </div>
          {(card.industry || card.location) && (
            <p className="mt-0.5 truncate text-xs text-court-fg-muted">
              {[card.industry, card.location].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {card.website && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(card.website!, "_blank", "noopener,noreferrer");
            }}
            className="shrink-0 rounded-full border border-court-border bg-court-surface px-2.5 py-1 text-[11px] font-medium text-court-fg-muted opacity-0 transition group-hover:opacity-100 hover:text-court-fg"
          >
            Site ↗
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {activeStages.length > 0 ? (
          activeStages.map((s) => (
            <PipelinePill
              key={s.key}
              stage={s.key}
              count={card[s.countField] ?? 0}
              href={`/pipeline?clientId=${card.id}&stage=${s.key}`}
            />
          ))
        ) : (
          <span className="text-xs italic text-court-fg-muted">No active pipeline</span>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-court-border pt-3 text-[11px] text-court-fg-muted">
        <span>
          Job status: <span className="font-semibold text-court-fg">{card.openJobsCount}</span> Open,{" "}
          <span className="font-semibold text-court-fg">{card.closedJobsCount}</span> closed
        </span>
        {card.feePct != null && (
          <span>
            Fee <span className="font-semibold text-court-fg">{card.feePct}%</span>
          </span>
        )}
      </div>
    </Link>
  );
}

function ClientListRowView({ card }: { card: ClientCard }) {
  const router = useRouter();
  const activeStages = PIPELINE_STAGES.filter((s: StageEntry) => (card[s.countField] ?? 0) > 0);
  return (
    <tr
      className="cursor-pointer transition hover:bg-brand/5"
      onClick={() => router.push(`/clients/${card.slug}`)}
    >
      <td className="px-5 py-3 align-middle">
        <div className="flex items-center gap-3">
          <ClientLogo domain={card.domain} name={card.name || "(unnamed)"} size={32} />
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-court-fg">{card.name || "(unnamed)"}</span>
            {card.isVerified && (
              <span className="text-brand" title="Signed fee agreement on file">
                <ShieldCheck />
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="px-5 py-3 align-middle text-sm text-court-fg-muted">{card.industry || ""}</td>
      <td className="px-5 py-3 align-middle text-sm text-court-fg-muted">{card.location || ""}</td>
      <td className="px-5 py-3 align-middle text-right text-sm">
        <span className="font-semibold text-court-fg">{card.openJobsCount}</span>
        <span className="text-court-fg-muted"> / {card.openJobsCount + card.closedJobsCount}</span>
      </td>
      <td className="px-5 py-3 align-middle">
        <div className="flex flex-wrap gap-1">
          {activeStages.length > 0 ? (
            activeStages.map((s) => (
              <PipelinePill
                key={s.key}
                stage={s.key}
                count={card[s.countField] ?? 0}
                href={`/pipeline?clientId=${card.id}&stage=${s.key}`}
              />
            ))
          ) : (
            <span className="text-xs italic text-court-fg-muted">—</span>
          )}
        </div>
      </td>
      <td className="px-5 py-3 align-middle text-right text-sm">
        {card.feePct != null ? (
          <span className="font-semibold text-court-fg">{card.feePct}%</span>
        ) : (
          <span className="text-court-fg-muted">—</span>
        )}
      </td>
      <td className="px-5 py-3 align-middle text-right">
        {card.website && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.open(card.website!, "_blank", "noopener,noreferrer");
            }}
            className="rounded-full border border-court-border px-2.5 py-1 text-[11px] font-medium text-court-fg-muted hover:text-court-fg"
          >
            Site ↗
          </button>
        )}
      </td>
    </tr>
  );
}

export function ClientsView({
  activeCards,
  inactiveCards,
  initialView = "grid",
  verifiedCount = 0,
  error = null,
}: {
  activeCards: ClientCard[];
  inactiveCards: ClientCard[];
  initialView?: ViewKind;
  verifiedCount?: number;
  error?: string | null;
}) {
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewKind>(initialView);

  const cards = tab === "active" ? activeCards : inactiveCards;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.industry ?? "").toLowerCase().includes(q) ||
        (c.location ?? "").toLowerCase().includes(q),
    );
  }, [cards, query]);

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* Header — owned by ClientsView now (page.tsx no longer renders
          PageHeader). Eyebrow + serif h1 + subtitle + New Client. */}
      {/* items-end pulls the action button down to the baseline of
          the description, putting it just above the search bar —
          matches PageHeader's behavior on /candidates and /jobs.
          Sizing also matches those two (px-3 py-1.5 text-xs) so the
          three create-buttons read as the same height. */}
      <div className="mb-7 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-court-fg-muted">
            Accounts
          </div>
          <h1 className="mt-2 font-serif text-4xl font-semibold text-court-fg">Clients</h1>
          <p className="mt-2 max-w-xl text-sm text-court-fg-muted">
            Active = an open job or a placement in the last 6 months. Verified shield means a signed fee agreement is on file.
          </p>
        </div>
        <Link
          href="/clients/new"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-emerald-400 bg-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-300"
        >
          <Building2 className="h-3 w-3" /> Create New Client
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-full border border-court-border bg-court-surface p-1">
          {([
            { k: "active" as const, l: "Active", n: activeCards.length },
            { k: "inactive" as const, l: "Inactive", n: inactiveCards.length },
          ]).map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k)}
              className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === t.k ? "bg-brand text-white" : "text-court-fg-muted hover:text-court-fg"
              }`}
            >
              {t.l}
              <span
                className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                  tab === t.k ? "bg-white/25 text-white" : "bg-court-surface-subtle text-court-fg"
                }`}
              >
                {t.n}
              </span>
            </button>
          ))}
        </div>

        <div className="relative min-w-[280px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-court-fg-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by client name, industry, or location..."
            className="h-10 w-full rounded-full border border-court-border bg-court-surface pl-10 pr-4 text-sm placeholder:text-court-fg-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </div>

        <ViewToggle view={view} onChange={setView} />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load clients.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-court-border bg-court-surface p-12 text-center text-sm text-court-fg-muted">
          No clients{query ? ` match "${query}"` : ""}.
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <ClientGridCard key={c.id} card={c} />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-court-border bg-court-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-court-border bg-court-surface-subtle text-[11px] uppercase tracking-wider text-court-fg-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Industry</th>
                  <th className="px-5 py-3 font-medium">Location</th>
                  <th className="px-5 py-3 text-right font-medium">Open</th>
                  <th className="px-5 py-3 font-medium">Pipeline</th>
                  <th className="px-5 py-3 text-right font-medium">Fee</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-court-border">
                {filtered.map((c) => (
                  <ClientListRowView key={c.id} card={c} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-3 text-xs text-court-fg-muted">
        <span>
          {filtered.length} {filtered.length === 1 ? "client" : "clients"}
          {query ? ` matching "${query}"` : ""}
        </span>
        {verifiedCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-brand-dark">
            <ShieldCheck /> {verifiedCount} verified
          </span>
        )}
      </div>
    </div>
  );
}
