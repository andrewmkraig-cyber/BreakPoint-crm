"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, CalendarCog, MapPin, PhoneCall, Video } from "lucide-react";
import { InterviewInvitePopup } from "./interview-invite-popup";

export type UpcomingInterviewRow = {
  id: string;
  candidateName: string;
  candidateHref: string;
  jobTitle: string;
  clientName: string;
  scheduledAt: string;
  durationMin: number;
  type: "phone_screen" | "video" | "in_person";
  source: "ace_scheduled" | "client_scheduled";
  meetLink: string | null;
};

// Builds a deep-link to the candidate's profile that auto-opens the
// reschedule-interview modal pre-filled with this interview. The
// candidate page's placement-flows useEffect listens for
// `?edit=interview&interviewId=...`, opens the modal, and strips the
// params so refresh / back-nav don't re-fire.
function buildEditInterviewHref(candidateHref: string, interviewId: string): string {
  const sep = candidateHref.includes("?") ? "&" : "?";
  return `${candidateHref}${sep}edit=interview&interviewId=${encodeURIComponent(interviewId)}`;
}

export function UpcomingInterviews({ rows }: { rows: UpcomingInterviewRow[] }) {
  // The CalendarCog icon now opens an inline edit-and-resend popup
  // instead of routing to the candidate page. Whole-row click still
  // goes to the candidate page (reschedule / cancel flow lives there).
  const [popupRow, setPopupRow] = useState<UpcomingInterviewRow | null>(null);
  return (
    <section className="rounded-[32px] bg-white p-10 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_16px_40px_rgba(16,36,24,0.04)] dark:bg-court-surface">
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="font-semibold tracking-[-0.04em] text-court-fg"
            style={{ fontSize: "28px", lineHeight: 1.1 }}
          >
            Upcoming interviews
          </h2>
          <p
            className="mt-1 text-court-fg-muted"
            style={{ fontSize: "14px" }}
          >
            Scheduled in the next 7 days
          </p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full bg-court-surface-subtle px-2.5 py-0.5 text-[11px] font-semibold text-court-fg-muted">
          <CalendarClock className="h-3 w-3" /> {rows.length}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-2 py-10 text-center text-sm text-court-fg-muted">
          Nothing on the calendar this week.
        </div>
      ) : (
        <ul className="mt-2">
          {rows.map((r, idx) => {
            const Icon = r.type === "phone_screen" ? PhoneCall : r.type === "video" ? Video : MapPin;
            const when = new Date(r.scheduledAt);
            const isLast = idx === rows.length - 1;
            const editHref = buildEditInterviewHref(r.candidateHref, r.id);
            return (
              <li
                key={r.id}
                className={isLast ? "" : "border-b border-court-border"}
              >
                <Link
                  href={editHref}
                  aria-label={`Edit interview with ${r.candidateName}`}
                  className="flex items-center gap-4 rounded-lg px-2 py-4 transition hover:bg-court-surface-subtle/60"
                >
                  <Icon className="h-4 w-4 shrink-0 text-court-fg-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-court-fg">
                      {r.candidateName}
                    </div>
                    <div className="truncate text-xs text-court-fg-muted">
                      {[
                        r.jobTitle,
                        r.clientName || null,
                        r.source === "client_scheduled" ? "Client-scheduled" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold text-court-fg">{formatWhen(when)}</div>
                    <div className="text-xs text-court-fg-muted">
                      {r.durationMin}m · {formatType(r.type)}
                    </div>
                  </div>
                  {r.meetLink && (
                    <a
                      href={r.meetLink}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-semibold text-court-fg hover:border-court-accent/40 hover:text-court-accent-dark"
                    >
                      Meet
                    </a>
                  )}
                  <button
                    type="button"
                    aria-label="Edit calendar invite"
                    title="Edit calendar invite"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPopupRow(r);
                    }}
                    className="shrink-0 rounded-md border border-court-border bg-court-surface p-1.5 text-court-fg-muted transition hover:border-court-accent/40 hover:text-court-accent-dark"
                  >
                    <CalendarCog className="h-4 w-4" />
                  </button>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {popupRow && (
        <InterviewInvitePopup
          interviewId={popupRow.id}
          whenLabel={formatWhen(new Date(popupRow.scheduledAt))}
          jobLabel={[popupRow.jobTitle, popupRow.clientName].filter(Boolean).join(" · ")}
          onClose={() => setPopupRow(null)}
        />
      )}
    </section>
  );
}

function formatWhen(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatType(t: UpcomingInterviewRow["type"]): string {
  if (t === "phone_screen") return "Phone";
  if (t === "video") return "Video";
  return "Onsite";
}
