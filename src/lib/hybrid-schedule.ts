export const HYBRID_SCHEDULE_OPTIONS = [
  { value: "1 day", label: "1" },
  { value: "2 days", label: "2" },
  { value: "2–3 days", label: "2–3" },
  { value: "3 days", label: "3" },
  { value: "4 days", label: "4" },
  { value: "Fridays off", label: "Fridays off" },
  { value: "Flexible", label: "Flexible" },
] as const;

export function isHybridSchedule(value: string): boolean {
  return HYBRID_SCHEDULE_OPTIONS.some((option) => option.value === value);
}
