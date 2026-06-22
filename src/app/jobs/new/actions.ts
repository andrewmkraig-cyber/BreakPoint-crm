"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { nextOwnerJobPriority } from "@/lib/job-priority";
import {
  extractJobFieldsFromGeneratedJd,
  generateJobDescription,
  missingRequiredJdHeaders,
  REQUIRED_JD_HEADER_COUNT,
  type ExtractedJdFields,
} from "@/lib/claude";
import { triggerJobsSiteRebuild } from "@/lib/jobs-site-rebuild";
import { validateUsCity, validateUsZip } from "@/lib/location-validation";

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
  "Claude API unavailable. Write the job description manually.\n\n" +
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
    console.log("[generate-jd] ANTHROPIC_API_KEY missing. Returning fallback");
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

// Best-effort follow-up extractor — /jobs/new fires this after
// generateJobDescriptionFromSource succeeds so the form's Job Title /
// Location / Salary Low / Salary High inputs can auto-fill from the
// generated markdown. Returns {} on any failure (no API key, Claude
// error, non-JSON response) — callers fail silently.
export async function extractFieldsFromGeneratedJd(
  markdown: string,
): Promise<ExtractedJdFields> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return {};
  if (!process.env.ANTHROPIC_API_KEY) return {};
  try {
    return await extractJobFieldsFromGeneratedJd(markdown);
  } catch {
    return {};
  }
}

export type NewJobInput = {
  title: string;
  // cuid FK into Client. Empty string = no client association (the form's
  // "Select a client…" option). Both Ace-native and RF-imported Clients
  // are identified by their cuid — the dropdown carries cuids now.
  clientId: string;
  // Structured location parts captured by the /jobs/new form (split out
  // for searchable filtering). The action composes Job.locations from
  // these so legacy readers that render the free-form locations[] string
  // keep working unchanged.
  locationCity: string;
  locationState: string;
  locationZip: string;
  jobType: string;
  employmentType: string;
  workplaceType: string;
  salaryRangeStart: number | null;
  salaryRangeEnd: number | null;
  salaryCurrency: string;
  // "yearly" or "hourly" — matches the existing Job.salaryFrequency
  // column already consumed by the Overview tab + JD generator.
  // Default on the form is "yearly" so historical create-paths that
  // omit this field aren't affected at runtime.
  salaryFrequency?: "yearly" | "hourly";
  openings: number | null;
  description: string;
  // The Source Job Link the recruiter pasted on /jobs/new. Persists to
  // Job.sourceJobUrl so a failed parse doesn't lose the link, and so
  // the Job's later JD tab can re-parse from the same source.
  sourceJobUrl?: string | null;
  // Free-form recruiter notes. /jobs/new's Save Link affordance (shown
  // when Indeed/LinkedIn block server-side fetches) drops a
  // "Client Job Link: <url>" line here so the URL isn't lost when the
  // parse can't run — the recruiter then writes the rest of the form
  // and clicks Create job.
  internalRecruiterNotes?: string | null;
};

// Ace-native create path. Writes a new Job row to Neon with the current
// tenant's organizationId stamped. No RecruiterFlow call. The returned
// slug is legacyRfId-as-string when available (keeps URLs backward-
// compat for RF-imported Clients whose jobs route through the numeric
// id), otherwise the cuid.
export async function createJob(
  input: NewJobInput,
): Promise<ActionResult<{ slug: string; jobCuid: string }>> {
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
    const org = await getCurrentOrg();

    // Validate the clientId (if any) belongs to the caller's tenant — the
    // dropdown is built against the same tenant, but another tab could
    // change state between form load and submit.
    let clientId: string | null = null;
    let clientOwnerId: string | null = null;
    if (input.clientId) {
      const client = await prisma.client.findFirst({
        where: { id: input.clientId, organizationId: org.id },
        select: { id: true, ownerId: true },
      });
      if (!client) return { ok: false, error: "Selected client is not available." };
      clientId = client.id;
      clientOwnerId = client.ownerId;
    }

    let description = input.description.trim();
    const jobType = input.jobType.trim();
    const employmentType = input.employmentType.trim();
    const workplaceType = input.workplaceType.trim();
    if (workplaceType && !["On-site", "Hybrid", "Remote"].includes(workplaceType)) {
      return { ok: false, error: "Workplace must be On-site, Hybrid, or Remote." };
    }

    // Format guarantee: every created job must store its JD in the canonical
    // BreakPoint markdown structure (## A Bit About Us / ## Why Join Us /
    // ## Job Details with ### sub-sections), regardless of how the recruiter
    // sourced it (pasted URL, dropped file, or pasted raw text). All three
    // input methods funnel through this one action, so normalizing here is
    // the single bulletproof chokepoint.
    //
    // The form already runs the markdown generator client-side, but that
    // call can fall back to the raw parse-url extraction text when Claude is
    // momentarily busy (the "Title: / About the Company: / Responsibilities:"
    // flat shape) - that fallback is what was getting saved unformatted. We
    // re-format only when the description clearly is NOT a BreakPoint JD
    // (3+ of the 5 canonical headers missing); an already-formatted JD, or a
    // recruiter's hand-edit of one, keeps all/most headers and is left
    // untouched so we never clobber deliberate edits or burn a needless call.
    if (
      description &&
      process.env.ANTHROPIC_API_KEY &&
      missingRequiredJdHeaders(description).length >= Math.min(3, REQUIRED_JD_HEADER_COUNT)
    ) {
      try {
        const formatted = await generateJobDescription({
          sourceText: description,
          jobTitle: title,
        });
        if (formatted && missingRequiredJdHeaders(formatted).length === 0) {
          description = formatted.trim();
        }
      } catch (e) {
        // Never block a save on the reformat - keep the original text. The
        // recruiter can still Regenerate with Claude on the JD tab later.
        // eslint-disable-next-line no-console
        console.error("[createJob] JD reformat failed, saving original:", e);
      }
    }

    // Normalize the new structured-location parts and compose the legacy
    // free-form "City, ST Zip" string from them. Empty parts collapse —
    // a job in just KY (no city/zip) yields locations=["KY"]; an empty
    // form yields locations=[] (same as before).
    const locationCity = input.locationCity.trim();
    const locationState = input.locationState.trim().toUpperCase();
    const locationZip = input.locationZip.trim();

    // City / State / Zip are REQUIRED on new jobs (server-side guard so a
    // missing/invalid location can never slip past a client that skipped
    // the form check). State must be a 2-letter abbreviation, Zip 5
    // digits. This only governs the create path — existing jobs are
    // untouched.
    if (!locationCity) return { ok: false, error: "City is required." };
    if (!locationState) return { ok: false, error: "State is required." };
    if (!/^[A-Z]{2}$/.test(locationState)) {
      return { ok: false, error: "State must be a 2-letter abbreviation." };
    }
    if (!locationZip) return { ok: false, error: "Zip is required." };
    if (!/^\d{5}$/.test(locationZip)) {
      return { ok: false, error: "Zip must be a 5-digit US zip code." };
    }

    // Defense-in-depth: re-run the US location validation the form
    // already performed via /api/location/validate-us. Network errors
    // fail open inside the helpers, matching the form's behavior, so a
    // transient Nominatim/Zippopotam outage can't block a valid save.
    const cityCheck = await validateUsCity(locationCity);
    if (!cityCheck.ok) {
      return { ok: false, error: `City: ${cityCheck.message}` };
    }
    const zipCheck = await validateUsZip(locationZip);
    if (!zipCheck.ok) {
      return { ok: false, error: `Zip: ${zipCheck.message}` };
    }
    const composedLocation = [
      [locationCity, locationState].filter(Boolean).join(", "),
      locationZip,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    const salaryFrequency =
      input.salaryFrequency === "hourly" || input.salaryFrequency === "yearly"
        ? input.salaryFrequency
        : "yearly";

    const sourceJobUrl = input.sourceJobUrl?.trim();
    const sourceJobUrlForCreate = sourceJobUrl && /^https?:\/\//i.test(sourceJobUrl) ? sourceJobUrl : null;
    const internalRecruiterNotes = input.internalRecruiterNotes?.trim() || null;

    const websitePriority = await nextOwnerJobPriority(org.id, clientOwnerId);
    const job = await prisma.job.create({
      data: {
        title,
        clientId,
        locations: composedLocation ? [composedLocation] : [],
        locationCity: locationCity || null,
        locationState: locationState || null,
        locationZip: locationZip || null,
        isOpen: true,
        employmentType: employmentType || null,
        workplaceType: workplaceType || null,
        jobType: jobType ? { name: jobType } : undefined,
        salaryRangeStart: lo ?? null,
        salaryRangeEnd: hi ?? null,
        salaryCurrency: (input.salaryCurrency || "USD").trim().toUpperCase().slice(0, 3),
        salaryFrequency,
        numberOfOpenings: input.openings ?? null,
        description: description || null,
        sourceJobUrl: sourceJobUrlForCreate,
        internalRecruiterNotes,
        websitePriority,
        organizationId: org.id,
      },
      select: { id: true, legacyRfId: true },
    });

    // Always redirect to the Job's cuid. legacyRfId is only set on RF-
    // imported rows (and historically a couple of corrupt rows ended up
    // with negative values, yielding /jobs/-309396680 404s). Ace-native
    // jobs route via cuid forever.
    const slug = job.id;
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${slug}`);
    // Bust the Clients list + the associated Client's detail page so the
    // Open/Closed job count chip reflects the new row on next navigation.
    // (Note: the count is currently sourced from Client.raw.open_jobs — a
    // legacy RF snapshot — so this revalidate only helps once that source
    // moves to a live Job rowcount. Flagging for a follow-up.)
    if (clientId) {
      revalidatePath("/clients");
      revalidatePath(`/clients/${clientId}`);
    }
    await triggerJobsSiteRebuild("job-created");
    return { ok: true, value: { slug, jobCuid: job.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create job." };
  }
}
