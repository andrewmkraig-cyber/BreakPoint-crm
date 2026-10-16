import type Anthropic from "@anthropic-ai/sdk";
import {
  ACTION_TOOL_NAMES,
  BULK_ACTION_TOOL_NAMES,
  DATA_TOOLS,
  executeTool,
  runCreateContact,
  runCreateReminder,
} from "@/lib/claude-panel/tools";
import type { ApiActor, ApiKeyScope } from "@/lib/api-keys";

// The subset of the Assistant's tools an API key may call, and the scope
// each one needs. Confirm-gated action tools (stage moves, notes, deletes,
// bulk ops) are excluded outright: they exist to be approved by a human
// in the panel, and an outside agent has no Confirm card to click.

const WRITE_TOOLS = new Set(["create_reminder", "create_contact"]);

export type ExposedTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: ApiKeyScope;
};

function scopeFor(name: string): ApiKeyScope | null {
  if (ACTION_TOOL_NAMES.has(name) || BULK_ACTION_TOOL_NAMES.has(name)) return null;
  return WRITE_TOOLS.has(name) ? "write" : "read";
}

export const EXPOSED_TOOLS: ExposedTool[] = (DATA_TOOLS as Anthropic.Tool[])
  .map((t) => {
    const scope = scopeFor(t.name);
    if (!scope) return null;
    return {
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.input_schema as Record<string, unknown>,
      scope,
    };
  })
  .filter((t): t is ExposedTool => t !== null);

export function toolsForActor(actor: ApiActor): ExposedTool[] {
  return EXPOSED_TOOLS.filter((t) => actor.scopes.includes(t.scope));
}

export type ToolCallOutcome =
  | { kind: "ok"; text: string }
  | { kind: "not_found" }
  | { kind: "forbidden"; scope: ApiKeyScope };

// Run one exposed tool as the key's actor. Reads go through executeTool
// (same markdown the panel gets); writes go through the same direct
// writers the panel uses, with the actor passed explicitly instead of a
// session, so attribution and tenant scoping are identical.
export async function callExposedTool(
  actor: ApiActor,
  name: string,
  input: unknown,
): Promise<ToolCallOutcome> {
  const tool = EXPOSED_TOOLS.find((t) => t.name === name);
  if (!tool) return { kind: "not_found" };
  if (!actor.scopes.includes(tool.scope)) return { kind: "forbidden", scope: tool.scope };

  if (name === "create_reminder") {
    const r = await runCreateReminder(input, { orgId: actor.orgId, userId: actor.userId });
    return {
      kind: "ok",
      text: r.ok ? `Saved reminder "${r.title}".` : `Reminder "${r.title}" was not saved: ${r.reason}`,
    };
  }
  if (name === "create_contact") {
    const r = await runCreateContact(input, actor.orgId, actor.userId);
    return { kind: "ok", text: r.line };
  }
  const text = await executeTool(name, input, actor.orgId, actor.userEmail);
  return { kind: "ok", text };
}
