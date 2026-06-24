// Shared rules and small render helpers for Claude-generated free-form output.
// Keep this file dependency-free: it is imported from both server routes and
// client-side merge-field helpers.

export const MARKDOWN_OUTPUT_FORMAT_RULES = [
  "FREE-FORM OUTPUT FORMAT RULES:",
  "- Use **bold** section headers for any section heading or label in structured output.",
  "- When a section has multiple responsibilities, requirements, qualifications, steps, tips, talking points, takeaways, jobs, companies, or options, format those items as a real list. Do not collapse list-like content into a paragraph.",
  "- Use hyphen bullets (`- `) for unordered lists in markdown/plain-text surfaces. Use numbered lists only when order or ranking matters.",
  "- Keep one blank line before each bold section header and before each list so markdown renderers preserve the structure.",
].join("\n");

export const HTML_EMAIL_OUTPUT_FORMAT_RULES = [
  "HTML EMAIL FORMAT RULES:",
  "- Use <strong>...</strong> for section headers and short section labels.",
  "- When a section has multiple responsibilities, requirements, qualifications, steps, tips, talking points, takeaways, jobs, companies, or options, use real <ul><li>...</li></ul> or <ol><li>...</li></ol> lists. Do not collapse list-like content into a paragraph.",
  "- Use <p> for paragraphs. No <html>/<body> wrapper and no inline styles.",
].join("\n");

const BULLET_RE = /^\s*[-*+\u2022]\s+(.+)$/;
const NUMBER_RE = /^\s*\d+[.)]\s+(.+)$/;

export function markdownishTextToEmailHtml(raw: string): string {
  const normalized = raw.replace(/\r\n|\r/g, "\n").trim();
  if (!normalized) return "";

  return normalized
    .split(/\n{2,}/)
    .map((block) => renderMarkdownishBlock(block))
    .filter(Boolean)
    .join("");
}

export function convertInlineMarkdownToHtml(html: string): string {
  return html
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]\n]+?)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
      '<a href="$2">$1</a>',
    );
}

function renderMarkdownishBlock(block: string): string {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  const parts: string[] = [];
  let paragraphLines: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    parts.push(
      `<p>${paragraphLines
        .map((line) => convertInlineMarkdownToHtml(escapeHtml(line)))
        .join("<br/>")}</p>`,
    );
    paragraphLines = [];
  }

  function flushList() {
    if (!listKind || listItems.length === 0) return;
    const tag = listKind;
    parts.push(
      `<${tag}>${listItems
        .map((item) => `<li>${convertInlineMarkdownToHtml(escapeHtml(item))}</li>`)
        .join("")}</${tag}>`,
    );
    listKind = null;
    listItems = [];
  }

  for (const line of lines) {
    const heading = standaloneHeadingText(line);
    if (heading) {
      flushParagraph();
      flushList();
      parts.push(`<p><strong>${escapeHtml(ensureColon(heading))}</strong></p>`);
      continue;
    }

    const bullet = line.match(BULLET_RE);
    const number = line.match(NUMBER_RE);
    if (bullet || number) {
      flushParagraph();
      const nextKind = bullet ? "ul" : "ol";
      if (listKind && listKind !== nextKind) flushList();
      listKind = nextKind;
      listItems.push((bullet?.[1] ?? number?.[1] ?? "").trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return parts.join("");
}

function standaloneHeadingText(line: string): string | null {
  const markdownHeading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
  if (markdownHeading) return stripWrappingBold(markdownHeading[1].trim());

  const boldHeading = line.match(/^\*\*(.+?)\*\*$/);
  if (boldHeading) return stripWrappingBold(boldHeading[1].trim());

  if (
    /^[A-Z][A-Za-z0-9 /&()'.,-]{1,90}:\s*$/.test(line) &&
    !/[.!?]\s*$/.test(line)
  ) {
    return line.replace(/:\s*$/, "").trim();
  }

  return null;
}

function stripWrappingBold(text: string): string {
  return text.replace(/^\*\*/, "").replace(/\*\*$/, "").trim();
}

function ensureColon(text: string): string {
  return text.endsWith(":") ? text : `${text}:`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
