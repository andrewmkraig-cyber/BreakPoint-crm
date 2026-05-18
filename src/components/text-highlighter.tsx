"use client";

import { useEffect } from "react";

// DOM-walker highlighter. Mount this component inside an embed view
// with the active search tokens to wrap every case-insensitive
// occurrence of each token in a <mark>. Returns null — render once at
// the top of the embed shell.
//
// Why a DOM walker and not per-component <Highlight> wrappers? The
// candidate embed renders 4-6 different cards (compact overview,
// resume, skills, activity), each of which renders an arbitrary mix
// of text. Threading a `tokens` prop through every one of those
// components is invasive and easy to forget on the next card we add.
// Walking the rendered tree on mount catches resume-derived text in
// every card without each card opting in.
//
// Skips text inside form controls (input/textarea/option), embedded
// objects (object/iframe), already-marked nodes, and script/style so
// we don't break syntax / corrupt mutable state. Buttons + anchors
// are still walked so skill chips rendered as clickable spans get
// marked correctly.
export function TextHighlighter({
  tokens,
  containerId,
}: {
  tokens: string[];
  // Optional scope. When set, we only walk the subtree of the element
  // with that id (skips the iframe-host's own chrome). Defaults to
  // document.body, which is fine for the candidate embed since
  // AppShell strips its top/side chrome under ?embed=true.
  containerId?: string;
}) {
  useEffect(() => {
    if (!tokens || tokens.length === 0) return;
    const root: HTMLElement | null = containerId
      ? document.getElementById(containerId)
      : document.body;
    if (!root) return;

    const escaped = tokens.map(escapeRegex).filter(Boolean);
    if (escaped.length === 0) return;
    // \b word boundaries mirror PdfCanvasViewer's overlay pattern so
    // "tax" never matches "syntax"/"taxonomy". Without them the DOM
    // walker and the PDF overlay would disagree on what counts as a hit.
    const pattern = `\\b(${escaped.join("|")})\\b`;

    // Re-run on next paint so React has committed the initial render
    // before we mutate text nodes — mid-commit mutation can drop
    // hydration markers in dev.
    const handle = requestAnimationFrame(() => {
      walkAndWrap(root, pattern);
    });
    return () => cancelAnimationFrame(handle);
  }, [tokens, containerId]);

  return null;
}

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "TEXTAREA",
  "INPUT",
  "OPTION",
  "MARK",
  "OBJECT",
  "IFRAME",
  "NOSCRIPT",
]);

function walkAndWrap(root: HTMLElement, pattern: string): void {
  // Gather first, mutate after. Walking + mutating in the same pass
  // skips the second-token-on-the-same-node case because TreeWalker's
  // cursor is invalidated by replaceChild.
  const targets: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      const text = node.nodeValue ?? "";
      if (!text.trim()) return NodeFilter.FILTER_SKIP;
      // Fresh regex per check — `test()` advances lastIndex which
      // would mis-skip subsequent nodes if reused.
      const probe = new RegExp(pattern, "i");
      return probe.test(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode())) targets.push(n as Text);

  for (const node of targets) {
    const text = node.nodeValue ?? "";
    const re = new RegExp(pattern, "gi");
    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement("mark");
      mark.className = "rounded-sm bg-amber-100 px-0.5 text-amber-900";
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
