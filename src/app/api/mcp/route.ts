import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api-keys";
import { callExposedTool, toolsForActor } from "@/lib/api-access/registry";

// MCP side door. A stateless Model Context Protocol server over Streamable
// HTTP: an agent platform (Grok, Claude, ChatGPT, anything that speaks
// MCP) is pointed at https://<ace host>/api/mcp with the API key as a
// bearer token, lists the Assistant's exposed tools, and calls them.
// Stateless means every POST is self-contained: no session id, no SSE
// stream to hold open, which is exactly what a Vercel function wants.
// Only JSON-RPC methods the tools surface needs are implemented.

export const maxDuration = 120;

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "ace", version: "1.0.0" };

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function unauthorized(status: 401 | 403, error: string) {
  return NextResponse.json(rpcError(null, -32001, error), {
    status,
    headers: { "WWW-Authenticate": 'Bearer realm="ace", error="invalid_token"' },
  });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return unauthorized(auth.status, auth.error);
  const actor = auth.actor;

  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = (await req.json()) as JsonRpcRequest | JsonRpcRequest[];
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  // Batches are legal JSON-RPC; handle each independently.
  const requests = Array.isArray(body) ? body : [body];
  const responses: unknown[] = [];

  for (const r of requests) {
    const id = r.id ?? null;
    const method = typeof r.method === "string" ? r.method : "";
    const params = (r.params && typeof r.params === "object" ? r.params : {}) as Record<
      string,
      unknown
    >;
    const isNotification = r.id === undefined;

    if (method === "initialize") {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      responses.push(
        rpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "Ace is BreakPoint Talent's recruiting CRM. Tools are scoped to the key owner's organization. " +
            "Search tools return markdown with relative links into Ace. create_reminder and create_contact " +
            "write immediately and return a one-line receipt.",
        }),
      );
      continue;
    }
    if (method === "notifications/initialized" || method.startsWith("notifications/")) {
      continue; // notifications never get a response
    }
    if (method === "ping") {
      responses.push(rpcResult(id, {}));
      continue;
    }
    if (method === "tools/list") {
      responses.push(
        rpcResult(id, {
          tools: toolsForActor(actor).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        }),
      );
      continue;
    }
    if (method === "tools/call") {
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments ?? {};
      const outcome = await callExposedTool(actor, name, args);
      if (outcome.kind === "not_found") {
        responses.push(rpcError(id, -32602, `Unknown tool: ${name}`));
      } else if (outcome.kind === "forbidden") {
        responses.push(
          rpcResult(id, {
            content: [
              {
                type: "text",
                text: `This API key does not have the "${outcome.scope}" scope required by ${name}. Ask the Ace admin to create a key with that scope in Settings > API Access.`,
              },
            ],
            isError: true,
          }),
        );
      } else {
        responses.push(rpcResult(id, { content: [{ type: "text", text: outcome.text }] }));
      }
      continue;
    }
    if (!isNotification) {
      responses.push(rpcError(id, -32601, `Method not found: ${method || "(none)"}`));
    }
  }

  if (responses.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? responses : responses[0]);
}

// Streamable HTTP clients may probe GET for a server-initiated SSE
// stream. We have nothing to push, so say so rather than hang.
export async function GET() {
  return new NextResponse("This MCP server is stateless; send JSON-RPC via POST.", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

export async function DELETE() {
  return new NextResponse(null, { status: 204 });
}
