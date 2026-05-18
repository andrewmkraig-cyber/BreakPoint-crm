import {
  getNoteCountsForUser,
  getNotesForUser,
  type NoteFilter,
} from "@/lib/notes/queries";

import { NotesView } from "./notes-view";

export const dynamic = "force-dynamic";

// Title + Ops breadcrumb live in the global TopBar via TopBarPageTitle,
// so the page starts directly with the composer card.
export default async function NotesPage({
  searchParams,
}: {
  searchParams?: { filter?: string };
}) {
  const filter: NoteFilter =
    searchParams?.filter === "mine"
      ? "mine"
      : searchParams?.filter === "attached"
        ? "attached"
        : "all";

  const [notes, counts] = await Promise.all([
    getNotesForUser(filter),
    getNoteCountsForUser(),
  ]);

  return <NotesView initialNotes={notes} counts={counts} initialFilter={filter} />;
}
