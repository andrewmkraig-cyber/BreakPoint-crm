"use client";

import { cn } from "@/lib/utils";
import type { InstantlyDailyPoint } from "@/lib/instantly/types";

// Daily trend for a campaign.
//
// Hand-rolled CSS bars, matching the charting convention already in the
// app (the quarterly revenue bars in components/finances/revenue-cards
// and the Submitted -> Placed funnel on the Scoreboard). There is no
// charting library in this project and this does not add one: track +
// fill, Court tokens, no hardcoded colors.
//
// Sent is the track-height driver; genuine replies overlay it in brand
// tint. Auto-replies are deliberately NOT drawn - they are not replies,
// and mixing them into this chart is exactly the conflation the reply
// rate rule forbids.

type Metric = "sent" | "replies";

export function DailyTrendChart({
  daily,
  className,
}: {
  daily: InstantlyDailyPoint[];
  className?: string;
}) {
  if (daily.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-court-border bg-court-surface-subtle/40 px-6 py-10 text-center text-xs text-court-fg-muted">
        No daily activity in this range.
      </div>
    );
  }

  const val = (d: InstantlyDailyPoint, m: Metric) =>
    m === "sent" ? (d.sent ?? 0) : (d.replies ?? 0);

  const maxSent = Math.max(...daily.map((d) => val(d, "sent")), 0);
  const totalSent = daily.reduce((a, d) => a + val(d, "sent"), 0);
  const totalReplies = daily.reduce((a, d) => a + val(d, "replies"), 0);

  // Every day at zero would render a row of flat stubs that reads as
  // broken. Fall back to a plain summary line instead.
  if (maxSent === 0) {
    return (
      <div className="rounded-xl border border-dashed border-court-border bg-court-surface-subtle/40 px-6 py-10 text-center text-xs text-court-fg-muted">
        No emails sent across these {daily.length} days.
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-court-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-court-surface-subtle ring-1 ring-court-border" />
          Sent ({totalSent.toLocaleString("en-US")})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-court-brand-tint ring-1 ring-court-brand/40" />
          Genuine replies ({totalReplies.toLocaleString("en-US")})
        </span>
        <span className="text-court-fg-muted/70">Auto-replies excluded</span>
      </div>

      {/* Horizontal scroll on narrow viewports rather than squashing the
          bars to invisibility. */}
      <div className="overflow-x-auto">
        <div className="flex h-40 min-w-full items-end gap-1" style={{ minWidth: daily.length * 22 }}>
          {daily.map((d) => {
            const sent = val(d, "sent");
            const replies = val(d, "replies");
            const sentPct = maxSent > 0 ? (sent / maxSent) * 100 : 0;
            // Replies are drawn relative to the same scale as sent, so
            // the visual comparison is honest. On a 1% reply rate this
            // is a sliver - that is the true picture, not a bug.
            const replyPct = maxSent > 0 ? (replies / maxSent) * 100 : 0;
            return (
              <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div
                  className="relative flex w-full flex-1 items-end justify-center"
                  title={`${d.date}: ${sent} sent, ${replies} genuine replies`}
                >
                  {sent === 0 ? null : (
                    <div className="relative h-full w-full max-w-[18px] overflow-hidden rounded-md bg-transparent">
                      <div
                        className="absolute inset-x-0 bottom-0 rounded-md bg-court-surface-subtle"
                        style={{ height: `${sentPct}%`, minHeight: 3 }}
                      />
                      {replies > 0 && (
                        <div
                          className="absolute inset-x-0 bottom-0 rounded-md bg-court-brand-tint"
                          style={{ height: `${Math.max(replyPct, 2)}%` }}
                        />
                      )}
                    </div>
                  )}
                </div>
                <div className="w-full truncate text-center text-[9px] tabular-nums text-court-fg-muted">
                  {d.date.slice(5)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
