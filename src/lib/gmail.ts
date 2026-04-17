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
};

export type SendEmailResult = { id: string; threadId: string };

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
  headers.push("MIME-Version: 1.0");

  if (params.bodyHtml) {
    const boundary = `----=_BreakPoint_${Math.random().toString(36).slice(2)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const body = [
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      params.bodyText,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      params.bodyHtml,
      "",
      `--${boundary}--`,
    ].join("\r\n");
    return headers.join("\r\n") + "\r\n" + body;
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
