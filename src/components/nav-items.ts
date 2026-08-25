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
  Wallet,
  Calendar,
  Settings,
  StickyNote,
  BarChart3,
  Trophy,
  Send,
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

// `key` is the stable identifier the persisted visibility setting is
// written against — NOT the href, because Placements and Metrics share
// the /dashboard?tab= href and would collide. Keys are also rename-safe:
// changing a label or href never orphans a stored toggle.
export type NavItemData = {
  key: string;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  // Visibility when the stored setting has no entry for this key. Absent
  // means shown. BD is the only row that ships hidden — the feature is
  // shelved, but every BD route, API handler, table, and cron stays live;
  // this is a sidebar-visibility flag and nothing more.
  defaultVisible?: boolean;
  // Locked rows always render and never appear in the Settings toggle
  // list. Clubhouse is the brand-mark target and the app's home, so
  // hiding it would strand the user with no way back.
  locked?: boolean;
};

export type NavGroupData = {
  title: string | null;
  items: ReadonlyArray<NavItemData>;
};

export const NAV_GROUPS: ReadonlyArray<NavGroupData> = [
  {
    title: "Home",
    items: [
      { key: "clubhouse", href: "/dashboard", label: "Clubhouse", icon: Home, iconColor: "text-emerald-400", locked: true },
    ],
  },
  {
    title: "Communication",
    items: [
      { key: "mail", href: "/mail", label: "Mail", icon: Mail, iconColor: "text-red-400" },
      { key: "phone", href: "/phone", label: "Phone", icon: Phone, iconColor: "text-teal-400" },
      { key: "calendar", href: "/calendar", label: "Calendar", icon: Calendar, iconColor: "text-orange-400" },
    ],
  },
  {
    title: "ATS",
    items: [
      { key: "pipeline", href: "/pipeline", label: "Pipeline", icon: GitBranch, iconColor: "text-sky-400" },
      { key: "candidates", href: "/candidates", label: "Candidates", icon: Users, iconColor: "text-violet-400" },
      { key: "jobs", href: "/jobs", label: "Jobs", icon: Briefcase, iconColor: "text-indigo-400" },
    ],
  },
  {
    title: "CRM",
    items: [
      { key: "clients", href: "/clients", label: "Clients", icon: Building2, iconColor: "text-cyan-400" },
      // Campaigns sits in the slot BD used to occupy. Read-only Instantly
      // monitoring; BD stays below it, still shelved and still hidden.
      { key: "campaigns", href: "/campaigns", label: "Campaigns", icon: Send, iconColor: "text-rose-400" },
      { key: "bd", href: "/bd", label: "BD", icon: Megaphone, iconColor: "text-rose-400", defaultVisible: false },
    ],
  },
  {
    title: "Ops",
    items: [
      { key: "invoices", href: "/invoices", label: "Invoices", icon: Receipt, iconColor: "text-lime-400" },
      { key: "expenses", href: "/expenses", label: "Expenses", icon: Wallet, iconColor: "text-amber-400" },
      { key: "notes", href: "/notes", label: "Notes", icon: StickyNote, iconColor: "text-pink-400" },
    ],
  },
  {
    title: "Scoreboard",
    items: [
      { key: "placements", href: "/dashboard?tab=placements", label: "Placements", icon: Trophy, iconColor: "text-emerald-400" },
      { key: "metrics", href: "/dashboard?tab=scoreboard", label: "Metrics", icon: BarChart3, iconColor: "text-fuchsia-400" },
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
  { key: "settings", href: "/settings", label: "Settings", icon: Settings, iconColor: "text-slate-400", locked: true },
];

// ---------------------------------------------------------------------
// Sidebar tab visibility
//
// Which rows the sidebar renders is a display filter and NOTHING else.
// A hidden tab keeps its route, its page, its API handlers, its tables,
// and its cron jobs — navigating straight to the URL still works. This
// is how BD is shelved without deleting any of it.
//
// The stored setting (app.preferences.sidebarTabs) is SPARSE: it holds
// only explicit user overrides. Defaults live here on the items
// themselves, so an empty or missing setting row still hides BD and a
// tab added later inherits its own default instead of a stale blob.
// ---------------------------------------------------------------------

// key -> shown. Sparse: a missing key means "use the item's default".
export type SidebarTabVisibility = Record<string, boolean>;

export function isNavItemVisible(
  item: NavItemData,
  visibility: SidebarTabVisibility,
): boolean {
  // Locked rows ignore the setting entirely — they can't be turned off.
  if (item.locked) return true;
  const stored = visibility[item.key];
  if (typeof stored === "boolean") return stored;
  return item.defaultVisible !== false;
}

// NAV_GROUPS filtered down to what the sidebar should actually render.
// Groups whose every item is hidden are dropped so a section header
// never renders alone over an empty list.
export function resolveVisibleNavGroups(
  visibility: SidebarTabVisibility,
): ReadonlyArray<NavGroupData> {
  const out: NavGroupData[] = [];
  for (const group of NAV_GROUPS) {
    const items = group.items.filter((item) => isNavItemVisible(item, visibility));
    if (items.length > 0) out.push({ title: group.title, items });
  }
  return out;
}

// The rows the Settings "Sidebar Tabs" section offers a toggle for.
// Locked rows are excluded by construction, so Clubhouse (and Settings,
// which lives in FOOTER_NAV) can never be switched off.
export const TOGGLEABLE_NAV_ITEMS: ReadonlyArray<NavItemData> =
  NAV_GROUPS.flatMap((group) => group.items).filter((item) => !item.locked);
