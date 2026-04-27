"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { useComposerManager } from "@/lib/composer-manager";
import type { ActiveTemplateSummary } from "@/app/email/actions";

// Floating "Compose email" action button mounted at the application
// shell so it's reachable from every signed-in surface. Context
// awareness: when the current pathname is /candidates/[id], the button
// fetches the candidate's email via the existing
// /api/mail/candidate-context endpoint and prefills the composer's To
// field. Other surfaces open a blank composer.
//
// Templates + the signed-in user's name come from /api/mail/compose-init
// (cached at module scope so subsequent FAB clicks are instant). Same
// pattern the click-to-email popup launcher already uses.

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

export function ComposeFAB() {
  const pathname = usePathname();
  const composer = useComposerManager();
  const [contextEmail, setContextEmail] = useState("");
  const [contextRef, setContextRef] = useState("");
  const [opening, setOpening] = useState(false);

  // Resolve a candidate email when the user is on /candidates/[id].
  // The candidate-context endpoint accepts either cuid or legacy rfId,
  // so passing the path segment as-is works for both.
  useEffect(() => {
    if (!pathname) {
      setContextEmail("");
      setContextRef("");
      return;
    }
    const m = pathname.match(/^\/candidates\/([^/]+)/);
    if (!m) {
      setContextEmail("");
      setContextRef("");
      return;
    }
    const ref = decodeURIComponent(m[1]);
    setContextRef(ref);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/mail/candidate-context/${encodeURIComponent(ref)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as
          | { candidate?: { email?: string } }
          | null;
        if (!cancelled && body?.candidate?.email) {
          setContextEmail(body.candidate.email);
        }
      } catch {
        // Silent: FAB still works without prefill.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  async function onClick() {
    if (opening) return;
    setOpening(true);
    try {
      const init = await fetchInit();
      composer.open({
        defaultTo: contextEmail,
        defaultSubject: "",
        templates: init.templates,
        candidateRef: contextRef || undefined,
        mergeContext: {
          user: {
            firstName: init.user.firstName,
            fullName: init.user.fullName,
          },
        },
      });
    } finally {
      setOpening(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Compose email"
      title="Compose email"
      className="group fixed right-6 bottom-6 z-[1000] flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#438631] active:bg-[#39762A] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(79,154,58,0.35)]"
      style={{ background: "#4F9A3A" }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0 bottom-full mb-2 whitespace-nowrap rounded-md bg-court-fg px-2 py-1 text-xs font-medium text-court-surface opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      >
        Compose email
      </span>
      <Plus className="h-7 w-7" strokeWidth={2.5} />
    </button>
  );
}
