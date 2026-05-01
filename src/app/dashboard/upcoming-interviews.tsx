import Link from "next/link";
import { CalendarClock, CalendarCog, MapPin, PhoneCall, Video } from "lucide-react";

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
  return (
    <section className="rounded-2xl border border-court-border bg-court-surface p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-sans text-lg font-semibold text-court-fg">Upcoming interviews</h2>
          <p className="text-sm text-court-fg-muted">Scheduled in the next 7 days.</p>
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
            // Whole row is now a Link into the edit-interview modal so
            // a single click anywhere on the interview opens the
            // edit / cancel / add-attendees flow on the candidate page
            // — recruiters were missing the small CalendarCog icon.
            // The Meet link is the one stop-propagation child since
            // it goes to a third-party URL in a new tab.
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
                  <CalendarCog
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-court-fg-muted"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
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
