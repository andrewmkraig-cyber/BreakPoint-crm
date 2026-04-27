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
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.55; color: #111111; white-space: pre-wrap;">${underlined}</div>`;
}

// Strips the bold / underline markers for the text/plain alternative so clients
// that render plain text (or an email pipeline that falls through to text) see
// clean copy instead of raw `**Comp Target:**` strings. Dash bullets stay
// intact because recipients and plain-text clients render them correctly.
export function submittalToPlainText(body: string): string {
  return body.replace(BOLD_RE, "$1").replace(UNDERLINE_RE, "$1");
}

// Converts Claude's marker-style submittal writeup into Tiptap-digestible
// HTML. Paragraph breaks in the source (blank lines) become <p> blocks; single
// newlines inside a paragraph become <br/> — that matches how the recruiter
// sees it in Gmail. Bold / underline markers are escaped first, then replaced,
// so a raw `<script>` in the AI's output can never become real markup.
export function submittalMarkdownToEditorHtml(body: string): string {
  const escaped = escapeHtml(body);
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => block.replace(/\n/g, "<br/>"))
    .map((block) => `<p>${block}</p>`)
    .join("");
  const bolded = paragraphs.replace(BOLD_RE, "<strong>$1</strong>");
  const underlined = bolded.replace(UNDERLINE_RE, "<u>$1</u>");
  return underlined || "<p></p>";
}

// Reverse conversion for the Gmail text/plain alternative when the client
// sends rich HTML from Tiptap. We don't ship a full HTML-to-text serializer
// because the editor's schema is deliberately narrow (paragraphs, <br>, bold,
// underline). Strip tags, decode entities, and collapse runs of blank lines.
export function submittalEditorHtmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
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

// Wraps raw editor HTML in the same outer font-family / line-height div that
// submittalToHtml uses, so recipients see identical type styling whether the
// body came from the markdown or the Tiptap path.
export function wrapEditorHtmlForGmail(html: string): string {
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.55; color: #111111;">${html}</div>`;
}
