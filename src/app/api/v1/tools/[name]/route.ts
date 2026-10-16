import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api-keys";
import { callExposedTool } from "@/lib/api-access/registry";

// REST side door, call half. POST a JSON object of tool arguments (the
// schema from GET /api/v1/tools) and get the same text the Assistant
// would have seen. Errors are plain JSON with an HTTP status, so a
// platform that can't read MCP error envelopes still gets something
// actionable.

export const maxDuration = 120;

export async function POST(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: { "WWW-Authenticate": 'Bearer realm="ace"' } },
    );
  }
  const { name } = await ctx.params;
  let input: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      input = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Body must be a JSON object of tool arguments." }, { status: 400 });
    }
  }
  const outcome = await callExposedTool(auth.actor, name, input);
  if (outcome.kind === "not_found") {
    return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 404 });
  }
  if (outcome.kind === "forbidden") {
    return NextResponse.json(
      { error: `This API key lacks the "${outcome.scope}" scope required by ${name}.` },
      { status: 403 },
    );
  }
  return NextResponse.json({ tool: name, result: outcome.text });
}
