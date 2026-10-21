// joinClaudeText: citation-split text blocks concatenate directly; a tool
// block between two text blocks is a paragraph break unless the model
// already supplied a newline. Run: npx tsx tests/unit/claude-text.test.ts
import assert from "node:assert/strict";
import { joinClaudeText } from "../../src/lib/claude-text";

// The Game Plan case: one bullet split around a citation.
assert.equal(
  joinClaudeText([
    { type: "text", text: "**Ghirardo CPA (Novato, CA)**\n- " },
    { type: "text", text: "A tax, accounting, and business services firm" },
    { type: "text", text: " with its main office in Novato." },
  ]),
  "**Ghirardo CPA (Novato, CA)**\n- A tax, accounting, and business services firm with its main office in Novato.",
);

// A search in the middle: paragraph break added.
assert.equal(
  joinClaudeText([
    { type: "text", text: "I'll pull a bit more detail." },
    { type: "server_tool_use" },
    { type: "web_search_tool_result" },
    { type: "text", text: "Founded in 1990." },
  ]),
  "I'll pull a bit more detail.\n\nFounded in 1990.",
);

// Model supplied its own newline: no double break.
assert.equal(
  joinClaudeText([
    { type: "text", text: "First.\n\n" },
    { type: "server_tool_use" },
    { type: "text", text: "Second." },
  ]),
  "First.\n\nSecond.",
);

// Leading tool blocks and empty text are ignored.
assert.equal(
  joinClaudeText([{ type: "server_tool_use" }, { type: "text", text: "" }, { type: "text", text: "Only." }]),
  "Only.",
);

console.log("claude-text: all assertions passed");
