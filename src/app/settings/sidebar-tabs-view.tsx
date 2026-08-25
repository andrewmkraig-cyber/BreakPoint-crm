"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  TOGGLEABLE_NAV_ITEMS,
  isNavItemVisible,
} from "@/components/nav-items";
import { useSidebarTabs } from "@/lib/sidebar-tabs-context";
import { setSidebarTabVisibility } from "@/app/settings/preferences-actions";
import { ToggleRow } from "@/app/settings/preferences-view";

// ----------------------------------------------------------------
// SidebarTabsView — one switch per sidebar tab. Reuses ToggleRow from
// preferences-view so the shape, spacing, and save behavior match the
// Notification Preferences switches exactly.
//
// Hiding a tab is a DISPLAY change only. The route, page, API handlers,
// database tables, and cron jobs all stay live — a hidden tab still
// loads if you navigate straight to its URL. That's how BD is shelved
// without deleting any of it.
//
// Clubhouse and Settings aren't listed: they're marked `locked` in
// nav-items.ts and filtered out of TOGGLEABLE_NAV_ITEMS, so there's
// always a way home and always a way back to this screen.
//
// Save behavior mirrors onToggleMailNotifs: flip optimistically so the
// sidebar reacts instantly, then persist. A failed write rolls the
// switch back and toasts the error.
// ----------------------------------------------------------------

export function SidebarTabsView() {
  const { visibility, setTabVisible } = useSidebarTabs();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onToggle(key: string, next: boolean) {
    setTabVisible(key, next);
    setPendingKey(key);
    startSave(async () => {
      const result = await setSidebarTabVisibility(key, next);
      setPendingKey(null);
      if (!result.ok) {
        setTabVisible(key, !next);
        toast.error("Couldn't save setting", { description: result.error });
      }
    });
  }

  return (
    <div className="space-y-3">
      {TOGGLEABLE_NAV_ITEMS.map((item) => (
        <ToggleRow
          key={item.key}
          label={item.label}
          description={`Show ${item.label} in the sidebar. Hiding it leaves the page itself working - ${item.href} still opens if you go straight to the URL.`}
          checked={isNavItemVisible(item, visibility)}
          onChange={(next) => onToggle(item.key, next)}
          disabled={isPending && pendingKey === item.key}
        />
      ))}
    </div>
  );
}
