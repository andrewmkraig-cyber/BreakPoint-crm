import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listGmailThreads, type MailListThread } from "@/lib/gmail";
import { MailView } from "@/app/mail/mail-view";
import { ComposeNewEmailButton } from "@/components/mail/compose-new-email-button";
import { listActiveTemplates, type ActiveTemplateSummary } from "@/app/email/actions";
import { getGmailStatus } from "@/lib/connectors";
import { ConnectorBanner } from "@/components/connector-banner";

// Read-only Mail Tab foundation (Phase 6.0). The left-rail thread list
// is server-rendered so the first paint shows real inbox content
// without an extra round-trip — the client component hydrates and
// manages the right-pane thread detail via /api/mail/threads/[id].
//
// Every thread call hits Google with the signed-in user's own refresh
// token, so there is no risk of cross-user or cross-org reads — the
// per-user Account row is the tenant boundary here.
export const dynamic = "force-dynamic";

export default async function MailPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return (
      <div className="p-6 text-sm text-court-fg-muted">
        Sign in to view your inbox.
      </div>
    );
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return (
      <div className="p-6 text-sm text-court-fg-muted">
        User row missing — sign out and back in to re-link your account.
      </div>
    );
  }

  let threads: MailListThread[] = [];
  let error: string | null = null;
  let templates: ActiveTemplateSummary[] = [];
  // Ace 28.0: pre-flight Gmail health so the banner can decide whether
  // to surface a Reconnect prompt at the top of the page. The check
  // runs in parallel with the inbox fetch so a healthy mailbox doesn't
  // pay the extra round-trip — Gmail status hits the Google token
  // endpoint, listGmailThreads hits the Gmail REST API, both ~150ms.
  const [gmailStatus] = await Promise.all([getGmailStatus(user.id)]);
  try {
    [threads, templates] = await Promise.all([
      listGmailThreads(user.id, { maxResults: 50 }),
      listActiveTemplates(),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load Gmail inbox";
  }

  // Resolve the current user's name so the composer can fill the
  // {{user.first_name}} / {{user.full_name}} merge fields without
  // another round-trip. UserProfile.fullName wins over User.name so
  // Andrew can display a branded name without touching his Google
  // account profile.
  const userRow = await prisma.user.findUnique({
    where: { id: user.id },
    select: { name: true, profile: { select: { fullName: true } } },
  });
  const myFullName = userRow?.profile?.fullName?.trim() || userRow?.name?.trim() || "";
  const myFirstName = myFullName.split(/\s+/)[0] ?? "";

  // Viewport-bounded flex column so the inbox sidebar + thread list +
  // detail pane fit the visible area exactly without the page itself
  // scrolling. A small negative top margin claws back part of the
  // AppShell gutter so the compact mail header sits closer to the
  // TopBar without going flush; height adds the same amount back so
  // the bottom edge stays inside the gutter. The mail page uses an
  // inline compact header (smaller than the global PageHeader) since
  // Mail is a workspace tool, not a content page.
  return (
    <div className="-mt-2 flex h-[calc(100vh-7.5rem)] flex-col md:-mt-4 md:h-[calc(100vh-8rem)]">
      <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-3">
        <div>
          <h1 className="font-serif text-xl font-semibold text-court-fg">Mail</h1>
          <p className="text-xs text-court-fg-muted">Gmail inbox and client conversations.</p>
        </div>
        <ComposeNewEmailButton
          templates={templates}
          currentUserFirstName={myFirstName}
          currentUserFullName={myFullName}
        />
      </div>
      {gmailStatus.state !== "connected" ? (
        <ConnectorBanner
          variant="gmail-down"
          message={`Gmail ${gmailStatus.state === "degraded" ? "looks degraded" : "disconnected"} — emails cannot be sent or received. ${gmailStatus.detail}`}
        />
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Couldn&rsquo;t load your inbox.</p>
          <p className="mt-1 text-xs">{error}</p>
          <p className="mt-2 text-xs">
            If this says the Gmail read scope isn&rsquo;t granted, sign out and sign back in —
            the new <code>gmail.readonly</code> scope was added in this release.
          </p>
        </div>
      ) : (
        <MailView
          threads={threads}
          currentUserEmail={session.user.email}
          templates={templates}
          currentUserFirstName={myFirstName}
          currentUserFullName={myFullName}
        />
      )}
    </div>
  );
}
