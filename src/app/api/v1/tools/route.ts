import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api-keys";
import { toolsForActor } from "@/lib/api-access/registry";

// REST side door, list half. For agent platforms that take a plain HTTP
// API + key rather than MCP. Returns the tools this key may call with
// their JSON schemas; call one via POST /api/v1/tools/{name}.

export async function GET(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: { "WWW-Authenticate": 'Bearer realm="ace"' } },
    );
  }
  return NextResponse.json({
    tools: toolsForActor(auth.actor).map((t) => ({
      name: t.name,
      description: t.description,
      scope: t.scope,
      input_schema: t.inputSchema,
      call: { method: "POST", path: `/api/v1/tools/${t.name}` },
    })),
  });
}
