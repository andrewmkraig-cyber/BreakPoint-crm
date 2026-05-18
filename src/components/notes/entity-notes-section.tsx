import Link from "next/link";
import { Briefcase, Building2, StickyNote, User } from "lucide-react";

import { getNotesForEntity } from "@/lib/notes/queries";

// Server-rendered "Notes" section that lives in the activity feed on
// the per-entity profile pages. Reads the signed-in user's notes
// attached to {entityType, entityId} and renders them in the chrome
// the handoff specified: StickyNote icon, optional title, body
// clamped to 3 lines, timestamp. Loose notes (no attachment) never
// appear here — only notes whose foreign key matches the entity.
export async function EntityNotesSection({
  entityType,
  entityId,
}: {
  entityType: "candidate" | "client" | "job";
  entityId: string;
}) {
  const notes = await getNotesForEntity(entityType, entityId);
  if (notes.length === 0) return null;

  return (
    <section className="rounded-2xl bg-court-surface shadow-sm">
      <div className="flex items-center gap-2 border-b border-court-border px-5 py-3">
        <StickyNote className="h-4 w-4 text-court-fg-muted" />
        <h2 className="font-serif text-base font-semibold text-court-fg">
          Notes
        </h2>
        <span className="text-xs text-court-fg-muted">
          {notes.length} {notes.length === 1 ? "note" : "notes"}
        </span>
        <Link
          href={
            entityType === "candidate"
              ? "/notes?filter=attached"
              : entityType === "client"
                ? "/notes?filter=attached"
                : "/notes?filter=attached"
          }
          className="ml-auto text-[11px] font-medium text-court-fg-muted transition hover:text-court-fg"
        >
          View all
        </Link>
      </div>
      <ul className="divide-y divide-court-border">
        {notes.map((n) => (
          <li key={n.id} className="px-5 py-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-court-surface-subtle text-court-fg-muted">
                <StickyNote className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                {n.title && (
                  <div className="text-sm font-semibold text-court-fg">
                    {n.title}
                  </div>
                )}
                <div
                  className="text-sm text-court-fg/90"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {n.body}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-court-fg-muted">
                  <time dateTime={n.updatedAt.toISOString()}>
                    {formatStamp(n.updatedAt)}
                  </time>
                  {n.pinned && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-court-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-court-brand-dark">
                      Pinned
                    </span>
                  )}
                  {renderOtherAttachments(n, entityType)}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Always render chips for ANY attachment on the note that isn't the
// page we're currently on. On a candidate page that's a no-op since
// notes are exclusive to one foreign key, but the helper keeps the
// renderer symmetric if mutual exclusion ever relaxes.
function renderOtherAttachments(
  n: Awaited<ReturnType<typeof getNotesForEntity>>[number],
  current: "candidate" | "client" | "job",
) {
  const chips: React.ReactNode[] = [];
  if (current !== "candidate" && n.candidate) {
    const name =
      [n.candidate.firstName, n.candidate.lastName].filter(Boolean).join(" ") ||
      "Candidate";
    chips.push(
      <Link
        key="cand"
        href={`/candidates/${n.candidate.id}`}
        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:underline"
      >
        <User className="h-3 w-3" /> {name}
      </Link>,
    );
  }
  if (current !== "client" && n.client) {
    chips.push(
      <Link
        key="cli"
        href={`/clients/${n.client.id}`}
        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:underline"
      >
        <Building2 className="h-3 w-3" /> {n.client.name}
      </Link>,
    );
  }
  if (current !== "job" && n.job) {
    chips.push(
      <Link
        key="job"
        href={`/jobs/${n.job.id}`}
        className="inline-flex items-center gap-1 rounded-full bg-court-brand-tint px-2 py-0.5 text-[11px] font-medium text-court-brand-dark hover:underline"
      >
        <Briefcase className="h-3 w-3" /> {n.job.title}
      </Link>,
    );
  }
  return chips;
}

function formatStamp(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
