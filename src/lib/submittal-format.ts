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

import { markdownishTextToEmailHtml } from "@/lib/ai-output-formatting";

const BOLD_RE = /\*\*([\s\S]+?)\*\*/g;
const UNDERLINE_RE = /__([\s\S]+?)__/g;

// Converts the composer's body into the HTML we send as the Gmail text/html
// alternative. Section headers become <strong> and dash bullets become real
// lists, so generated writeups render like edited Gmail copy.
export function submittalToHtml(body: string): string {
  const rendered = markdownishTextToEmailHtml(body).replace(UNDERLINE_RE, "<u>$1</u>");
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.55; color: #111111;">${rendered}</div>`;
}

// Strips the bold / underline markers for the text/plain alternative so clients
// that render plain text (or an email pipeline that falls through to text) see
// clean copy instead of raw `**Comp Target:**` strings. Dash bullets stay
// intact because recipients and plain-text clients render them correctly.
export function submittalToPlainText(body: string): string {
  return body.replace(BOLD_RE, "$1").replace(UNDERLINE_RE, "$1");
}

// Converts Claude's marker-style submittal writeup into Tiptap-digestible
// HTML with real list nodes for bullet sections.
export function submittalMarkdownToEditorHtml(body: string): string {
  const underlined = markdownishTextToEmailHtml(body).replace(UNDERLINE_RE, "<u>$1</u>");
  return underlined || "<p></p>";
}

// Reverse conversion for the Gmail text/plain alternative when the client
// sends rich HTML from Tiptap. We don't ship a full HTML-to-text serializer
// because the editor's schema is deliberately narrow (paragraphs, <br>, bold,
// underline). Strip tags, decode entities, and collapse runs of blank lines.
export function submittalEditorHtmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/<\/?(?:strong|b|u|em|i|span)[^>]*>/gi, "");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  const decoded = stripped
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return decoded.replace(/\n{3,}/g, "\n\n").trim();
}

// The editor-HTML Gmail wrapper now lives in src/lib/email-html.ts as the
// single shared wrapEmailHtml (consolidated with merge-fields' old
// htmlEmailWrap so the container can never drift). Callers import it directly.
