// Canonical job lifecycle resolution — the single source of truth shared by
// the /jobs Active/Private/Inactive tabs and every job picker (bulk email,
// candidate Apply/Keep). A row's stored `lifecycle` column wins; legacy rows
// that predate the column (no lifecycle) fall back to the isOpen mapping.
//
// Keep this in one place so a picker can never drift from what the Jobs page
// shows as "Active" (e.g. isOpen=true also covers the "private" lifecycle, so
// an isOpen-only filter would leak private/inactive jobs into a picker).

export type JobLifecycle = "active" | "private" | "inactive";

export function resolveJobLifecycle(
  rawLifecycle: string | null | undefined,
  isOpen: boolean,
): JobLifecycle {
  if (rawLifecycle === "private") return "private";
  if (rawLifecycle === "inactive") return "inactive";
  return isOpen ? "active" : "inactive";
}

// True only for jobs the /jobs Active tab would show. Pass the raw shim row's
// `_lifecycle` carry-along and its isOpen flag.
export function isActiveJobLifecycle(
  rawLifecycle: string | null | undefined,
  isOpen: boolean,
): boolean {
  return resolveJobLifecycle(rawLifecycle, isOpen) === "active";
}
