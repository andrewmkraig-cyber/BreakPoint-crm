import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Lightweight job picker for the Mail composer's Candidate Recruit
// template flow. Returns a short list of open jobs in the current
// tenant so the recruiter can pick which job to merge into the
// outreach email. Optional ?q= filters by title or client name.

export type JobPickerOption = {
  jobId: string;
  jobTitle: string;
  clientName: string;
  city: string;
  state: string;
};

export type JobPickerResponse = { jobs: JobPickerOption[] };

const MAX_RESULTS = 50;

export async function GET(req: NextRequest): Promise<NextResponse<JobPickerResponse | { error: string }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getCurrentOrg();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

  const where = {
    organizationId: org.id,
    isOpen: true,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { client: { name: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const jobs = await prisma.job.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: MAX_RESULTS,
    select: {
      id: true,
      title: true,
      locations: true,
      locationCity: true,
      locationState: true,
      client: { select: { name: true } },
    },
  });

  const out: JobPickerOption[] = jobs.map((j) => {
    const { city, state } = resolveCityState(j.locationCity, j.locationState, j.locations);
    return {
      jobId: j.id,
      jobTitle: j.title ?? "",
      clientName: j.client?.name ?? "",
      city,
      state,
    };
  });

  return NextResponse.json({ jobs: out });
}

// Prefer the new structured location columns; fall back to splitting
// the legacy locations[] string ("City, ST Zip" or "City, ST").
function resolveCityState(
  city: string | null,
  state: string | null,
  legacy: string[],
): { city: string; state: string } {
  const c = (city ?? "").trim();
  const s = (state ?? "").trim();
  if (c || s) return { city: c, state: s };
  const first = legacy.find((l) => typeof l === "string" && l.trim().length > 0);
  if (!first) return { city: "", state: "" };
  const parts = first.split(",").map((p) => p.trim());
  // "City, ST Zip" — state may be followed by a space + zip; keep just the state.
  const stateRaw = parts[1] ?? "";
  return { city: parts[0] ?? "", state: stateRaw.split(/\s+/)[0] ?? "" };
}
