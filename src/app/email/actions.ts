"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createGmailDraft, plainToHtml, sendGmail, type SendEmailResult } from "@/lib/gmail";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { createScheduledEmail } from "@/lib/scheduled-email";

export type ActiveTemplateSummary = {
  id: string;
  name: string;
  subject: string;
  body: string;
  trigger: string | null;
  audience: string | null;
  category: string | null;
};

// Pulls active email templates for populating the composer's "Use Template"
// dropdown. No merge-field resolution here — the caller resolves after pick.
export async function listActiveTemplates(): Promise<ActiveTemplateSummary[]> {
  const rows = await prisma.emailTemplate.findMany({
    where: { isActive: true },
    // Manual sort order set in Settings ▸ Templates wins; name is the
    // stable tiebreaker for rows that never got a custom order.
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      subject: true,
      body: true,
      trigger: true,
      audience: true,
      category: true,
    },
  });
  return rows;
}

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

export type ComposeEmailInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  threadId?: string;
};

async function requireUser(): Promise<{ id: string; email: string; name: string | null } | null> {
  const s = await getServerSession(authOptions);
  if (!s?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: s.user.email },
    select: { id: true, email: true, name: true },
  });
  return u ? { id: u.id, email: u.email ?? "", name: u.name ?? null } : null;
}

function validate(input: ComposeEmailInput): string | null {
  const to = input.to.filter((e) => e.trim());
  if (to.length === 0) return "At least one recipient is required.";
  if (!input.subject.trim()) return "Subject is required.";
  if (!input.bodyText.trim()) return "Body is required.";
  return null;
}

export async function sendEmailAction(input: ComposeEmailInput): Promise<Result<SendEmailResult>> {
  const user = await requireUser();
  if (!user || !user.email) return { ok: false, error: "Not signed in." };

  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  try {
    const out = await sendGmail({
      userId: user.id,
      from: user.email,
      fromName: user.name ?? undefined,
      to: input.to.map((e) => e.trim()).filter(Boolean),
      cc: (input.cc ?? []).map((e) => e.trim()).filter(Boolean),
      bcc: (input.bcc ?? []).map((e) => e.trim()).filter(Boolean),
      subject: input.subject.trim(),
      bodyText: input.bodyText,
      bodyHtml: plainToHtml(input.bodyText),
      threadId: input.threadId,
    });
    return { ok: true, value: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Email send failed." };
  }
}

export type ScheduleEmailInput = ComposeEmailInput & {
  scheduledSendAt: string; // ISO UTC
  timezone: string;
  candidateId?: string;
};

// "Send Later" for the everyday candidate email composer (EmailLink).
// Persists a ScheduledEmail (plus a mirror Gmail draft) instead of
// sending now; the per-minute cron fires it. Org + user scoped.
export async function scheduleEmailAction(
  input: ScheduleEmailInput,
): Promise<Result> {
  const user = await requireUser();
  if (!user || !user.email) return { ok: false, error: "Not signed in." };

  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  const when = new Date(input.scheduledSendAt);
  if (Number.isNaN(when.getTime())) {
    return { ok: false, error: "Invalid scheduled time." };
  }
  if (when.getTime() < Date.now() - 30_000) {
    return { ok: false, error: "Scheduled time must be in the future." };
  }

  try {
    const org = await getCurrentOrg();
    await createScheduledEmail({
      organizationId: org.id,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      to: input.to.map((e) => e.trim()).filter(Boolean),
      cc: (input.cc ?? []).map((e) => e.trim()).filter(Boolean),
      bcc: (input.bcc ?? []).map((e) => e.trim()).filter(Boolean),
      subject: input.subject.trim(),
      bodyHtml: plainToHtml(input.bodyText),
      bodyText: input.bodyText,
      threadId: input.threadId,
      scheduledSendAt: when,
      timezone: input.timezone,
      createDraft: true,
      autoTag: true,
      candidateId: input.candidateId,
      source: "scheduled_send",
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not schedule email.",
    };
  }
}

export async function createEmailDraftAction(input: ComposeEmailInput): Promise<Result<SendEmailResult>> {
  const user = await requireUser();
  if (!user || !user.email) return { ok: false, error: "Not signed in." };

  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  try {
    const out = await createGmailDraft({
      userId: user.id,
      from: user.email,
      fromName: user.name ?? undefined,
      to: input.to.map((e) => e.trim()).filter(Boolean),
      cc: (input.cc ?? []).map((e) => e.trim()).filter(Boolean),
      bcc: (input.bcc ?? []).map((e) => e.trim()).filter(Boolean),
      subject: input.subject.trim(),
      bodyText: input.bodyText,
      bodyHtml: plainToHtml(input.bodyText),
      threadId: input.threadId,
    });
    // Ace 28.0b — createGmailDraft now returns { draftId, messageId,
    // threadId }; this action's existing contract still hands back a
    // SendEmailResult ({ id, threadId }). The `id` historically meant
    // "message id" so map messageId → id to keep the contract intact.
    return { ok: true, value: { id: out.messageId, threadId: out.threadId } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Email draft failed." };
  }
}
