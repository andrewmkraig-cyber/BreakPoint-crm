import Link from "next/link";
import { CalendarClock, MapPin, PhoneCall, Video } from "lucide-react";

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

export function UpcomingInterviews({ rows }: { rows: UpcomingInterviewRow[] }) {
  return (
    <section className="rounded-xl border border-border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h2 className="font-serif text-base font-semibold text-navy">Upcoming interviews</h2>
          <p className="text-xs text-muted-foreground">Scheduled in the next 7 days.</p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-navy-400">
          <CalendarClock className="h-3 w-3" /> {rows.length}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Nothing on the calendar this week.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const Icon = r.type === "phone_screen" ? PhoneCall : r.type === "video" ? Video : MapPin;
            const when = new Date(r.scheduledAt);
            return (
              <li key={r.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={r.candidateHref}
                    className="truncate font-medium text-navy hover:text-brand-dark"
                  >
                    {r.candidateName}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.jobTitle}
                    {r.clientName ? ` · ${r.clientName}` : ""}
                    {r.source === "client_scheduled" ? " · Client-scheduled" : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm text-navy">{formatWhen(when)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.durationMin}m · {formatType(r.type)}
                  </div>
                </div>
                {r.meetLink && (
                  <a
                    href={r.meetLink}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-semibold text-navy hover:border-brand/40 hover:text-brand-dark"
                  >
                    Meet
                  </a>
                )}
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
