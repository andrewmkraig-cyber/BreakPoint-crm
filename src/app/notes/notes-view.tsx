"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StickyNote } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";

import { TabStrip } from "@/components/ui/tab-strip";
import { NoteCard } from "@/components/notes/note-card";
import { NoteComposer } from "@/components/notes/note-composer";
import { reorderNotes } from "@/app/notes/actions";
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
  const [notes, setNotes] = useState(initialNotes);

  // Keep local order in sync when the server sends a fresh page
  // (after add / edit / delete / filter change).
  useEffect(() => {
    setNotes(initialNotes);
  }, [initialNotes]);

  function setFilter(id: NoteFilter) {
    const url = id === "all" ? "/notes" : `/notes?filter=${id}`;
    router.push(url, { scroll: false });
  }

  // PointerSensor with a distance threshold means a drag only starts
  // after the cursor moves 8px while held — short clicks, button
  // clicks, and link clicks inside the card never accidentally start
  // a drag, and the underlying click handlers still fire. This is
  // what prevents the "stuck cursor / won't release" feeling: there
  // is no DragOverlay (just CSS transform on the card itself), and
  // every drag has a real pointerup that ends it.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = notes.findIndex((n) => n.id === active.id);
    const newIndex = notes.findIndex((n) => n.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(notes, oldIndex, newIndex);
    setNotes(next);
    void reorderNotes(next.map((n) => n.id));
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

      {notes.length === 0 ? (
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={notes.map((n) => n.id)}
            strategy={rectSortingStrategy}
          >
            <div className="flex flex-wrap items-start gap-4">
              {notes.map((n) => (
                <NoteCard key={n.id} note={n} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
