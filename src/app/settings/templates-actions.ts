"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CANDIDATE_APPLIED_CONFIRMATION_TRIGGER,
  CANDIDATE_CONFIRMATION_TRIGGER,
  CANDIDATE_HIRED_WELCOME_TRIGGER,
  CANDIDATE_INTERVIEW_PREP_TRIGGER,
  CANDIDATE_REJECTION_TRIGGER,
  CLIENT_INTERVIEW_SCHEDULED_TRIGGER,
  CLIENT_SUBMITTAL_TRIGGER,
  CONFIRMED_START_INVOICE_TRIGGER,
  OFFER_ACCEPTANCE_TRIGGER,
  OFFER_EXTENDED_TRIGGER,
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
    // On create, push the new template to the bottom of the list by
    // taking max(sortOrder) + 10. Updates leave sortOrder untouched —
    // ordering is changed through reorderEmailTemplate, never as a
    // side-effect of edits.
    const isCreate = !input.id;
    let createSortOrder = 10;
    if (isCreate) {
      const top = await prisma.emailTemplate.aggregate({
        _max: { sortOrder: true },
      });
      createSortOrder = (top._max.sortOrder ?? 0) + 10;
    }
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
        sortOrder: createSortOrder,
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

// Swap the sortOrder of the given template with its neighbor in the
// requested direction. Scope = the same tab the row lives in (active
// templates reorder among active rows; inactive among inactive). This
// is the up/down chevron handler in Settings ▸ Templates.
export async function reorderEmailTemplate(
  id: string,
  direction: "up" | "down",
): Promise<Result> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  try {
    const row = await prisma.emailTemplate.findUnique({
      where: { id },
      select: { id: true, sortOrder: true, isActive: true },
    });
    if (!row) return { ok: false, error: "Template not found." };

    const neighbor = await prisma.emailTemplate.findFirst({
      where: {
        isActive: row.isActive,
        id: { not: row.id },
        sortOrder:
          direction === "up" ? { lt: row.sortOrder } : { gt: row.sortOrder },
      },
      orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
      select: { id: true, sortOrder: true },
    });
    if (!neighbor) {
      // Already at the edge — no-op success.
      return { ok: true };
    }

    // Two-step swap so the unique nothing-but-index constraint never
    // sees duplicate sortOrders mid-transaction. Park the row at
    // -row.id-ish negative space, move the neighbor, then place row.
    const parkValue = -Math.abs(row.sortOrder) - 1;
    await prisma.$transaction([
      prisma.emailTemplate.update({ where: { id: row.id }, data: { sortOrder: parkValue } }),
      prisma.emailTemplate.update({ where: { id: neighbor.id }, data: { sortOrder: row.sortOrder } }),
      prisma.emailTemplate.update({ where: { id: row.id }, data: { sortOrder: neighbor.sortOrder } }),
    ]);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to reorder template." };
  }
}

export async function updateTemplateSendAsDraft(
  templateId: string,
  value: boolean,
): Promise<Result> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  try {
    await prisma.emailTemplate.update({
      where: { id: templateId },
      data: { sendAsDraft: value },
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update template." };
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
    "Please reply to this email with three professional references - ideally direct managers or senior colleagues from recent roles. " +
    "For each, include:\n" +
    "• Full name\n" +
    "• Title and company\n" +
    "• Relationship to you\n" +
    "• Phone and email\n\n" +
    "I keep it short and respectful - usually a 10-15 minute call. Let me know if any of them prefer email.\n\n" +
    "Thanks,",
} as const;

const CANDIDATE_APPLIED_CONFIRMATION_DEFAULT = {
  name: "Candidate Applied - Confirmation",
  subject: "We've got your application - [Job Title] at [Client Company Name]",
  trigger: CANDIDATE_APPLIED_CONFIRMATION_TRIGGER,
  audience: "candidate",
  category: "applied",
  body:
    "Hi [Candidate First Name],\n\n" +
    "Thanks for your interest in the [Job Title] role at [Client Company Name]. " +
    "We've received your application and added you to our pipeline for this role.\n\n" +
    "Next steps: I'll review your background against what the client is looking for and reach " +
    "out within a few business days to talk through the role in more detail. If we move forward, " +
    "I'll submit your profile to the client and keep you posted on their feedback.\n\n" +
    "If anything changes - availability, comp expectations, locations you'd consider - just reply " +
    "to this email and I'll update your file.",
} as const;

const OFFER_EXTENDED_DEFAULT = {
  name: "Offer Extended",
  subject: "Offer extended - [Job Title] at [Client Company Name]",
  trigger: OFFER_EXTENDED_TRIGGER,
  audience: "candidate",
  category: "offer",
  body:
    "Hi [Candidate First Name],\n\n" +
    "Great news - [Client Company Name] has extended an offer for the [Job Title] role.\n\n" +
    "Take some time to review the details and let me know how you're feeling about it. " +
    "Happy to walk through anything - comp, start date, benefits, the team, the role itself - " +
    "before you respond to them.\n\n" +
    "When you're ready to move forward, reply here and we'll line up next steps together.",
} as const;

const CANDIDATE_HIRED_WELCOME_DEFAULT = {
  name: "Hired - Welcome / Next Steps",
  subject: "Welcome to [Client Company Name] - [Job Title]",
  trigger: CANDIDATE_HIRED_WELCOME_TRIGGER,
  audience: "candidate",
  category: "hired",
  body:
    "Hi [Candidate First Name],\n\n" +
    "Congratulations on your new role as [Job Title] at [Client Company Name] - start date is locked in.\n\n" +
    "From here, [Client Company Name] will reach out directly with onboarding paperwork, equipment, " +
    "first-day logistics, and anything else they need on their end. Keep an eye on your inbox for them.\n\n" +
    "On my side, I'll check in shortly after you start to make sure things are going well. If anything " +
    "comes up between now and then - questions about the offer, paperwork, scheduling - just reply here.\n\n" +
    "Excited for you. Best of luck!",
} as const;

// 2026-05-27: client-facing invoice email seeded as a DB template so the
// "Invoice Email" row shows up in Settings -> Templates and can be edited
// in-app instead of code. The active send path in
// src/app/invoices/[id]/invoice-detail.tsx still computes its subject +
// body from a literal (with merge fields resolved client-side) -- wiring
// invoice-detail to actually consume this template body + apply the new
// [Invoice Number] / [Fee Amount] / [Invoice Due Date] merge fields lands
// in a follow-up. Until then this row is editable and visible but doesn't
// drive sends; keep that caveat in mind when changing the body here.
const CONFIRMED_START_INVOICE_DEFAULT = {
  name: "Invoice Email",
  subject:
    "Invoice from [Client Company Name] - [Candidate Full Name] placement",
  trigger: CONFIRMED_START_INVOICE_TRIGGER,
  audience: "client",
  category: "invoice",
  body:
    "[Greeting]\n\n" +
    "Congratulations again on bringing [Candidate Full Name] onto the team as [Job Title].\n\n" +
    "Attached is the invoice for the placement fee, with a start date of [Start Date].\n\n" +
    "ACH, wire, and check details are inside the PDF. If anything looks off or you need a different billing contact on file, just reply here and we'll sort it out.\n\n" +
    "We appreciate you trusting [Client Company Name] with this search, and we hope to continue to support your hiring needs in the future.\n\n" +
    "Best,",
} as const;

const CLIENT_INTERVIEW_SCHEDULED_DEFAULT = {
  name: "Interview Scheduled - Client Confirmation",
  subject: "Interview Confirmed - [Candidate Full Name] for [Job Title]",
  trigger: CLIENT_INTERVIEW_SCHEDULED_TRIGGER,
  audience: "client",
  category: "interview",
  body:
    "Hi [Client Contact First Name],\n\n" +
    "Confirming the interview with [Candidate Full Name] for the [Job Title] role. You should see the calendar invite hit your inbox shortly.\n\n" +
    "A quick recap of what we have on the books:\n" +
    "• Candidate: [Candidate Full Name] - [Candidate Current Title]\n" +
    "• Role: [Job Title]\n" +
    "• Format: [Interview Type]\n" +
    "• When: [Interview Date Time]\n" +
    "• Duration: [Interview Duration]\n\n" +
    "If anything changes on your end, just reply to this email and I'll get it updated. Otherwise, have a great conversation!",
} as const;

// Manual-only outreach template — recruiter picks it from the composer
// when reaching out to a candidate about a specific job. Body leans on
// the [Job Description] merge field so the generated JD (already capped
// at ~1900 chars by the generator) carries the bulk of the structured
// content (A Bit About Us / Why Join Us / Job Details / etc.).
const CANDIDATE_RECRUIT_DEFAULT = {
  name: "Candidate Recruit",
  subject: "[Job Title] - Immediate Opportunity in [Job Location]",
  // Null trigger = manual only; identified by `name` in the seed loop
  // since there's no trigger key to match on.
  trigger: null as string | null,
  audience: "candidate",
  category: "outreach",
  body:
    "Hi [Candidate First Name],\n\n" +
    "My client, [Client Company Name], is looking to add a [Job Title] to the growing team in [Job Location].\n\n" +
    "Are you interested?\n\n\n" +
    "[Job Title]:\n" +
    "[Job Description]",
} as const;

const CANDIDATE_INTERVIEW_PREP_DEFAULT = {
  name: "Interview Scheduled - Candidate Prep",
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
    "• Review the job description and jot down 2-3 questions that show you've done your homework on the company.\n" +
    "• Have a short tour of 2-3 recent projects ready - what the problem was, what you did, what the outcome was.\n" +
    "• Log in a few minutes early - test camera, mic, and link if it's a video interview.\n\n" +
    "Reply to this email if anything comes up. Good luck!",
} as const;

export async function ensureDefaultTemplates(): Promise<void> {
  const defaults = [
    // Pipeline-ordered so a fresh org sees them in funnel order in
    // Settings → Email Templates.
    CANDIDATE_RECRUIT_DEFAULT,
    CANDIDATE_APPLIED_CONFIRMATION_DEFAULT,
    CLIENT_SUBMITTAL_DEFAULT,
    CANDIDATE_CONFIRMATION_DEFAULT,
    CLIENT_INTERVIEW_SCHEDULED_DEFAULT,
    CANDIDATE_INTERVIEW_PREP_DEFAULT,
    OFFER_EXTENDED_DEFAULT,
    OFFER_ACCEPTANCE_DEFAULT,
    CANDIDATE_HIRED_WELCOME_DEFAULT,
    CONFIRMED_START_INVOICE_DEFAULT,
    CANDIDATE_REJECTION_DEFAULT,
    REFERENCE_CHECK_DEFAULT,
  ] as const;

  for (let i = 0; i < defaults.length; i++) {
    const tpl = defaults[i];
    // Seed rows are spaced 10 apart so the recruiter can drop new
    // templates between them without renumbering. New rows created
    // via upsertEmailTemplate land at max(sortOrder)+10.
    const seedSortOrder = (i + 1) * 10;
    // Manual-only templates (trigger=null) can't be looked up by trigger
    // — fall back to identifying them by name so the seed stays
    // idempotent. Trigger-bearing templates still use trigger as the
    // unique key so renames don't accidentally create dupes.
    const existing = tpl.trigger
      ? await prisma.emailTemplate.findFirst({
          where: { trigger: tpl.trigger },
          select: { id: true, category: true, sortOrder: true },
        })
      : await prisma.emailTemplate.findFirst({
          where: { name: tpl.name },
          select: { id: true, category: true, sortOrder: true },
        });
    if (existing) {
      const patch: { category?: string; sortOrder?: number } = {};
      // Backfill category on existing rows that predate the column so the
      // composer's category filter picks them up.
      if (!existing.category) patch.category = tpl.category;
      // Backfill sortOrder on rows that predate the column. Anything at
      // the default (0) gets the seed value; recruiter-customized
      // values (non-zero) are left untouched.
      if (!existing.sortOrder) patch.sortOrder = seedSortOrder;
      if (Object.keys(patch).length > 0) {
        await prisma.emailTemplate.update({ where: { id: existing.id }, data: patch });
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
        sortOrder: seedSortOrder,
      },
    });
  }

  await migrateClientNameToken();
  await migrateInvoiceGreetingToken();
  await stripSignatureBlocksFromTemplates();
  await stripEmDashesFromTemplates();
  await backfillSortOrderForLegacyRows();
}

// Andrew doesn't want em dashes in outbound copy - they read as
// AI-generated. Replace any em dash in existing template subjects and
// bodies with a plain hyphen. Idempotent: only writes rows that had
// at least one em dash.
async function stripEmDashesFromTemplates(): Promise<void> {
  const rows = await prisma.emailTemplate.findMany({
    select: { id: true, subject: true, body: true },
  });
  for (const row of rows) {
    const nextSubject = row.subject.replace(/—/g, "-");
    const nextBody = row.body.replace(/—/g, "-");
    if (nextSubject === row.subject && nextBody === row.body) continue;
    await prisma.emailTemplate.update({
      where: { id: row.id },
      data: { subject: nextSubject, body: nextBody },
    });
  }
}

// Any non-seed row that still has the default sortOrder=0 gets an
// auto-assigned value below the seeded rows so the up/down arrows have
// something to swap with. Idempotent — only touches rows where
// sortOrder=0.
async function backfillSortOrderForLegacyRows(): Promise<void> {
  const orphans = await prisma.emailTemplate.findMany({
    where: { sortOrder: 0 },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    select: { id: true },
  });
  if (orphans.length === 0) return;
  const top = await prisma.emailTemplate.aggregate({ _max: { sortOrder: true } });
  let next = (top._max.sortOrder ?? 0) + 10;
  for (const row of orphans) {
    await prisma.emailTemplate.update({ where: { id: row.id }, data: { sortOrder: next } });
    next += 10;
  }
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
// Bring the live "Invoice Email" template in line with the smart-greeting
// change: swap the old fixed greeting line for the [Greeting] merge field so
// it renders consistently with the runtime invoice email (1/2/3+ recipients).
// Edit-safe + idempotent — only fires when the body still carries the exact
// original seeded greeting substring, so a recruiter who reworded the greeting
// is left untouched, and a row already on [Greeting] is skipped.
async function migrateInvoiceGreetingToken(): Promise<void> {
  const OLD_GREETING = "Hi [Client Contact First Name],";
  const rows = await prisma.emailTemplate.findMany({
    where: { trigger: CONFIRMED_START_INVOICE_TRIGGER },
    select: { id: true, body: true },
  });
  for (const row of rows) {
    if (!row.body.includes(OLD_GREETING)) continue;
    await prisma.emailTemplate.update({
      where: { id: row.id },
      data: { body: row.body.split(OLD_GREETING).join("[Greeting]") },
    });
  }
}

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
