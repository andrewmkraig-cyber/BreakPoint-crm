"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useTransition } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { useComposerManager } from "@/lib/composer-manager";
import { usePhonePanels } from "@/lib/phone-panels-context";
import type { ActiveTemplateSummary } from "@/app/email/actions";
import { DASHBOARD_TAB_LABELS, resolveDashboardTab } from "@/app/dashboard/tabs";
import { createBlankInvoiceAction } from "@/app/invoices/actions";

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
  | { kind: "phone-dial"; label: string }
  | { kind: "new-invoice"; label: string };

type Spec = { group?: string; title: TitleSpec; action?: ActionSpec };

// Sidebar-group label rendered as a muted breadcrumb prefix before the
// page title ("Ops > Calendar"). Mirrors NAV_GROUPS in
// src/components/sidebar.tsx — duplicated here so this module stays a
// pure consumer of the pathname without importing the sidebar tree.
function resolveGroup(pathname: string): string | undefined {
  if (
    pathname.startsWith("/pipeline")
    || pathname.startsWith("/applicants")
    || pathname.startsWith("/candidates")
  ) {
    return "ATS";
  }
  if (
    pathname.startsWith("/jobs")
    || pathname.startsWith("/clients")
    || pathname.startsWith("/bd")
  ) {
    return "CRM";
  }
  if (pathname.startsWith("/mail") || pathname.startsWith("/phone")) {
    return "Inbox";
  }
  if (pathname.startsWith("/invoices")) {
    return "Ops";
  }
  return undefined;
}

function resolveSpec(
  pathname: string | null,
  searchParams: URLSearchParams | null,
): Spec {
  const base = resolveBaseSpec(pathname, searchParams);
  if (!pathname) return base;
  const group = resolveGroup(pathname);
  return group ? { ...base, group } : base;
}

function resolveBaseSpec(
  pathname: string | null,
  searchParams: URLSearchParams | null,
): Spec {
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

  if (pathname === "/invoices") {
    return {
      title: { label: "Invoices" },
      action: { kind: "new-invoice", label: "New Invoice" },
    };
  }
  if (/^\/invoices\/[^/]+/.test(pathname)) {
    return { title: { label: "Invoices", href: "/invoices" } };
  }

  if (pathname === "/pipeline") return { title: { label: "Pipeline" } };
  if (pathname === "/applicants") return { title: { label: "Applicants" } };
  if (pathname === "/dashboard") {
    const tab = resolveDashboardTab(searchParams?.get("tab"));
    return { title: { label: DASHBOARD_TAB_LABELS[tab] } };
  }
  if (pathname.startsWith("/settings")) return { title: { label: "Settings" } };

  return { title: { label: "" } };
}

// Action chip ("+ New Job" / "+ Compose" / etc.) sits to the right
// of the page title in the topbar. Reads as a secondary affordance
// next to the larger serif title rather than equal weight.
const ACTION_BUTTON_CLASS =
  "inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-court-brand bg-court-brand-tint px-2 py-1 text-[11px] font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25";

// `useSearchParams()` requires the closest parent to be a
// <Suspense> boundary in Next.js 14 — without it, the hook causes
// the entire tree to bail out of static rendering and can throw at
// runtime. TopBar mounts on every page, not just /dashboard, so the
// crash showed up app-wide once `useSearchParams` was added here.
// The exported component wraps the search-params-reading internals
// in Suspense so callers don't need to know.
export function TopBarPageTitle() {
  return (
    <Suspense fallback={null}>
      <TopBarPageTitleInner />
    </Suspense>
  );
}

// Sibling renderer for the +Add affordance. The TopBar positions this
// to the right of the search bar (not in the title cluster) so the
// action stays adjacent to the search affordance instead of trailing
// the page title. Returns null on pages that don't have an action.
export function TopBarPageAction() {
  return (
    <Suspense fallback={null}>
      <TopBarPageActionInner />
    </Suspense>
  );
}

function TopBarPageTitleInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const spec = resolveSpec(pathname, searchParams);

  if (!spec.title.label) return null;

  // Every page title runs on the Bricolage display face (font-serif
  // → --font-display) so the topbar reads in the same family as the
  // Ace wordmark. The group breadcrumb prefix uses the same family but
  // muted + regular weight so the current page reads as the dominant
  // term.
  const titleStyle = {
    fontSize: "26px",
    letterSpacing: "-0.035em",
    lineHeight: 1.15,
  };
  const groupClass = "font-serif font-medium text-court-fg-muted";
  const titleClass = "font-serif font-extrabold text-court-fg";

  return (
    <div className="flex min-w-0 items-center gap-2">
      {spec.group && (
        <>
          <span className={groupClass} style={titleStyle}>
            {spec.group}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-court-fg-muted" />
        </>
      )}
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
    </div>
  );
}

function TopBarPageActionInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const spec = resolveSpec(pathname, searchParams);
  if (!spec.action) return null;
  return <ActionButton action={spec.action} />;
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
  if (action.kind === "new-invoice") {
    return <NewInvoiceTopBarButton label={action.label} />;
  }
  return null;
}

function NewInvoiceTopBarButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await createBlankInvoiceAction({});
          if (result.ok) router.push(`/invoices/${result.data.id}`);
        })
      }
      className={ACTION_BUTTON_CLASS}
    >
      <Plus className="h-3 w-3" />
      {pending ? "Creating…" : label}
    </button>
  );
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
