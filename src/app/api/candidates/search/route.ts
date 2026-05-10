import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCandidatesPageForOrg } from "@/lib/candidates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Not signed in." },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const rawPage = url.searchParams.get("page");
  const parsed = rawPage ? Number(rawPage) : 1;
  const page =
    Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;

  try {
    const { rows, total } = await getCandidatesPageForOrg({
      page,
      pageSize: PAGE_SIZE,
    });
    return NextResponse.json({ candidates: rows, total });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Search failed.",
      },
      { status: 500 },
    );
  }
}
