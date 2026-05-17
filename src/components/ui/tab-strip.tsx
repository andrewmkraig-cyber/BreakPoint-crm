"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabStripItem<TId extends string = string> = {
  id: TId;
  label: string;
  count?: number;
  href?: string;
  // Small brand-green pip after the label — used to signal "this tab
  // has something to show" when there's no count to render (e.g. the
  // Client Benefits tab when agreement info exists but no files are
  // uploaded yet).
  dot?: boolean;
};

type Common<TId extends string> = {
  items: ReadonlyArray<TabStripItem<TId>>;
  activeId: TId;
  ariaLabel?: string;
  className?: string;
  /** Stretches each tab so the strip fills its parent (used by narrow split-view sidebars). */
  fullWidth?: boolean;
  /**
   * "default" — bordered chip with subtle bg (existing app-wide tabs).
   * "underline" — opt-in flat style: 2px brand bottom border on active, no pill bg.
   *   Used by /pipeline. Other consumers stay on "default" so this change
   *   doesn't ripple through Dashboard / Jobs / Applicants / etc.
   */
  variant?: "default" | "underline";
};

type ControlledProps<TId extends string> = Common<TId> & {
  onChange: (id: TId) => void;
};

type LinkProps<TId extends string> = Common<TId> & {
  onChange?: undefined;
};

export function TabStrip<TId extends string = string>(
  props: ControlledProps<TId> | LinkProps<TId>,
) {
  const { items, activeId, ariaLabel, className, fullWidth, variant = "default" } = props;
  const isUnderline = variant === "underline";

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex flex-wrap items-center gap-1",
        fullWidth && "flex w-full",
        isUnderline && "gap-0 border-b border-court-border",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        const sharedClass = isUnderline
          ? cn(
              // Underline variant: flat, no chip bg, 2px brand-dark
              // bottom border when active. -mb-px tucks the active
              // border underneath the strip's own border so the seam
              // reads as one line, not two.
              "inline-flex items-center gap-1 -mb-px border-b-2 px-3 py-2 text-[13px] transition-colors",
              fullWidth && "flex-1 justify-center",
              active
                ? "border-court-brand-dark font-semibold text-court-brand-dark"
                : "border-transparent font-medium text-court-fg-muted hover:text-court-fg",
            )
          : cn(
              "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[13px] transition-colors",
              fullWidth && "flex-1 justify-center",
              active
                ? "border-court-brand bg-transparent font-semibold text-court-brand"
                : "border-transparent bg-transparent font-medium text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg",
            );
        const body = (
          <>
            <span>{item.label}</span>
            {item.dot && (
              <span
                aria-hidden
                className={cn(
                  "ml-0.5 inline-block h-1.5 w-1.5 rounded-full",
                  active ? "bg-court-brand" : "bg-court-brand/60",
                )}
              />
            )}
            {typeof item.count === "number" && (
              <span
                className={cn(
                  "ml-0.5 inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  active
                    ? "bg-court-brand-tint text-court-brand-dark"
                    : "bg-court-surface-subtle text-court-fg-muted",
                )}
              >
                {item.count.toLocaleString()}
              </span>
            )}
          </>
        );

        if (item.href && !props.onChange) {
          return (
            <Link
              key={item.id}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              href={item.href}
              scroll={false}
              className={sharedClass}
            >
              {body}
            </Link>
          );
        }

        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() =>
              props.onChange ? props.onChange(item.id) : undefined
            }
            className={sharedClass}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
