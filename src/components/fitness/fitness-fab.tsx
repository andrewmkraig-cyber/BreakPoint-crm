"use client";

import { BicepsFlexed } from "lucide-react";

import { useFitnessPanel } from "@/lib/fitness-panel-context";

export function FitnessFAB() {
  const { open, minimized, toggle } = useFitnessPanel();
  const active = open && !minimized;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Fitness"
      aria-pressed={active}
      className={
        "group relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-court-brand/40 " +
        (active
          ? "border-court-brand-dark bg-court-brand text-white hover:bg-court-brand-dark"
          : "border-court-brand bg-court-brand-tint text-court-brand-dark hover:bg-court-brand/30")
      }
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-md bg-court-fg px-2 py-1 text-xs font-medium text-court-surface opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      >
        Fitness
      </span>
      <BicepsFlexed className="h-5 w-5" strokeWidth={2.4} />
    </button>
  );
}
