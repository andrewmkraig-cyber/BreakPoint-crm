"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
export async function ensureDefaultTemplates(): Promise<void> {
  const defaults = [
    {
      name: "Client Submittal",
      subject: "Candidate Submittal - {{candidate_name}} | {{job_title}}",
      trigger: "client_submittal",
      audience: "client",
      body:
        "About {{candidate_name}}\n" +
        "<2–4 sentence intro to the candidate>\n\n" +
        "What {{he_or_she}} Brings\n" +
        "<3–5 sentences on strengths and relevant experience>\n\n" +
        "Technically:\n" +
        "<hard skills, stack, tools>\n\n" +
        "Comp Target:\n" +
        "<expected salary / open>\n\n" +
        "Location:\n" +
        "<city, state + remote/hybrid/on-site>\n\n" +
        "LinkedIn:\n" +
        "<LinkedIn URL>\n\n" +
        "Let me know if you'd like to set up an interview with {{him_or_her}}.",
    },
    {
      name: "Candidate Submission Confirmation",
      subject: "Great News - You've Been Submitted!",
      trigger: "candidate_submission_confirmation",
      audience: "candidate",
      body:
        "Hi {{candidate_first_name}},\n\n" +
        "Great news — you've been submitted to {{client_name}}.\n\n" +
        "Please reply \"Understood!\" so I know you're tracking.\n\n" +
        "A few ground rules while we're working this together:\n" +
        "• Please don't apply directly to the company or reach out to them.\n" +
        "• Let me know right away if you've applied or interviewed there before.\n" +
        "• I'll be your single point of contact until an interview is scheduled.\n\n" +
        "I'll circle back as soon as I have feedback from the client.\n\n" +
        "Thanks,",
    },
  ];

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
}
