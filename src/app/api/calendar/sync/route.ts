import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { syncGoogleCalendars } from "@/lib/calendar/google-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual-trigger sync endpoint. Pulls every calendar the signed-in user
// can read and mirrors a ±90-day event window into CalendarEvent. The
// downstream /calendar surface still reads its seed data — Prompt 3
// will swap it over to this table.

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let orgId: string;
  try {
    const org = await getCurrentOrg();
    orgId = org.id;
  } catch {
    return NextResponse.json({ ok: false, error: "No organization" }, { status: 401 });
  }

  try {
    const result = await syncGoogleCalendars(session.user.id, orgId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    // Expired / revoked refresh token surfaces a message containing
    // "sign out and sign back in" from getFreshAccessToken — flip that
    // to a 401 so the client can route the user to re-auth instead of
    // showing a generic 500.
    if (message.includes("sign out and sign back in")) {
      return NextResponse.json({ ok: false, error: message }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
