import { prisma } from "@/lib/prisma";
import { applyMergeFields, type MergeFieldValues } from "@/lib/merge-fields";
import { createGmailDraft, plainToHtml, sendGmail, type SendEmailResult } from "@/lib/gmail";

export type TriggerLookupResult =
  | { kind: "ok"; template: { id: string; name: string; subject: string; body: string } }
  | { kind: "missing" }
  | { kind: "inactive"; name: string };

// Finds the most recently updated template for a trigger. Returns structured
// info so callers can distinguish missing vs. disabled vs. usable.
export async function loadTriggeredTemplate(trigger: string): Promise<TriggerLookupResult> {
  const any = await prisma.emailTemplate.findFirst({
    where: { trigger },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, subject: true, body: true, isActive: true },
  });
  if (!any) return { kind: "missing" };
  if (!any.isActive) return { kind: "inactive", name: any.name };
  return {
    kind: "ok",
    template: { id: any.id, name: any.name, subject: any.subject, body: any.body },
  };
}

export type FireTemplatedEmailInput = {
  trigger: string;
  userId: string;
  fromEmail: string;
  fromName?: string | null;
  to: string[];
  cc?: string[];
  values: MergeFieldValues;
  mode: "send" | "draft";
};

export type FireResult =
  | { status: "sent"; result: SendEmailResult; subject: string; body: string; templateName: string }
  | { status: "drafted"; result: SendEmailResult; subject: string; body: string; templateName: string }
  | { status: "skipped"; reason: "missing" | "inactive" | "no_recipient"; templateName?: string }
  | { status: "error"; error: string };

// Single choke point every auto-trigger routes through. Reads the template
// assigned to the trigger, resolves merge fields against values, and either
// sends or drafts via Gmail. If the template is missing, disabled, or has no
// recipient, returns a structured skip reason so the caller can report it.
export async function fireTemplatedEmail(input: FireTemplatedEmailInput): Promise<FireResult> {
  const to = input.to.map((e) => e.trim()).filter(Boolean);
  if (to.length === 0) return { status: "skipped", reason: "no_recipient" };

  const look = await loadTriggeredTemplate(input.trigger);
  if (look.kind === "missing") return { status: "skipped", reason: "missing" };
  if (look.kind === "inactive") return { status: "skipped", reason: "inactive", templateName: look.name };

  const subject = applyMergeFields(look.template.subject, input.values);
  const body = applyMergeFields(look.template.body, input.values);
  const html = plainToHtml(body);

  try {
    const cc = (input.cc ?? []).map((e) => e.trim()).filter(Boolean);
    if (input.mode === "send") {
      const sent = await sendGmail({
        userId: input.userId,
        from: input.fromEmail,
        fromName: input.fromName ?? undefined,
        to,
        cc,
        subject,
        bodyText: body,
        bodyHtml: html,
      });
      return { status: "sent", result: sent, subject, body, templateName: look.template.name };
    }
    const drafted = await createGmailDraft({
      userId: input.userId,
      from: input.fromEmail,
      fromName: input.fromName ?? undefined,
      to,
      cc,
      subject,
      bodyText: body,
      bodyHtml: html,
    });
    return { status: "drafted", result: drafted, subject, body, templateName: look.template.name };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "Email delivery failed." };
  }
}
