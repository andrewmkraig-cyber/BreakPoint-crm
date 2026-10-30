import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { describeZoomInfoFailure, probeZoomInfo } from "@/lib/zoominfo";

export const dynamic = "force-dynamic";

type TestResult = {
  ok: boolean;
  state: "connected" | "not_configured" | "error";
  account: string | null;
  message: string;
  hint?: string;
  checkedAt: string;
};

export async function POST() {
  const session = await getServerSession(authOptions);
  const checkedAt = new Date().toISOString();
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, state: "error", account: null, message: "Not signed in.", checkedAt } satisfies TestResult,
      { status: 401 },
    );
  }
  const org = await getCurrentOrg();
  const probe = await probeZoomInfo(org.id);
  if (probe.ok) {
    return NextResponse.json(
      {
        ok: true,
        state: "connected",
        account: probe.username,
        message: probe.usageSummary ? `Connected. ${probe.usageSummary}` : "Connected. Credentials accepted.",
        checkedAt,
      } satisfies TestResult,
      { status: 200 },
    );
  }
  const { message, hint } = describeZoomInfoFailure(probe);
  return NextResponse.json(
    {
      ok: false,
      state: probe.reason === "not_connected" ? "not_configured" : "error",
      account: null,
      message,
      hint,
      checkedAt,
    } satisfies TestResult,
    { status: 200 },
  );
}
