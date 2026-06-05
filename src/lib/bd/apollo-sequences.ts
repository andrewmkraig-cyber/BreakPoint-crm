// Single source of truth for the Apollo sequences Ace orchestrates.
// Sequences themselves are built in Apollo (step content, delays, etc.);
// Ace just records the apolloId so it can tell Apollo "enroll this
// contact into this sequence" and surface the linkage in /settings/bd.
//
// When a real sequence is added or rotated, edit this array — every BD
// surface reads from here.

export type ApolloSequenceStatus = "ACTIVE" | "PAUSED";

export type ApolloSequence = {
  // Display name shown in the BD settings table and saved-search picker.
  // Treated as the human handle; criteria.apolloSequenceId stores this
  // name string today (the dropdown options are names, not IDs).
  name: string;
  // Former display names this sequence has been known by. Saved searches
  // persist the sequence NAME in criteria.apolloSequenceId, so when the
  // display name changes the old string lives on in the DB — listing the
  // prior name here lets resolveSequenceDisplayName map it forward so
  // existing saved searches keep resolving to the current name.
  aliases?: string[];
  // Apollo's own identifier for the sequence — what /api/v1/contacts
  // receives as sequence_id on enrollment. Empty string means the
  // sequence hasn't been wired to Apollo yet (UI shows "Pending").
  apolloId: string;
  verticalName: string;
  steps: number;
  status: ApolloSequenceStatus;
};

export const APOLLO_SEQUENCES: ApolloSequence[] = [
  {
    name: "Tax BD Sequence",
    aliases: ["BD Outbound v1"],
    apolloId: "6a06068f8142ee001d2b3dd2",
    verticalName: "Public Accounting",
    steps: 5,
    status: "ACTIVE",
  },
];

export function getApolloSequenceByName(name: string): ApolloSequence | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return (
    APOLLO_SEQUENCES.find(
      (s) => s.name === trimmed || (s.aliases?.includes(trimmed) ?? false),
    ) ?? null
  );
}

// Resolve a stored sequence handle (current name, a former alias, or even
// the raw Apollo id) to the sequence's CURRENT display name. Unknown
// values pass through unchanged so legacy/unmapped strings still render.
export function resolveSequenceDisplayName(stored: string): string {
  const trimmed = stored.trim();
  if (!trimmed) return "";
  const match = getApolloSequenceByName(trimmed) ?? getApolloSequenceById(trimmed);
  return match?.name ?? trimmed;
}

export function getApolloSequenceById(id: string): ApolloSequence | null {
  const trimmed = id.trim();
  if (!trimmed) return null;
  return APOLLO_SEQUENCES.find((s) => s.apolloId === trimmed) ?? null;
}

// The default sequence the enroll step uses when neither the BDRun's
// plan nor the SavedSearch criteria pins a specific one. Today there is
// only one sequence, so this is unambiguous; later this can return null
// and the caller can fail loud.
export function getDefaultApolloSequence(): ApolloSequence | null {
  return APOLLO_SEQUENCES[0] ?? null;
}
