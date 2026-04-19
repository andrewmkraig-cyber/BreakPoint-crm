"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CANDIDATE_CONFIRMATION_TRIGGER,
  CANDIDATE_INTERVIEW_PREP_TRIGGER,
  CANDIDATE_REJECTION_TRIGGER,
  CLIENT_INTERVIEW_CONFIRMATION_TRIGGER,
  CLIENT_SUBMITTAL_TRIGGER,
  INTERVIEW_CONFIRMATION_TRIGGER,
  OFFER_ACCEPTANCE_TRIGGER,
  REFERENCE_CHECK_REQUEST_TRIGGER,
} from "@/app/settings/template-constants";

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
  category: string | null;
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
        category: input.category?.trim() || null,
        isActive: input.isActive,
      },
      update: {
        name: input.name.trim(),
        subject: input.subject.trim(),
        body: input.body,
        trigger: input.trigger?.trim() || null,
        audience: input.audience?.trim() || null,
        category: input.category?.trim() || null,
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
  category: "submittal",
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

// NOTE: Templates are seeded WITHOUT signatures. Signature is appended at
// send time from the user's Preferences so it can't duplicate.

const CANDIDATE_CONFIRMATION_DEFAULT = {
  name: "Candidate Submission Confirmation",
  subject: "BreakPoint Talent has reviewed and submitted your profile for [Job Title]",
  trigger: CANDIDATE_CONFIRMATION_TRIGGER,
  audience: "candidate",
  category: "submittal",
  body:
    "Hi [Candidate First Name],\n\n" +
    "Good news - your profile has been submitted to [Client Company Name].\n\n" +
    "Please read below and then hit reply on this email and state: Understood!\n\n" +
    "This email serves as confirmation that BreakPoint Talent has reviewed your resume and submitted it directly to our client, [Client Company Name], for their [Job Title] position.\n\n" +
    "Please do not apply directly nor contact [Client Company Name]. We will be managing all feedback and next steps on your behalf.\n\n" +
    "We will keep you posted on feedback/next steps once we hear from them.",
} as const;

const OFFER_ACCEPTANCE_DEFAULT = {
  name: "Offer Acceptance",
  subject: "Acceptance of Offer - [Candidate Full Name] - [Client Company Name]",
  trigger: OFFER_ACCEPTANCE_TRIGGER,
  audience: "client",
  category: "offer",
  body:
    "Hi [Client Contact First Name],\n\n" +
    "I have the candidate CC'd on this email.\n\n" +
    "Great news - [Candidate Full Name] accepts your offer of [Offer Amount] and is targeting a [Start Date] start date.\n\n" +
    "Feel free to communicate directly from here regarding new hire paperwork or onboarding.\n\n" +
    "[Candidate Full Name] - congratulations again, they are excited to welcome you to the team!",
} as const;

const CANDIDATE_REJECTION_DEFAULT = {
  name: "Candidate Rejection",
  subject: "[Job Title] - [Client Company Name]",
  trigger: CANDIDATE_REJECTION_TRIGGER,
  audience: "candidate",
  category: "rejection",
  body:
    "Hi [Candidate First Name],\n\n" +
    "I wanted to reach out and let you know that unfortunately the client has moved forward with another candidate for this role.\n\n" +
    "I really appreciate your time throughout this process. I will absolutely keep you in mind and reach out if something comes up that I think would be a strong fit for you.\n\n" +
    "Thanks again and I will be in touch.",
} as const;

const REFERENCE_CHECK_DEFAULT = {
  name: "Reference Check Request",
  subject: "Quick favor - reference check",
  trigger: REFERENCE_CHECK_REQUEST_TRIGGER,
  audience: "candidate",
  category: "reference",
  body:
    "Hi [Candidate First Name],\n\n" +
    "Things are moving in the right direction with [Client Company Name] on the [Job Title] role. " +
    "Before we go further, I'd like to line up a quick reference check.\n\n" +
    "Please reply to this email with three professional references — ideally direct managers or senior colleagues from recent roles. " +
    "For each, include:\n" +
    "• Full name\n" +
    "• Title and company\n" +
    "• Relationship to you\n" +
    "• Phone and email\n\n" +
    "I keep it short and respectful — usually a 10–15 minute call. Let me know if any of them prefer email.\n\n" +
    "Thanks,",
} as const;

const INTERVIEW_CONFIRMATION_DEFAULT = {
  name: "Interview Confirmation (legacy)",
  subject: "Interview Confirmed - [Job Title] with [Client Company Name]",
  trigger: INTERVIEW_CONFIRMATION_TRIGGER,
  audience: "candidate",
  category: "interview",
  body:
    "Hi [Candidate First Name],\n\n" +
    "Congratulations - you are confirmed for an interview with [Client Company Name] for the [Job Title] role.\n\n" +
    "Make sure to review the below information prior to the interview, and come prepared with a few questions to show you looked into them a bit.\n\n" +
    "[Job Description]",
} as const;

const CLIENT_INTERVIEW_CONFIRMATION_DEFAULT = {
  name: "Client Interview Confirmation",
  subject: "Interview Confirmed - [Candidate Full Name] for [Job Title]",
  trigger: CLIENT_INTERVIEW_CONFIRMATION_TRIGGER,
  audience: "client",
  category: "interview",
  body:
    "Hi [Client Contact First Name],\n\n" +
    "Confirming the interview with [Candidate Full Name] for the [Job Title] role. You should see the calendar invite hit your inbox shortly.\n\n" +
    "A quick recap of what we have on the books:\n" +
    "• Candidate: [Candidate Full Name] — [Candidate Current Title]\n" +
    "• Role: [Job Title]\n" +
    "• Format: [Interview Type]\n" +
    "• When: [Interview Date Time]\n" +
    "• Duration: [Interview Duration]\n\n" +
    "If anything changes on your end, just reply to this email and I'll get it updated. Otherwise, have a great conversation!",
} as const;

const CANDIDATE_INTERVIEW_PREP_DEFAULT = {
  name: "Candidate Interview Prep",
  subject: "You're confirmed - [Job Title] with [Client Company Name]",
  trigger: CANDIDATE_INTERVIEW_PREP_TRIGGER,
  audience: "candidate",
  category: "interview",
  body:
    "Hi [Candidate First Name],\n\n" +
    "You are confirmed for your [Interview Type] interview with [Client Company Name] for the [Job Title] role. " +
    "The calendar invite is on its way.\n\n" +
    "Details:\n" +
    "• When: [Interview Date Time]\n" +
    "• Duration: [Interview Duration]\n" +
    "• Format: [Interview Type]\n\n" +
    "A few prep tips so you can show up sharp:\n" +
    "• Review the job description and jot down 2–3 questions that show you've done your homework on the company.\n" +
    "• Have a short tour of 2–3 recent projects ready — what the problem was, what you did, what the outcome was.\n" +
    "• Log in a few minutes early — test camera, mic, and link if it's a video interview.\n\n" +
    "Reply to this email if anything comes up. Good luck!",
} as const;

export async function ensureDefaultTemplates(): Promise<void> {
  const defaults = [
    CLIENT_SUBMITTAL_DEFAULT,
    CANDIDATE_CONFIRMATION_DEFAULT,
    OFFER_ACCEPTANCE_DEFAULT,
    CANDIDATE_REJECTION_DEFAULT,
    INTERVIEW_CONFIRMATION_DEFAULT,
    REFERENCE_CHECK_DEFAULT,
    CLIENT_INTERVIEW_CONFIRMATION_DEFAULT,
    CANDIDATE_INTERVIEW_PREP_DEFAULT,
  ] as const;

  for (const tpl of defaults) {
    const existing = await prisma.emailTemplate.findFirst({
      where: { trigger: tpl.trigger },
      select: { id: true, category: true },
    });
    if (existing) {
      // Backfill category on existing rows that predate the column so the
      // composer's category filter picks them up.
      if (!existing.category) {
        await prisma.emailTemplate.update({
          where: { id: existing.id },
          data: { category: tpl.category },
        });
      }
      continue;
    }
    await prisma.emailTemplate.create({
      data: {
        name: tpl.name,
        subject: tpl.subject,
        body: tpl.body,
        trigger: tpl.trigger,
        audience: tpl.audience,
        category: tpl.category,
        isActive: true,
      },
    });
  }

  await migrateClientNameToken();
  await stripSignatureBlocksFromTemplates();
}

// Scrubs the trailing "[Recruiter Name] / Managing Partner / [Recruiter Email]
// / [Recruiter Phone] / www.breakpointtalent.com" block from any template
// body that includes it. Keeps the rest of the body untouched. Idempotent —
// templates without a matching tail block are left alone. Signatures are now
// appended at send time, so baking them into the template would duplicate.
async function stripSignatureBlocksFromTemplates(): Promise<void> {
  const rows = await prisma.emailTemplate.findMany({ select: { id: true, body: true } });
  for (const row of rows) {
    const stripped = stripTrailingSignatureBlock(row.body);
    if (stripped === row.body) continue;
    await prisma.emailTemplate.update({
      where: { id: row.id },
      data: { body: stripped },
    });
  }
}

function stripTrailingSignatureBlock(body: string): string {
  // Find the last occurrence of the [Recruiter Name] merge field and, if it
  // begins a trailing signature block (followed by a title/phone/email line
  // or www.breakpointtalent.com), truncate from there. Tolerates whitespace.
  const marker = "[Recruiter Name]";
  const idx = body.lastIndexOf(marker);
  if (idx === -1) return body;
  const tail = body.slice(idx);
  // Heuristic: tail is a signature if it contains [Recruiter Phone] OR
  // [Recruiter Email] OR www.breakpointtalent.com within the next ~8 lines.
  const tailLines = tail.split(/\r?\n/).slice(0, 10).join("\n").toLowerCase();
  const looksLikeSig =
    tailLines.includes("[recruiter phone]") ||
    tailLines.includes("[recruiter email]") ||
    tailLines.includes("www.breakpointtalent.com");
  if (!looksLikeSig) return body;
  return body.slice(0, idx).replace(/\s+$/, "");
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
