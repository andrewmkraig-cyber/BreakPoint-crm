import { prisma } from "@/lib/prisma";
import { getEmailSignature } from "@/lib/preferences";

// Gmail API helpers. We keep a single refresh token per user in the Account
// row NextAuth's PrismaAdapter populated on first sign-in. For every Gmail
// call we exchange that refresh token for a fresh access token (Google access
// tokens expire in ~1 hour) and then hit the REST API directly.
//
// The user must have granted `gmail.send` during OAuth consent. If the
// refresh token is missing (older sign-ins before scope was added), we return
// a clear error pointing them to re-auth.

type GoogleAccount = {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
};

async function getGoogleAccount(userId: string): Promise<GoogleAccount | null> {
  const acct = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { access_token: true, refresh_token: true, expires_at: true },
  });
  return acct ?? null;
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth env vars missing (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token refresh failed (${res.status}): ${text || "no body"}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  const expiresAt = Math.floor(Date.now() / 1000) + (json.expires_in ?? 3600);
  return { accessToken: json.access_token, expiresAt };
}

// Returns a usable access token for the user. Reuses the stored one if it's
// still valid for at least 60s; otherwise refreshes and persists the new one.
async function getFreshAccessToken(userId: string): Promise<string> {
  const acct = await getGoogleAccount(userId);
  if (!acct || !acct.refresh_token) {
    throw new Error(
      "No Google refresh token on file. Sign out and sign back in to grant Gmail permissions.",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (acct.access_token && acct.expires_at && acct.expires_at - now > 60) {
    return acct.access_token;
  }
  const { accessToken, expiresAt } = await refreshAccessToken(acct.refresh_token);
  await prisma.account.updateMany({
    where: { userId, provider: "google" },
    data: { access_token: accessToken, expires_at: expiresAt },
  });
  return accessToken;
}

export type GmailAttachment = {
  filename: string;
  mimeType: string;
  data: Uint8Array;
};

export type SendEmailInput = {
  userId: string;
  from: string; // the sender's address (must match the authenticated user)
  fromName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  threadId?: string;
  attachments?: GmailAttachment[];
  // RFC 5322 threading headers. Populated by the Mail Tab reply composer
  // so Apple Mail / Outlook still thread replies — Gmail threads by
  // threadId alone, but external clients rely on these.
  inReplyTo?: string;
  references?: string;
};

export type SendEmailResult = { id: string; threadId: string };

function randomBoundary(tag: string): string {
  return `----=_BreakPoint_${tag}_${Math.random().toString(36).slice(2)}`;
}

function buildAlternativePart(bodyText: string, bodyHtml: string, boundary: string): string {
  return [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    bodyText,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    bodyHtml,
    "",
    `--${boundary}--`,
  ].join("\r\n");
}

// RFC 2045: base64 lines SHOULD be <= 76 chars. Gmail tolerates long lines but
// some downstream forwarders don't, so chunk to 76.
function base64Chunk(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const b64 = buf.toString("base64");
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? b64;
}

function buildAttachmentPart(att: GmailAttachment): string {
  // Only MIME-encode the display filename; the raw filename still goes in as
  // ASCII since we assume PDFs / DOCX etc. whose filenames rarely contain
  // non-ASCII. Keep things boring and interop-safe.
  const fn = encodeMimeWord(att.filename);
  return [
    `Content-Type: ${att.mimeType}; name="${fn}"`,
    `Content-Disposition: attachment; filename="${fn}"`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Chunk(att.data),
  ].join("\r\n");
}

// Builds a Gmail-compatible RFC 2822 message + base64url encodes it, which is
// the raw shape /users/me/messages/send expects.
function buildRfc2822(params: SendEmailInput): string {
  const headers: string[] = [];
  const fromLabel = params.fromName ? `${encodeMimeWord(params.fromName)} <${params.from}>` : params.from;
  headers.push(`From: ${fromLabel}`);
  headers.push(`To: ${params.to.join(", ")}`);
  if (params.cc && params.cc.length > 0) headers.push(`Cc: ${params.cc.join(", ")}`);
  if (params.bcc && params.bcc.length > 0) headers.push(`Bcc: ${params.bcc.join(", ")}`);
  headers.push(`Subject: ${encodeMimeWord(params.subject)}`);
  if (params.inReplyTo) headers.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) headers.push(`References: ${params.references}`);
  headers.push("MIME-Version: 1.0");

  const hasAttachments = Boolean(params.attachments && params.attachments.length > 0);

  // multipart/mixed { multipart/alternative { text, html }, attachment+ }
  if (hasAttachments) {
    const mixed = randomBoundary("mix");
    const alt = randomBoundary("alt");
    headers.push(`Content-Type: multipart/mixed; boundary="${mixed}"`);
    const htmlBody = params.bodyHtml ?? plainToHtml(params.bodyText);
    const parts: string[] = [
      "",
      `--${mixed}`,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      "",
      buildAlternativePart(params.bodyText, htmlBody, alt),
      "",
    ];
    for (const att of params.attachments!) {
      parts.push(`--${mixed}`);
      parts.push(buildAttachmentPart(att));
      parts.push("");
    }
    parts.push(`--${mixed}--`);
    return headers.join("\r\n") + "\r\n" + parts.join("\r\n");
  }

  if (params.bodyHtml) {
    const boundary = randomBoundary("alt");
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    return (
      headers.join("\r\n") +
      "\r\n\r\n" +
      buildAlternativePart(params.bodyText, params.bodyHtml, boundary)
    );
  }

  headers.push("Content-Type: text/plain; charset=UTF-8");
  headers.push("Content-Transfer-Encoding: 7bit");
  return headers.join("\r\n") + "\r\n\r\n" + params.bodyText;
}

function encodeMimeWord(raw: string): string {
  // Only encode if non-ASCII; otherwise pass through. Keeps ASCII subjects readable in logs.
  if (/^[\x20-\x7E]*$/.test(raw)) return raw;
  const b64 = Buffer.from(raw, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Simple plain-text → HTML converter: preserves line breaks, keeps "• " as a
// bullet glyph, and escapes basic HTML entities so a pasted "<" doesn't break
// the output.
export function plainToHtml(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.55; color: #0f1b2d; white-space: pre-wrap;">${esc}</div>`;
}

// Attach the user's stored signature to the body exactly once. If the body
// already ends with that signature (or contains it anywhere), we don't add
// another copy. Templates are expected to NOT bake in a signature so this
// append is the single source.
export function appendSignature(body: string, signature: string): string {
  const trimmedBody = body.replace(/\s+$/, "");
  const sig = (signature ?? "").replace(/\s+$/, "");
  if (!sig) return trimmedBody;
  if (trimmedBody.includes(sig)) return trimmedBody;
  return `${trimmedBody}\n\n${sig}`;
}

async function withSignature(input: SendEmailInput): Promise<SendEmailInput> {
  const signature = await getEmailSignature(input.from);
  const bodyText = appendSignature(input.bodyText, signature);
  const bodyHtml = input.bodyHtml ? appendSignature(input.bodyHtml, plainToHtml(signature)) : plainToHtml(bodyText);
  return { ...input, bodyText, bodyHtml };
}

export async function sendGmail(input: SendEmailInput): Promise<SendEmailResult> {
  const accessToken = await getFreshAccessToken(input.userId);
  const signed = await withSignature(input);
  const raw = base64UrlEncode(buildRfc2822(signed));
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw, threadId: input.threadId }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail send failed (${res.status}): ${text || "no body"}`);
  }
  const json = (await res.json()) as { id: string; threadId: string };
  return { id: json.id, threadId: json.threadId };
}

export async function createGmailDraft(input: SendEmailInput): Promise<SendEmailResult> {
  const accessToken = await getFreshAccessToken(input.userId);
  const signed = await withSignature(input);
  const raw = base64UrlEncode(buildRfc2822(signed));
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { raw, threadId: input.threadId } }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail draft create failed (${res.status}): ${text || "no body"}`);
  }
  const json = (await res.json()) as { id: string; message: { id: string; threadId: string } };
  return { id: json.message.id, threadId: json.message.threadId };
}

// ---- Mail Tab read paths (Phase 6) ----
// Read-only list + fetch for the signed-in user's own inbox. Uses the
// same refresh-token-per-user plumbing as the send path above so there
// is no extra OAuth ceremony — the `gmail.readonly` scope added in
// src/lib/auth.ts is all that was needed.

export type MailListThread = {
  id: string;
  // Snippet, "from" name, subject — all from the thread's most recent
  // message. That's what the left-rail preview shows.
  snippet: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  // `internalDate` is ms-since-epoch as a string in Gmail's API. We
  // ship it as an ISO string for the client formatter.
  timestampIso: string | null;
  unread: boolean;
};

type GmailListThreadsResponse = {
  threads?: Array<{ id: string; snippet?: string; historyId?: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailHeader = { name: string; value: string };

type GmailMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
};

type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
};

type GmailThreadResponse = {
  id: string;
  historyId?: string;
  messages?: GmailMessage[];
};

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return "";
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

// RFC 5322 "Name <email@host>" → { name, email }.
function parseAddress(raw: string): { name: string; email: string } {
  if (!raw) return { name: "", email: "" };
  const m = raw.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
  if (m) return { name: (m[1] ?? "").trim(), email: m[2].trim() };
  // Bare address, no name.
  return { name: "", email: raw.trim() };
}

export async function listGmailThreads(
  userId: string,
  opts: { maxResults?: number; labelIds?: string[] } = {},
): Promise<MailListThread[]> {
  const accessToken = await getFreshAccessToken(userId);
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/threads");
  url.searchParams.set("maxResults", String(opts.maxResults ?? 50));
  for (const id of opts.labelIds ?? ["INBOX"]) {
    url.searchParams.append("labelIds", id);
  }
  const listRes = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!listRes.ok) {
    const text = await listRes.text().catch(() => "");
    throw new Error(`Gmail threads.list failed (${listRes.status}): ${text || "no body"}`);
  }
  const listJson = (await listRes.json()) as GmailListThreadsResponse;
  const ids = (listJson.threads ?? []).map((t) => t.id);
  if (ids.length === 0) return [];

  // Hydrate each thread's most-recent-message summary via metadata format
  // (saves bandwidth — no body). Concurrent fetches; Gmail rate limits
  // are generous enough for 50 parallel metadata calls per user.
  const enriched = await Promise.all(
    ids.map(async (id) => {
      const tUrl = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}`,
      );
      tUrl.searchParams.set("format", "metadata");
      for (const h of ["From", "Subject", "Date"]) {
        tUrl.searchParams.append("metadataHeaders", h);
      }
      const r = await fetch(tUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!r.ok) return null;
      const j = (await r.json()) as GmailThreadResponse;
      const messages = j.messages ?? [];
      if (messages.length === 0) return null;
      // Most recent message is the last one in the array.
      const last = messages[messages.length - 1];
      const from = parseAddress(headerValue(last.payload?.headers, "From"));
      const subject = headerValue(last.payload?.headers, "Subject");
      const internalDate = last.internalDate;
      const isoTs = internalDate ? new Date(Number(internalDate)).toISOString() : null;
      const labels = last.labelIds ?? [];
      return {
        id: j.id,
        snippet: last.snippet ?? "",
        fromName: from.name || from.email,
        fromEmail: from.email,
        subject: subject || "(no subject)",
        timestampIso: isoTs,
        unread: labels.includes("UNREAD"),
      } satisfies MailListThread;
    }),
  );
  // Sort by timestamp desc so the newest thread sits at the top even
  // if Gmail returned them in a different order.
  return enriched
    .filter((x): x is MailListThread => x !== null)
    .sort((a, b) => (b.timestampIso ?? "").localeCompare(a.timestampIso ?? ""));
}

export type MailThreadMessage = {
  id: string;
  fromName: string;
  fromEmail: string;
  to: string;
  cc: string;
  dateIso: string | null;
  subject: string;
  // HTML body (already sanitized by the route) if available; otherwise
  // the plain-text body converted to HTML via <pre>.
  bodyHtml: string;
};

export type MailThreadDetail = {
  id: string;
  subject: string;
  messages: MailThreadMessage[];
};

// Recursively walks the MIME tree looking for the first html part, then
// falls back to the first text/plain part if no html was found.
function pickBestBody(
  payload: GmailMessagePart | undefined,
): { mimeType: "text/html" | "text/plain"; data: string } | null {
  if (!payload) return null;
  const htmlPart = findPart(payload, "text/html");
  if (htmlPart?.body?.data) {
    return { mimeType: "text/html", data: decodeB64Url(htmlPart.body.data) };
  }
  const textPart = findPart(payload, "text/plain");
  if (textPart?.body?.data) {
    return { mimeType: "text/plain", data: decodeB64Url(textPart.body.data) };
  }
  // Some Gmail messages store the body directly on the top-level payload.
  if (payload.body?.data) {
    const mt = (payload.mimeType ?? "text/plain") === "text/html" ? "text/html" : "text/plain";
    return { mimeType: mt, data: decodeB64Url(payload.body.data) };
  }
  return null;
}

function findPart(root: GmailMessagePart, mimeType: string): GmailMessagePart | null {
  if (root.mimeType === mimeType && root.body?.data) return root;
  if (root.parts) {
    for (const child of root.parts) {
      const found = findPart(child, mimeType);
      if (found) return found;
    }
  }
  return null;
}

function decodeB64Url(s: string): string {
  // Gmail returns base64url-encoded data. Standard-base64 would fail on
  // Gmail's `-`/`_` chars.
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 === 0 ? norm : norm + "=".repeat(4 - (norm.length % 4));
  return Buffer.from(pad, "base64").toString("utf-8");
}

export async function getGmailThread(userId: string, threadId: string): Promise<MailThreadDetail> {
  const accessToken = await getFreshAccessToken(userId);
  const tUrl = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`,
  );
  tUrl.searchParams.set("format", "full");
  const r = await fetch(tUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Gmail thread.get failed (${r.status}): ${text || "no body"}`);
  }
  const j = (await r.json()) as GmailThreadResponse;
  const messages = (j.messages ?? []).map<MailThreadMessage>((m) => {
    const headers = m.payload?.headers;
    const from = parseAddress(headerValue(headers, "From"));
    const body = pickBestBody(m.payload);
    const bodyHtml = body
      ? body.mimeType === "text/html"
        ? body.data
        : `<pre class="whitespace-pre-wrap font-sans text-sm text-court-fg">${escapeHtml(body.data)}</pre>`
      : `<p class="text-xs text-court-fg-muted">(no body content)</p>`;
    return {
      id: m.id,
      fromName: from.name || from.email,
      fromEmail: from.email,
      to: headerValue(headers, "To"),
      cc: headerValue(headers, "Cc"),
      dateIso: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
      subject: headerValue(headers, "Subject"),
      bodyHtml,
    };
  });
  // The top-level subject is the subject of the first message (usually the
  // originating send before anyone hit Reply).
  const subject = messages[0]?.subject ?? "(no subject)";
  return { id: j.id, subject, messages };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---- Mail Tab archive (Phase 6.1) ----
// Drops the INBOX label from a thread — Gmail's native "archive". Needs
// gmail.modify scope in auth.ts. Scoped implicitly to the signed-in
// user's own mailbox because the access token is theirs.
export async function archiveGmailThread(userId: string, threadId: string): Promise<void> {
  const accessToken = await getFreshAccessToken(userId);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail thread.archive failed (${res.status}): ${text || "no body"}`);
  }
}

// ---- Mail Tab reply (Phase 6.1) ----
// Fetches the Message-ID of the latest message in a thread so outbound
// replies can set the standard In-Reply-To / References headers. Gmail
// itself will thread via threadId alone, but external clients (Apple
// Mail, Outlook) still need these for their own threading to work.
export async function getThreadReplyHeaders(
  userId: string,
  threadId: string,
): Promise<{ messageId: string | null; references: string | null }> {
  const accessToken = await getFreshAccessToken(userId);
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`,
  );
  url.searchParams.set("format", "metadata");
  for (const h of ["Message-ID", "References"]) {
    url.searchParams.append("metadataHeaders", h);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return { messageId: null, references: null };
  const j = (await res.json()) as GmailThreadResponse;
  const messages = j.messages ?? [];
  if (messages.length === 0) return { messageId: null, references: null };
  const last = messages[messages.length - 1];
  const headers = last.payload?.headers;
  const messageId = headerValue(headers, "Message-ID") || null;
  const prior = headerValue(headers, "References") || "";
  // New References chain = old References + the message we're replying to.
  const references = [prior, messageId].filter(Boolean).join(" ").trim() || null;
  return { messageId, references };
}
