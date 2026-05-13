// Shared Eastern-time date widget shown in the top-right of every
// Clubhouse tab (Clubhouse / Scoreboard / Placements / Financial
// Performance). Rendered by the dashboard page wrapper next to the
// tab strip so it sits at the very top of the page, above each tab's
// SectionHero. Court Mode tokens only.
function getCalendarDateParts(d: Date): {
  weekday: string;
  month: string;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).formatToParts(d);
  return {
    weekday: parts.find((p) => p.type === "weekday")?.value ?? "",
    month: parts.find((p) => p.type === "month")?.value ?? "",
    day: Number(parts.find((p) => p.type === "day")?.value ?? "0"),
  };
}

export function CalendarWidget() {
  const dateParts = getCalendarDateParts(new Date());
  return (
    <div className="hidden sm:block">
      <div className="inline-flex flex-col overflow-hidden rounded-2xl shadow-sm">
        <div className="bg-court-brand-tint px-3 py-1 text-center text-xs font-extrabold uppercase tracking-wide text-court-brand">
          {dateParts.weekday}
        </div>
        <div className="bg-court-surface px-4 py-2 text-center">
          <div className="text-xs font-medium uppercase tracking-wide text-court-fg-muted">
            {dateParts.month}
          </div>
          <div className="text-4xl font-black leading-none text-court-fg">
            {dateParts.day}
          </div>
        </div>
      </div>
    </div>
  );
}
