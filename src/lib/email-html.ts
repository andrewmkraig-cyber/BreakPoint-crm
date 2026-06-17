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
//
// Pure string helpers — safe to import from both client components and server
// code. Keep EMAIL_BODY_CONTAINER_STYLE byte-identical to the prior wrappers
// so existing submittal / bulk / template emails render exactly as before.

const EMAIL_BODY_CONTAINER_STYLE =
  "font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.55; color: #111111;";

// Wrap already-HTML body content (no escaping) in the shared container so
// <strong>/<u>/<p> survive into the inbox with consistent spacing.
export function wrapEmailHtml(html: string): string {
  return `<div style="${EMAIL_BODY_CONTAINER_STYLE}">${html}</div>`;
}

// True when a body already opens with the shared container, so callers can
// guard against double-wrapping. Matches only the exact signature wrapEmailHtml
// emits; the submittal text path's pre-wrap variant (submittalToHtml adds
// `white-space: pre-wrap`) is intentionally NOT matched here.
export function isEmailHtmlWrapped(html: string): boolean {
  return html.trimStart().startsWith(`<div style="${EMAIL_BODY_CONTAINER_STYLE}"`);
}

// Wrap exactly once: returns the body unchanged when it is already wrapped.
// Used by the mail/reply send route, where an incoming body is normally raw
// editor HTML but could in principle already be wrapped.
export function ensureEmailHtmlWrapped(html: string): string {
  return isEmailHtmlWrapped(html) ? html : wrapEmailHtml(html);
}
