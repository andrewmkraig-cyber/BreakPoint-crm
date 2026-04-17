"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { recruiterflow } from "@/lib/recruiterflow";

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

export type NewJobInput = {
  title: string;
  clientCompanyId: number | null;
  locations: string[];
  jobType: string;
  employmentType: string;
  salaryRangeStart: number | null;
  salaryRangeEnd: number | null;
  salaryCurrency: string;
  openings: number | null;
  description: string;
};

export async function createJob(input: NewJobInput): Promise<ActionResult<{ id: number | null }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Job title is required." };

  const lo = input.salaryRangeStart;
  const hi = input.salaryRangeEnd;
  if (lo != null && lo < 0) return { ok: false, error: "Salary low can't be negative." };
  if (hi != null && hi < 0) return { ok: false, error: "Salary high can't be negative." };
  if (lo != null && hi != null && lo > hi) {
    return { ok: false, error: "Salary low can't be greater than salary high." };
  }

  try {
    const res = await recruiterflow.createJob({
      title,
      client_company_id: input.clientCompanyId ?? undefined,
      locations: input.locations.length ? input.locations : undefined,
      job_type: input.jobType || undefined,
      employment_type: input.employmentType || undefined,
      salary_range_start: lo ?? undefined,
      salary_range_end: hi ?? undefined,
      salary_range_currency: input.salaryCurrency || "USD",
      number_of_openings: input.openings ?? undefined,
      description: input.description.trim() || undefined,
      is_open: true,
    });

    if (res && typeof res === "object" && "RESULT" in res && res.RESULT && res.RESULT !== "SUCCESS") {
      return { ok: false, error: `RecruiterFlow returned ${res.RESULT}` };
    }

    const newId =
      (res && typeof res === "object" && "id" in res && typeof res.id === "number" && res.id) ||
      (res && typeof res === "object" && "job_id" in res && typeof res.job_id === "number" && res.job_id) ||
      null;

    revalidatePath("/jobs");
    return { ok: true, value: { id: newId } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create job." };
  }
}
