// Join Claude's text blocks back into one string the way the model wrote
// it. With web search on, a reply arrives as MANY small text blocks split
// around each citation, often mid-sentence. Gluing those with "\n\n" turns
// "- A tax, accounting, and business services firm" into an empty bullet
// and a stray paragraph (Game Plan, 2026-10-21). Adjacent text blocks are
// one continuous passage and concatenate directly; a paragraph break is
// only added where a tool call sat between two text blocks and the model
// did not supply its own newline.
//
// Pure helper, no server-only import, so the chat stream can share the
// same rule.

export type ClaudeContentBlock = { type: string; text?: string };

export function joinClaudeText(content: ReadonlyArray<ClaudeContentBlock>): string {
  let out = "";
  let gapPending = false;
  for (const b of content) {
    if (b.type === "text") {
      const t = b.text ?? "";
      if (!t) continue;
      if (gapPending && out && !/\n$/.test(out) && !/^\n/.test(t)) out += "\n\n";
      out += t;
      gapPending = false;
    } else if (out) {
      gapPending = true;
    }
  }
  return out.trim();
}
