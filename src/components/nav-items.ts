import type React from "react";
import {
  Home,
  Users,
  GitBranch,
  Briefcase,
  Building2,
  Megaphone,
  Mail,
  Phone,
  Receipt,
  Calendar,
  Settings,
  StickyNote,
  BarChart3,
  Trophy,
} from "lucide-react";

// Single source of truth for the primary nav rows shared by the desktop
// Sidebar and the mobile hamburger drawer (MobileNav). The two used to
// keep independent copies of this list, which meant the per-icon rainbow
// `iconColor` map only existed on desktop and silently drifted from
// mobile. Lifting the data here (data only — no rendering chrome) lets
// both consume the same hrefs, labels, icons, AND colors so they can
// never diverge again. Each component still owns its own NavLink chrome.
//
// The per-icon accent colors are Tailwind palette tokens (not raw hex) so
// they inherit Court Mode theme inversion. They are applied only to
// INACTIVE rows — active rows keep the high-contrast sidebar foreground so
// the lit-up state still reads. Order is the explicit recruiter-workflow
// scan order Andrew wants (no alphabetizing): Pipeline leads ATS because
// that's where the active deals live; Placements leads Scoreboard because
// the dollar number is the headline KPI.

export type NavItemData = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
};

export type NavGroupData = {
  title: string | null;
  items: ReadonlyArray<NavItemData>;
};

export const NAV_GROUPS: ReadonlyArray<NavGroupData> = [
  {
    title: "Home",
    items: [
      { href: "/dashboard", label: "Clubhouse", icon: Home, iconColor: "text-emerald-400" },
    ],
  },
  {
    title: "Communication",
    items: [
      { href: "/mail", label: "Mail", icon: Mail, iconColor: "text-red-400" },
      { href: "/phone", label: "Phone", icon: Phone, iconColor: "text-teal-400" },
      { href: "/calendar", label: "Calendar", icon: Calendar, iconColor: "text-orange-400" },
    ],
  },
  {
    title: "ATS",
    items: [
      { href: "/pipeline", label: "Pipeline", icon: GitBranch, iconColor: "text-sky-400" },
      { href: "/candidates", label: "Candidates", icon: Users, iconColor: "text-violet-400" },
      { href: "/jobs", label: "Jobs", icon: Briefcase, iconColor: "text-indigo-400" },
    ],
  },
  {
    title: "CRM",
    items: [
      { href: "/bd", label: "BD", icon: Megaphone, iconColor: "text-rose-400" },
      { href: "/clients", label: "Clients", icon: Building2, iconColor: "text-cyan-400" },
    ],
  },
  {
    title: "Ops",
    items: [
      { href: "/finances", label: "Finances", icon: Receipt, iconColor: "text-lime-400" },
      { href: "/notes", label: "Notes", icon: StickyNote, iconColor: "text-yellow-400" },
    ],
  },
  {
    title: "Scoreboard",
    items: [
      { href: "/dashboard?tab=placements", label: "Placements", icon: Trophy, iconColor: "text-emerald-400" },
      { href: "/dashboard?tab=scoreboard", label: "Metrics", icon: BarChart3, iconColor: "text-fuchsia-400" },
    ],
  },
];

// Settings is pinned at the bottom of both navs, flowing out of the main
// nav as a normal row (no divider boxing it into its own section). Kept
// separate from NAV_GROUPS so each consumer can pin it where it belongs:
// the desktop sidebar renders it in its own bottom <nav> above the profile
// card; the mobile drawer renders it after the groups, above the theme
// toggle.
export const FOOTER_NAV: ReadonlyArray<NavItemData> = [
  { href: "/settings", label: "Settings", icon: Settings, iconColor: "text-slate-400" },
];
