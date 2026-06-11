import { NextResponse } from "next/server";
import Papa from "papaparse";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { geocodePill } from "@/lib/geocode";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pin CSV column → Ace Candidate field mapping. Headers are matched
// exactly against Pin's dotted export format. Pin sometimes emits
// sentinel values like "ERROR" / "MISSING_EMAIL" in the email column;
// those fail the @-check below and the row imports without an email.
const COL = {
  firstName: "candidate.firstName",
  lastName: "candidate.lastName",
  email: "candidate.emails.0",
  phone: "candidate.phoneNumbers",
  location: "candidate.location",
  linkedin: "candidate.linkedin",
} as const;

const MAX_EXPERIENCES = 10;
const MAX_EDUCATIONS = 5;

type Row = Record<string, string | undefined>;

// Source export the CSV came from. "pin" = Pin's dotted-namespace
// export; "zoominfo" = a ZoomInfo PERSON export (human-readable
// headers); "generic" = anything else, mapped best-effort by common
// column names so a stray export still imports instead of silently
// skipping every row.
type SourceFormat = "pin" | "zoominfo" | "generic";

type NormalizedRow = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string;
  company: string;
  location: string | null;
  linkedin: string | null;
  experiences: WorkEntry[];
  educations: EduEntry[];
};

function clean(v: string | undefined): string {
  return (v ?? "").trim();
}

function normalizeEmail(raw: string | undefined): string | null {
  const s = clean(raw).toLowerCase();
  if (!s) return null;
  if (!s.includes("@")) return null;
  return s;
}

// Split a single "Full Name" cell into first + last for exports that
// don't separate the two. First token is the first name; the remainder
// (which may be multi-word) is the last name.
function splitFullName(full: string): { first: string; last: string } {
  const parts = clean(full).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// Header-driven format detection. Pin exports carry dotted
// "candidate.*" columns; ZoomInfo PERSON exports carry "First Name" +
// "Email Address" / "Company Name". Everything else is treated as
// generic and matched best-effort below.
function detectFormat(fields: string[]): SourceFormat {
  const set = new Set(fields.map((f) => f.trim().toLowerCase()));
  if (set.has("candidate.firstname") || set.has("candidate.emails.0")) {
    return "pin";
  }
  const hasName = set.has("first name") || set.has("last name");
  const hasZoomCol =
    set.has("email address") ||
    set.has("company name") ||
    set.has("direct phone number") ||
    set.has("person city");
  if (hasName && hasZoomCol) return "zoominfo";
  return "generic";
}

// Pin date columns come as raw strings (ISO, year-only, "Present", or
// blank). We extract the first 4-digit year (1900–2099) so the existing
// editable-experience / resume-pdf-template / generate-resume readers
// that key off from_year/to_year still get a value.
function yearOf(s: string): number | null {
  const m = s.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

type WorkEntry = {
  title: string;
  company: string;
  startDate: string;
  endDate: string;
  // Mirrored fields kept for backward-compat with the AI-parsed shape
  // (designation/organization/from_year/to_year). The profile page,
  // resume PDF, and generate-resume action all key off these names.
  designation: string;
  organization: string;
  from_year: number | null;
  to_year: number | null;
  description: string;
};

type EduEntry = {
  degree: string;
  major: string;
  school: string;
  schoolStartDate: string;
  schoolEndDate: string;
  from_year: number | null;
  to_year: number | null;
  description: string;
};

function collectExperiences(row: Row): WorkEntry[] {
  const out: WorkEntry[] = [];
  for (let i = 0; i < MAX_EXPERIENCES; i++) {
    const title = clean(row[`candidate.experiences.${i}.title`]);
    const company = clean(row[`candidate.experiences.${i}.company`]);
    const startDate = clean(row[`candidate.experiences.${i}.startDate`]);
    const endDate = clean(row[`candidate.experiences.${i}.endDate`]);
    // Skip rows where both title and company are empty — a date-only
    // experience entry is noise. Keeps date-bearing rows that have
    // either a title OR a company so partial Pin exports still
    // contribute to the timeline.
    if (!title && !company) continue;
    out.push({
      title,
      company,
      startDate,
      endDate,
      designation: title,
      organization: company,
      from_year: yearOf(startDate),
      to_year: yearOf(endDate),
      description: "",
    });
  }
  return out;
}

function collectEducations(row: Row): EduEntry[] {
  const out: EduEntry[] = [];
  for (let i = 0; i < MAX_EDUCATIONS; i++) {
    const degree = clean(row[`candidate.educations.${i}.degree`]);
    const major = clean(row[`candidate.educations.${i}.major`]);
    const school = clean(row[`candidate.educations.${i}.school`]);
    const schoolStartDate = clean(
      row[`candidate.educations.${i}.schoolStartDate`],
    );
    const schoolEndDate = clean(
      row[`candidate.educations.${i}.schoolEndDate`],
    );
    // Skip when school is empty — degree/major without a school is
    // unusable; the profile and resume readers all need school as the
    // anchor field.
    if (!school) continue;
    out.push({
      degree,
      major,
      school,
      schoolStartDate,
      schoolEndDate,
      from_year: yearOf(schoolStartDate),
      to_year: yearOf(schoolEndDate),
      description: major,
    });
  }
  return out;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart form upload with a `file` field." },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing CSV file." },
      { status: 400 },
    );
  }

  const text = await file.text();
  const parsed = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length > 0) {
    const fatal = parsed.errors.find((e) => e.type !== "FieldMismatch");
    if (fatal) {
      return NextResponse.json(
        { error: `CSV parse failed: ${fatal.message}` },
        { status: 400 },
      );
    }
  }

  const rows = parsed.data ?? [];
  const fields = parsed.meta.fields ?? [];
  const format = detectFormat(fields);
  const org = await getCurrentOrg();

  // Case-insensitive header lookup for the ZoomInfo + generic mappers.
  // ZoomInfo/CRM exports vary header casing ("Mobile phone" vs "Mobile
  // Phone"), so we resolve by lowercased name to the real column key.
  const lc = new Map<string, string>();
  for (const f of fields) lc.set(f.trim().toLowerCase(), f);
  const getCI = (row: Row, name: string): string => {
    const key = lc.get(name.toLowerCase());
    return key ? clean(row[key]) : "";
  };
  const getCIFirst = (row: Row, names: string[]): string => {
    for (const n of names) {
      const v = getCI(row, n);
      if (v) return v;
    }
    return "";
  };

  function mapRow(row: Row): NormalizedRow {
    if (format === "pin") {
      const experiences = collectExperiences(row);
      const educations = collectEducations(row);
      const head = experiences[0];
      return {
        firstName: clean(row[COL.firstName]),
        lastName: clean(row[COL.lastName]),
        email: normalizeEmail(row[COL.email]),
        phone: clean(row[COL.phone]) || null,
        title: head?.title || "",
        company: head?.company || "",
        location: clean(row[COL.location]) || null,
        linkedin: clean(row[COL.linkedin]) || null,
        experiences,
        educations,
      };
    }
    if (format === "zoominfo") {
      const city = getCI(row, "Person City");
      const state = getCI(row, "Person State");
      const loc = [city, state].filter(Boolean).join(", ");
      return {
        firstName: getCI(row, "First Name"),
        lastName: getCI(row, "Last Name"),
        email: normalizeEmail(getCI(row, "Email Address")),
        // Prefer mobile, fall back to the direct line.
        phone:
          getCIFirst(row, [
            "Mobile phone",
            "Mobile Phone",
            "Mobile Phone Number",
            "Direct Phone Number",
          ]) || null,
        title: getCI(row, "Job Title"),
        company: getCI(row, "Company Name"),
        location: loc || null,
        linkedin:
          getCIFirst(row, [
            "LinkedIn Contact Profile URL",
            "LinkedIn URL",
          ]) || null,
        experiences: [],
        educations: [],
      };
    }
    // generic best-effort
    let firstName = getCIFirst(row, ["First Name", "FirstName", "First"]);
    let lastName = getCIFirst(row, [
      "Last Name",
      "LastName",
      "Last",
      "Surname",
    ]);
    if (!firstName && !lastName) {
      const full = getCIFirst(row, ["Full Name", "Name", "Contact Name"]);
      if (full) {
        const s = splitFullName(full);
        firstName = s.first;
        lastName = s.last;
      }
    }
    const city = getCIFirst(row, ["City", "Person City"]);
    const state = getCIFirst(row, ["State", "Person State", "Region"]);
    const locJoin = [city, state].filter(Boolean).join(", ");
    return {
      firstName,
      lastName,
      email: normalizeEmail(
        getCIFirst(row, ["Email", "Email Address", "E-mail", "Work Email"]),
      ),
      phone:
        getCIFirst(row, [
          "Mobile phone",
          "Mobile",
          "Cell",
          "Phone",
          "Phone Number",
          "Direct Phone Number",
          "Work Phone",
        ]) || null,
      title: getCIFirst(row, ["Job Title", "Title", "Position", "Role"]),
      company: getCIFirst(row, [
        "Company Name",
        "Company",
        "Employer",
        "Organization",
        "Current Employer",
      ]),
      location: getCIFirst(row, ["Location"]) || locJoin || null,
      linkedin:
        getCIFirst(row, [
          "LinkedIn",
          "LinkedIn URL",
          "LinkedIn Contact Profile URL",
          "Linkedin Profile",
        ]) || null,
      experiences: [],
      educations: [],
    };
  }

  // Normalize every row once, up front, so the dedup pre-scan and the
  // import loop share the same mapped values (the Pin mapper does real
  // work per row via collectExperiences).
  const normalized = rows.map(mapRow);

  // Batch the duplicate-email check: collect every normalized email in the
  // CSV up front and resolve existing candidates in one query instead of a
  // findUnique per row (N+1). email carries a global unique constraint, so a
  // single findMany mirrors the original per-row lookup semantics.
  const csvEmails = Array.from(
    new Set(
      normalized
        .map((n) => n.email)
        .filter((e): e is string => !!e),
    ),
  );
  const existingByEmail = csvEmails.length
    ? await prisma.candidate.findMany({
        where: { email: { in: csvEmails } },
        select: { email: true },
      })
    : [];
  const existingEmails = new Set(
    existingByEmail.map((c) => c.email).filter((e): e is string => !!e),
  );

  let imported = 0;
  let importedNoEmail = 0;
  let skippedNoName = 0;
  let skippedError = 0;
  let duplicates = 0;
  // Geocode per imported row so a CSV-imported candidate gets a distance
  // sub-line without waiting for the next scripts/geocode-candidates.ts
  // run. A geocode miss/failure NEVER aborts the import (the row is
  // already committed before the geocode runs, and the call is isolated
  // in its own try/catch). To keep a large import from blowing the
  // serverless function budget on serial Nominatim round-trips (~5s each
  // worst case), inline geocoding is capped; rows past the cap keep
  // lat/lng=null and the backfill script remains the net. The cap is
  // reported back so it isn't a silent truncation.
  const GEOCODE_INLINE_CAP = 75;
  let geocoded = 0;
  let geocodeAttempts = 0;
  let geocodeDeferred = 0;

  for (const n of normalized) {
    if (!n.firstName && !n.lastName) {
      skippedNoName += 1;
      continue;
    }

    if (n.email && existingEmails.has(n.email)) {
      duplicates += 1;
      continue;
    }

    const rowLocation = n.location;
    try {
      const createdRow = await prisma.candidate.create({
        data: {
          firstName: n.firstName || n.lastName,
          lastName: n.firstName ? n.lastName || null : null,
          email: n.email,
          phone: n.phone,
          currentDesignation: n.title || null,
          currentOrganization: n.company || null,
          location: rowLocation,
          linkedinProfile: n.linkedin,
          experience: n.experiences.length ? n.experiences : undefined,
          education: n.educations.length ? n.educations : undefined,
          createdById: user.id,
          organizationId: org.id,
        },
        select: { id: true },
      });
      imported += 1;
      if (!n.email) importedNoEmail += 1;
      // Track this email so a later row in the same CSV with the same address
      // is counted as a duplicate without a failing insert + P2002 round trip.
      if (n.email) existingEmails.add(n.email);

      // Awaited, failure-isolated, tenant-scoped geocode (same shape as
      // createCandidate, Ace 68.0 / f2d48d8). The row is already imported
      // above, so a null/throw here can't roll it back. geocodePill
      // swallows 429 / timeout / errors and returns null.
      if (rowLocation) {
        if (geocodeAttempts < GEOCODE_INLINE_CAP) {
          geocodeAttempts += 1;
          try {
            const hit = await geocodePill(rowLocation);
            if (hit) {
              await prisma.candidate.update({
                where: { id: createdRow.id, organizationId: org.id },
                data: { lat: hit.lat, lng: hit.lng },
              });
              geocoded += 1;
            }
          } catch (geoErr) {
            // eslint-disable-next-line no-console
            console.warn("[import-csv] geocode failed (row still imported)", {
              candidateId: createdRow.id,
              location: rowLocation,
              err: geoErr instanceof Error ? geoErr.message : String(geoErr),
            });
          }
        } else {
          // Past the inline cap — leave lat/lng null for the backfill net.
          geocodeDeferred += 1;
        }
      }
    } catch (err) {
      // Most likely a race on the email unique constraint (two rows in the
      // same CSV with the same address). Count as duplicate so the user sees
      // an honest tally rather than a silent skip.
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
        duplicates += 1;
        continue;
      }
      // eslint-disable-next-line no-console
      console.error("[import-csv] row create failed:", err);
      skippedError += 1;
    }
  }

  if (geocodeDeferred > 0) {
    // Surface the cap so a partially-geocoded import isn't read as
    // fully covered. The deferred rows are picked up by the backfill.
    // eslint-disable-next-line no-console
    console.log("[import-csv] geocode summary", {
      imported,
      geocoded,
      geocodeAttempts,
      geocodeDeferred,
      cap: GEOCODE_INLINE_CAP,
    });
  }

  return NextResponse.json({
    imported,
    skipped: skippedNoName + skippedError,
    duplicates,
    // Breakdown the dialog uses to explain a partial or zero import.
    format,
    total: rows.length,
    skippedNoName,
    skippedError,
    importedNoEmail,
    geocoded,
    geocodeDeferred,
  });
}
