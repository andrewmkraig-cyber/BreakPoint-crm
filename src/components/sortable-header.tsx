import Link from "next/link";
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

  return (
    <Link
      href={buildHref(columnKey, nextDir)}
      className={cn(
        "inline-flex items-center transition-colors",
        align === "right" && "justify-end",
        align === "center" && "justify-center",
        isActive ? "text-court-fg" : "text-court-fg-muted hover:text-court-fg",
      )}
    >
      <span>{label}</span>
    </Link>
  );
}
