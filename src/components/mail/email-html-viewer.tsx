"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { normalizeCopiedEmail } from "@/lib/email-address";

// Renders email bodies inside a sandboxed iframe so the email's own CSS
// can render without Ace's page styles leaking in or out. Required for
// newsletter-style emails (Quo, MailerLite, marketing blasts) whose dark
// backgrounds + centered cards depend on head-level <style> blocks that
// an inline render would collapse against Ace's typography rules.
//
// Every email renders on a WHITE canvas with dark text - the way Gmail
// shows mail on a white card - in BOTH light and dark Court Mode. We
// previously branched per message and blended plain-text bodies into the
// dark theme (transparent background + the live Court Mode foreground
// token). But received replies carry their own quoted markup, signatures,
// and occasionally baked-in colors that turned faint or invisible against
// a dark canvas - so received mail looked nothing like the clean white
// card a sent email shows. A consistent white card is the only rendering
// that's readable for every message (sent, received, plain, newsletter),
// so received mail now matches how sent mail looks.
//
// Newsletters that ship their own <style> / <body background> still win:
// buildSrcDoc splices our baseline <style> in FIRST, so a newsletter's
// later head styles override the white default and its design renders
// intact.
//
// Sandbox is `allow-popups allow-popups-to-escape-sandbox
// allow-same-origin`. Same-origin keeps the iframe's contentDocument
// readable from the parent so we can ResizeObserver it for auto-height;
// the lack of `allow-scripts` keeps any inline JS / event handlers
// inert, which is the real defense-in-depth layer (the server-side
// sanitize-html step is the first). `<base target="_blank">` injected
// into the head forces every link to open in a new tab.
//
// Plain-text bodies are wrapped in <pre> upstream by gmail.ts; the
// baseline CSS below preserves wrap behavior for those.

// Fixed email canvas. These hexes are the isolated iframe's own document
// styles - Court Mode tokens never reach inside an iframe, and email
// content is authored for a white background, so a fixed white card with
// dark text is correct here (this is not a Court Mode surface).
const EMAIL_CSS = `
  /* Pin text to its authored size. The body renders in a srcdoc iframe with
     no <meta name="viewport">, so mobile WebKit (the installed iOS PWA)
     auto-INFLATES text by its font-boost multiplier - which blew the
     BreakPoint signature's authored 18/11/13px name/title/links up to
     oversized in the reading pane. text-size-adjust:100% disables that
     inflation WITHOUT changing layout width (so fixed-width newsletters are
     unaffected) and is a no-op on desktop, where boosting is already off.
     Keep this: without it, signatures render oversized on mobile again. */
  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  html, body { margin: 0; padding: 0; }
  body {
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    font-size: 14px;
    line-height: 1.55;
    color: #1f2937;
    background: #ffffff;
    box-sizing: border-box;
    padding: 18px 20px;
    word-wrap: break-word;
  }
  pre { font-family: inherit; white-space: pre-wrap; word-break: break-word; margin: 0; padding: 0; }
  img { max-width: 100%; height: auto; border: 0; }
  blockquote {
    border-left: 2px solid #cbd5e1;
    margin: 12px 0;
    padding-left: 12px;
    color: #64748b;
  }
  a { color: #3F7030; }
`;

const MIN_EMAIL_HEIGHT = 80;

function measureEmailDocumentHeight(doc: Document): number {
  const body = doc.body;
  const root = doc.documentElement;
  if (!body || !root) return 0;

  let max = Math.max(
    body.scrollHeight,
    root.scrollHeight,
    body.offsetHeight,
    root.offsetHeight,
  );

  // Some newsletter templates put the whole email inside a 100%-height
  // scrollable wrapper. In that case html/body report only the iframe
  // viewport height, so include each descendant's scrollHeight too.
  const win = doc.defaultView;
  const rootTop = root.getBoundingClientRect().top;
  for (const el of Array.from(body.querySelectorAll<HTMLElement>("*"))) {
    const style = win?.getComputedStyle(el);
    if (style?.display === "none") continue;

    const rect = el.getBoundingClientRect();
    const top = rect.top - rootTop;
    const bottom = top + Math.max(
      rect.height,
      el.scrollHeight,
      el.offsetHeight,
    );
    if (Number.isFinite(bottom) && bottom > 0) {
      max = Math.max(max, bottom);
    }
  }

  return Math.ceil(max);
}

// Turn bare URLs / www links / email addresses that sit as plain TEXT in
// the body into real clickable anchors. Plain-text emails (account
// activations, password resets) and HTML emails that paste a raw link
// instead of wrapping it in <a> both leave the recruiter with inert text
// to copy-paste. We walk the parsed DOM's text nodes (decoded text, so no
// HTML-entity boundary ambiguity) and skip anything already inside an
// <a>/<script>/<style>, so existing links and newsletter markup are never
// touched. Only http(s)/www/mailto targets are produced — never
// javascript:/data: — and the href is set via the DOM (not string concat)
// so it can't break out of an attribute. When nothing matches we return
// the original html byte-for-byte, so richly-formatted newsletters (which
// already carry their own anchors) never get reserialized.
function linkifyHtml(html: string): string {
  if (!html) return html;
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    return html;
  }
  // Cheap pre-check: skip the parse entirely when the body has nothing
  // that could become a link.
  if (!/(?:https?:\/\/|www\.|@)/i.test(html)) return html;

  let doc: Document;
  try {
    doc = new window.DOMParser().parseFromString(html, "text/html");
  } catch {
    return html;
  }
  if (!doc.body) return html;

  const SKIP_TAGS = new Set(["A", "SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT"]);
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    current = walker.nextNode();
    const value = node.nodeValue;
    if (!value || !/(?:https?:\/\/|www\.|@)/i.test(value)) continue;
    let skip = false;
    let parent = node.parentElement;
    while (parent && parent !== doc.body) {
      if (SKIP_TAGS.has(parent.tagName)) {
        skip = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (skip) continue;
    targets.push(node);
  }

  let changed = false;
  for (const node of targets) {
    const frag = buildLinkFragment(node.nodeValue ?? "", doc);
    if (frag && node.parentNode) {
      node.parentNode.replaceChild(frag, node);
      changed = true;
    }
  }
  if (!changed) return html;
  // Reserialize the FULL document (not just body) so a newsletter's
  // <head>/<style> survives — buildSrcDoc handles the <html>/<head> shape.
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

// URL (group 1) or email address (group 2). The URL branch is greedy and
// listed first so an "@" inside a URL is consumed by the URL, not matched
// as an email.
const LINKIFY_RE =
  /((?:https?:\/\/|www\.)[^\s<>"']+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi;

function buildLinkFragment(text: string, doc: Document): DocumentFragment | null {
  const re = new RegExp(LINKIFY_RE.source, "gi");
  let last = 0;
  let m: RegExpExecArray | null;
  let any = false;
  const frag = doc.createDocumentFragment();
  while ((m = re.exec(text)) !== null) {
    const isEmail = m[2] != null;
    let token = m[0];
    // Peel trailing sentence punctuation / closing brackets so they stay
    // as plain text rather than 404-ing inside the href.
    let trailing = "";
    const trail = token.match(/[.,;:!?)\]}'"]+$/);
    if (trail && !isEmail) {
      trailing = token.slice(token.length - trail[0].length);
      token = token.slice(0, token.length - trail[0].length);
    }
    if (!token) continue;
    if (m.index > last) {
      frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
    }
    const a = doc.createElement("a");
    const href = isEmail
      ? `mailto:${token}`
      : /^www\./i.test(token)
        ? `https://${token}`
        : token;
    a.setAttribute("href", href);
    if (isEmail) a.setAttribute("data-copy-email", token);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.textContent = token;
    frag.appendChild(a);
    if (trailing) frag.appendChild(doc.createTextNode(trailing));
    last = m.index + m[0].length;
    any = true;
  }
  if (!any) return null;
  if (last < text.length) {
    frag.appendChild(doc.createTextNode(text.slice(last)));
  }
  return frag;
}

// Wrap the email body in a full HTML document so the iframe has a real
// <head> for the <base target=...> + baseline CSS. Three cases:
//   1. Body already has <head>  → splice our injection in.
//   2. Body has <html> but no <head> → add a <head> before <body>.
//   3. Body is a fragment (the common case for Gmail replies / signatures)
//      → wrap the whole thing in a doc shell.
function buildSrcDoc(bodyHtml: string, css: string): string {
  const headInjection = `<base target="_blank"><meta charset="utf-8"><style>${css}</style>`;
  if (/<head[\s>]/i.test(bodyHtml)) {
    return bodyHtml.replace(/<head([^>]*)>/i, `<head$1>${headInjection}`);
  }
  if (/<html[\s>]/i.test(bodyHtml)) {
    if (/<body[\s>]/i.test(bodyHtml)) {
      return bodyHtml.replace(/<body([^>]*)>/i, (_match, attrs) => `<head>${headInjection}</head><body${attrs}>`);
    }
    return bodyHtml.replace(/<html([^>]*)>/i, `<html$1><head>${headInjection}</head>`);
  }
  return `<!doctype html><html><head>${headInjection}</head><body>${bodyHtml}</body></html>`;
}

export function EmailHtmlViewer({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number>(MIN_EMAIL_HEIGHT);
  const [loadTick, setLoadTick] = useState(0);

  const srcDoc = useMemo(() => buildSrcDoc(linkifyHtml(html), EMAIL_CSS), [html]);

  useEffect(() => {
    setHeight(MIN_EMAIL_HEIGHT);
  }, [srcDoc]);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    let resizeObserver: ResizeObserver | null = null;
    const imgListeners: Array<{ img: HTMLImageElement; fn: () => void }> = [];
    const timers: number[] = [];
    let frame = 0;
    let copyDoc: Document | null = null;
    let copyHandler: ((event: ClipboardEvent) => void) | null = null;
    let contextMenuHandler: ((event: MouseEvent) => void) | null = null;

    const updateHeight = () => {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;
      const next = measureEmailDocumentHeight(doc);
      if (next > 0) {
        setHeight((current) =>
          Math.abs(current - next) > 1 ? Math.ceil(next) : current,
        );
      }
    };

    const findMailtoAnchor = (node: Node | null): HTMLAnchorElement | null => {
      let current: Node | null = node;
      while (current) {
        const el = current.nodeType === 1 ? (current as Element) : null;
        if (
          el?.tagName === "A" &&
          el.getAttribute("href")?.toLowerCase().startsWith("mailto:")
        ) {
          return el as HTMLAnchorElement;
        }
        current = current.parentNode;
      }
      return null;
    };

    const findMailtoAnchorInRange = (doc: Document, range: Range): HTMLAnchorElement | null => {
      const direct = findMailtoAnchor(range.commonAncestorContainer);
      if (direct) return direct;
      const wrapper = doc.createElement("div");
      wrapper.appendChild(range.cloneContents());
      for (const anchor of Array.from(wrapper.querySelectorAll("a"))) {
        if (anchor.getAttribute("href")?.toLowerCase().startsWith("mailto:")) {
          return anchor as HTMLAnchorElement;
        }
      }
      return null;
    };

    const scheduleUpdate = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateHeight();
      });
    };

    const clearImageListeners = () => {
      for (const { img, fn } of imgListeners) {
        img.removeEventListener("load", fn);
        img.removeEventListener("error", fn);
      }
      imgListeners.length = 0;
    };

    const clearCopyListener = () => {
      if (copyDoc && copyHandler) {
        copyDoc.removeEventListener("copy", copyHandler);
      }
      if (copyDoc && contextMenuHandler) {
        copyDoc.removeEventListener("contextmenu", contextMenuHandler);
      }
      copyDoc = null;
      copyHandler = null;
      contextMenuHandler = null;
    };

    const wireDocument = () => {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;
      clearCopyListener();
      copyHandler = (event: ClipboardEvent) => {
        const selection = doc.getSelection();
        if (!selection || selection.isCollapsed || !event.clipboardData) return;
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const anchor = range ? findMailtoAnchorInRange(doc, range) : null;
        if (!anchor) return;
        const raw = anchor.dataset.copyEmail || anchor.getAttribute("href") || selection.toString();
        const email = normalizeCopiedEmail(raw);
        if (!email || !email.includes("@")) return;
        event.clipboardData.setData("text/plain", email);
        event.clipboardData.setData("text/html", email);
        event.preventDefault();
      };
      contextMenuHandler = (event: MouseEvent) => {
        const anchor = findMailtoAnchor(event.target as Node | null);
        if (!anchor || typeof navigator === "undefined" || !navigator.clipboard) return;
        const raw = anchor.dataset.copyEmail || anchor.getAttribute("href") || anchor.textContent || "";
        const email = normalizeCopiedEmail(raw);
        if (!email || !email.includes("@")) return;
        event.preventDefault();
        void navigator.clipboard.writeText(email).then(() => {
          toast.success("Email copied", { description: email });
        });
      };
      copyDoc = doc;
      doc.addEventListener("copy", copyHandler);
      doc.addEventListener("contextmenu", contextMenuHandler);
      // Watch for late layout shifts (web fonts loading, lazy images,
      // reflow as remote CSS resolves). Disconnects on unmount or when
      // the html prop changes (effect re-runs).
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = new ResizeObserver(() => scheduleUpdate());
      resizeObserver.observe(doc.documentElement);
      resizeObserver.observe(doc.body);
      clearImageListeners();
      // Hide images that fail to load — Quo support emails ship a CDN
      // logo that the recipient network sometimes blocks; without this
      // the iframe reserves a giant empty rectangle.
      for (const img of Array.from(doc.images)) {
        if (img.complete && img.naturalWidth === 0) {
          img.style.display = "none";
          continue;
        }
        const fn = () => {
          if (img.complete && img.naturalWidth === 0) img.style.display = "none";
          scheduleUpdate();
        };
        img.addEventListener("load", fn);
        img.addEventListener("error", fn);
        imgListeners.push({ img, fn });
      }
      scheduleUpdate();
    };

    // srcDoc iframes can finish loading before this effect attaches.
    // Measure immediately and again after a few ticks so fast-loading
    // and late-layout emails both expand.
    wireDocument();
    for (const ms of [0, 50, 250, 1000]) {
      timers.push(window.setTimeout(wireDocument, ms));
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      for (const timer of timers) window.clearTimeout(timer);
      if (resizeObserver) resizeObserver.disconnect();
      clearCopyListener();
      clearImageListeners();
    };
  }, [srcDoc, loadTick]);

  return (
    <div className="w-full max-w-[840px] overflow-hidden rounded-xl border border-court-border bg-court-surface-subtle p-2 shadow-sm">
      <iframe
        ref={ref}
        srcDoc={srcDoc}
        onLoad={() => setLoadTick((tick) => tick + 1)}
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        title="Email body"
        style={{
          width: "100%",
          height: `${height}px`,
          border: "0",
          display: "block",
          // White email card in every Court Mode, so received mail reads the
          // same as sent mail. colorScheme:light keeps default UA controls
          // and form widgets light-mode to match the white canvas.
          background: "#ffffff",
          borderRadius: "8px",
          colorScheme: "light",
        }}
      />
    </div>
  );
}
