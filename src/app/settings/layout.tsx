import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { SettingsNav } from "@/app/settings/settings-nav";

// Two-column shell shared by every /settings/<category> route. Left
// rail = vertical nav (active item highlighted via Court Mode
// tokens). Right column = whatever each category page renders.
//
// Mirrors the visual rules the old single-page Settings had: the
// "Admin / Settings" eyebrow + serif title block sits at the top of
// the rail on lg, and a stripped-down PageHeader stands in for it on
// narrow screens where the rail collapses out of view.
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <div className="lg:hidden">
        <PageHeader
          eyebrow="Admin"
          title="Settings"
          description="Preferences and reusable email templates."
        />
      </div>

      <aside className="hidden lg:sticky lg:top-24 lg:block lg:w-56 lg:shrink-0">
        <div className="mb-6 border-b border-court-border pb-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-court-accent-dark">
            Admin
          </div>
          <h1 className="mt-1 font-serif text-2xl font-semibold text-court-fg">
            Settings
          </h1>
        </div>
        <SettingsNav />
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
