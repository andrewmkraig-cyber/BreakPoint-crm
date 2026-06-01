"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

  const srcDoc = useMemo(() => buildSrcDoc(html, EMAIL_CSS), [html]);

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

    const wireDocument = () => {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;
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
