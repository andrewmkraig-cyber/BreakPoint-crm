"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateJobDescription } from "@/lib/claude";
import { recruiterflow } from "@/lib/recruiterflow";

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

export type GenerateJDInput = {
  jobTitle: string;
  sourceText: string;
  file:
    | {
        filename: string;
        mimeType: string;
        base64: string;
      }
    | null;
};

// Max inline size for the JD upload — 4MB fits comfortably under Vercel Hobby's
// 4.5MB body cap. Larger JDs get split or pasted as text.
const MAX_JD_BYTES = 4 * 1024 * 1024;

const JD_FALLBACK_TEXT =
  "Claude API unavailable — write the job description manually.\n\n" +
  "Role Summary\n<2–3 sentence overview of the role and the team/company.>\n\n" +
  "What You'll Do\n<5–7 bullet points on day-to-day responsibilities.>\n\n" +
  "What We're Looking For\n<5–7 bullet points on must-have skills and experience.>\n\n" +
  "Nice to Have\n<optional bullets for preferred qualifications.>\n\n" +
  "Compensation & Benefits\n<salary range, benefits, perks.>";

export async function generateJobDescriptionFromSource(
  input: GenerateJDInput,
): Promise<ActionResult<{ text: string; fallback?: boolean; reason?: string }>> {
  // eslint-disable-next-line no-console
  console.log("[generate-jd] server action hit");

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };

  if (!input.file && !input.sourceText.trim()) {
    return { ok: false, error: "Upload a JD or paste source text first." };
  }

  let buffer: Buffer | undefined;
  if (input.file) {
    try {
      buffer = Buffer.from(input.file.base64, "base64");
    } catch {
      return { ok: false, error: "Couldn't decode the uploaded file." };
    }
    if (buffer.byteLength === 0) return { ok: false, error: "Uploaded file is empty." };
    if (buffer.byteLength > MAX_JD_BYTES) {
      return { ok: false, error: `JD upload too large (max ${MAX_JD_BYTES / (1024 * 1024)}MB).` };
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // eslint-disable-next-line no-console
    console.log("[generate-jd] ANTHROPIC_API_KEY missing — returning fallback");
    return { ok: true, value: { text: JD_FALLBACK_TEXT, fallback: true, reason: "ANTHROPIC_API_KEY not set" } };
  }

  try {
    const text = await generateJobDescription({
      sourceFile: input.file && buffer
        ? { filename: input.file.filename, mimeType: input.file.mimeType, data: buffer }
        : undefined,
      sourceText: input.sourceText,
      jobTitle: input.jobTitle,
    });
    return { ok: true, value: { text } };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("[generate-jd] threw:", e);
    return { ok: true, value: { text: JD_FALLBACK_TEXT, fallback: true, reason: reason.slice(0, 200) } };
  }
}

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
