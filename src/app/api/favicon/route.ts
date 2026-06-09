import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 300_000;
const MAX_ICON_BYTES = 1_000_000;

function normalizeUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AceBot/1.0; +https://ace.breakpointtalent.com)",
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHomepage(url: URL): Promise<{ html: string; pageUrl: URL } | null> {
  const res = await fetchWithTimeout(url, { headers: { Accept: "text/html,application/xhtml+xml" } });
  const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
  if (!res.ok && !contentType.includes("text/html")) return null;
  const html = await res.text();
  return {
    html: html.slice(0, MAX_HTML_BYTES),
    pageUrl: normalizeUrl(res.url) ?? url,
  };
}

function attrsFor(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(tag))) {
    attrs[match[1].toLowerCase()] = decodeHtmlAttr(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'");
}

function faviconCandidates(pageUrl: URL, html: string): URL[] {
  const candidates: URL[] = [];
  const seen = new Set<string>();
  const push = (href: string) => {
    try {
      const url = new URL(href, pageUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      if (seen.has(url.href)) return;
      seen.add(url.href);
      candidates.push(url);
    } catch {
      // Ignore malformed third-party metadata.
    }
  };

  const linkRe = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html))) {
    const attrs = attrsFor(match[0]);
    const rel = (attrs.rel ?? "").toLowerCase();
    const href = attrs.href ?? "";
    if (!href) continue;
    if (rel.split(/\s+/).includes("icon") || rel.includes("apple-touch-icon")) {
      push(href);
    }
  }

  for (const href of logoImageCandidates(pageUrl, html)) {
    push(href);
  }
  for (const href of providerIconCandidates(pageUrl)) {
    push(href);
  }
  push("/favicon.ico");
  return candidates;
}

function logoImageCandidates(pageUrl: URL, html: string): string[] {
  const matches: Array<{ href: string; score: number }> = [];
  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html))) {
    const attrs = attrsFor(match[0]);
    const src = attrs.src ?? "";
    if (!src) continue;
    const haystack = [
      attrs.alt,
      attrs.title,
      attrs.class,
      attrs.id,
      src,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!/\b(logo|brand)\b/.test(haystack)) continue;
    if (/\b(button|badge|icon|spinner|avatar)\b/.test(haystack)) continue;

    let score = 0;
    if (/\blogo\b/.test(haystack)) score += 10;
    if (/\bbrand\b/.test(haystack)) score += 4;
    if (/\b(header|nav|masthead|z-logo)\b/.test(haystack)) score += 3;
    if (/\bfooter\b/.test(haystack)) score -= 2;
    if (/\bwhite\b|\brev\b/.test(haystack)) score -= 1;
    matches.push({ href: src, score });
  }
  return matches
    .sort((a, b) => b.score - a.score)
    .map((m) => {
      try {
        return new URL(m.href, pageUrl).href;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

function providerIconCandidates(pageUrl: URL): string[] {
  const host = pageUrl.hostname.replace(/^www\./i, "");
  if (!host) return [];
  return [
    `https://icons.duckduckgo.com/ip3/${host}.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
  ];
}

async function readImage(url: URL): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const res = await fetchWithTimeout(url, { headers: { Accept: "image/*" } });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) return null;
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ICON_BYTES) return null;
  return { bytes, contentType };
}

export async function GET(req: NextRequest) {
  const rawDomain = req.nextUrl.searchParams.get("domain") ?? "";
  const pageUrl = normalizeUrl(rawDomain);
  if (!pageUrl) return new NextResponse(null, { status: 404 });

  const homepage = await fetchHomepage(pageUrl).catch(() => null);
  const iconBaseUrl = homepage?.pageUrl ?? pageUrl;
  for (const candidate of faviconCandidates(iconBaseUrl, homepage?.html ?? "")) {
    const image = await readImage(candidate).catch(() => null);
    if (!image) continue;
    return new NextResponse(image.bytes, {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
