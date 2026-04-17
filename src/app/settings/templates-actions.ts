"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CANDIDATE_CONFIRMATION_TRIGGER, CLIENT_SUBMITTAL_TRIGGER } from "@/app/settings/template-constants";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

async function requireSession(): Promise<boolean> {
  const s = await getServerSession(authOptions);
  return Boolean(s?.user?.email);
}

export type EmailTemplateInput = {
  id?: string;
  name: string;
  subject: string;
  body: string;
  trigger: string | null;
  audience: string | null;
  isActive: boolean;
};

export async function upsertEmailTemplate(input: EmailTemplateInput): Promise<Result<{ id: string }>> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  if (!input.name.trim()) return { ok: false, error: "Name is required." };
  if (!input.subject.trim()) return { ok: false, error: "Subject is required." };
  if (!input.body.trim()) return { ok: false, error: "Body is required." };

  try {
    const row = await prisma.emailTemplate.upsert({
      where: { id: input.id ?? "__new__" },
      create: {
        name: input.name.trim(),
        subject: input.subject.trim(),
        body: input.body,
        trigger: input.trigger?.trim() || null,
        audience: input.audience?.trim() || null,
        isActive: input.isActive,
      },
      update: {
        name: input.name.trim(),
        subject: input.subject.trim(),
        body: input.body,
        trigger: input.trigger?.trim() || null,
        audience: input.audience?.trim() || null,
        isActive: input.isActive,
      },
      select: { id: true },
    });
    revalidatePath("/settings");
    return { ok: true, value: { id: row.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save template." };
  }
}

export async function deleteEmailTemplate(id: string): Promise<Result> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  try {
    await prisma.emailTemplate.delete({ where: { id } });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete template." };
  }
}

// Seeds the two default templates if they aren't already present. Idempotent —
// only creates rows when the trigger key is missing, so user edits aren't
// clobbered.

const CLIENT_SUBMITTAL_DEFAULT = {
  name: "Client Submittal",
  subject: "Candidate Submittal - [Candidate First Name] [Candidate Last Name] | [Job Title]",
  trigger: CLIENT_SUBMITTAL_TRIGGER,
  audience: "client",
  body:
    "About [Candidate First Name] [Candidate Last Name]\n" +
    "<2–4 sentence intro to the candidate>\n\n" +
    "What They Bring\n" +
    "<3–5 sentences on strengths and relevant experience>\n\n" +
    "Technically:\n" +
    "<hard skills, stack, tools>\n\n" +
    "Comp Target:\n" +
    "<expected salary / open>\n\n" +
    "Location:\n" +
    "<city, state + remote/hybrid/on-site>\n\n" +
    "LinkedIn:\n" +
    "<LinkedIn URL>\n\n" +
    "Let me know if you'd like to set up an interview with them.",
} as const;

const CANDIDATE_CONFIRMATION_DEFAULT = {
  name: "Candidate Submission Confirmation",
  subject: "BreakPoint Talent has reviewed and submitted your profile for [Job Title]",
  trigger: CANDIDATE_CONFIRMATION_TRIGGER,
  audience: "candidate",
  body:
    "Hi [Candidate First Name],\n\n" +
    "Good news - your profile has been submitted to [Client Company Name].\n\n" +
    "Please read below and then hit reply on this email and state: Understood!\n\n" +
    "This email serves as confirmation that BreakPoint Talent has reviewed your resume and submitted it directly to our client, [Client Company Name], for their [Job Title] position.\n\n" +
    "Please do not apply directly nor contact [Client Company Name]. We will be managing all feedback and next steps on your behalf.\n\n" +
    "We will keep you posted on feedback/next steps once we hear from them.\n\n" +
    "[Recruiter Name]\n" +
    "Managing Partner & Founder\n" +
    "[Recruiter Email]\n" +
    "[Recruiter Phone]\n" +
    "www.breakpointtalent.com",
} as const;

export async function ensureDefaultTemplates(): Promise<void> {
  const defaults = [CLIENT_SUBMITTAL_DEFAULT, CANDIDATE_CONFIRMATION_DEFAULT] as const;

  for (const tpl of defaults) {
    const existing = await prisma.emailTemplate.findFirst({ where: { trigger: tpl.trigger } });
    if (existing) continue;
    await prisma.emailTemplate.create({
      data: {
        name: tpl.name,
        subject: tpl.subject,
        body: tpl.body,
        trigger: tpl.trigger,
        audience: tpl.audience,
        isActive: true,
      },
    });
  }

  await migrateClientNameToken();
}

// One-shot migration: any existing template subject/body still using the old
// [Client Name] token gets rewritten to [Client Company Name]. Idempotent —
// templates that don't reference it are skipped; templates that already use
// the new token are left alone.
async function migrateClientNameToken(): Promise<void> {
  const rows = await prisma.emailTemplate.findMany({
    select: { id: true, subject: true, body: true },
  });
  const needle = /\[Client Name\]/g;
  for (const row of rows) {
    const subjectHit = needle.test(row.subject);
    needle.lastIndex = 0;
    const bodyHit = needle.test(row.body);
    needle.lastIndex = 0;
    if (!subjectHit && !bodyHit) continue;
    await prisma.emailTemplate.update({
      where: { id: row.id },
      data: {
        subject: row.subject.replace(/\[Client Name\]/g, "[Client Company Name]"),
        body: row.body.replace(/\[Client Name\]/g, "[Client Company Name]"),
      },
    });
  }
}
