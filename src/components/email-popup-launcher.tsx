"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";
import type { ActiveTemplateSummary } from "@/app/email/actions";
import type { MailMergeContext } from "@/lib/mail-merge-fields";
import { useComposerManager } from "@/lib/composer-manager";
import { cn } from "@/lib/utils";

// Click-to-email popup launcher. Defers to the global ComposerManager
// (mounted in Providers) so the opened composer survives navigation
// away from the page that triggered it — important now that the
// composer can be minimized to a tray and the recruiter expects
// drafts to stick around as they move between profiles.
//
// First click on any launcher fetches /api/mail/compose-init for
// templates + the signed-in user's first/full name. Result is cached
// at module scope so subsequent click-to-email opens are instant.

type InitPayload = {
  templates: ActiveTemplateSummary[];
  user: { firstName: string; fullName: string };
};

let cachedInit: Promise<InitPayload> | null = null;

function fetchInit(): Promise<InitPayload> {
  if (cachedInit) return cachedInit;
  cachedInit = (async () => {
    const res = await fetch("/api/mail/compose-init");
    if (!res.ok) {
      cachedInit = null;
      throw new Error(`compose-init failed (${res.status})`);
    }
    return (await res.json()) as InitPayload;
  })();
  return cachedInit;
}

export function EmailPopupLauncher({
  email,
  children,
  className,
  context,
  defaultSubject = "",
  onSent,
}: {
  email: string | null | undefined;
  children?: ReactNode;
  className?: string;
  // Caller-provided merge context. The launcher adds {{user.*}} from
  // the init fetch; everything else (candidate / job / client) is the
  // caller's responsibility since it's surface-specific.
  context?: Omit<MailMergeContext, "user">;
  defaultSubject?: string;
  onSent?: () => void;
}) {
  const composer = useComposerManager();
  const [opening, setOpening] = useState(false);
  const trimmed = (email ?? "").trim();

  async function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!trimmed || opening) return;
    setOpening(true);
    try {
      const init = await fetchInit();
      composer.open({
        defaultTo: trimmed,
        defaultSubject,
        templates: init.templates,
        mergeContext: {
          ...(context ?? {}),
          user: {
            firstName: init.user.firstName,
            fullName: init.user.fullName,
          },
        },
        onSent,
      });
    } catch (err) {
      toast.error("Couldn't open composer", {
        description: err instanceof Error ? err.message : "unknown error",
      });
    } finally {
      setOpening(false);
    }
  }

  return (
    <a
      // Kept href so middle-click / right-click "Copy link" still
      // produces something useful; the onClick prevents actual
      // navigation so no external mail client opens.
      href={trimmed ? `mailto:${trimmed}` : "#"}
      onClick={handleClick}
      className={cn("cursor-pointer", className)}
    >
      {children ?? trimmed}
    </a>
  );
}
