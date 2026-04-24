# Branding & Signature

Ships in Phase 6.2. A per-user branding block that drives the full Gmail-style email signature Ace appends to every outbound email.

## What it does

Settings → **Branding & Signature** exposes six fields:

| Field | Stored on | Default |
|---|---|---|
| **Full name** | `UserProfile.fullName` | your account name (NextAuth `user.name`) |
| **Job title** | `UserProfile.jobTitle` | `Managing Partner & Founder` |
| **Phone** | `UserProfile.phone` | `216-870-4655` |
| **Website** | `UserProfile.website` | `www.breakpointtalent.com` |
| **Email** | read-only, pulled from session | (your authenticated Google account) |
| **Signature logo** | `UserProfile.logoData` (Bytes) | `public/brand/breakpoint_logo_signature.png` |

Every field is per-user — your tenant-mate's saved name / logo / phone are in their own row.

## How it renders in email

The signature is a two-column HTML table:

- **Left column** — your logo, rendered at 120px wide, vertically centered on a white background. The logo travels as a `data:image/png;base64,...` URI, so recipients see it even with image loading disabled.
- **Thin vertical green divider** (`#5A9642`, 2px wide) between the two columns.
- **Right column, stacked:**
  - **Name** — 18px, bold, dark gray `#1a1a1a`, Georgia / Cormorant Garamond serif.
  - **Title** — 11px, bold, green `#5A9642`, letter-spacing 1.5px, UPPERCASE.
  - A light horizontal rule.
  - **Three contact rows**, each with a filled-green-circle SVG icon on the left:
    - ✉ envelope + your email (mailto: link)
    - 📞 phone + your phone (tel: link)
    - 🌐 globe + your website (https:// link)

If a field is empty, that row is skipped — you won't get a blank "email: " slot in the signature.

Preceding the signature, the plain-text body gets a standard `-- ` delimiter line (RFC 3676) so mail clients auto-fold it in quoted replies.

## How to use it

1. **Settings → Branding & Signature.**
2. Edit any text field. Changes are saved when you click **Save branding** (toast confirms).
3. **Replace logo**: click, pick a PNG or JPG up to 500KB. The preview updates immediately. Reload the page to confirm the change persisted — the logo is stored as raw bytes on your `UserProfile` row.
4. **Reset to default**: shown only if you've uploaded a custom logo. One click reverts the signature to the shipped BreakPoint logo.

## Where the signature shows up

Every email Ace sends on your behalf picks up your current signature:

- Mail Tab reply composer (`/mail` → Reply)
- Submittal composer
- Candidate confirmation emails
- Any future email surface (sending and drafts both route through `sendGmail()` in `src/lib/gmail.ts`, which calls `withSignature()`).

If you're looking at a received copy of your own email and the signature is missing, you probably used a template that pre-bakes a signature — `withSignature()` skips its own append if it detects a signature marker is already in the body.

## How the logo bytes travel

- Uploaded via a server action (`uploadBrandingLogo`) with a 500KB cap and PNG/JPG-only mime check.
- Stored on Neon Postgres as `UserProfile.logoData: Bytes`.
- On every send, encoded as base64 and embedded as a `data:` URI in the HTML table.
- Never uploaded to a CDN — the logo lives only in Ace's DB + whichever outbound emails you've sent.

## Troubleshooting

**"Couldn't save branding."**
Check the toast description — the underlying Prisma error surfaces there. Most common cause is a session that's gone stale; reload the page and try again.

**"Logo too large."**
Client-side guard against >500KB uploads. Compress the PNG (Squoosh, TinyPNG) and retry, or save as JPG if the image is photographic.

**"Wrong file type."**
PNG and JPG only. Convert animated GIFs / SVGs to PNG before uploading — email clients' rendering of alternate formats is unreliable.

**Signature renders but the logo doesn't appear in a recipient's Gmail.**
Gmail occasionally shows "Display images below" above a message with embedded data URIs. The recipient can click that; subsequent messages from you will show images by default. If it's systemic, check that the logo is under 200KB — Gmail applies stricter rules above that.

**Default logo shows up even after I've uploaded a custom one.**
Force-refresh the Settings page (⌘/Ctrl + Shift + R). The preview is rendered server-side; a cached HTML response could show the old state until the page re-fetches.

## Related features

- **Mail Tab reply composer** (`docs/help/mail-tab.md`) — consumes the signature on every send.
- **Submittal composer** — also consumes the signature (unchanged from before this release, since `sendGmail()` handles signature injection).
