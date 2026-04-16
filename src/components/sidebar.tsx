"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Inbox,
  Briefcase,
  Building2,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand-mark";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/candidates", label: "Candidates", icon: Users },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-white md:flex md:flex-col">
      <div className="flex h-16 items-center border-b border-border px-5">
        <BrandMark withTag />
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-tint text-brand-dark"
                  : "text-navy-400 hover:bg-muted hover:text-navy",
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-brand-dark" : "text-navy-400")} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-4 text-[11px] uppercase tracking-wider text-muted-foreground">
        BreakPoint Talent
        <div className="mt-1 text-[10px] normal-case tracking-normal text-muted-foreground/80">
          Solon, OH &middot; Est. 2026
        </div>
      </div>
    </aside>
  );
}
