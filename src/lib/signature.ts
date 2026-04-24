import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";

// Gmail-style HTML-table signature rendered from the user's UserProfile.
// Kept intentionally in one file so the render logic, the plain-text
// fallback, and the default-profile bootstrap are easy to grep for.
//
// Design principles:
// - HTML tables for layout (Gmail, Apple Mail, Outlook all handle tables
//   consistently; flexbox/grid are hit-or-miss in email clients).
// - Inline styles only — <style> blocks and class refs get stripped by
//   most email clients.
// - Logo as base64 data: URI so the recipient doesn't have to click
//   "Display images from this sender" to see it.
// - Icons as SVG data: URIs. Same reason + they stay crisp at any DPI.

export const SIGNATURE_GREEN = "#5A9642";
export const SIGNATURE_DARK = "#1a1a1a";
export const SIGNATURE_DIVIDER = "#e5e7eb";
export const MAX_LOGO_BYTES = 500 * 1024;

export type UserProfileInput = {
  fullName: string;
  jobTitle: string;
  phone: string;
  website: string;
  logoDataBase64: string; // empty string means "no logo"
  logoMimeType: string;
};

export type UserProfileRecord = UserProfileInput & {
  userId: string;
  email: string;
  hasCustomLogo: boolean;
};

const ANDREW_DEFAULTS = {
  jobTitle: "Managing Partner & Founder",
  phone: "216-870-4655",
  website: "www.breakpointtalent.com",
};

// Reads the shipped default signature logo from /public/brand/ at
// request time. Cached per process (a Node fs read on cold start is
// fine but not every call). Returns { mime, base64 }.
let cachedDefaultLogo: { mime: string; base64: string } | null = null;
async function loadDefaultLogo(): Promise<{ mime: string; base64: string }> {
  if (cachedDefaultLogo) return cachedDefaultLogo;
  const file = path.join(process.cwd(), "public", "brand", "breakpoint_logo_signature.png");
  const bytes = await fs.readFile(file);
  cachedDefaultLogo = { mime: "image/png", base64: bytes.toString("base64") };
  return cachedDefaultLogo;
}

// Fetch the user's profile, returning a fully-populated record with
// sensible defaults for missing fields. Never returns null; a signed-in
// user without a profile row gets a virtual one synthesized from their
// User row + /public/brand/ default logo.
export async function getUserBrandingProfile(userId: string): Promise<UserProfileRecord> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, profile: true },
  });
  if (!user) {
    // Shouldn't happen in practice — caller already verified the session.
    // Fall back to the BreakPoint defaults so we never return null.
    const def = await loadDefaultLogo();
    return {
      userId,
      email: "",
      fullName: "",
      jobTitle: ANDREW_DEFAULTS.jobTitle,
      phone: ANDREW_DEFAULTS.phone,
      website: ANDREW_DEFAULTS.website,
      logoDataBase64: def.base64,
      logoMimeType: def.mime,
      hasCustomLogo: false,
    };
  }
  const p = user.profile;
  const hasCustomLogo = Boolean(p?.logoData && p.logoData.length > 0);
  let logoDataBase64 = "";
  let logoMimeType = "";
  if (hasCustomLogo) {
    logoDataBase64 = Buffer.from(p!.logoData!).toString("base64");
    logoMimeType = p!.logoMimeType ?? "image/png";
  } else {
    const def = await loadDefaultLogo();
    logoDataBase64 = def.base64;
    logoMimeType = def.mime;
  }
  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: p?.fullName?.trim() || user.name?.trim() || "",
    jobTitle: p?.jobTitle?.trim() || ANDREW_DEFAULTS.jobTitle,
    phone: p?.phone?.trim() || ANDREW_DEFAULTS.phone,
    website: p?.website?.trim() || ANDREW_DEFAULTS.website,
    logoDataBase64,
    logoMimeType,
    hasCustomLogo,
  };
}

// SVG data: URI helpers — inline so the signature doesn't depend on any
// external asset. Each returns a ready-to-drop <img src="..."/> value.
function svgDataUri(svg: string): string {
  // Strip newlines + collapse whitespace so the data: URI stays compact.
  const compact = svg.replace(/\s+/g, " ").trim();
  return `data:image/svg+xml;utf8,${encodeURIComponent(compact)}`;
}

function envelopeIcon(): string {
  return svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
      <circle cx="12" cy="12" r="12" fill="${SIGNATURE_GREEN}"/>
      <path d="M6 8.5h12v7h-12z" fill="${SIGNATURE_GREEN}" stroke="#ffffff" stroke-width="1.4"/>
      <polyline points="6,9 12,13.2 18,9" fill="none" stroke="#ffffff" stroke-width="1.4"/>
    </svg>
  `);
}

function phoneIcon(): string {
  return svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
      <circle cx="12" cy="12" r="12" fill="${SIGNATURE_GREEN}"/>
      <path d="M9.3 7.4 l1.5-0.4 l1.3 2.6 l-1.1 1.2 a8 8 0 0 0 2.2 2.2 l1.2-1.1 l2.6 1.3 l-0.4 1.5 a1 1 0 0 1-1 0.7 c-3.8 0-7-3.2-7-7 a1 1 0 0 1 0.7-1 z" fill="#ffffff"/>
    </svg>
  `);
}

function globeIcon(): string {
  return svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
      <circle cx="12" cy="12" r="12" fill="${SIGNATURE_GREEN}"/>
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="#ffffff" stroke-width="1.3"/>
      <ellipse cx="12" cy="12" rx="2.4" ry="5.5" fill="none" stroke="#ffffff" stroke-width="1.3"/>
      <line x1="6.5" y1="12" x2="17.5" y2="12" stroke="#ffffff" stroke-width="1.3"/>
    </svg>
  `);
}

type ContactRow = {
  iconSrc: string;
  text: string;
  href: string;
};

function buildContactRows(p: UserProfileRecord): ContactRow[] {
  const rows: ContactRow[] = [];
  if (p.email) {
    rows.push({ iconSrc: envelopeIcon(), text: p.email, href: `mailto:${p.email}` });
  }
  if (p.phone) {
    rows.push({
      iconSrc: phoneIcon(),
      text: p.phone,
      href: `tel:${p.phone.replace(/[^+0-9]/g, "")}`,
    });
  }
  if (p.website) {
    const href = /^https?:\/\//i.test(p.website) ? p.website : `https://${p.website}`;
    rows.push({ iconSrc: globeIcon(), text: p.website, href });
  }
  return rows;
}

// Render the signature as an HTML-table block. Returns just the inner
// HTML (no <html><body>) so callers can splice it into any email body.
export function renderSignatureHtml(profile: UserProfileRecord): string {
  const logoSrc =
    profile.logoDataBase64.length > 0
      ? `data:${profile.logoMimeType};base64,${profile.logoDataBase64}`
      : "";
  const contactRows = buildContactRows(profile);
  const nameLine = profile.fullName
    ? `<div style="font-family: Georgia, 'Cormorant Garamond', serif; font-weight: 700; font-size: 18px; color: ${SIGNATURE_DARK}; line-height: 1.2;">${escape(profile.fullName)}</div>`
    : "";
  const titleLine = profile.jobTitle
    ? `<div style="font-family: Arial, Helvetica, sans-serif; font-weight: 700; font-size: 11px; color: ${SIGNATURE_GREEN}; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 4px;">${escape(profile.jobTitle)}</div>`
    : "";
  const divider = `<div style="border-top: 1px solid ${SIGNATURE_DIVIDER}; margin: 8px 0;"></div>`;
  const contactsHtml = contactRows
    .map(
      (r) => `
        <tr>
          <td style="padding: 2px 8px 2px 0; vertical-align: middle;">
            <img src="${r.iconSrc}" width="20" height="20" alt="" style="display: block; border: 0;"/>
          </td>
          <td style="padding: 2px 0; vertical-align: middle; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: ${SIGNATURE_DARK};">
            <a href="${escape(r.href)}" style="color: ${SIGNATURE_DARK}; text-decoration: underline;">${escape(r.text)}</a>
          </td>
        </tr>`,
    )
    .join("");

  const logoCell = logoSrc
    ? `
      <td width="140" style="padding: 0 18px 0 0; vertical-align: middle; background: #ffffff;">
        <img src="${logoSrc}" width="120" alt="BreakPoint Talent" style="display: block; border: 0; max-width: 120px; height: auto;"/>
      </td>`
    : "";

  const dividerCell = `
    <td width="2" style="width: 2px; background: ${SIGNATURE_GREEN}; padding: 0;">&nbsp;</td>`;

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; color: ${SIGNATURE_DARK};">
      <tr>
        ${logoCell}
        ${dividerCell}
        <td style="padding: 0 0 0 18px; vertical-align: middle;">
          ${nameLine}
          ${titleLine}
          ${nameLine || titleLine ? divider : ""}
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
            ${contactsHtml}
          </table>
        </td>
      </tr>
    </table>`;
}

export function renderSignatureText(profile: UserProfileRecord): string {
  const lines: string[] = [];
  if (profile.fullName) lines.push(profile.fullName);
  if (profile.jobTitle) lines.push(profile.jobTitle);
  if (profile.email) lines.push(profile.email);
  if (profile.phone) lines.push(profile.phone);
  if (profile.website) lines.push(profile.website);
  return lines.join("\n");
}

function escape(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Standard email signature delimiter per RFC 3676: "-- " (dash-dash-
// space) on a line by itself. Used by mail clients to auto-fold the
// signature in quoted replies.
export const SIGNATURE_DELIMITER_TEXT = "-- ";
export const SIGNATURE_DELIMITER_HTML = `<div>-- </div>`;
