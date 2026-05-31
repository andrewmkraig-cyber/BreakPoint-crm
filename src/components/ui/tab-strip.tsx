"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
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

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Proximity hover. The tab nearest the cursor (by horizontal distance)
  // eases up to scale(1.04) and gains a faint court-brand tint, falling off
  // over a ~100px radius. We mutate inline transform + an inset box-shadow
  // directly from a rAF-throttled mousemove handler, so it's pure GPU compositing
  // - it never reflows or pushes sibling tabs - and it leaves the active pill's
  // border/text classes untouched (active tabs scale but get no tint). The whole
  // effect is gated behind prefers-reduced-motion: reduce.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === "undefined") return;

    const RADIUS = 100; // px horizontal falloff
    const MAX_SCALE = 0.04; // nearest tab -> scale(1.04)
    const MAX_TINT = 0.14; // nearest inactive tab -> court-brand alpha

    const clearAll = () => {
      container
        .querySelectorAll<HTMLElement>("[data-proximity-tab]")
        .forEach((el) => {
          el.style.transform = "";
          el.style.boxShadow = "";
        });
    };

    let raf = 0;
    let lastX = 0;
    let lastY = 0;

    const apply = () => {
      raf = 0;
      const tabs = container.querySelectorAll<HTMLElement>(
        "[data-proximity-tab]",
      );
      tabs.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        // Horizontal distance drives the effect; a vertical guard keeps a
        // wrapped second row from lighting up while the cursor is on row one.
        const offRow = Math.abs(lastY - cy) > rect.height;
        let t = offRow ? 0 : 1 - Math.abs(lastX - cx) / RADIUS;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const te = t * t; // ease-in so only genuinely-near tabs react
        if (te === 0) {
          el.style.transform = "";
          el.style.boxShadow = "";
          return;
        }
        el.style.transform = `scale(${1 + MAX_SCALE * te})`;
        el.style.boxShadow =
          el.dataset.proximityActive === "true"
            ? ""
            : `inset 0 0 0 100px rgb(var(--court-brand) / ${(
                MAX_TINT * te
              ).toFixed(3)})`;
      });
    };

    const onMove = (e: MouseEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clearAll();
    };

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const wire = () => {
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
      clearAll();
      if (!mq.matches) {
        container.addEventListener("mousemove", onMove);
        container.addEventListener("mouseleave", onLeave);
      }
    };
    wire();
    mq.addEventListener("change", wire);

    return () => {
      mq.removeEventListener("change", wire);
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
      clearAll();
    };
  }, []);

  return (
    <div
      ref={containerRef}
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
          "relative inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[13px] transition-[transform,box-shadow,color,background-color,border-color] duration-150 ease-out will-change-transform",
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
              data-proximity-tab
              data-proximity-active={active ? "true" : undefined}
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
            data-proximity-tab
            data-proximity-active={active ? "true" : undefined}
            className={sharedClass}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
