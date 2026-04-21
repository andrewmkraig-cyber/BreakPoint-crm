// Lightweight markdown-ish converter for the submittal email body. The
// composer keeps the body in a plain textarea, but uses `**bold**` and
// `__underline__` markers so the recruiter can format section headers and
// Claude-generated writeups with real bold/underline in the Gmail draft.
//
// Why this instead of a full contentEditable rich editor: the composer's
// templates, merge fields, autosave, and Claude integration all operate on a
// single `body` string. Keeping it as a string with markdown-ish markers means
// every existing code path (localStorage autosave, applyMergeFields, template
// resolution) stays identical — only the on-the-wire conversion changes.

const BOLD_RE = /\*\*([\s\S]+?)\*\*/g;
const UNDERLINE_RE = /__([\s\S]+?)__/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Converts the composer's body into the HTML we send as the Gmail text/html
// alternative. Order matters: escape first (so inline HTML never leaks), then
// apply the bold/underline transforms on the escaped output. Line breaks map
// to <br/> so recipients see the same paragraph shape as the plain text
// version (the white-space:pre-wrap wrapper keeps indentation too).
export function submittalToHtml(body: string): string {
  const escaped = escapeHtml(body);
  const bolded = escaped.replace(BOLD_RE, "<strong>$1</strong>");
  const underlined = bolded.replace(UNDERLINE_RE, "<u>$1</u>");
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.55; color: #0f1b2d; white-space: pre-wrap;">${underlined}</div>`;
}

// Strips the bold / underline markers for the text/plain alternative so clients
// that render plain text (or an email pipeline that falls through to text) see
// clean copy instead of raw `**Comp Target:**` strings. Dash bullets stay
// intact because recipients and plain-text clients render them correctly.
export function submittalToPlainText(body: string): string {
  return body.replace(BOLD_RE, "$1").replace(UNDERLINE_RE, "$1");
}
