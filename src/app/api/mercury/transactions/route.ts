import { NextResponse } from "next/server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { fetchMercuryYtdTransactions } from "@/lib/mercury";

export const dynamic = "force-dynamic";

export async function GET() {
  const org = await getCurrentOrg();
  const result = await fetchMercuryYtdTransactions(org.id);

  if (!result.ok) {
    switch (result.reason) {
      case "not_connected":
        return NextResponse.json({ error: "not_connected" }, { status: 400 });
      case "invalid_key":
        return NextResponse.json({ error: "invalid_key" }, { status: 401 });
      case "unreachable":
        return NextResponse.json(
          { error: "mercury_unreachable" },
          { status: 502 },
        );
      case "upstream":
        return NextResponse.json(
          { error: `mercury_${result.status ?? "unknown"}` },
          { status: 502 },
        );
    }
  }

  return NextResponse.json({ transactions: result.transactions });
}
