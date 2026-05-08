"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useComposerManager } from "@/lib/composer-manager";
import { usePhonePanels } from "@/lib/phone-panels-context";
import type { ActiveTemplateSummary } from "@/app/email/actions";

// Pathname-driven page title rendered on the left side of the
// TopBar. Mirrors the Jobot pattern Andrew showed: the section title
// (Jobs / Candidates / Clients / Mail / Calls & Texts / etc.) sits in
// the topbar with an inline action button next to it ("+ New Job",
// "+ Compose", etc.). Drops the in-page PageHeader component on every
// primary surface; pages render their content flush with the topbar.
//
// Detail pages (/jobs/[id], /candidates/[id], /clients/[id]) show the
// section title (linked back to the list) without an action button —
// the page itself surfaces the per-record name.

type TitleSpec = {
  label: string;
  href?: string; // when set, the title is a link (typically back to the list)
};

type ActionSpec =
  | { kind: "link"; label: string; href: string }
  | { kind: "compose-mail"; label: string }
  | { kind: "phone-dial"; label: string };

function resolveSpec(
  pathname: string | null,
): { title: TitleSpec; action?: ActionSpec } {
  if (!pathname) return { title: { label: "" } };

  // Detail page → section title links back to the list
  if (/^\/jobs\/[^/]+/.test(pathname) && !pathname.startsWith("/jobs/new")) {
    return { title: { label: "Jobs", href: "/jobs" } };
  }
  if (/^\/candidates\/[^/]+/.test(pathname) && !pathname.startsWith("/candidates/new") && !pathname.startsWith("/candidates/lists")) {
    return { title: { label: "Candidates", href: "/candidates" } };
  }
  if (/^\/clients\/[^/]+/.test(pathname) && !pathname.startsWith("/clients/new")) {
    return { title: { label: "Clients", href: "/clients" } };
  }

  if (pathname === "/jobs") {
    return {
      title: { label: "Jobs" },
      action: { kind: "link", label: "New Job", href: "/jobs/new" },
    };
  }
  if (pathname === "/jobs/new") {
    return { title: { label: "New Job", href: "/jobs" } };
  }

  if (pathname === "/candidates") {
    return {
      title: { label: "Candidates" },
      action: { kind: "link", label: "New Candidate", href: "/candidates/new" },
    };
  }
  if (pathname === "/candidates/new") {
    return { title: { label: "New Candidate", href: "/candidates" } };
  }
  if (pathname === "/candidates/lists") {
    return { title: { label: "Candidate Lists", href: "/candidates" } };
  }

  if (pathname === "/clients") {
    return {
      title: { label: "Clients" },
      action: { kind: "link", label: "New Client", href: "/clients/new" },
    };
  }
  if (pathname === "/clients/new") {
    return { title: { label: "New Client", href: "/clients" } };
  }

  if (pathname === "/mail") {
    return {
      title: { label: "Mail" },
      action: { kind: "compose-mail", label: "Compose" },
    };
  }

  if (pathname === "/phone") {
    return {
      title: { label: "Calls & Texts" },
      action: { kind: "phone-dial", label: "New Text/Call" },
    };
  }

  if (pathname === "/pipeline") return { title: { label: "Pipeline" } };
  if (pathname === "/applicants") return { title: { label: "Applicants" } };
  if (pathname === "/dashboard") return { title: { label: "Activity Dashboard" } };
  if (pathname.startsWith("/settings")) return { title: { label: "Settings" } };

  return { title: { label: "" } };
}

const ACTION_BUTTON_CLASS =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25";

export function TopBarPageTitle() {
  const pathname = usePathname();
  const spec = resolveSpec(pathname);

  if (!spec.title.label) return null;

  // Dashboard gets the larger sans-serif treatment per the premium
  // dashboard pass; every other page keeps the existing serif chrome
  // so the topbar reads consistently across Jobs / Candidates / Mail.
  const isDashboard = pathname === "/dashboard";
  const titleClass = isDashboard
    ? "font-sans font-semibold text-court-fg"
    : "font-serif text-2xl font-semibold text-court-fg";
  const titleStyle = isDashboard
    ? { fontSize: "34px", letterSpacing: "-0.035em", lineHeight: 1.1 }
    : undefined;

  return (
    <div className="flex min-w-0 items-center gap-3">
      {spec.title.href ? (
        <Link
          href={spec.title.href}
          className={`${titleClass} transition hover:text-brand-dark`}
          style={titleStyle}
        >
          {spec.title.label}
        </Link>
      ) : (
        <h1 className={titleClass} style={titleStyle}>
          {spec.title.label}
        </h1>
      )}
      {spec.action ? <ActionButton action={spec.action} /> : null}
    </div>
  );
}

function ActionButton({ action }: { action: ActionSpec }) {
  if (action.kind === "link") {
    return (
      <Link href={action.href} className={ACTION_BUTTON_CLASS}>
        <Plus className="h-3 w-3" />
        {action.label}
      </Link>
    );
  }
  if (action.kind === "compose-mail") {
    return <ComposeMailButton label={action.label} />;
  }
  if (action.kind === "phone-dial") {
    return <PhoneDialButton label={action.label} />;
  }
  return null;
}

// Mail-compose trigger. Lazy-fetches /api/mail/compose-init the first
// time the recruiter clicks so the topbar doesn't pay the round-trip
// on every page load. Templates + the user's name come back together
// and feed the global composer manager. Cached at module scope to
// match how ComposeFAB does the same fetch.
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

function ComposeMailButton({ label }: { label: string }) {
  const composer = useComposerManager();
  const [busy, setBusy] = useState(false);

  // Pre-warm the templates fetch on mount so the first click is
  // instant. Failures stay silent — the click handler will retry.
  useEffect(() => {
    void fetchInit().catch(() => {});
  }, []);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      const init = await fetchInit();
      composer.open({
        defaultTo: "",
        defaultSubject: "",
        templates: init.templates,
        nonBlocking: true,
        mergeContext: {
          user: {
            firstName: init.user.firstName,
            fullName: init.user.fullName,
          },
        },
      });
    } catch {
      // Silent: composer manager toasts its own failures.
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={onClick} disabled={busy} className={ACTION_BUTTON_CLASS}>
      <Plus className="h-3 w-3" />
      {label}
    </button>
  );
}

function PhoneDialButton({ label }: { label: string }) {
  const phonePanels = usePhonePanels();
  return (
    <button
      type="button"
      onClick={phonePanels.openDialPad}
      className={ACTION_BUTTON_CLASS}
    >
      <Plus className="h-3 w-3" />
      {label}
    </button>
  );
}
