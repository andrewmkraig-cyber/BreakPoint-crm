"use client";

import { Users, Send, MessageSquare, Percent, AlertTriangle, BotMessageSquare } from "lucide-react";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { formatCount, formatRate, type InstantlyHeadline } from "@/lib/instantly/metrics";

// Headline metrics row. Reuses the canonical KpiTile (the Clubhouse
// card-sizing reference) rather than inventing a stat card.
//
// Every number originates in /campaigns/analytics. None of it is counted
// from /emails.
//
// Auto-replies sit in a SEPARATE, visually secondary tile below the main
// row, explicitly labelled as excluded. They are never added into
// "Genuine replies" and never affect the reply rate - an out-of-office
// is not interest.

export function HeadlineStats({
  headline,
  scopeLabel,
  instantlyReplyCount,
}: {
  headline: InstantlyHeadline;
  scopeLabel: string;
  /** Instantly's own reply total for this scope, for the delta line. */
  instantlyReplyCount?: number;
}) {
  // Instantly counts our own replies to leads as replies. When the two
  // numbers differ, say so on the page rather than leaving it to be
  // discovered against Instantly's dashboard.
  const delta =
    typeof instantlyReplyCount === "number"
      ? instantlyReplyCount - headline.genuineReplies
      : 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile label="Leads contacted" value={formatCount(headline.leadsContacted)} icon={Users} />
        <KpiTile label="Emails sent" value={formatCount(headline.emailsSent)} icon={Send} />
        <KpiTile label="Genuine replies" value={formatCount(headline.genuineReplies)} icon={MessageSquare} />
        <KpiTile label="Reply rate" value={formatRate(headline.replyRate)} icon={Percent} />
        <KpiTile label="Bounce rate" value={formatRate(headline.bounceRate)} icon={AlertTriangle} />
      </div>

      {/* Secondary row: auto-replies, clearly fenced off from the
          headline numbers above. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-court-border/40 bg-court-surface-subtle/40 px-4 py-2.5">
        <BotMessageSquare aria-hidden="true" className="h-4 w-4 shrink-0 text-court-fg-muted" />
        <span className="text-sm font-semibold tabular-nums text-court-fg">
          {formatCount(headline.autoReplies)}
        </span>
        <span className="text-xs text-court-fg-muted">
          auto-replies (out-of-office and similar) - excluded from genuine replies and from reply rate
        </span>
        <span className="ml-auto text-[11px] text-court-fg-muted">
          {scopeLabel}
        </span>
      </div>

      {delta > 0 && (
        <p className="px-1 text-[11px] leading-relaxed text-court-fg-muted">
          Instantly reports {instantlyReplyCount} replies for this view.{" "}
          {delta} {delta === 1 ? "is" : "are"} your own repl
          {delta === 1 ? "y" : "ies"} to leads - Instantly reads them back out
          of the synced mailbox and counts them as inbound. Ace excludes them,
          so the number above is {headline.genuineReplies}.
        </p>
      )}
    </div>
  );
}
