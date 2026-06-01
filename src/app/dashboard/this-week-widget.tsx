import { getWeekData } from "./this-week-data";
import { ThisWeekWidgetClient } from "./this-week-widget-client";

// Court-mode "This Week" widget on the Clubhouse tab. The server renders
// the current week (offset 0); the client owns the ‹ › paging state and
// calls the fetchWeekData server action to swap in other weeks. All
// fetch + label formatting lives in this-week-data.ts so SSR and
// hydration agree byte-for-byte and the action can reuse the same logic.

export async function ThisWeekWidget({
  orgId,
  selfPerson,
}: {
  orgId: string;
  selfPerson: { name: string | null; email: string | null };
}) {
  const initial = await getWeekData(orgId, selfPerson, 0);
  return <ThisWeekWidgetClient initial={initial} />;
}
