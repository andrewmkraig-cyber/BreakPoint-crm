"use client";

import { useRouter } from "next/navigation";
import { StickyNote } from "lucide-react";

import { TabStrip } from "@/components/ui/tab-strip";
import { NoteCard } from "@/components/notes/note-card";
import { NoteComposer } from "@/components/notes/note-composer";
import type { NoteFilter, NoteRow } from "@/lib/notes/queries";

type Counts = { all: number; mine: number; attached: number };

export function NotesView({
  initialNotes,
  counts,
  initialFilter,
}: {
  initialNotes: NoteRow[];
  counts: Counts;
  initialFilter: NoteFilter;
}) {
  const router = useRouter();

  function setFilter(id: NoteFilter) {
    const url = id === "all" ? "/notes" : `/notes?filter=${id}`;
    router.push(url, { scroll: false });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <TabStrip<NoteFilter>
          ariaLabel="Notes filter"
          activeId={initialFilter}
          onChange={setFilter}
          items={[
            { id: "all", label: "All Notes", count: counts.all },
            { id: "mine", label: "My Notes", count: counts.mine },
            { id: "attached", label: "Attached", count: counts.attached },
          ]}
        />
      </div>

      <NoteComposer />

      {initialNotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-court-surface p-12 text-center shadow-sm">
          <StickyNote className="h-6 w-6 text-court-fg-muted" />
          <p className="text-sm text-court-fg-muted">
            {initialFilter === "all"
              ? "No notes yet. Save one above to get started."
              : initialFilter === "mine"
                ? "No loose notes. Notes saved without an attachment land here."
                : "No attached notes. Use the Attach button on a note to pin it to a profile."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {initialNotes.map((n) => (
            <NoteCard key={n.id} note={n} />
          ))}
        </div>
      )}
    </div>
  );
}
