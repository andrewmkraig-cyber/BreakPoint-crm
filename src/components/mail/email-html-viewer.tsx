"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Renders email bodies inside a sandboxed iframe so the email's own CSS
// can render without Ace's page styles leaking in or out. Required for
// newsletter-style emails (Quo, MailerLite, marketing blasts) whose dark
// backgrounds + centered cards depended on head-level <style> blocks that
// an inline render would have collapsed against Ace's typography rules.
//
// Two rendering modes, chosen per message by isSelfStyled():
//   - SELF-STYLED (newsletters): white canvas + dark text + colorScheme
//     light, so the sender's original design renders intact — exactly like
//     Gmail shows HTML mail on a white card.
//   - SIMPLE (plain-text bodies + basic replies that ship no design of
//     their own): transparent background + the live Court Mode foreground
//     token, so the message reads like a native part of the dark/light UI
//     instead of a white rectangle floating in a dark app.
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

// Self-styled emails (newsletters / marketing / anything that ships its
// own <table> layout, <style> block, or background) get a white canvas so
// the sender's original design renders the way they built it.
const SELF_STYLED_CSS = `
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

type ResolvedTheme = {
  fg: string;
  muted: string;
  border: string;
  accent: string;
  isDark: boolean;
};

// Resolve the live Court Mode tokens so the simple-body iframe (its own
// document, where Tailwind classes / CSS vars never reach) can paint with
// the exact foreground the rest of the UI uses. Keyword fallbacks only
// matter for the SSR pass — this component is client-fetched, so the
// browser always resolves real token values before paint.
function readTheme(): ResolvedTheme {
  if (typeof document === "undefined") {
    return {
      fg: "CanvasText",
      muted: "GrayText",
      border: "GrayText",
      accent: "LinkText",
      isDark: false,
    };
  }
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => {
    const raw = cs.getPropertyValue(name).trim();
    return raw ? `rgb(${raw})` : fallback;
  };
  return {
    fg: v("--court-fg", "CanvasText"),
    muted: v("--court-fg-muted", "GrayText"),
    border: v("--court-border", "GrayText"),
    accent: v("--court-accent", "LinkText"),
    isDark: document.documentElement.getAttribute("data-theme") === "dark",
  };
}

function simpleCss(t: ResolvedTheme): string {
  return `
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: ${t.fg};
    background: transparent;
    word-wrap: break-word;
  }
  /* No internal padding — the surrounding message block already insets the
     body, so the text lines up under the sender row like Gmail. */
  pre { font-family: inherit; white-space: pre-wrap; word-break: break-word; margin: 0; padding: 0; }
  img { max-width: 100%; height: auto; border: 0; }
  blockquote {
    border-left: 2px solid ${t.border};
    margin: 12px 0;
    padding-left: 12px;
    color: ${t.muted};
  }
  a { color: ${t.accent}; }
`;
}

// A body is "self-styled" when it ships its own layout/design and would
// break (or look wrong) re-themed: full documents, table-based newsletter
// layouts, <style> blocks, or any explicit background. Everything else —
// plain-text <pre> from gmail.ts, simple typed replies and signatures — is
// rendered transparent so it blends into Court Mode.
function isSelfStyled(html: string): boolean {
  return /<!doctype|<html[\s>]|<body[\s>]|<table[\s>]|<style[\s>]|bgcolor=|background-color\s*:|background\s*:/i.test(
    html,
  );
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
  const [height, setHeight] = useState<number>(80);
  const [theme, setTheme] = useState<ResolvedTheme>(readTheme);

  const selfStyled = useMemo(() => isSelfStyled(html), [html]);

  // Re-resolve tokens whenever the recruiter switches surface/theme so an
  // open simple-body email repaints to match without a reload.
  useEffect(() => {
    if (selfStyled) return;
    const root = document.documentElement;
    const update = () => setTheme(readTheme());
    update();
    const mo = new MutationObserver(update);
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-surface"] });
    return () => mo.disconnect();
  }, [selfStyled]);

  const srcDoc = useMemo(
    () => buildSrcDoc(html, selfStyled ? SELF_STYLED_CSS : simpleCss(theme)),
    [html, selfStyled, theme],
  );

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
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      srcDoc={srcDoc}
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      title="Email body"
      style={{
        width: "100%",
        height: `${height}px`,
        border: "0",
        display: "block",
        background: "transparent",
        colorScheme: selfStyled ? "light" : theme.isDark ? "dark" : "light",
      }}
    />
  );
}
