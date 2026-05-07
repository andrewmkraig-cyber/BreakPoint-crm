import type { ReactNode } from "react";
import { SettingsNav } from "@/app/settings/settings-nav";

// Two-column shell shared by every /settings/<category> route. Left
// rail = vertical nav (active item highlighted via Court Mode
// tokens). Right column = whatever each category page renders.
//
// Page title ("Settings") now lives in the global TopBar via
// TopBarPageTitle, so this layout no longer renders a separate
// header — the lg sidebar shows just the nav, and on narrow widths
// the topbar's title is the only header.
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <aside className="hidden lg:sticky lg:top-24 lg:block lg:w-56 lg:shrink-0">
        <SettingsNav />
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
