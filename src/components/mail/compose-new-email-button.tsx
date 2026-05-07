"use client";

import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useComposerManager } from "@/lib/composer-manager";
import type { ActiveTemplateSummary } from "@/app/email/actions";

// Page-header "Compose new email" button for /mail. Wraps the shared
// Button component so the brand-tinted primary surface follows whatever
// Court Mode is active, instead of a one-off button styling.
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
    <Button
      variant="primary"
      size="sm"
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
    >
      <Pencil className="h-3.5 w-3.5" />
      Compose new email
    </Button>
  );
}
