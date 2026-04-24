"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_LOGO_BYTES } from "@/lib/signature";

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
      error: `Logo is ${Math.round(bytes.byteLength / 1024)}KB — max is ${MAX_LOGO_BYTES / 1024}KB.`,
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
