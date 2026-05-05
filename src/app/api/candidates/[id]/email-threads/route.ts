import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getFreshAccessToken, listTaggedThreadSummaries } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Returns the candidate's tagged Gmail threads enriched with subject /
// from / date for the candidate Activity tab email list. Org-scoped on
// the GmailThreadTag query; the Gmail fetch uses the signed-in user's
// own access token.
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

  const tags = await prisma.gmailThreadTag.findMany({
    where: { organizationId: org.id, candidateId: params.id },
    orderBy: { createdAt: "desc" },
    select: { threadId: true, createdAt: true },
  });
  const threadIds = tags.map((t) => t.threadId);
  if (threadIds.length === 0) {
    return NextResponse.json({ threads: [] });
  }

  let summaries: Awaited<ReturnType<typeof listTaggedThreadSummaries>> = [];
  try {
    const accessToken = await getFreshAccessToken(user.id);
    summaries = await listTaggedThreadSummaries(accessToken, threadIds);
  } catch {
    // Gmail unavailable / no scope / etc. — fall through with empty
    // summaries so the UI shows the same empty state instead of an
    // error.
    summaries = [];
  }

  // Preserve the GmailThreadTag.createdAt ordering (most recently
  // tagged first). Gmail's metadata fetch may reorder due to the
  // parallel Promise.all.
  const byId = new Map(summaries.map((s) => [s.threadId, s]));
  const ordered = threadIds
    .map((id) => byId.get(id))
    .filter(
      (s): s is NonNullable<typeof s> => s !== undefined,
    );

  return NextResponse.json({ threads: ordered });
}
