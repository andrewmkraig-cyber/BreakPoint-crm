"use client";

import { Pencil } from "lucide-react";
import { useComposerManager } from "@/lib/composer-manager";
import type { ActiveTemplateSummary } from "@/app/email/actions";

// Page-header "Compose new email" button for /mail. Sits in the
// PageHeader actions slot above the three-pane mail layout, mirroring
// the Post New Job / New Client / New Candidate buttons on those
// pages so the recruiter has the same "primary action lives at top
// right" muscle memory across the app.
//
// Routes through useComposerManager so the launched composer is
// hoisted to the application shell — same path the global compose
// FAB uses. That means the new email survives navigation, can be
// minimized to the tray, and respects the non-blocking modal
// behavior the rest of the app relies on.
export function ComposeNewEmailButton({
  templates,
  currentUserFirstName,
  currentUserFullName,
}: {
  templates: ActiveTemplateSummary[];
  currentUserFirstName: string;
  currentUserFullName: string;
}) {
  const composer = useComposerManager();
  return (
    <button
      type="button"
      onClick={() => {
        composer.open({
          defaultTo: "",
          templates,
          mergeContext: {
            user: {
              firstName: currentUserFirstName,
              fullName: currentUserFullName,
            },
          },
          modalTitle: "New email",
          nonBlocking: true,
        });
      }}
      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-400 bg-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-300"
    >
      <Pencil className="h-3.5 w-3.5" />
      Compose new email
    </button>
  );
}
