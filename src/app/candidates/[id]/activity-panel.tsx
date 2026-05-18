"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { cn } from "@/lib/utils";

// Collapsed accordion that lives below the resume on the candidate
// profile. Surfaces interview history (cancelled / completed /
// rescheduled) so the linked-job row above can stay a thin actionable
// strip showing only ACTIVE interviews. Future expansions will add
// call logs, sent emails, manual notes, and stage-change history —
// stubbed here as separate sections so the layout doesn't have to
// change later.

export type ActivityInterview = {
  id: string;
  scheduledAt: string;
  durationMin: number;
  type: "phone_screen" | "video" | "in_person";
  status: "scheduled" | "completed" | "cancelled" | "rescheduled";
  source: "ace_scheduled" | "client_scheduled";
  jobTitle: string;
  attendees: { name: string; email: string }[];
};

export function ActivityPanel({ interviews }: { interviews: ActivityInterview[] }) {
  const [open, setOpen] = useState(false);
  const past = interviews.filter((iv) => iv.status !== "scheduled");
  const counts = {
    cancelled: past.filter((iv) => iv.status === "cancelled").length,
    completed: past.filter((iv) => iv.status === "completed").length,
    rescheduled: past.filter((iv) => iv.status === "rescheduled").length,
  };
  const total = past.length;

  return (
    <section className="rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-court-fg-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-court-fg-muted" />
          )}
          <History className="h-4 w-4 text-court-fg-muted" />
          <h2 className="font-serif text-base font-semibold text-court-fg">Activity</h2>
          {total > 0 && (
            <span className="text-xs text-court-fg-muted">
              (
              {[
                counts.cancelled ? `${counts.cancelled} cancelled` : null,
                counts.completed ? `${counts.completed} completed` : null,
                counts.rescheduled ? `${counts.rescheduled} rescheduled` : null,
              ]
                .filter(Boolean)
                .join(", ") || `${total} items`}
              )
            </span>
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-court-border px-5 py-4 space-y-5">
          <ActivitySection title="Interview history" emptyText="No past interviews yet.">
            {past.length === 0 ? null : (
              <ul className="space-y-1.5">
                {past
                  .slice()
                  .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
                  .map((iv) => (
                    <InterviewHistoryRow key={iv.id} iv={iv} />
                  ))}
              </ul>
            )}
          </ActivitySection>
          <ActivitySection title="Calls" emptyText="No calls logged for this candidate yet." />
          <ActivitySection title="Emails sent" emptyText="No emails sent to this candidate yet." />
          <ActivitySection title="Notes & stage changes" emptyText="No notes or stage changes recorded yet." />
        </div>
      )}
    </section>
  );
}

function ActivitySection({
  title,
  emptyText,
  children,
}: {
  title: string;
  emptyText: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
        {title}
      </div>
      <div className="mt-1.5">{children ?? <p className="text-xs text-court-fg-muted">{emptyText}</p>}</div>
    </div>
  );
}

function InterviewHistoryRow({ iv }: { iv: ActivityInterview }) {
  const when = new Date(iv.scheduledAt);
  const statusLabel =
    iv.status === "cancelled"
      ? "Cancelled"
      : iv.status === "completed"
        ? "Completed"
        : iv.status === "rescheduled"
          ? "Rescheduled"
          : "Scheduled";
  const statusTone =
    iv.status === "cancelled"
      ? "bg-red-50 text-red-700 border-red-200"
      : iv.status === "completed"
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : "bg-amber-50 text-amber-700 border-amber-200";
  const formattedWhen = when.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-court-border/40 bg-court-surface-subtle/40 px-3 py-2 text-xs">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-court-fg">
          {formattedWhen} · {iv.durationMin}m · {formatType(iv.type)}
        </span>
        <span className="truncate text-[11px] text-court-fg-muted">
          {iv.jobTitle}
          {iv.attendees.length > 0 ? ` · with ${iv.attendees.map((a) => a.name).join(", ")}` : ""}
          {iv.source === "client_scheduled" ? " · Client-scheduled" : ""}
        </span>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
          statusTone,
        )}
      >
        {statusLabel}
      </span>
    </li>
  );
}

function formatType(t: ActivityInterview["type"]): string {
  if (t === "phone_screen") return "Phone Screen";
  if (t === "video") return "Video";
  return "In-Person";
}
