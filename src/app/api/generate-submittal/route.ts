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
  const t0 = Date.now();
  const mark = (label: string, extra?: Record<string, unknown>) => {
    // eslint-disable-next-line no-console
    console.log(
      `[generate-submittal] ${label} · +${Date.now() - t0}ms`,
      extra ? JSON.stringify(extra).slice(0, 300) : "",
    );
  };
  mark("POST received");

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    mark("no session");
    return NextResponse.json({ error: "Session expired. Reload and sign in again." }, { status: 401 });
  }
  mark("session ok", { email: session.user.email });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    mark("invalid json body");
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const candidateRfId = Number(body.candidateRfId);
  if (!Number.isFinite(candidateRfId)) {
    mark("missing candidateRfId");
    return NextResponse.json({ error: "candidateRfId is required." }, { status: 400 });
  }
  const jobTitle = typeof body.jobTitle === "string" ? body.jobTitle : "";
  const clientName = typeof body.clientName === "string" ? body.clientName : "";
  mark("body parsed", { candidateRfId, jobTitle, clientName });

  if (!process.env.ANTHROPIC_API_KEY) {
    mark("missing ANTHROPIC_API_KEY");
    return NextResponse.json(
      { error: "Claude API unavailable — ANTHROPIC_API_KEY not set on this deployment." },
      { status: 503 },
    );
  }

  try {
    const c = await recruiterflow.getCandidate(candidateRfId);
    mark("fetched candidate from RF", { name: c.name ?? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() });
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

    mark("calling Claude");
    const writeup = await generateSubmittalWriteup(input);
    mark("Claude returned", { length: writeup.length });
    const text = `${writeup.trim()}\n\nLet me know if you'd like to set up an interview with him/her.`;

    // Defensive: make absolutely sure we never return HTML through this path.
    if (/^<!DOCTYPE|^<html\b|<script\b|__next_f\.push\(/i.test(text.slice(0, 2000))) {
      mark("rejected suspicious content");
      return NextResponse.json({ error: "Generator returned invalid content." }, { status: 500 });
    }

    mark("sending response");
    return NextResponse.json({ text });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to generate submittal.";
    // eslint-disable-next-line no-console
    console.error(`[generate-submittal] threw after ${Date.now() - t0}ms:`, e);
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
