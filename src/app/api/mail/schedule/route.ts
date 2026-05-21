import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { createScheduledEmail, type StoredAttachment } from "@/lib/scheduled-email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Send Later" scheduler. Mirrors the /api/mail/send payload shape and
// adds scheduledSendAt + timezone. Used by the Mail composer (FAB + thread
// reply). The candidate and bulk surfaces schedule through server actions
// that call the same createScheduledEmail helper.
//
// Tenant isolation: the row is scoped to getCurrentOrg() and to the
// signed-in user, whose Gmail account is what fires the send at cron time.

type SchedulePayload = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  threadId?: string;
  sendAsEmail?: string;
  attachments?: StoredAttachment[];
  scheduledSendAt: string; // ISO UTC
  timezone: string;
  // Single-send surfaces mirror to Gmail Drafts; bulk turns this off.
  createDraft?: boolean;
  autoTag?: boolean;
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, name: true },
  });
  if (!user?.email) {
    return NextResponse.json({ error: "Unknown user" }, { status: 401 });
  }

  let payload: SchedulePayload;
  try {
    payload = (await req.json()) as SchedulePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = (payload.to ?? []).map((e) => e.trim()).filter(Boolean);
  if (to.length === 0) {
    return NextResponse.json(
      { error: "At least one recipient required" },
      { status: 400 },
    );
  }
  if (!payload.subject?.trim()) {
    return NextResponse.json({ error: "Subject required" }, { status: 400 });
  }
  const when = new Date(payload.scheduledSendAt);
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json(
      { error: "Invalid scheduled time" },
      { status: 400 },
    );
  }
  // Guard against scheduling in the past (allow a 30s grace for clock skew).
  if (when.getTime() < Date.now() - 30_000) {
    return NextResponse.json(
      { error: "Scheduled time must be in the future" },
      { status: 400 },
    );
  }

  try {
    const org = await getCurrentOrg();
    const created = await createScheduledEmail({
      organizationId: org.id,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      to,
      cc: (payload.cc ?? []).map((e) => e.trim()).filter(Boolean),
      bcc: (payload.bcc ?? []).map((e) => e.trim()).filter(Boolean),
      subject: payload.subject.trim(),
      bodyHtml: payload.bodyHtml ?? "",
      bodyText: payload.bodyText,
      threadId: payload.threadId,
      sendAsEmail: payload.sendAsEmail,
      attachments: payload.attachments,
      scheduledSendAt: when,
      timezone: payload.timezone || "America/New_York",
      createDraft: payload.createDraft ?? true,
      autoTag: payload.autoTag ?? true,
      source: "scheduled_send",
    });
    return NextResponse.json({
      ok: true,
      id: created.id,
      scheduledSendAt: when.toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Schedule failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
