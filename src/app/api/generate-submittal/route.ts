import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateSubmittalWriteup, type SubmittalInput } from "@/lib/claude";
import { extractCandidateFields } from "@/lib/candidate-fields";
import { formatLocation } from "@/lib/utils";
import { recruiterflow } from "@/lib/recruiterflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  candidateRfId?: unknown;
  jobRfId?: unknown;
  jobTitle?: unknown;
  clientName?: unknown;
};

// POST /api/generate-submittal
//
// Body: { candidateRfId, jobRfId?, jobTitle, clientName }
// Returns: { text: string }  on success
// Returns: { error: string } on failure (status 4xx/5xx)
//
// This is a plain JSON endpoint (no server-action RPC protocol) so there's
// zero chance of the caller receiving HTML back — the client's fetch always
// gets a JSON body and can render the text directly into the composer.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Session expired. Reload and sign in again." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const candidateRfId = Number(body.candidateRfId);
  if (!Number.isFinite(candidateRfId)) {
    return NextResponse.json({ error: "candidateRfId is required." }, { status: 400 });
  }
  const jobTitle = typeof body.jobTitle === "string" ? body.jobTitle : "";
  const clientName = typeof body.clientName === "string" ? body.clientName : "";

  try {
    const c = await recruiterflow.getCandidate(candidateRfId);
    const { firstName, lastName } = extractCandidateFields(c);

    const expectedSalary = (c.expected_salary ?? null) as
      | { number?: number | null; currency?: string | null }
      | null;
    const salaryStr = expectedSalary?.number
      ? `${expectedSalary.currency ?? "USD"} ${expectedSalary.number.toLocaleString()}`
      : "";

    const experienceSummary = summarizeExperience(c.experience);
    const notes = summarizeNotes(c.notes);
    const locationLabel = formatLocation(c.location);

    const input: SubmittalInput = {
      candidate: {
        firstName,
        lastName,
        title: c.current_designation ?? "",
        employer: c.current_organization ?? "",
        location: locationLabel,
        skills: Array.isArray(c.skills)
          ? (c.skills as unknown[]).filter((s): s is string => typeof s === "string")
          : [],
        experienceSummary,
        notes,
        expectedSalary: salaryStr,
        linkedin: c.linkedin_profile ?? "",
      },
      job: {
        title: jobTitle,
        clientName,
      },
    };

    const writeup = await generateSubmittalWriteup(input);
    const text = `${writeup.trim()}\n\nLet me know if you'd like to set up an interview with him/her.`;

    // Defensive: make absolutely sure we never return HTML through this path.
    if (/^<!DOCTYPE|^<html\b|<script\b/i.test(text.slice(0, 1000))) {
      return NextResponse.json({ error: "Generator returned invalid content." }, { status: 500 });
    }

    return NextResponse.json({ text });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to generate submittal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function summarizeExperience(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .slice(0, 4)
    .map((e) => {
      const r = e as {
        designation?: string;
        organization?: string;
        from?: [number | null, number | null];
        to?: [number | null, number | null];
      };
      const span = [r.from?.[1], r.to?.[1]].filter(Boolean).join("–");
      return [r.designation, r.organization, span].filter(Boolean).join(" · ");
    })
    .filter(Boolean)
    .join("\n");
}

function summarizeNotes(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .slice(0, 3)
    .map((n) => (n as { note?: string }).note ?? "")
    .filter(Boolean)
    .join("\n");
}
