// The Clubhouse activity strip's URL param name. The strip itself now
// routes through the shared two-tier TimeRangeSelector (see
// @/components/ui/time-range-selector and @/lib/time-range); only this
// param key remains surface-specific so the activity window stays
// independent of the ?period= param Placements / Metrics share.
export const CLUBHOUSE_PERIOD_PARAM = "cbperiod";
