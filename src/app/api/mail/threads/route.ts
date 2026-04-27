import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listGmailThreads } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Mail Tab thread-list endpoint. Wraps listGmailThreads so the client
// can refetch the left-rail when the user switches between Inbox and
// a Gmail label without a full page reload. Same per-user refresh-token
// boundary as every other /api/mail/* route — no cross-user reads.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

  const labelIds = req.nextUrl.searchParams.getAll("labelIds");
  const q = req.nextUrl.searchParams.get("q") ?? undefined;

  // listGmailThreads defaults missing labelIds to ["INBOX"] for the
  // no-search case. When the caller explicitly omits labelIds while
  // passing a search query, that's the "search all mail" intent — we
  // pass an empty array so the helper's INBOX default doesn't kick in
  // and silently re-scope the search.
  const labelIdsForCall =
    labelIds.length > 0 ? labelIds : q ? [] : undefined;

  try {
    const threads = await listGmailThreads(user.id, {
      maxResults: 50,
      labelIds: labelIdsForCall,
      q,
    });
    return NextResponse.json({ threads });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load threads";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
