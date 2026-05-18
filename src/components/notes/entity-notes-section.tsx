import Link from "next/link";
import { Briefcase, Building2, StickyNote, User } from "lucide-react";

import { getNotesForEntity, type NoteRow } from "@/lib/notes/queries";

// Server-rendered "Notes" section rendered inside the activity feed on
// the per-entity profile pages. Reads the signed-in user's notes that
// have {entityType, entityId} in their attachment set and renders
// them in the chrome the spec calls for: StickyNote icon, optional
// title, body clamped to 3 lines, timestamp, plus chips for any
// *other* entities the same note is attached to.
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
          href="/notes?filter=attached"
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
                  {renderOtherAttachments(n, entityType, entityId)}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Renders chips for every attachment on the note that ISN'T the
// current entity. Lets the recruiter see "this note also lives on
// Acme Corp" while reading it inside the candidate profile.
function renderOtherAttachments(
  n: NoteRow,
  currentKind: "candidate" | "client" | "job",
  currentId: string,
) {
  const chips: React.ReactNode[] = [];
  for (const c of n.candidates) {
    if (currentKind === "candidate" && c.id === currentId) continue;
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "Candidate";
    chips.push(
      <Link
        key={`cand-${c.id}`}
        href={`/candidates/${c.id}`}
        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:underline"
      >
        <User className="h-3 w-3" /> {name}
      </Link>,
    );
  }
  for (const c of n.clients) {
    if (currentKind === "client" && c.id === currentId) continue;
    chips.push(
      <Link
        key={`cli-${c.id}`}
        href={`/clients/${c.id}`}
        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:underline"
      >
        <Building2 className="h-3 w-3" /> {c.name}
      </Link>,
    );
  }
  for (const j of n.jobs) {
    if (currentKind === "job" && j.id === currentId) continue;
    chips.push(
      <Link
        key={`job-${j.id}`}
        href={`/jobs/${j.id}`}
        className="inline-flex items-center gap-1 rounded-full bg-court-brand-tint px-2 py-0.5 text-[11px] font-medium text-court-brand-dark hover:underline"
      >
        <Briefcase className="h-3 w-3" /> {j.title}
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
