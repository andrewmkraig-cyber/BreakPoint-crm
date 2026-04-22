import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc";

export function SortableHeader({
  label,
  columnKey,
  activeKey,
  activeDir,
  buildHref,
  align = "left",
}: {
  label: string;
  columnKey: string;
  activeKey: string | null;
  activeDir: SortDirection;
  buildHref: (key: string, dir: SortDirection) => string;
  align?: "left" | "right" | "center";
}) {
  const isActive = activeKey === columnKey;
  const nextDir: SortDirection = isActive && activeDir === "asc" ? "desc" : "asc";
  const Icon = !isActive ? ArrowUpDown : activeDir === "asc" ? ArrowUp : ArrowDown;

  return (
    <Link
      href={buildHref(columnKey, nextDir)}
      className={cn(
        "group inline-flex items-center gap-1 transition-colors",
        align === "right" && "justify-end",
        align === "center" && "justify-center",
        isActive ? "text-court-fg" : "text-court-fg-muted hover:text-court-fg",
      )}
    >
      <span>{label}</span>
      <Icon
        className={cn(
          "h-3 w-3 transition-opacity",
          isActive ? "opacity-100" : "opacity-40 group-hover:opacity-80",
        )}
      />
    </Link>
  );
}
