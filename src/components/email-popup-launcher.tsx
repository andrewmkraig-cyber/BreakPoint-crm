"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { MailComposer } from "@/app/mail/mail-composer";
import type { ActiveTemplateSummary } from "@/app/email/actions";
import type { MailMergeContext } from "@/lib/mail-merge-fields";
import { cn } from "@/lib/utils";

// Click-to-email popup that opens the full Mail Tab composer in a
// modal. Replaces the legacy EmailLink → EmailComposer flow for the
// surfaces that want the full Mail Tab feature set (templates, merge
// fields, attachments, inline image paste, Claude Generate).
//
// On first mount the launcher fetches /api/mail/compose-init for
// templates + the signed-in user's first/full name so the
// {{user.first_name}} / {{user.full_name}} merge fields always
// resolve regardless of which surface the popup was opened from.
// Result is cached at module scope so subsequent popups on the same
// page are instant.

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
  const [open, setOpen] = useState(false);
  const [init, setInit] = useState<InitPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || init) return;
    let cancelled = false;
    fetchInit()
      .then((p) => {
        if (!cancelled) setInit(p);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [open, init]);

  const trimmed = (email ?? "").trim();

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!trimmed) return;
    setOpen(true);
  }

  return (
    <>
      <a
        // Kept href so middle-click / right-click "Copy link" still
        // produces something useful; the onClick prevents actual
        // navigation so no external mail client opens.
        href={trimmed ? `mailto:${trimmed}` : "#"}
        onClick={onClick}
        className={cn("cursor-pointer", className)}
      >
        {children ?? trimmed}
      </a>
      {open && init && (
        <MailComposer
          asModal
          modalTitle="New email"
          defaultTo={trimmed}
          defaultSubject={defaultSubject}
          templates={init.templates}
          mergeContext={{
            ...(context ?? {}),
            user: {
              firstName: init.user.firstName,
              fullName: init.user.fullName,
            },
          }}
          onClose={() => setOpen(false)}
          onSent={() => {
            setOpen(false);
            onSent?.();
          }}
        />
      )}
      {open && !init && loadError && (
        <div
          role="alert"
          className="fixed inset-x-0 top-4 z-50 mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 shadow"
        >
          Couldn&rsquo;t open composer — {loadError}.{" "}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-2 underline hover:opacity-80"
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}
