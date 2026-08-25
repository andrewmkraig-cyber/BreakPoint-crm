"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  BotMessageSquare,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InstantlyEmptyState, InstantlyErrorState } from "@/app/campaigns/instantly-states";

// Replies view - inbound only, newest first, read-only.
//
// Ace never replies from here. "Open in Instantly" deep-links to the
// Unibox thread (verified format: /app/unibox/{thread_id}?mode=...) so
// the actual response happens in Instantly.
//
// AUTO-REPLY HANDLING, the part that matters:
//   isAutoReply === true  -> confirmed auto-reply. Hidden unless the
//                            toggle is on; rendered clearly marked.
//   isAutoReply === false -> confirmed genuine.
//   isAutoReply === null  -> UNVERIFIED. The list endpoint does not
//                            carry the flag, so this row simply has not
//                            been classified yet. It renders with an
//                            explicit "Unverified" chip and is NEVER
//                            presented as a genuine reply.
//
// RATE BUDGET: classification costs one request per row against 20/min.
// The route enriches what the budget allows and reports the rest as
// pending with a retryAfterMs. This component schedules a single quiet
// refetch after that delay instead of blocking or spinning. The page is
// always usable, even fully unverified.

export type ReplyRow = {
  id: string;
  threadId: string | null;
  campaignId: string | null;
  leadEmail: string | null;
  fromEmail: string | null;
  subject: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string;
  receivedAt: string | null;
  isAutoReply: boolean | null;
  countsAsReply: boolean;
  isUnread: boolean;
  eaccount: string | null;
  threadUrl: string | null;
};

type Payload = {
  ok: true;
  replies: ReplyRow[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  enrichedCount: number;
  pendingCount: number;
  budgetExhausted: boolean;
  retryAfterMs: number;
  budgetRemaining: number;
};

type ErrPayload = { ok: false; kind: string; message: string; hint: string };

export function RepliesView({
  campaignOptions,
  initialCampaignId,
  lockCampaign = false,
}: {
  campaignOptions: { id: string; name: string }[];
  initialCampaignId?: string;
  /** Detail page: pin to one campaign and hide the picker entirely. */
  lockCampaign?: boolean;
}) {
  const [campaignId, setCampaignId] = useState<string>(initialCampaignId ?? "");
  const [showAuto, setShowAuto] = useState(false);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<ErrPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) setLoading(true);
      try {
        const sp = new URLSearchParams({
          page: String(page),
          includeAuto: String(showAuto),
        });
        if (campaignId) sp.set("campaignId", campaignId);
        const res = await fetch(`/api/instantly/replies?${sp}`);
        const json = (await res.json()) as Payload | ErrPayload;
        if (!json.ok) {
          setError(json);
          setData(null);
        } else {
          setError(null);
          setData(json);
        }
      } catch (e) {
        setError({
          ok: false,
          kind: "unavailable",
          message: e instanceof Error ? e.message : "Could not load replies.",
          hint: "Check your connection and try again.",
        });
      } finally {
        setLoading(false);
      }
    },
    [campaignId, page, showAuto],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Quiet re-enrichment: when rows came back unverified because the
  // /emails budget was spent, retry ONCE after the reported delay. No
  // spinner, no blocking - the rows are already on screen and readable.
  useEffect(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (!data || data.pendingCount === 0 || !data.budgetExhausted) return;
    const delay = Math.min(Math.max(data.retryAfterMs, 2000), 65_000);
    retryTimer.current = setTimeout(() => {
      void load({ quiet: true });
    }, delay);
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [data, load]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {/* Filters. Campaign picker + the auto-reply toggle. */}
      <div className="flex flex-wrap items-center gap-3">
        {!lockCampaign ? (
          <label className="flex items-center gap-2 text-xs text-court-fg-muted">
            Campaign
            <select
              value={campaignId}
              onChange={(e) => {
                setCampaignId(e.target.value);
                setPage(0);
              }}
              className="rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-xs text-court-fg"
            >
              <option value="">All campaigns</option>
              {campaignOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <Button
          type="button"
          variant={showAuto ? "secondary" : "ghost"}
          size="sm"
          onClick={() => {
            setShowAuto((v) => !v);
            setPage(0);
          }}
          aria-pressed={showAuto}
        >
          <BotMessageSquare className="h-3.5 w-3.5" />
          {showAuto ? "Hiding nothing - auto-replies shown" : "Show auto-replies"}
        </Button>

        {data && data.pendingCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-court-fg-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            {data.pendingCount} row{data.pendingCount === 1 ? "" : "s"} still
            unverified - checking again shortly
          </span>
        ) : null}
      </div>

      {error ? (
        <InstantlyErrorState kind={error.kind} message={error.message} hint={error.hint} />
      ) : loading ? (
        <RepliesSkeleton />
      ) : !data || data.replies.length === 0 ? (
        <InstantlyEmptyState title="No replies to show">
          {showAuto
            ? "No inbound replies for this filter yet."
            : "No genuine replies for this filter yet. Auto-replies are hidden - use Show auto-replies if you're looking for those."}
        </InstantlyEmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-court-border/40 bg-court-surface">
          <ul className="divide-y divide-court-border-soft">
            {data.replies.map((r) => (
              <ReplyItem
                key={r.id}
                reply={r}
                expanded={expanded.has(r.id)}
                onToggle={() => toggleExpand(r.id)}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Pager */}
      {data && (data.page > 0 || data.hasMore) ? (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={data.page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="text-[11px] text-court-fg-muted">Page {data.page + 1}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!data.hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ReplyItem({
  reply,
  expanded,
  onToggle,
}: {
  reply: ReplyRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const sender = displayName(reply.fromEmail ?? reply.leadEmail);
  const email = reply.fromEmail ?? reply.leadEmail ?? "";
  const company = companyFromEmail(email);

  return (
    <li className={cn("px-4 py-3", reply.isAutoReply === true && "bg-court-surface-subtle/40")}>
      <div className="flex items-start gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse reply" : "Expand reply"}
          className="!px-1 !py-0 shadow-none"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* One bold element per row: the sender name. */}
            <span className="font-semibold text-court-fg">{sender}</span>
            <span className="truncate text-xs text-court-fg-muted">{email}</span>
            {company ? (
              <span className="truncate text-xs text-court-fg-muted">· {company}</span>
            ) : null}
            <ReplyKindChip isAutoReply={reply.isAutoReply} />
          </div>

          <div className="mt-0.5 truncate text-sm text-court-fg">{reply.subject || "(no subject)"}</div>
          {!expanded ? (
            <div className="mt-0.5 truncate text-xs text-court-fg-muted">{reply.snippet}</div>
          ) : null}

          {expanded ? (
            <div className="mt-2 whitespace-pre-wrap rounded-lg bg-court-surface-subtle/60 p-3 text-xs leading-relaxed text-court-fg">
              {reply.bodyText?.trim() || reply.snippet || "(no body)"}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="whitespace-nowrap text-xs text-court-fg-muted">
            {formatReceived(reply.receivedAt)}
          </span>
          {reply.threadUrl ? (
            <a
              href={reply.threadUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface-subtle px-2.5 py-1 text-xs font-semibold text-court-fg transition hover:bg-court-surface"
            >
              <ExternalLink className="h-3 w-3" />
              Open in Instantly
            </a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

// The three-state chip. An unverified row must never read as genuine, so
// null gets its own explicit treatment rather than silently rendering
// like a confirmed real reply.
function ReplyKindChip({ isAutoReply }: { isAutoReply: boolean | null }) {
  if (isAutoReply === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-court-surface-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-court-fg-muted">
        <BotMessageSquare className="h-3 w-3" />
        Auto-reply
      </span>
    );
  }
  if (isAutoReply === null) {
    return (
      <span
        title="Not yet classified. Instantly's list endpoint doesn't include the auto-reply flag, so this row hasn't been checked yet."
        className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400"
      >
        <HelpCircle className="h-3 w-3" />
        Unverified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-court-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-court-brand-dark">
      Genuine
    </span>
  );
}

function RepliesSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-court-border/40 bg-court-surface">
      <ul className="divide-y divide-court-border-soft">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="px-4 py-3">
            <div className="h-3 w-40 animate-pulse rounded bg-court-surface-subtle" />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-court-surface-subtle" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function displayName(email: string | null): string {
  if (!email) return "Unknown sender";
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ") || email;
}

// Instantly returns no company field on an email row, so the sending
// domain is the best available proxy. Free-mail domains carry no company
// signal, so they render blank rather than "Gmail".
const FREE_MAIL = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "me.com", "live.com", "msn.com", "protonmail.com",
]);

function companyFromEmail(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || FREE_MAIL.has(domain)) return null;
  const base = domain.split(".")[0];
  if (!base) return null;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function formatReceived(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
