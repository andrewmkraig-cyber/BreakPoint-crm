import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  respondToCalendarInvite,
  type InviteResponse,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

// Mail Tab RSVP endpoint. Answers a calendar invite (Yes / No / Maybe)
// straight from the thread view, mirroring Gmail's invite buttons. Scoped
// implicitly to the signed-in user's own Google account via their per-user
// OAuth refresh token, so there's no cross-tenant exposure. The event is
// resolved by its iCalendar UID against the user's primary calendar.
const VALID: InviteResponse[] = ["accepted", "declined", "tentative"];

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

  let body: { iCalUID?: unknown; response?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const iCalUID = typeof body.iCalUID === "string" ? body.iCalUID.trim() : "";
  const response = body.response as InviteResponse;
  if (!iCalUID || !VALID.includes(response)) {
    return NextResponse.json(
      { error: "Missing or invalid invite response." },
      { status: 400 },
    );
  }

  try {
    const result = await respondToCalendarInvite({
      userId: user.id,
      iCalUID,
      response,
    });
    return NextResponse.json({ ok: true, summary: result.summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to send RSVP";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
