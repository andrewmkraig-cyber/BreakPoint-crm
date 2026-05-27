"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  MAX_LOGO_BYTES,
  getUserBrandingProfile,
  renderSignatureHtml,
  type SignatureAssetUrls,
} from "@/lib/signature";
import { getFreshAccessToken } from "@/lib/gmail";

// Gmail's users.settings.sendAs API caps the `signature` field at
// 10,000 chars. The Ace-rendered base64 signature is ~85 KB (logo
// ~80 KB + three icons + markup), well over the cap. We host the
// same PNGs in /public/brand/ so the Gmail-push variant of the
// signature can reference them as plain HTTPS URLs instead, which
// drops the rendered HTML to ~1.5 KB. Production domain is the
// canonical asset host — Vercel preview URLs aren't stable, and
// Gmail caches the image bytes once it fetches them, so a stable
// URL matters more than matching whichever deploy the user was on
// when they hit Push.
const GMAIL_SIGNATURE_ASSET_HOST = "https://ace.breakpointtalent.com";
const GMAIL_SIGNATURE_ASSETS: SignatureAssetUrls = {
  iconEmail: `${GMAIL_SIGNATURE_ASSET_HOST}/brand/icon-email.png`,
  iconPhone: `${GMAIL_SIGNATURE_ASSET_HOST}/brand/icon-phone.png`,
  iconGlobe: `${GMAIL_SIGNATURE_ASSET_HOST}/brand/icon-globe.png`,
  logo: `${GMAIL_SIGNATURE_ASSET_HOST}/brand/breakpoint-logo.png`,
};

// Hard ceiling per Gmail API docs. If the rendered signature ever
// crosses this we abort before calling Google (better error than
// a 400 from sendAs.update) — also surfaces a regression early if
// somebody re-introduces a base64 asset on the push path.
const GMAIL_SIGNATURE_MAX_CHARS = 10000;

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

export type BrandingFields = {
  fullName: string;
  jobTitle: string;
  phone: string;
  website: string;
};

async function requireUserId(): Promise<{ id: string; email: string } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true },
  });
  if (!user?.email) return null;
  return { id: user.id, email: user.email };
}

// Upserts the text fields on the signed-in user's UserProfile. Logo
// upload is a separate action (uploadBrandingLogo) because the FormData
// shape is different. Both paths are tenant-scoped by the session
// cookie — a caller without a valid session never touches the row.
export async function saveBrandingFields(patch: BrandingFields): Promise<ActionResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  try {
    await prisma.userProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        fullName: patch.fullName.trim() || null,
        jobTitle: patch.jobTitle.trim() || null,
        phone: patch.phone.trim() || null,
        website: patch.website.trim() || null,
      },
      update: {
        fullName: patch.fullName.trim() || null,
        jobTitle: patch.jobTitle.trim() || null,
        phone: patch.phone.trim() || null,
        website: patch.website.trim() || null,
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save branding." };
  }
}

// Logo upload via server action. The client reads the file as base64
// (FileReader.readAsDataURL) and passes it in. We enforce the 500KB cap
// here — a second time on top of the client guard — and validate the
// mime type.
const ALLOWED_LOGO_MIMES = new Set(["image/png", "image/jpeg", "image/jpg"]);

export async function uploadBrandingLogo(input: {
  filename: string;
  mimeType: string;
  dataBase64: string;
}): Promise<ActionResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  const mime = input.mimeType || "image/png";
  if (!ALLOWED_LOGO_MIMES.has(mime)) {
    return { ok: false, error: `Unsupported logo type: ${mime}. PNG or JPG only.` };
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.dataBase64, "base64");
  } catch {
    return { ok: false, error: "Logo payload was not valid base64." };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, error: "Logo file is empty." };
  }
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    return {
      ok: false,
      error: `Logo is ${Math.round(bytes.byteLength / 1024)}KB. Max is ${MAX_LOGO_BYTES / 1024}KB.`,
    };
  }
  // Prisma's Bytes column expects Uint8Array<ArrayBuffer>; Buffer
  // subclasses Uint8Array but over ArrayBufferLike, which TS rejects.
  // Same copy pattern as src/app/candidates/new/actions.ts — fresh
  // ArrayBuffer-backed Uint8Array to satisfy the typing.
  const ab = new ArrayBuffer(bytes.byteLength);
  const logoData = new Uint8Array(ab);
  logoData.set(bytes);
  try {
    await prisma.userProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        logoData,
        logoMimeType: mime,
      },
      update: {
        logoData,
        logoMimeType: mime,
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save logo." };
  }
}

export async function resetBrandingLogo(): Promise<ActionResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  try {
    await prisma.userProfile.updateMany({
      where: { userId: user.id },
      data: { logoData: null, logoMimeType: null },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to reset logo." };
  }
}

// Push the Ace-rendered signature to Gmail's native SendAs settings.
// After this runs, composing directly in gmail.com (not just on
// Ace-sent mail) shows the signature. Requires the
// `gmail.settings.basic` scope — users granted before the scope was
// added need to sign out and back in once; we surface that as a
// targeted re-auth message on 403.
//
// Gmail returns up to a few SendAs entries (primary + aliases). We
// update the primary (`isPrimary: true`) only; updating every alias
// would clobber any custom signatures Andrew has set on alternate
// "from" addresses, and Ace has no UI to express that intent.
type GmailSendAsListResponse = {
  sendAs?: Array<{
    sendAsEmail: string;
    isPrimary?: boolean;
    isDefault?: boolean;
    signature?: string;
  }>;
};

export async function pushSignatureToGmail(): Promise<ActionResult<{ targetEmail: string }>> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };

  let signatureHtml: string;
  try {
    const profile = await getUserBrandingProfile(user.id);
    // Push variant: every image is a hosted HTTPS URL, not base64.
    // This is the *only* code path that drops the inline assets —
    // every inbox-bound render (preview / /send / /reply / gmail.ts
    // withSignature) still embeds base64.
    signatureHtml = renderSignatureHtml(profile, GMAIL_SIGNATURE_ASSETS);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Couldn't render the signature.",
    };
  }

  // Diag log + guard. Length is the JS string length (UTF-16 code
  // units); for the all-ASCII signature this matches Gmail's char
  // count. Logged before the API call so we can verify in Vercel
  // logs that the trimmed signature stays well under 10K.
  console.log(
    `[push-signature] rendered=${signatureHtml.length} chars (limit=${GMAIL_SIGNATURE_MAX_CHARS})`,
  );
  if (signatureHtml.length > GMAIL_SIGNATURE_MAX_CHARS) {
    return {
      ok: false,
      error: `Rendered signature is ${signatureHtml.length} characters — Gmail's API caps the signature field at ${GMAIL_SIGNATURE_MAX_CHARS}. Trim the signature or fall back to a smaller asset set.`,
    };
  }

  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(user.id);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Couldn't fetch a Google access token.",
    };
  }

  // 1) Discover the primary SendAs. The API returns the signed-in
  // user's own mailbox plus any aliases they've added in Gmail
  // settings. The primary is the one with `isPrimary: true` — that
  // matches what Gmail's compose UI defaults to.
  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
  );
  if (listRes.status === 403) {
    return {
      ok: false,
      error:
        "Gmail rejected the request — the gmail.settings.basic scope hasn't been granted yet. Sign out of Ace and sign back in to grant it.",
    };
  }
  if (!listRes.ok) {
    const text = await listRes.text().catch(() => "");
    return {
      ok: false,
      error: `Gmail sendAs list failed (${listRes.status}): ${text.slice(0, 200) || "no body"}`,
    };
  }
  const list = (await listRes.json()) as GmailSendAsListResponse;
  const primary = list.sendAs?.find((s) => s.isPrimary) ?? list.sendAs?.[0];
  if (!primary?.sendAsEmail) {
    return { ok: false, error: "Couldn't find a primary SendAs address in your Gmail." };
  }

  // 2) PATCH the primary SendAs with the rendered signature HTML.
  // PATCH (not PUT) preserves every other field on the SendAs row —
  // alias display name, treatAsAlias, replyToAddress, etc. We only
  // touch `signature`.
  const updateRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/${encodeURIComponent(primary.sendAsEmail)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ signature: signatureHtml }),
      cache: "no-store",
    },
  );
  if (updateRes.status === 403) {
    return {
      ok: false,
      error:
        "Gmail rejected the write — the gmail.settings.basic scope hasn't been granted yet. Sign out of Ace and sign back in to grant it.",
    };
  }
  if (!updateRes.ok) {
    const text = await updateRes.text().catch(() => "");
    return {
      ok: false,
      error: `Gmail sendAs update failed (${updateRes.status}): ${text.slice(0, 200) || "no body"}`,
    };
  }

  return { ok: true, value: { targetEmail: primary.sendAsEmail } };
}
