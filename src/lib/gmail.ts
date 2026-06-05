import { prisma } from "@/lib/prisma";
import { getEmailSignature } from "@/lib/preferences";
import {
  ACE_SIGNATURE_MARKER,
  getUserBrandingProfile,
  renderSignatureInline,
  renderSignatureText,
  SIGNATURE_DELIMITER_HTML,
  SIGNATURE_DELIMITER_TEXT,
  type SignatureInlineImage,
} from "@/lib/signature";

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
export async function getFreshAccessToken(userId: string): Promise<string> {
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
  // Internal: signature logo/icons to embed as multipart/related inline
  // parts (Content-Disposition: inline). Set by withSignature, consumed by
  // buildRfc2822. Callers never populate this directly — withSignature is
  // the single source of the branded signature.
  inlineImages?: SignatureInlineImage[];
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

// A renderable inline image part for multipart/related embedding. Unlike
// buildAttachmentPart (Content-Disposition: attachment), this declares
// `inline` and a Content-ID so the HTML's `cid:` refs resolve AND Apple
// Mail renders it inside the body only — never as a bottom attachment.
function buildInlineImagePart(img: SignatureInlineImage): string {
  const b64 = img.base64.match(/.{1,76}/g)?.join("\r\n") ?? img.base64;
  return [
    `Content-Type: ${img.mimeType}; name="${img.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-ID: <${img.cid}>`,
    `Content-Disposition: inline; filename="${img.filename}"`,
    `X-Attachment-Id: ${img.cid}`,
    "",
    b64,
  ].join("\r\n");
}

// Joins already-rendered MIME entity strings (each beginning with its own
// `Content-Type:` header) into one multipart body, and returns the entity
// for the next nesting level: its own `Content-Type: multipart/<subtype>`
// header line, a blank line, then the boundary-delimited body.
function wrapMultipart(subtype: string, boundary: string, parts: string[]): string {
  const body = parts.map((p) => `--${boundary}\r\n${p}`).join("\r\n") + `\r\n--${boundary}--`;
  return `Content-Type: multipart/${subtype}; boundary="${boundary}"\r\n\r\n${body}`;
}

// Builds a Gmail-compatible RFC 2822 message + base64url encodes it, which is
// the raw shape /users/me/messages/send expects.
//
// Nesting, built inside-out:
//   multipart/mixed {              (only when file attachments present)
//     multipart/related {          (only when inline signature images present)
//       multipart/alternative { text/plain, text/html },
//       inline-image+
//     },
//     attachment+
//   }
// Any layer with nothing to wrap is skipped, so a plain signed email is just
// multipart/related { alternative, images } and a bare text email stays
// text/plain.
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

  const attachments = params.attachments ?? [];
  const inlineImages = params.inlineImages ?? [];

  // Plain-text only — no HTML, no inline images, no attachments.
  if (!params.bodyHtml && inlineImages.length === 0 && attachments.length === 0) {
    headers.push("Content-Type: text/plain; charset=UTF-8");
    headers.push("Content-Transfer-Encoding: 7bit");
    return headers.join("\r\n") + "\r\n\r\n" + params.bodyText;
  }

  // Innermost: multipart/alternative { text/plain, text/html }.
  const altBoundary = randomBoundary("alt");
  const htmlBody = params.bodyHtml ?? plainToHtml(params.bodyText);
  const altBlock = buildAlternativePart(params.bodyText, htmlBody, altBoundary);
  let entity = `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n${altBlock}`;

  // Wrap the alternative + inline signature images in multipart/related so
  // the cid: refs resolve and the logo renders inline only.
  if (inlineImages.length > 0) {
    entity = wrapMultipart("related", randomBoundary("rel"), [
      entity,
      ...inlineImages.map(buildInlineImagePart),
    ]);
  }

  // Wrap the body + file attachments in multipart/mixed.
  if (attachments.length > 0) {
    entity = wrapMultipart("mixed", randomBoundary("mix"), [
      entity,
      ...attachments.map(buildAttachmentPart),
    ]);
  }

  // The top-level entity carries its own Content-Type; lift it onto the
  // message headers (entity already starts with "Content-Type: …\r\n\r\n").
  return headers.join("\r\n") + "\r\n" + entity;
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
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.55; color: #111111; white-space: pre-wrap;">${esc}</div>`;
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
  // Phase 6.2: Gmail-style HTML-table signature, pulled from the
  // sender's UserProfile (logo, name, title, phone, website).
  //
  // Strict idempotence: if the inbound body already carries an Ace
  // signature, we strip it from the marker forward and re-render fresh.
  // Earlier versions relied on a fragile href-substring check that
  // could miss a prior signature whose URL had been rewritten in
  // transit, which let a second copy stack underneath the first — the
  // double-signature symptom Andrew reported. ACE_SIGNATURE_MARKER is
  // an HTML comment baked into renderSignatureHtml; it round-trips
  // through our own send/draft pipeline but is never visible to a
  // recipient.
  const branding = await getUserBrandingProfile(input.userId);
  const textSig = renderSignatureText(branding);
  // Render the signature with cid: image refs (not data: URIs) and collect
  // the logo/icons to embed as inline multipart/related parts. This stops
  // Apple Mail / iOS Mail from rendering the logo a second time as a bottom
  // attachment — see renderSignatureInline for the full why.
  const cidPrefix = `bptsig-${Math.random().toString(36).slice(2)}`;
  const { html: htmlSig, images: sigImages } = renderSignatureInline(branding, cidPrefix);

  // Plain-text body: strip any prior "-- " block (RFC 3676 delimiter
  // on a line by itself), then append a single fresh block. Falls back
  // to the legacy per-email signatures map so older seed data still
  // works when the user has no UserProfile.
  const legacyFallback = await getEmailSignature(input.from);
  const textSigBlock = textSig.trim().length > 0
    ? `${SIGNATURE_DELIMITER_TEXT}\n${textSig}`
    : legacyFallback;
  const cleanedText = stripExistingTextSignature(input.bodyText);
  const bodyText = textSigBlock
    ? `${cleanedText.replace(/\s+$/, "")}\n\n${textSigBlock}`
    : cleanedText;

  // HTML body: strip any prior Ace signature (using the marker as the
  // canonical boundary), then append a single fresh sig block.
  // htmlSigBlock includes the marker via htmlSig itself, so a re-run
  // of withSignature on the resulting body will land back here with
  // markerIdx >= 0 and produce exactly one signature again.
  const htmlSigBlock = `<br/><br/>${SIGNATURE_DELIMITER_HTML}${htmlSig}`;
  const baseHtml = input.bodyHtml ?? plainToHtml(input.bodyText);
  const cleanedHtml = stripExistingHtmlSignature(baseHtml);
  const bodyHtml = `${cleanedHtml}${htmlSigBlock}`;

  return { ...input, bodyText, bodyHtml, inlineImages: sigImages };
}

// Returns the body with any prior Ace-rendered signature removed. We
// anchor on ACE_SIGNATURE_MARKER and walk back to drop the leading
// "<br/><br/><div>-- </div>" preamble + any trailing whitespace so the
// fresh signature lands on a clean tail.
function stripExistingHtmlSignature(body: string): string {
  const idx = body.indexOf(ACE_SIGNATURE_MARKER);
  if (idx >= 0) {
    const head = body.slice(0, idx);
    // Drop the "<br/><br/><div>-- </div>" preamble that we prepend to the
    // sig in htmlSigBlock so it doesn't pile up across re-signs. Anchored
    // to end-of-string with optional whitespace.
    return head
      .replace(/(?:\s*<br\s*\/?>\s*){1,4}(?:<div[^>]*>\s*--\s*<\/div>\s*)?$/i, "")
      .replace(/\s+$/, "");
  }
  // No marker found — but the ACE_SIGNATURE_MARKER is an HTML comment, and
  // sanitizers / forwarding can strip HTML comments while leaving the rest
  // of the signature intact. Fall back to the "-- " delimiter block
  // (SIGNATURE_DELIMITER_HTML, which withSignature always prepends ahead of
  // the sig) so a marker-less prior signature still gets removed instead of
  // stacking a second copy. Mirrors stripExistingTextSignature, which
  // already anchors on the plain-text "-- " delimiter. Take the LAST such
  // delimiter so only the trailing signature block is cut.
  const delimRe = /(?:\s*<br\s*\/?>\s*){1,4}<div[^>]*>\s*--\s*<\/div>/gi;
  let lastDelimIdx = -1;
  for (let m = delimRe.exec(body); m; m = delimRe.exec(body)) lastDelimIdx = m.index;
  if (lastDelimIdx < 0) return body;
  return body.slice(0, lastDelimIdx).replace(/\s+$/, "");
}

// Returns the body with any prior "-- " plain-text signature block
// removed. RFC 3676 signature delimiter is "-- " (dash-dash-space) on a
// line by itself; we strip from that line through end-of-body so a
// second appendSignature lands on a clean tail.
function stripExistingTextSignature(body: string): string {
  return body.replace(/(?:^|\n)--\s*\n[\s\S]*$/, "");
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

// Ace 28.0b — Save Draft now returns the Gmail Draft id (not just the
// underlying message id) so the composer can DELETE it later via
// /v1/users/me/drafts/{draftId}. The Gmail API uses two distinct id
// spaces — Draft.id and Message.id — and only the former works on the
// drafts.* endpoints. We keep both fields so callers that only need
// "open this thread on Gmail" can still use threadId.
export type GmailDraftCreateResult = {
  draftId: string;
  messageId: string;
  threadId: string;
};

export async function createGmailDraft(input: SendEmailInput): Promise<GmailDraftCreateResult> {
  const accessToken = await getFreshAccessToken(input.userId);
  // Drafts store the body EXACTLY as composed — the signature is NOT
  // baked in here. It is appended only at true send time (sendGmail ->
  // withSignature), matching normal-send behavior where the recruiter
  // never sees the signature in the composer UI. Signing the stored
  // draft caused the oversized-signature-on-reopen bug (the Save Draft
  // body and the Send Later mirror draft both carried the full
  // signature table, which the editor re-rendered unconstrained). A
  // scheduled send still goes out signed: fireScheduledEmail sends the
  // clean stored body through sendGmail, which appends the signature on
  // dispatch.
  const raw = base64UrlEncode(buildRfc2822(input));
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
  return { draftId: json.id, messageId: json.message.id, threadId: json.message.threadId };
}

// Ace 28.0b — Delete a Gmail draft by its Draft.id. 204 = gone, 404 =
// already gone (we treat that as success since the desired end state
// matches). Anything else throws so the caller can decide how to
// surface the error.
export async function deleteGmailDraft(userId: string, draftId: string): Promise<void> {
  const accessToken = await getFreshAccessToken(userId);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail draft delete failed (${res.status}): ${text || "no body"}`);
  }
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
  opts: { maxResults?: number; labelIds?: string[]; q?: string } = {},
): Promise<MailListThread[]> {
  const accessToken = await getFreshAccessToken(userId);
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/threads");
  url.searchParams.set("maxResults", String(opts.maxResults ?? 50));
  for (const id of opts.labelIds ?? ["INBOX"]) {
    url.searchParams.append("labelIds", id);
  }
  // Gmail's full search syntax — from:/to:/subject:/has:attachment/etc.
  // Pass through whatever the user typed; the API handles parsing.
  if (opts.q && opts.q.trim()) {
    url.searchParams.set("q", opts.q.trim());
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

export type MailAttachmentRef = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
};

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
  // When the sender's address resolves to a CRM Contact whose Client is
  // known, the route stamps a slug + name here so MessageBlock can
  // render an "Open client" affordance straight from the thread view.
  // Null when the sender isn't tied to any Client (or there's no
  // matching Contact at all).
  senderClient?: { slug: string; name: string } | null;
  // User-uploaded attachments (PDFs, Word docs, images sent as files,
  // etc.) discovered by walking the MIME tree. Inline cid: images are
  // excluded — they live in the body via inlineCidImages. Empty array
  // when the message has no real attachments.
  attachments: MailAttachmentRef[];
};

export type MailThreadDetail = {
  id: string;
  subject: string;
  messages: MailThreadMessage[];
  // Deduped union of Gmail labelIds across every message in the
  // thread. Lets the client identify thread-level state (e.g. the
  // BD-reply prompt banner only renders when the recruiter's "BD"
  // label is present here).
  labelIds: string[];
  // Populated when one of the thread's messages carries the system
  // DRAFT label and we can resolve it back to a Draft.id via
  // findDraftIdForThread. /mail uses this to open the composer
  // pre-loaded against the existing Gmail draft instead of rendering
  // the read-only thread view. Null for non-drafts and when the
  // draft lookup fails (treated as fail-soft so the read path still
  // works for the recruiter).
  draftId: string | null;
  // The Message.id of the draft inside this thread, used by the
  // client to find the right entry in `messages` and copy
  // subject/body/to/cc into the composer. Paired with draftId so
  // the recruiter can keep editing the existing Gmail draft instead
  // of starting a new one.
  draftMessageId: string | null;
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
  const messages = await Promise.all(
    (j.messages ?? []).map<Promise<MailThreadMessage>>(async (m) => {
      const headers = m.payload?.headers;
      const from = parseAddress(headerValue(headers, "From"));
      const body = pickBestBody(m.payload);
      let bodyHtml = body
        ? body.mimeType === "text/html"
          ? body.data
          : `<pre class="whitespace-pre-wrap font-sans text-sm text-court-fg">${escapeHtml(body.data)}</pre>`
        : `<p class="text-xs text-court-fg-muted">(no body content)</p>`;
      // Inline `<img src="cid:...">` references (Gmail's MIME-internal
      // image refs) by rewriting them to data: URIs sourced from the
      // matching attachment part. Without this rewrite, the browser
      // can't resolve cid: and renders broken-image boxes — the
      // exact symptom we hit on the BreakPoint logo + signature
      // contact icons. No-op when the body has no cid: refs.
      if (body?.mimeType === "text/html") {
        bodyHtml = await inlineCidImages(accessToken, m.id, bodyHtml, m.payload);
      }
      return {
        id: m.id,
        fromName: from.name || from.email,
        fromEmail: from.email,
        to: headerValue(headers, "To"),
        cc: headerValue(headers, "Cc"),
        dateIso: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
        subject: headerValue(headers, "Subject"),
        bodyHtml,
        attachments: collectAttachments(m.payload),
      };
    }),
  );
  // The top-level subject is the subject of the first message (usually the
  // originating send before anyone hit Reply).
  const subject = messages[0]?.subject ?? "(no subject)";
  // When the thread carries the DRAFT label on any of its messages,
  // resolve the corresponding Gmail Draft.id so /mail can swap the
  // read-only thread view for the composer. Fail-soft: a failed
  // lookup returns null and the thread renders normally.
  const hasDraftLabel = (j.messages ?? []).some((m) =>
    (m.labelIds ?? []).includes("DRAFT"),
  );
  const draftLookup = hasDraftLabel
    ? await findDraftForThread(userId, j.id).catch(() => null)
    : null;
  const labelIds = Array.from(
    new Set((j.messages ?? []).flatMap((m) => m.labelIds ?? [])),
  );
  return {
    id: j.id,
    subject,
    messages,
    labelIds,
    draftId: draftLookup?.draftId ?? null,
    draftMessageId: draftLookup?.messageId ?? null,
  };
}

// Walks the signed-in user's Drafts list and returns the Draft.id +
// underlying Message.id whose message lives on the given threadId.
// Gmail's drafts.list doesn't support a threadId filter, so we
// paginate by hand. The 500-result page cap is Gmail's max — a
// recruiter with more than 500 outstanding drafts (extremely unlikely
// on a working inbox) falls back to "treat as a regular thread" since
// the lookup misses.
export async function findDraftForThread(
  userId: string,
  threadId: string,
): Promise<{ draftId: string; messageId: string } | null> {
  const accessToken = await getFreshAccessToken(userId);
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
  url.searchParams.set("maxResults", "500");
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const j = (await r.json()) as {
    drafts?: Array<{ id: string; message?: { id?: string; threadId?: string } }>;
  };
  const match = (j.drafts ?? []).find((d) => d.message?.threadId === threadId);
  if (!match?.id || !match.message?.id) return null;
  return { draftId: match.id, messageId: match.message.id };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---- cid: → data: image inlining ----
// Gmail's API hands back inline images as separate MIME parts with a
// Content-ID header, and the HTML body references them via
// `<img src="cid:foo">`. The browser has no concept of cid: outside
// an email client, so without this rewrite those images render as
// broken-image boxes inside Ace's thread view.
//
// Approach: walk the message MIME tree, collect every part that
// carries a Content-ID, fetch its body bytes (either inline in
// body.data or via the attachments endpoint when only attachmentId is
// returned), and string-replace each cid: src with a data: URI.

type InlinePart = {
  contentId: string;
  mimeType: string;
  attachmentId?: string;
  data?: string;
};

function collectInlineParts(
  payload: GmailMessagePart | undefined,
  out: InlinePart[] = [],
): InlinePart[] {
  if (!payload) return out;
  const cid = payload.headers?.find((h) => h.name.toLowerCase() === "content-id")?.value;
  if (cid && payload.body) {
    out.push({
      contentId: cid.replace(/^[\s<]+|[\s>]+$/g, ""),
      mimeType: payload.mimeType ?? "application/octet-stream",
      attachmentId: payload.body.attachmentId ?? undefined,
      data: payload.body.data ?? undefined,
    });
  }
  if (payload.parts) for (const p of payload.parts) collectInlineParts(p, out);
  return out;
}

// Walks the MIME tree and returns every part that looks like a real
// user-attached file. "Real" = has a non-empty filename, a fetchable
// body.attachmentId, and is NOT an inline image (those carry a
// Content-ID header and are inlined into the body via
// inlineCidImages). Without the Content-ID filter, signature logos
// would show up as attachment pills on every outbound email.
function collectAttachments(
  payload: GmailMessagePart | undefined,
  out: MailAttachmentRef[] = [],
): MailAttachmentRef[] {
  if (!payload) return out;
  const isInline = payload.headers?.some(
    (h) => h.name.toLowerCase() === "content-id",
  );
  if (
    payload.filename &&
    payload.filename.length > 0 &&
    payload.body?.attachmentId &&
    !isInline
  ) {
    out.push({
      attachmentId: payload.body.attachmentId,
      filename: payload.filename,
      mimeType: payload.mimeType ?? "application/octet-stream",
      size: payload.body.size ?? 0,
    });
  }
  if (payload.parts) for (const p of payload.parts) collectAttachments(p, out);
  return out;
}

// Authenticated attachment fetcher used by the download route. Returns
// decoded bytes ready to stream back to the browser; null when Gmail
// rejects the fetch (deleted message, revoked token, etc.).
export async function getGmailAttachment(
  userId: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  const accessToken = await getFreshAccessToken(userId);
  const b64 = await fetchAttachmentBase64(accessToken, messageId, attachmentId);
  if (!b64) return null;
  const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 === 0 ? norm : norm + "=".repeat(4 - (norm.length % 4));
  return Buffer.from(pad, "base64");
}

async function fetchAttachmentBase64(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<string | null> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
    messageId,
  )}/attachments/${encodeURIComponent(attachmentId)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { data?: string };
  return j.data ?? null;
}

// Gmail returns base64URL (- and _) but data: URIs need standard base64
// (+ and /). Quick swap before splicing into the src attribute.
function base64UrlToStandard(b64: string): string {
  return b64.replace(/-/g, "+").replace(/_/g, "/");
}

async function inlineCidImages(
  accessToken: string,
  messageId: string,
  bodyHtml: string,
  payload: GmailMessagePart | undefined,
): Promise<string> {
  // Cheap escape hatch: most messages have no cid: refs, so skip the
  // MIME walk + attachment fetches entirely.
  if (!bodyHtml.includes("cid:")) return bodyHtml;
  const parts = collectInlineParts(payload);
  if (parts.length === 0) return bodyHtml;

  // Resolve each part to actual bytes — small parts have body.data
  // inline; larger ones need a follow-up attachments.get call.
  const resolved = await Promise.all(
    parts.map(async (p) => {
      let data = p.data;
      if (!data && p.attachmentId) {
        data = (await fetchAttachmentBase64(accessToken, messageId, p.attachmentId)) ?? undefined;
      }
      return { ...p, data };
    }),
  );

  return bodyHtml.replace(/src=(["'])cid:([^"'>\s]+)\1/gi, (match, quote: string, rawId: string) => {
    const id = rawId.trim();
    const part = resolved.find((p) => p.contentId === id);
    if (!part?.data) return match;
    const dataUri = `data:${part.mimeType};base64,${base64UrlToStandard(part.data)}`;
    return `src=${quote}${dataUri}${quote}`;
  });
}

// Gmail serializes writes per mailbox, so firing several thread.modify
// calls in quick succession (a bulk archive / move of 5+ threads) can
// come back 429/403 "rate limit" or a transient 5xx even when each call
// is well under the per-second quota. Google's prescribed remedy is
// exponential backoff. Every label mutation below goes through this
// wrapper instead of a bare fetch — without it a bulk run surfaced only
// the first success and left the rest "failed" until the user clicked
// Archive again.
const RETRYABLE_GMAIL_STATUS = new Set([403, 429, 500, 502, 503, 504]);

async function modifyGmailThreadLabels(
  userId: string,
  threadId: string,
  body: { addLabelIds?: string[]; removeLabelIds?: string[] },
  op: string,
): Promise<void> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`;
  // Token is good for >=60s (getFreshAccessToken guarantees it), so one
  // fetch up front covers the whole retry window (~3s worst case).
  const accessToken = await getFreshAccessToken(userId);
  const maxAttempts = 4;
  let lastStatus = 0;
  let lastText = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.ok) return;
    lastStatus = res.status;
    lastText = await res.text().catch(() => "");
    if (attempt === maxAttempts - 1 || !RETRYABLE_GMAIL_STATUS.has(res.status)) break;
    // Exponential backoff with jitter: ~0.4s, 0.9s, 1.9s.
    const backoff = 400 * 2 ** attempt + Math.random() * 200;
    await new Promise((r) => setTimeout(r, backoff));
  }
  throw new Error(`Gmail thread.${op} failed (${lastStatus}): ${lastText || "no body"}`);
}

// ---- Mail Tab archive (Phase 6.1) ----
// Drops the INBOX label from a thread — Gmail's native "archive". Needs
// gmail.modify scope in auth.ts. Scoped implicitly to the signed-in
// user's own mailbox because the access token is theirs.
export async function archiveGmailThread(userId: string, threadId: string): Promise<void> {
  await modifyGmailThreadLabels(userId, threadId, { removeLabelIds: ["INBOX"] }, "archive");
}

// ---- Mail Tab live polling (Phase 6.x: notification context) ----
// Returns the unread INBOX count plus a small slice of the newest
// unread thread summaries — enough to drive both the sidebar badge and
// the in-app new-mail toast. Bundled in one Gmail call (threads.list
// with the same q=in:inbox is:unread filter as the count-only path)
// so the polling interval pays for one quota unit + N metadata gets
// per tick instead of two list calls.

export type UnreadInboxThread = {
  id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  timestampIso: string | null;
};

export type UnreadInboxSummary = {
  count: number;
  latest: UnreadInboxThread[];
};

export async function getUnreadInboxSummary(
  userId: string,
  opts: { maxResults?: number } = {},
): Promise<UnreadInboxSummary> {
  try {
    const accessToken = await getFreshAccessToken(userId);
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/threads");
    url.searchParams.set("q", "in:inbox is:unread");
    url.searchParams.set("maxResults", String(opts.maxResults ?? 5));
    const listRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!listRes.ok) return { count: 0, latest: [] };
    const listJson = (await listRes.json()) as GmailListThreadsResponse & {
      resultSizeEstimate?: number;
    };
    const ids = (listJson.threads ?? []).map((t) => t.id);
    const count =
      typeof listJson.resultSizeEstimate === "number" ? listJson.resultSizeEstimate : ids.length;
    if (ids.length === 0) return { count, latest: [] };
    const latest = await Promise.all(
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
        const last = messages[messages.length - 1];
        const from = parseAddress(headerValue(last.payload?.headers, "From"));
        const subject = headerValue(last.payload?.headers, "Subject");
        return {
          id: j.id,
          fromName: from.name || from.email,
          fromEmail: from.email,
          subject: subject || "(no subject)",
          timestampIso: last.internalDate
            ? new Date(Number(last.internalDate)).toISOString()
            : null,
        } satisfies UnreadInboxThread;
      }),
    );
    return {
      count,
      latest: latest
        .filter((x): x is UnreadInboxThread => x !== null)
        .sort((a, b) => (b.timestampIso ?? "").localeCompare(a.timestampIso ?? "")),
    };
  } catch {
    return { count: 0, latest: [] };
  }
}

// Returns the count of unread INBOX threads for the signed-in user.
// Used by the sidebar nav badge. Defensively swallows every failure
// (token expiry, scope mismatch, transient 5xx) and returns 0 — the
// badge is decorative and must never block layout rendering.
//
// Gmail returns `resultSizeEstimate` even when `maxResults=1`, so we
// don't pay for hauling 1000 thread previews back. Estimate may be
// approximate on large mailboxes; that's acceptable per spec.
export async function getUnreadMailCount(userId: string): Promise<number> {
  try {
    const accessToken = await getFreshAccessToken(userId);
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/threads");
    url.searchParams.set("q", "in:inbox is:unread");
    url.searchParams.set("maxResults", "1");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const body = (await res.json()) as { resultSizeEstimate?: number };
    return typeof body.resultSizeEstimate === "number" ? body.resultSizeEstimate : 0;
  } catch {
    return 0;
  }
}

// Lists the actual unread INBOX thread IDs for a user (not Gmail's
// lagging resultSizeEstimate). The push webhook unions these with the
// thread it just saw arrive so the closed-app badge counts a brand-new
// email even before Gmail's is:unread search index catches up to it.
// Capped so a huge unread pile never makes the webhook page forever -
// the app-icon badge only needs to be right in the low double digits.
//
// STRICT variant: distinguishes "Gmail returned zero unread" from
// "Gmail lookup failed". The lossy getUnreadInboxThreadIds below collapses
// both to [], which is unsafe for badge math - a failed lookup then reads
// as an empty inbox, zeroes the mail portion, and lets a new SMS knock the
// app badge down to 1. Returns { ok: false } on any token-refresh throw,
// non-2xx response, or network error so callers can omit the badge rather
// than guess 0.
export type UnreadThreadIdsResult =
  | { ok: true; ids: string[] }
  | { ok: false };

export async function getUnreadInboxThreadIdsStrict(
  userId: string,
  opts: { cap?: number } = {},
): Promise<UnreadThreadIdsResult> {
  const cap = opts.cap ?? 100;
  try {
    const accessToken = await getFreshAccessToken(userId);
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(
        "https://gmail.googleapis.com/gmail/v1/users/me/threads",
      );
      url.searchParams.set("q", "in:inbox is:unread");
      url.searchParams.set(
        "maxResults",
        String(Math.min(100, cap - ids.length)),
      );
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      // A non-2xx means the unread total is unprovable. Bail to ok:false
      // rather than returning a short/empty list the caller would read as 0.
      if (!res.ok) return { ok: false };
      const body = (await res.json()) as GmailListThreadsResponse;
      for (const t of body.threads ?? []) ids.push(t.id);
      pageToken = body.nextPageToken;
    } while (pageToken && ids.length < cap);
    return { ok: true, ids };
  } catch {
    return { ok: false };
  }
}

// Lossy wrapper kept for any caller that only needs a best-effort list and
// treats failure the same as empty. Badge math must use the strict variant
// above so a Gmail failure is never mistaken for an empty inbox.
export async function getUnreadInboxThreadIds(
  userId: string,
  opts: { cap?: number } = {},
): Promise<string[]> {
  const res = await getUnreadInboxThreadIdsStrict(userId, opts);
  return res.ok ? res.ids : [];
}

// ---- Mail Tab labels (Phase 6.x: Move To dropdown) ----
// Lists the signed-in user's Gmail labels, filtered to user-created
// labels only. System labels (INBOX, SENT, TRASH, SPAM, UNREAD,
// STARRED, IMPORTANT, CATEGORY_*) are excluded — they're returned by
// Gmail with type === "system" and have no place in a "file this
// somewhere" UX. Sorted alphabetically by name for a stable dropdown.
export type GmailUserLabel = { id: string; name: string };

type GmailLabelsResponse = {
  labels?: Array<{ id: string; name: string; type?: "system" | "user" }>;
};

export async function listGmailUserLabels(userId: string): Promise<GmailUserLabel[]> {
  const accessToken = await getFreshAccessToken(userId);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail labels.list failed (${res.status}): ${text || "no body"}`);
  }
  const j = (await res.json()) as GmailLabelsResponse;
  return (j.labels ?? [])
    .filter((l) => l.type === "user")
    .map((l) => ({ id: l.id, name: l.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Returns every Gmail label (system + user) with messagesTotal. Used by
// the Mail Tab sidebar so the client can build the user-label hierarchy
// tree (Gmail uses "/" as the path separator on user labels) and still
// have the system labels available if/when we surface system folders.
//
// labels.list does not return counts — Gmail only exposes messagesTotal
// via labels.get on a single label. We fan out one labels.get call per
// label in parallel; ~30-50 labels is well within Gmail's per-user
// rate budget. messagesTotal defaults to 0 if a labels.get sub-fetch
// fails so a single hiccup doesn't blank the entire sidebar.
export type GmailLabel = {
  id: string;
  name: string;
  type: "system" | "user";
  messagesTotal: number;
};

export async function listGmailAllLabels(userId: string): Promise<GmailLabel[]> {
  const accessToken = await getFreshAccessToken(userId);
  const listRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!listRes.ok) {
    const text = await listRes.text().catch(() => "");
    throw new Error(`Gmail labels.list failed (${listRes.status}): ${text || "no body"}`);
  }
  const j = (await listRes.json()) as GmailLabelsResponse;
  const list = j.labels ?? [];
  const detailed = await Promise.all(
    list.map(async (l): Promise<GmailLabel> => {
      const fallback: GmailLabel = {
        id: l.id,
        name: l.name,
        type: l.type ?? "user",
        messagesTotal: 0,
      };
      try {
        const dRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(l.id)}`,
          { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
        );
        if (!dRes.ok) return fallback;
        const dj = (await dRes.json()) as { messagesTotal?: number };
        return { ...fallback, messagesTotal: dj.messagesTotal ?? 0 };
      } catch {
        return fallback;
      }
    }),
  );
  return detailed.sort((a, b) => a.name.localeCompare(b.name));
}

// Creates a new user label in the signed-in user's mailbox. Returns the
// freshly minted label id+name so the caller can immediately apply it
// to a thread (Gmail labels.create returns the same id you'd later see
// from labels.list). Covered by the gmail.modify scope — no separate
// gmail.labels grant required.
export async function createGmailLabel(
  userId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const accessToken = await getFreshAccessToken(userId);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail labels.create failed (${res.status}): ${text || "no body"}`);
  }
  const j = (await res.json()) as { id?: string; name?: string };
  if (!j.id || !j.name) {
    throw new Error("Gmail labels.create returned an incomplete payload");
  }
  return { id: j.id, name: j.name };
}

// PATCH a user label — used by Ace's in-app "Edit label" / "Move to
// parent" affordance. Caller passes the new full name (e.g. "Active
// Clients/Renamed Sub" to move + rename in one call). Gmail uses the
// `/` separator inside `name` as the visual hierarchy marker — the
// label tree in the sidebar just splits on that.
export async function patchGmailLabel(
  userId: string,
  labelId: string,
  patch: { name?: string },
): Promise<{ id: string; name: string }> {
  const accessToken = await getFreshAccessToken(userId);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail labels.patch failed (${res.status}): ${text || "no body"}`);
  }
  const j = (await res.json()) as { id?: string; name?: string };
  if (!j.id || !j.name) throw new Error("Gmail labels.patch returned an incomplete payload");
  return { id: j.id, name: j.name };
}

// DELETE a user label. Gmail removes the label from every message it
// was on, so the messages stay — they just lose the label. System
// labels (INBOX, SENT, etc.) can't be deleted; the API returns 400.
export async function deleteGmailLabel(userId: string, labelId: string): Promise<void> {
  const accessToken = await getFreshAccessToken(userId);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail labels.delete failed (${res.status}): ${text || "no body"}`);
  }
}

// "Move to label" = single atomic modify that adds the chosen user
// label and drops INBOX in one call. Mirrors how Gmail's native "Move
// to" item behaves in the web UI.
export async function moveGmailThread(
  userId: string,
  threadId: string,
  labelId: string,
  removeLabelIds: string[] = [],
): Promise<void> {
  const removeIds = Array.from(
    new Set(
      removeLabelIds
        .map((id) => id.trim())
        .filter((id) => id && id !== labelId),
    ),
  );
  if (labelId === "INBOX") {
    await modifyGmailThreadLabels(
      userId,
      threadId,
      {
        addLabelIds: ["INBOX"],
        ...(removeIds.length > 0 ? { removeLabelIds: removeIds } : {}),
      },
      "moveToInbox",
    );
    return;
  }
  await modifyGmailThreadLabels(
    userId,
    threadId,
    { addLabelIds: [labelId], removeLabelIds: Array.from(new Set(["INBOX", ...removeIds])) },
    "move",
  );
}

// Removes the UNREAD label from a thread — Gmail's native "mark read".
// Idempotent: removing a label that isn't on the thread returns 200.
// Same gmail.modify scope as archive. Used by the Mail Tab to mirror
// in-Ace open-thread events back to Gmail so the user's phone /
// laptop Gmail apps don't keep buzzing on the same message.
export async function markGmailThreadRead(userId: string, threadId: string): Promise<void> {
  await modifyGmailThreadLabels(userId, threadId, { removeLabelIds: ["UNREAD"] }, "markRead");
}

// Inverse of markGmailThreadRead — re-applies UNREAD so a recruiter
// who has already opened a thread can flag it for follow-up in their
// native Gmail inbox view.
export async function markGmailThreadUnread(userId: string, threadId: string): Promise<void> {
  await modifyGmailThreadLabels(userId, threadId, { addLabelIds: ["UNREAD"] }, "markUnread");
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

// Pulls every email-shaped token out of a raw RFC 5322 To/Cc/Bcc header.
// Tolerates "Display Name <addr@host>", bare addresses, and comma-
// separated lists. Returns lowercased, trimmed, deduped strings.
export function extractEmailsFromHeader(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const matches = raw.match(/[\w!#$%&'*+/=?^`{|}~.-]+@[\w.-]+\.[a-zA-Z]{2,}/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((s) => s.toLowerCase().trim())));
}

// Auto-tags a Gmail thread to candidate/client profiles by matching the
// thread's participant addresses against Candidate.email and
// Contact.emails inside the current org. Idempotent — safe to call on
// every thread open and on every send. Failures should be caught by
// callers; a tagging hiccup must not break the underlying mail flow.
export async function tagThreadByAddresses({
  threadId,
  addresses,
  organizationId,
}: {
  threadId: string;
  addresses: string[];
  organizationId: string;
}) {
  const emails = Array.from(
    new Set(addresses.map((a) => a.toLowerCase().trim()).filter(Boolean)),
  );
  if (!emails.length) return;

  const [candidates, contacts] = await Promise.all([
    prisma.candidate.findMany({
      where: { email: { in: emails }, organizationId },
      select: { id: true },
    }),
    prisma.contact.findMany({
      where: { emails: { hasSome: emails }, organizationId },
      select: { id: true, clientId: true },
    }),
  ]);

  const upserts = [
    ...candidates.map((c) =>
      prisma.gmailThreadTag.upsert({
        where: { threadId_candidateId: { threadId, candidateId: c.id } },
        create: { threadId, candidateId: c.id, organizationId },
        update: {},
      }),
    ),
    ...contacts
      .filter((c) => c.clientId)
      .map((c) =>
        prisma.gmailThreadTag.upsert({
          where: { threadId_clientId: { threadId, clientId: c.clientId! } },
          create: { threadId, clientId: c.clientId!, organizationId },
          update: {},
        }),
      ),
  ];

  await Promise.all(upserts);
}

// Game Plan Phase 3 — fetches the last message of each tagged Gmail
// thread (up to 5) and returns a compact { subject, from, snippet }
// summary for injection into the ai-workspace system prompt. Caller
// passes a pre-resolved access token so this can run inside the
// /api/ai-workspace POST without a second token-refresh round trip.
// Failures on any single thread are swallowed — partial context beats
// crashing the whole Game Plan response.
export async function getRecentTaggedEmails(
  accessToken: string,
  threadIds: string[],
  maxCharsPerMessage: number = 400,
): Promise<{ subject: string; from: string; snippet: string }[]> {
  if (threadIds.length === 0) return [];
  const limited = threadIds.slice(0, 5);
  const results = await Promise.all(
    limited.map(async (threadId) => {
      try {
        const url = new URL(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`,
        );
        url.searchParams.set("format", "full");
        const r = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (!r.ok) return null;
        const j = (await r.json()) as GmailThreadResponse;
        const messages = j.messages ?? [];
        if (messages.length === 0) return null;
        const last = messages[messages.length - 1];
        const subject = headerValue(last.payload?.headers, "Subject") || "(no subject)";
        const from = headerValue(last.payload?.headers, "From") || "";

        let snippet = "";
        if (last.payload) {
          const textPart = findPart(last.payload, "text/plain");
          if (textPart?.body?.data) {
            snippet = decodeB64Url(textPart.body.data);
          } else {
            const htmlPart = findPart(last.payload, "text/html");
            if (htmlPart?.body?.data) {
              snippet = decodeB64Url(htmlPart.body.data)
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            }
          }
        }
        if (!snippet) snippet = last.snippet ?? "";
        if (snippet.length > maxCharsPerMessage) {
          snippet = snippet.slice(0, maxCharsPerMessage);
        }
        return { subject, from, snippet };
      } catch {
        return null;
      }
    }),
  );
  return results.filter(
    (r): r is { subject: string; from: string; snippet: string } => r !== null,
  );
}

// Lighter-weight cousin of getRecentTaggedEmails — pulls just the
// metadata headers (Subject + From) plus internalDate for each thread,
// no body, no MIME walk. Used by the candidate Activity tab + client
// Email tab to render compact row lists. Per-thread failures are
// swallowed so a single Gmail hiccup doesn't blank the whole list.
export async function listTaggedThreadSummaries(
  accessToken: string,
  threadIds: string[],
): Promise<{ threadId: string; subject: string; from: string; dateIso: string | null }[]> {
  if (threadIds.length === 0) return [];
  const results = await Promise.all(
    threadIds.map(async (threadId) => {
      try {
        const url = new URL(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`,
        );
        url.searchParams.set("format", "metadata");
        for (const h of ["From", "Subject", "Date"]) {
          url.searchParams.append("metadataHeaders", h);
        }
        const r = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (!r.ok) return null;
        const j = (await r.json()) as GmailThreadResponse;
        const messages = j.messages ?? [];
        if (messages.length === 0) return null;
        const last = messages[messages.length - 1];
        const subject = headerValue(last.payload?.headers, "Subject") || "(no subject)";
        const from = headerValue(last.payload?.headers, "From") || "";
        const dateIso = last.internalDate
          ? new Date(Number(last.internalDate)).toISOString()
          : null;
        return { threadId: j.id, subject, from, dateIso };
      } catch {
        return null;
      }
    }),
  );
  return results.filter(
    (r): r is { threadId: string; subject: string; from: string; dateIso: string | null } =>
      r !== null,
  );
}

// Pub/Sub topic Gmail pushes new-mail notifications to. Hardcoded
// to the breakpoint-crm GCP project since Ace is single-tenant; if
// we ever move projects, update here.
export const GMAIL_PUSH_TOPIC = "projects/breakpoint-crm/topics/ace-gmail-push";

// Registers (or renews) a Gmail INBOX watch on this user's mailbox.
// Gmail expires watches after 7 days, so this is called both from
// the Settings "Enable / Renew" button and from the daily renew cron
// for any row within 24h of expiration. The returned historyId is the
// pointer the webhook reads from when filtering messages.history.list
// down to only what arrived since the last push.
export async function registerGmailWatch({
  userId,
  organizationId,
  email,
}: {
  userId: string;
  organizationId: string;
  email: string;
}): Promise<{ expiresAt: Date; historyId: string }> {
  const accessToken = await getFreshAccessToken(userId);
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/watch",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        labelIds: ["INBOX"],
        topicName: GMAIL_PUSH_TOPIC,
      }),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail watch failed (${res.status}): ${text || "no body"}`);
  }
  const json = (await res.json()) as { historyId: string; expiration: string };
  const expiresAt = new Date(Number(json.expiration));
  const historyId = String(json.historyId);

  await prisma.gmailPushWatch.upsert({
    where: { organizationId_email: { organizationId, email } },
    create: { organizationId, email, expiresAt, lastHistoryId: historyId },
    update: { expiresAt, lastHistoryId: historyId },
  });

  return { expiresAt, historyId };
}
