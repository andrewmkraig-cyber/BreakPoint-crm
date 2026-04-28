import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { listGmailThreads, type MailListThread } from "@/lib/gmail";
import { MailView } from "@/app/mail/mail-view";
import { ComposeNewEmailButton } from "@/components/mail/compose-new-email-button";
import { listActiveTemplates, type ActiveTemplateSummary } from "@/app/email/actions";

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

  return (
    <div>
      <PageHeader
        eyebrow="Inbox"
        title="Mail"
        description="Your Gmail inbox — read-only for now. Reply composer ships next."
        actions={
          <ComposeNewEmailButton
            templates={templates}
            currentUserFirstName={myFirstName}
            currentUserFullName={myFullName}
          />
        }
      />
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
