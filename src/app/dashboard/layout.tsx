import type { ReactNode } from "react";

// Dashboard-only page background. The app shell paints `bg-court-bg`
// across the main column; this layer bleeds past <main>'s asymmetric
// padding (p-6 pl-3 / md:p-8 md:pl-4) and re-applies it so the warm
// sage tint covers the full content area in light mode. Dark mode
// stays transparent so the existing court tokens carry the page.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="-m-6 -ml-3 min-h-[calc(100vh-72px)] bg-[#F6FAF4] p-6 pl-3 dark:bg-transparent md:-m-8 md:-ml-4 md:p-8 md:pl-4">
      {children}
    </div>
  );
}
