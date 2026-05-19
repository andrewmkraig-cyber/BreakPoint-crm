// Single-source-of-truth client-side helper for the /api/calendar/sync
// round-trip. Same code path the manual Sync button on /calendar uses,
// reused by post-schedule auto-sync so the local CalendarEvent mirror
// catches the freshly-created Google event without the recruiter
// clicking Sync. Fire-and-forget: rejections are swallowed because the
// authoritative state already lives on Google's side - the local
// mirror is a UX convenience, not a correctness boundary.
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

export async function triggerCalendarSync(router: AppRouterInstance | null): Promise<void> {
  try {
    const res = await fetch("/api/calendar/sync", { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("Calendar sync failed", body);
    }
  } catch (err) {
    console.error("Calendar sync error", err);
  } finally {
    router?.refresh();
  }
}
