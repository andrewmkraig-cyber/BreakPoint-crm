import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { BDActivityKind } from "@prisma/client";

export const dynamic = "force-dynamic";

// Apollo posts here when a contact opens, replies, bounces, or unsubs
// inside a sequence. We translate the event_type string onto the
// BDActivityKind enum and write one row per event so /bd/activity
// surfaces the signal. Apollo expects 200 on every callback or it
// retries aggressively, so we swallow parse/DB errors and log them
// instead of returning a non-2xx.
const EVENT_KIND_MAP: Record<string, BDActivityKind> = {
  email_opened: "OPEN",
  email_replied: "REPLY",
  email_bounced: "BOUNCE",
  unsubscribed: "UNSUB",
};

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch (e) {
    console.error("[apollo-webhook] body parse failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    const eventType = typeof body.event_type === "string" ? body.event_type : "";
    const contactEmail = typeof body.contact_email === "string" ? body.contact_email : null;
    const sequenceId = typeof body.sequence_id === "string" ? body.sequence_id : null;
    const occurredAtRaw = typeof body.occurred_at === "string" ? body.occurred_at : null;

    const kind = EVENT_KIND_MAP[eventType];
    if (!kind) {
      console.warn(`[apollo-webhook] unmapped event_type="${eventType}"`);
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const occurredAt =
      occurredAtRaw && !Number.isNaN(Date.parse(occurredAtRaw))
        ? new Date(occurredAtRaw)
        : new Date();

    let organizationId = process.env.ORG_ID;
    if (!organizationId) {
      const firstOrg = await prisma.organization.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      organizationId = firstOrg?.id;
    }
    if (!organizationId) {
      console.error("[apollo-webhook] no organization resolved; dropping event");
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    await prisma.bDActivity.create({
      data: {
        organizationId,
        kind,
        occurredAt,
        metadata: {
          email: contactEmail,
          sequenceId,
          eventType,
        },
      },
    });
  } catch (e) {
    console.error("[apollo-webhook] handler error:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
