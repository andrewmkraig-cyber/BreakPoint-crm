"use client";

import { useEffect, useRef, useState } from "react";

// Renders rich HTML email bodies inside a sandboxed iframe so the
// email's own CSS can render without Ace's page styles leaking in or
// out. Required for newsletter-style emails (Quo, MailerLite, marketing
// blasts) whose dark backgrounds + centered cards depended on
// head-level <style> blocks that an inline render would have collapsed
// against Ace's typography rules.
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

const BASELINE_CSS = `
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #1f2937;
    background: #ffffff;
    word-wrap: break-word;
  }
  /* Newsletter HTML often nests its content in a single <table>; align
     the iframe's default to centered so emails that lean on <center>
     and table align="center" still feel like the original. */
  pre { font-family: inherit; white-space: pre-wrap; word-break: break-word; margin: 0; padding: 12px 16px; }
  img { max-width: 100%; height: auto; border: 0; }
  blockquote {
    border-left: 2px solid #cbd5e1;
    margin: 12px 0;
    padding-left: 12px;
    color: #64748b;
  }
  a { color: #3F7030; }
`;

// Wrap the email body in a full HTML document so the iframe has a real
// <head> for the <base target=...> + baseline CSS. Three cases:
//   1. Body already has <head>  → splice our injection in.
//   2. Body has <html> but no <head> → add a <head> before <body>.
//   3. Body is a fragment (the common case for Gmail replies / signatures)
//      → wrap the whole thing in a doc shell.
function buildSrcDoc(bodyHtml: string): string {
  const headInjection = `<base target="_blank"><meta charset="utf-8"><style>${BASELINE_CSS}</style>`;
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
  const [height, setHeight] = useState<number>(80);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    let resizeObserver: ResizeObserver | null = null;
    const imgListeners: Array<{ img: HTMLImageElement; fn: () => void }> = [];

    const updateHeight = () => {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;
      // scrollHeight of <html> handles the case where body is shorter
      // than its content (some newsletters set explicit body height).
      const next = Math.max(
        doc.body.scrollHeight,
        doc.documentElement.scrollHeight,
      );
      if (next > 0) setHeight(Math.ceil(next));
    };

    const onLoad = () => {
      updateHeight();
      const doc = iframe.contentDocument;
      if (!doc?.body) return;
      // Watch for late layout shifts (web fonts loading, lazy images,
      // reflow as remote CSS resolves). Disconnects on unmount or when
      // the html prop changes (effect re-runs).
      resizeObserver = new ResizeObserver(() => updateHeight());
      resizeObserver.observe(doc.body);
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
          updateHeight();
        };
        img.addEventListener("load", fn);
        img.addEventListener("error", fn);
        imgListeners.push({ img, fn });
      }
    };

    iframe.addEventListener("load", onLoad);
    return () => {
      iframe.removeEventListener("load", onLoad);
      if (resizeObserver) resizeObserver.disconnect();
      for (const { img, fn } of imgListeners) {
        img.removeEventListener("load", fn);
        img.removeEventListener("error", fn);
      }
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      srcDoc={buildSrcDoc(html)}
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      title="Email body"
      style={{
        width: "100%",
        height: `${height}px`,
        border: "0",
        display: "block",
        background: "transparent",
        colorScheme: "light",
      }}
    />
  );
}
