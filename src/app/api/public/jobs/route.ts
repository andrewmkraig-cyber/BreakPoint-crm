import { NextResponse } from "next/server";

import { getPublishedWebsiteJobs } from "@/lib/public-jobs";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getPublishedWebsiteJobs();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      generatedAt: new Date().toISOString(),
      count: result.jobs.length,
      jobs: result.jobs,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
