import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  backfillClientGmailThreadTags,
  getFreshAccessToken,
  listTaggedThreadSummaries,
} from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Returns the client's tagged Gmail threads (one row per unique
// threadId, even when the same thread is tagged via multiple Contacts
// at this client) enriched with subject / from / date for the client
// Email tab. Org-scoped on the GmailThreadTag query.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Unknown user" }, { status: 401 });
  }
  const org = await getCurrentOrg();

  const loadTags = () =>
    prisma.gmailThreadTag.findMany({
      where: { organizationId: org.id, clientId: params.id },
      orderBy: { createdAt: "desc" },
      select: { threadId: true, createdAt: true },
    });
  let tags = await loadTags();
  if (tags.length === 0) {
    try {
      const client = await prisma.client.findFirst({
        where: { id: params.id, organizationId: org.id },
        select: {
          id: true,
          domain: true,
          contacts: { select: { emails: true } },
        },
      });
      if (client) {
        await backfillClientGmailThreadTags({
          userId: user.id,
          organizationId: org.id,
          clientId: client.id,
          addresses: client.contacts.flatMap((c) => c.emails),
          domains: [client.domain ?? ""],
        });
        tags = await loadTags();
      }
    } catch (err) {
      console.warn("[clients/email-threads] Gmail backfill failed", err);
    }
  }
  // Dedupe by threadId — keep the first occurrence (most recent
  // createdAt thanks to the orderBy above). A thread tagged through
  // two contacts at the same client should render once.
  const seen = new Set<string>();
  const threadIds: string[] = [];
  for (const t of tags) {
    if (seen.has(t.threadId)) continue;
    seen.add(t.threadId);
    threadIds.push(t.threadId);
  }
  if (threadIds.length === 0) {
    return NextResponse.json({ threads: [] });
  }

  let summaries: Awaited<ReturnType<typeof listTaggedThreadSummaries>> = [];
  try {
    const accessToken = await getFreshAccessToken(user.id);
    summaries = await listTaggedThreadSummaries(accessToken, threadIds);
  } catch {
    summaries = [];
  }

  // Sort by the actual most-recent-message date desc — newest email
  // at the top.
  const ordered = [...summaries].sort((a, b) =>
    (b.dateIso ?? "").localeCompare(a.dateIso ?? ""),
  );

  return NextResponse.json({ threads: ordered });
}
