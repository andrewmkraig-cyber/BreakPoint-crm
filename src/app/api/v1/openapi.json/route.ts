import { NextRequest, NextResponse } from "next/server";
import { EXPOSED_TOOLS } from "@/lib/api-access/registry";

// OpenAPI description of the REST side door, generated from the same
// registry the endpoints serve. Public (no key needed): it describes
// shapes, not data, and agent platforms usually fetch it before they
// have a place to put the key. Every operation is bearer-authenticated.

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const paths: Record<string, unknown> = {
    "/api/v1/tools": {
      get: {
        operationId: "listTools",
        summary: "List the tools this API key may call",
        responses: { "200": { description: "Tool list with JSON schemas" } },
      },
    },
  };
  for (const t of EXPOSED_TOOLS) {
    paths[`/api/v1/tools/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.description.slice(0, 120),
        description: `${t.description}\n\nRequires the "${t.scope}" scope.`,
        requestBody: {
          required: true,
          content: { "application/json": { schema: t.inputSchema } },
        },
        responses: {
          "200": {
            description: "Tool result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { tool: { type: "string" }, result: { type: "string" } },
                  required: ["tool", "result"],
                },
              },
            },
          },
          "403": { description: "Key lacks the required scope" },
          "404": { description: "Unknown tool" },
        },
      },
    };
  }
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "Ace API Access",
      version: "1.0.0",
      description:
        "Side door into Ace (BreakPoint Talent CRM) for outside agents. Same tools the in-app Assistant uses, scoped to the key owner's organization.",
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "An Ace API key from Settings > API Access" },
      },
    },
    paths,
  });
}
