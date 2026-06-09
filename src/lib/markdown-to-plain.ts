// Pure helper for collapsing markdown syntax back to plain text.
// Extracted out of `lib/claude.ts` so client-side modules (e.g.
// merge-fields.ts) can call it without dragging the Anthropic SDK into
// the browser bundle.
//
// Converts # / ## / ### headers into plain text, collapses **bold** and
// _italic_ markers, and rewrites "- " / "* " bullet lines to use the •
// glyph. Also strips em/en dashes — banned punctuation in Ace copy.
export function stripMarkdownToPlain(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    let line = raw;
    // Drop leading heading markers (## / ### / # etc).
    line = line.replace(/^\s{0,3}#{1,6}\s*/, "");
    // Convert "* text" / "- text" bullets to "• text" (leading whitespace preserved).
    line = line.replace(/^(\s*)[-*+]\s+/, "$1• ");
    // Drop **bold** / __bold__ wrappers while keeping inner text.
    line = line.replace(/\*\*(.+?)\*\*/g, "$1");
    line = line.replace(/__(.+?)__/g, "$1");
    // Drop single-* italic wrappers only when they look like pairs, not inside words.
    line = line.replace(/(^|\s)\*(?!\s)(.+?)(?<!\s)\*(?=\s|$|[.,;:!?)])/g, "$1$2");
    line = line.replace(/(^|\s)_(?!\s)(.+?)(?<!\s)_(?=\s|$|[.,;:!?)])/g, "$1$2");
    // Banned punctuation: em dashes (`—`) and en dashes (`–`). Andrew
    // reads them as ChatGPT-flavored writing, so strip them codebase-
    // wide. Replace with a comma + space, which is what the model
    // usually meant.
    line = line.replace(/\s*[–—]\s*/g, ", ");
    out.push(line);
  }
  // Collapse 3+ blank lines into 2 blanks.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Strip ONLY the banned em/en dashes (Andrew reads them as AI-flavored) while
// LEAVING markdown syntax intact - for summaries that stay markdown and render
// through MarkdownProse as a real bullet list. The ASCII hyphen-minus used by
// `- ` bullets is U+002D and is not matched here, so list markers survive.
export function stripBannedDashes(text: string): string {
  return text.replace(/\s*[–—]\s*/g, ", ").trim();
}
