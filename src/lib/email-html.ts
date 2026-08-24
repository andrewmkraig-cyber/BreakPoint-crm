import render from "dom-serializer";
import { isTag, isText, type AnyNode, type ChildNode, type Element } from "domhandler";
import { parseDocument } from "htmlparser2";

// Single shared wrapper for outgoing email HTML bodies. Every Ace composer's
// Tiptap editor emits the same paragraph HTML (<p>...</p> on Enter); this
// container is what makes the SENT email render with consistent type and line
// spacing in the recipient's inbox (Arial / 14px / line-height 1.55 / #111111).
//
// This used to exist as two byte-identical copies — htmlEmailWrap (merge-
// fields.ts) and wrapEditorHtmlForGmail (submittal-format.ts) — while the
// mail/reply send route wrapped nothing at all, so New Email and Reply
// inherited the recipient client's default spacing and looked different from
// the submittal. Consolidated here so the one container can never drift, and
// routed through the mail send path so all three composers match.

const EMAIL_BODY_CONTAINER_STYLE =
  "font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.55; color: #111111;";

const EMAIL_BLOCK_STYLE = "margin: 0 0 12px 0; line-height: 1.55;";
const EMAIL_HEADING_STYLE =
  "margin: 0 0 12px 0; line-height: 1.35; font-weight: 700;";
const EMAIL_LIST_STYLE = "margin: 0 0 12px 0; padding-left: 22px; line-height: 1.55;";
const EMAIL_LIST_ITEM_STYLE = "margin: 0 0 4px 0; line-height: 1.55;";
const EMAIL_LIST_CHILD_STYLE = "margin: 0; line-height: 1.55;";
const EMAIL_BLOCKQUOTE_STYLE =
  "margin: 0 0 12px 12px; padding-left: 12px; border-left: 2px solid #d0d7de; line-height: 1.55;";

const REMOVABLE_TAGS = new Set(["script", "style", "meta", "link"]);
const BLOCK_TAGS = new Set(["p", "div"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const LIST_TAGS = new Set(["ul", "ol"]);
const SPACING_STYLE_KEYS = new Set([
  "font-family",
  "font-size",
  "line-height",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
]);

// Normalize already-HTML body content before wrapping. Pasted Gmail /
// Google Docs / web snippets can bring their own paragraph margins and
// line heights; Gmail honors those inline styles, which makes copied
// content look different from Ace templates. We keep semantic tags and
// recruiter formatting, but make block spacing Ace-owned.
export function normalizeEmailBodyHtml(html: string): string {
  const source = unwrapEmailHtml(html).trim();
  if (!source) return "";

  const doc = parseDocument(source, { decodeEntities: false });
  doc.children = normalizeNodes(doc.children, []) as ChildNode[];
  return render(doc.children, { encodeEntities: "utf8" });
}

// Wrap already-HTML body content (no escaping) in the shared container so
// <strong>/<u>/<p> survive into the inbox with consistent spacing.
export function wrapEmailHtml(html: string): string {
  return `<div style="${EMAIL_BODY_CONTAINER_STYLE}">${normalizeEmailBodyHtml(html)}</div>`;
}

// True when a body already opens with the shared container, so callers can
// guard against double-wrapping. Matches only the exact signature wrapEmailHtml
// emits; the submittal text path's pre-wrap variant (submittalToHtml adds
// `white-space: pre-wrap`) is intentionally NOT matched here.
export function isEmailHtmlWrapped(html: string): boolean {
  return html.trimStart().startsWith(`<div style="${EMAIL_BODY_CONTAINER_STYLE}"`);
}

// Wrap exactly once and normalize even when an old draft/body is already
// wrapped. Used by the mail/reply send route, where an incoming body is
// normally raw editor HTML but could in principle already be wrapped.
export function ensureEmailHtmlWrapped(html: string): string {
  return wrapEmailHtml(html);
}

function normalizeNodes(nodes: ChildNode[], ancestors: Element[]): ChildNode[] {
  const normalized: ChildNode[] = [];
  for (const node of nodes) {
    if (isTag(node)) {
      const tag = node.name.toLowerCase();
      if (REMOVABLE_TAGS.has(tag)) continue;

      applyAceSpacing(node, ancestors);
      node.children = normalizeNodes(node.children, [...ancestors, node]);
    }
    normalized.push(node);
  }
  return normalized;
}

function applyAceSpacing(el: Element, ancestors: Element[]): void {
  const tag = el.name.toLowerCase();
  const parentTag = ancestors.at(-1)?.name.toLowerCase();

  if (BLOCK_TAGS.has(tag)) {
    mergeStyle(el, styleMap(parentTag === "li" ? EMAIL_LIST_CHILD_STYLE : EMAIL_BLOCK_STYLE));
    return;
  }

  if (HEADING_TAGS.has(tag)) {
    mergeStyle(el, styleMap(EMAIL_HEADING_STYLE));
    return;
  }

  if (LIST_TAGS.has(tag)) {
    mergeStyle(el, styleMap(EMAIL_LIST_STYLE));
    return;
  }

  if (tag === "li") {
    mergeStyle(el, styleMap(EMAIL_LIST_ITEM_STYLE));
    return;
  }

  if (tag === "blockquote") {
    mergeStyle(el, styleMap(EMAIL_BLOCKQUOTE_STYLE));
  }
}

function unwrapEmailHtml(html: string): string {
  if (!isEmailHtmlWrapped(html)) return html;

  const doc = parseDocument(html, { decodeEntities: false });
  const meaningful = doc.children.filter((node) => {
    if (isText(node)) return node.data.trim().length > 0;
    return isTag(node);
  });

  if (meaningful.length !== 1) return html;
  const [only] = meaningful;
  if (!isTag(only) || only.name.toLowerCase() !== "div") return html;
  if (!sameStyleSignature(only.attribs.style, EMAIL_BODY_CONTAINER_STYLE)) return html;

  return render(only.children as AnyNode[], { encodeEntities: "utf8" });
}

function mergeStyle(el: Element, enforced: Record<string, string>): void {
  const preserved = styleMap(el.attribs.style ?? "");
  SPACING_STYLE_KEYS.forEach((key) => {
    delete preserved[key];
  });
  const next = { ...preserved, ...enforced };
  el.attribs.style = styleString(next);
}

function sameStyleSignature(a: string | undefined, b: string): boolean {
  const left = styleMap(a ?? "");
  const right = styleMap(b);
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;
  return rightEntries.every(([key, value]) => left[key] === value);
}

function styleMap(style: string): Record<string, string> {
  return style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const colon = part.indexOf(":");
      if (colon < 0) return acc;
      const key = part.slice(0, colon).trim().toLowerCase();
      const value = part.slice(colon + 1).trim();
      if (key && value) acc[key] = value;
      return acc;
    }, {});
}

function styleString(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
}
