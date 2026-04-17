"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Search, Loader2, ExternalLink, ShieldCheck, MapPin, Briefcase } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { cn } from "@/lib/utils";

export type ClientCard = {
  id: number;
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
  agreementDate: string | null;
  feePct: number | null;
  billingContact: string | null;
  submittedCount: number;
  interviewingCount: number;
  hiredCount: number;
  statusName: string | null;
};

type Props = {
  cards: ClientCard[];
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
  q: string;
  tab: "active" | "inactive";
  activeCount: number;
  inactiveCount: number;
  verifiedCount: number;
  error: string | null;
};

export function ClientsView({
  cards,
  total,
  page,
  totalPages,
  pageSize,
  q,
  tab,
  activeCount,
  inactiveCount,
  verifiedCount,
  error,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(q);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setQuery(q);
  }, [q]);

  const buildHref = (overrides: Record<string, string | number | undefined>): string => {
    const next = new URLSearchParams(params?.toString() ?? "");
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === "" || v === null) next.delete(k);
      else next.set(k, String(v));
    }
    return `/clients?${next.toString()}`;
  };

  function onSubmitSearch(e: FormEvent) {
    e.preventDefault();
    startTransition(() => {
      router.push(buildHref({ q: query, page: 1 }));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start gap-3 md:flex-row md:items-center">
        <Tabs tab={tab} activeCount={activeCount} inactiveCount={inactiveCount} buildHref={buildHref} />
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          {total.toLocaleString()} {total === 1 ? "client" : "clients"}
          {q ? ` matching "${q}"` : ""}
        </span>
        {verifiedCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-brand-dark">
            <ShieldCheck className="h-3 w-3" /> {verifiedCount} verified
          </span>
        )}
      </div>

      <form
        onSubmit={onSubmitSearch}
        className="flex flex-col gap-2 rounded-xl border border-border bg-white p-3 shadow-sm md:flex-row md:items-center"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by client name, industry, or location…"
            className="w-full rounded-lg border border-transparent bg-muted py-2 pl-10 pr-3 text-sm text-navy placeholder:text-muted-foreground focus:border-brand focus:bg-white focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load clients.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.length === 0 && !error ? (
          <div className="col-span-full rounded-xl border border-border bg-white p-12 text-center text-sm text-muted-foreground">
            No clients{q ? ` match "${q}"` : ""}.
          </div>
        ) : (
          cards.map((c) => <Card key={c.id} card={c} />)
        )}
      </div>

      {total > 0 && (
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            buildHref={(p) => buildHref({ page: p })}
            label="clients"
          />
        </div>
      )}
    </div>
  );
}

function Tabs({
  tab,
  activeCount,
  inactiveCount,
  buildHref,
}: {
  tab: "active" | "inactive";
  activeCount: number;
  inactiveCount: number;
  buildHref: (overrides: Record<string, string | number | undefined>) => string;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-white p-1 shadow-sm">
      <TabLink label="Active" count={activeCount} active={tab === "active"} href={buildHref({ tab: "active", page: 1 })} />
      <TabLink label="Inactive" count={inactiveCount} active={tab === "inactive"} href={buildHref({ tab: "inactive", page: 1 })} />
    </div>
  );
}

function TabLink({ label, count, active, href }: { label: string; count: number; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-brand-tint text-brand-dark" : "text-navy-400 hover:bg-muted",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
          active ? "bg-brand text-white" : "bg-muted text-muted-foreground",
        )}
      >
        {count.toLocaleString()}
      </span>
    </Link>
  );
}

function Card({ card }: { card: ClientCard }) {
  return (
    <Link
      href={`/clients/${card.id}`}
      className="group flex flex-col rounded-xl border border-border bg-white p-5 shadow-sm transition hover:border-brand/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-serif text-lg font-semibold leading-tight text-navy group-hover:text-brand-dark">
            {card.name || "(unnamed)"}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {card.industry && <span>{card.industry}</span>}
            {card.industry && card.location && <span>·</span>}
            {card.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {card.location}
              </span>
            )}
          </div>
        </div>
        {card.website && (
          <span
            role="link"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(card.website!, "_blank", "noopener,noreferrer");
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:text-brand-dark"
          >
            Site <ExternalLink className="h-3 w-3" />
          </span>
        )}
      </div>

      {card.isVerified && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-dark">
            <ShieldCheck className="h-3 w-3" /> Verified · signed agreement
          </span>
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-center">
        <Stat label="Submitted" value={card.submittedCount} tone="brand" />
        <Stat label="Interviewing" value={card.interviewingCount} tone="blue" />
        <Stat label="Hired" value={card.hiredCount} tone="emerald" />
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Briefcase className="h-3 w-3" />
          {card.openJobsCount} open · {card.closedJobsCount} closed
        </span>
        {card.feePct != null && <span>Fee {card.feePct}%</span>}
      </div>
    </Link>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "brand" | "blue" | "emerald" }) {
  const cls = {
    brand: "text-brand-dark",
    blue: "text-blue-700",
    emerald: "text-emerald-700",
  }[tone];
  return (
    <div>
      <div className={cn("font-serif text-xl font-semibold", value > 0 ? cls : "text-muted-foreground/60")}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
