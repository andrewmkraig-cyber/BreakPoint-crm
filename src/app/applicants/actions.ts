"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Result = { ok: true } | { ok: false; error: string };

async function requireUserId(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  if (!s?.user?.email) return null;
  const u = await prisma.user.findUnique({ where: { email: s.user.email }, select: { id: true } });
  return u?.id ?? null;
}

export type ApplicantStatusValue = "new" | "reviewed" | "rejected" | "moved_to_pipeline";

export type SetApplicantStatusInput = {
  candidateRfId: number;
  jobRfId: number;
  status: ApplicantStatusValue;
};

const VALID: ReadonlySet<ApplicantStatusValue> = new Set<ApplicantStatusValue>([
  "new",
  "reviewed",
  "rejected",
  "moved_to_pipeline",
]);

// Applicants aren't their own Prisma model yet — we derive status from the
// latest `applicant_status` ActionLog row for the candidate/job pair. New
// applicants with no entry default to "new" on the page layer.
export async function setApplicantStatus(input: SetApplicantStatusInput): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (!VALID.has(input.status)) return { ok: false, error: "Invalid status." };
  try {
    await prisma.actionLog.create({
      data: {
        userId,
        actionType: "applicant_status",
        subjectType: "candidate",
        subjectId: String(input.candidateRfId),
        metadata: {
          jobRfId: input.jobRfId,
          status: input.status,
        },
      },
    });
    revalidatePath("/applicants");
    revalidatePath(`/candidates/${input.candidateRfId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update applicant." };
  }
}
