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
  candidateRef,
  defaultSubject = "",
  defaultBody,
  nonBlocking,
  onSent,
}: {
  email: string | null | undefined;
  children?: ReactNode;
  className?: string;
  // Caller-provided merge context. The launcher adds {{user.*}} from
  // the init fetch; everything else (candidate / job / client) is the
  // caller's responsibility since it's surface-specific.
  context?: Omit<MailMergeContext, "user">;
  // Set on candidate-profile launchers so the composer can fetch the
  // candidate's active applied jobs and either auto-load context (1
  // active job) or render the "Which job is this email about?"
  // dropdown (2+). Accepts cuid or legacy rfId — the smart-context
  // API resolves both. Phase 5A.2.
  candidateRef?: string;
  defaultSubject?: string;
  // Pre-fills the rich-text editor body. AI Workspace passes the
  // bubble's clean HTML so an email straight from a Game Plan keeps
  // its hyperlinks + bullets without dragging the dark theme along.
  defaultBody?: string;
  // Lets the caller override blocking behavior. Defaults to true so
  // launching a click-to-email popup doesn't dim the rest of Ace —
  // the recruiter can keep navigating with the composer floating.
  nonBlocking?: boolean;
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
        defaultBody,
        templates: init.templates,
        mergeContext: {
          ...(context ?? {}),
          user: {
            firstName: init.user.firstName,
            fullName: init.user.fullName,
          },
        },
        candidateRef,
        nonBlocking: nonBlocking ?? true,
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
