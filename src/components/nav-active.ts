import { resolveDashboardTab, type DashboardTab } from "@/app/dashboard/tabs";

// Single source of truth for sidebar + mobile-nav row active state.
// Clubhouse (/dashboard), Metrics (?tab=scoreboard), Placements
// (?tab=placements) and Goals (?tab=goals) share the same pathname, so a
// pathname-only check lights up all three together. Reading the resolved
// dashboard tab disambiguates them: Clubhouse is active only when no
// tab param (or an unknown one) is present, Metrics on tab=scoreboard,
// Placements on tab=placements, Goals on tab=goals. Every other nav row
// keeps the existing
// pathname-prefix match.
export function isNavItemActive(args: {
  href: string;
  pathname: string;
  // Parsed once by the caller via resolveDashboardTab(searchParams.get("tab"))
  // so we don't re-parse the search string per row.
  resolvedDashboardTab: DashboardTab;
}): boolean {
  const { href, pathname, resolvedDashboardTab } = args;

  // Dashboard-rooted hrefs are tab-discriminated. We don't pathname-prefix-
  // match on /dashboard because that would re-trip the all-three-light-up
  // bug for any nested /dashboard/* route added later.
  if (href === "/dashboard") {
    return pathname === "/dashboard" && resolvedDashboardTab === "dashboard";
  }
  if (href === "/dashboard?tab=scoreboard") {
    return (
      (pathname === "/dashboard" || pathname.startsWith("/dashboard/"))
      && resolvedDashboardTab === "scoreboard"
    );
  }
  if (href === "/dashboard?tab=placements") {
    return (
      (pathname === "/dashboard" || pathname.startsWith("/dashboard/"))
      && resolvedDashboardTab === "placements"
    );
  }
  if (href === "/dashboard?tab=goals") {
    return (
      (pathname === "/dashboard" || pathname.startsWith("/dashboard/"))
      && resolvedDashboardTab === "goals"
    );
  }

  // Non-dashboard rows: exact pathname or section prefix. Matches the
  // prior behavior so existing rows (Mail, Pipeline, Settings, etc.)
  // don't regress.
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Re-export resolveDashboardTab so nav callers don't have to import it
// separately alongside this helper — the two are always used together.
export { resolveDashboardTab };
export type { DashboardTab };
