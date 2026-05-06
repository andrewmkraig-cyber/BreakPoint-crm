import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEntityDisplayName } from "@/lib/ai-workspace-context";

// Tiny GET endpoint the Claude Panel calls to populate the header
// pill ("Ace Assistant · Tom Marek"). The full build*Context payload
// is far too heavy for a label, so this hits one indexed SELECT and
// returns just the display name. Org-scoping is enforced inside
// getEntityDisplayName via getCurrentOrg().

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");

  if (type !== "candidate" && type !== "client" && type !== "job") {
    return NextResponse.json(
      { ok: false, error: "type must be candidate | client | job" },
      { status: 400 },
    );
  }
  if (!id || id.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "id is required" },
      { status: 400 },
    );
  }

  const name = await getEntityDisplayName(type, id.trim());
  return NextResponse.json({ ok: true, name });
}
