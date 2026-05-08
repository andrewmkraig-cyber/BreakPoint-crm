import { NextResponse } from "next/server";
import Papa from "papaparse";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
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
  expTitle: "candidate.experiences.0.title",
  expCompany: "candidate.experiences.0.company",
  eduDegree: "candidate.educations.0.degree",
  eduSchool: "candidate.educations.0.school",
} as const;

type Row = Record<string, string | undefined>;

function clean(v: string | undefined): string {
  return (v ?? "").trim();
}

function normalizeEmail(raw: string | undefined): string | null {
  const s = clean(raw).toLowerCase();
  if (!s) return null;
  if (!s.includes("@")) return null;
  return s;
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
  const org = await getCurrentOrg();

  let imported = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows) {
    const firstName = clean(row[COL.firstName]);
    const lastName = clean(row[COL.lastName]);
    if (!firstName && !lastName) {
      skipped += 1;
      continue;
    }

    const email = normalizeEmail(row[COL.email]);
    if (email) {
      const existing = await prisma.candidate.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing) {
        duplicates += 1;
        continue;
      }
    }

    const degree = clean(row[COL.eduDegree]);
    const school = clean(row[COL.eduSchool]);
    const education =
      degree || school
        ? [
            {
              degree,
              school,
              from_year: null,
              to_year: null,
              description: "",
            },
          ]
        : undefined;

    try {
      await prisma.candidate.create({
        data: {
          firstName: firstName || lastName,
          lastName: firstName ? lastName || null : null,
          email,
          phone: clean(row[COL.phone]) || null,
          currentDesignation: clean(row[COL.expTitle]) || null,
          currentOrganization: clean(row[COL.expCompany]) || null,
          location: clean(row[COL.location]) || null,
          linkedinProfile: clean(row[COL.linkedin]) || null,
          education,
          createdById: user.id,
          organizationId: org.id,
        },
      });
      imported += 1;
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
      skipped += 1;
    }
  }

  return NextResponse.json({ imported, skipped, duplicates });
}
