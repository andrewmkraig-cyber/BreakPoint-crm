"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabStripItem<TId extends string = string> = {
  id: TId;
  label: string;
  count?: number;
  href?: string;
};

type Common<TId extends string> = {
  items: ReadonlyArray<TabStripItem<TId>>;
  activeId: TId;
  ariaLabel?: string;
  className?: string;
  /** Stretches each tab so the strip fills its parent (used by narrow split-view sidebars). */
  fullWidth?: boolean;
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
  const { items, activeId, ariaLabel, className, fullWidth } = props;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex flex-wrap items-center gap-1",
        fullWidth && "flex w-full",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        const sharedClass = cn(
          "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[13px] transition-colors",
          fullWidth && "flex-1 justify-center",
          active
            ? "border-court-brand bg-transparent font-semibold text-court-brand"
            : "border-transparent bg-transparent font-medium text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg",
        );
        const body = (
          <>
            <span>{item.label}</span>
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
