"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  EMPTY_ADDRESS,
  TSHIRT_SIZES,
  parseAddress,
  serializeAddress,
  type AddressFields,
  type PersonalInfoRow,
} from "@/app/settings/personal-info-constants";

// Personal-info fields (birthday, address, t-shirt size) live on
// UserProfile and are scoped per signed-in user — not per org. Loaders
// upsert an empty profile row on demand so the form has something to
// hydrate from on first visit.
//
// Address is a 4-field shape (street/city/state/zip) on the wire but
// persists as a JSON-encoded string in UserProfile.address — see
// personal-info-constants for the (de)serializer.

type Result = { ok: true } | { ok: false; error: string };
type ResultWithValue<T> = { ok: true; value: T } | { ok: false; error: string };

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return user?.id ?? null;
}

// PNG, JPG, and WebP only — three formats every modern browser
// renders without a polyfill. 1 MB upper bound mirrors what every
// modern HR portal lets through for a headshot.
const ALLOWED_PROFILE_PICTURE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const MAX_PROFILE_PICTURE_BYTES = 1_000_000;

export async function getPersonalInfo(): Promise<PersonalInfoRow | null> {
  const userId = await requireUserId();
  if (!userId) return null;
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      birthday: true,
      workAnniversary: true,
      address: true,
      tshirtSize: true,
    },
  });
  if (!profile) {
    return {
      birthday: null,
      workAnniversary: null,
      address: { ...EMPTY_ADDRESS },
      tshirtSize: null,
    };
  }
  return {
    birthday: profile.birthday
      ? profile.birthday.toISOString().slice(0, 10)
      : null,
    workAnniversary: profile.workAnniversary
      ? profile.workAnniversary.toISOString().slice(0, 10)
      : null,
    address: parseAddress(profile.address),
    tshirtSize: profile.tshirtSize,
  };
}

export async function savePersonalInfo(input: {
  birthday: string | null; // YYYY-MM-DD or empty
  workAnniversary: string | null; // YYYY-MM-DD or empty
  address: AddressFields;
  tshirtSize: string | null;
}): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  // Birthday + workAnniversary share the same YYYY-MM-DD parse path:
  // both are calendar dates stored as @db.Date in Postgres, and both
  // need to land on a deterministic midnight UTC so downstream year
  // math (zodiac, anniversary count) doesn't drift across timezones.
  function parseCalendarDate(
    raw: string | null,
    label: string,
  ): { ok: true; value: Date | null } | { ok: false; error: string } {
    if (!raw || raw.trim() === "") return { ok: true, value: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return { ok: false, error: `${label} must be in YYYY-MM-DD format.` };
    }
    const parsed = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: `${label} is not a valid date.` };
    }
    return { ok: true, value: parsed };
  }

  const birthdayRes = parseCalendarDate(input.birthday, "Birthday");
  if (!birthdayRes.ok) return birthdayRes;
  const anniversaryRes = parseCalendarDate(
    input.workAnniversary,
    "Start date",
  );
  if (!anniversaryRes.ok) return anniversaryRes;
  const birthday = birthdayRes.value;
  const workAnniversary = anniversaryRes.value;

  const tshirtSize =
    input.tshirtSize && input.tshirtSize.trim() !== ""
      ? input.tshirtSize.trim()
      : null;
  if (
    tshirtSize !== null &&
    !(TSHIRT_SIZES as readonly string[]).includes(tshirtSize)
  ) {
    return { ok: false, error: "Unknown t-shirt size." };
  }

  const address = serializeAddress(input.address);

  try {
    await prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        birthday,
        workAnniversary,
        address,
        tshirtSize,
      },
      update: { birthday, workAnniversary, address, tshirtSize },
    });
    revalidatePath("/settings/personal-info");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to save personal info.",
    };
  }
}

// ---- Profile picture --------------------------------------------------

export type ProfilePictureStatus = {
  // Current avatar URL as it will appear in <img src>. May be the
  // uploaded /api/avatar/<userId>?v=<timestamp> URL, the Google
  // OAuth picture, or null when neither exists.
  imageUrl: string | null;
  // True iff the user has uploaded a custom picture (i.e. the bytes
  // live in UserProfile.profileImageData). Drives whether the settings
  // UI shows "Use default photo" or "Remove" / "Upload a new photo".
  hasCustomPicture: boolean;
};

export async function getProfilePictureStatus(): Promise<ProfilePictureStatus> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return { imageUrl: null, hasCustomPicture: false };
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      image: true,
      profile: { select: { profileImageData: true } },
    },
  });
  if (!user) return { imageUrl: null, hasCustomPicture: false };
  return {
    imageUrl: user.image,
    hasCustomPicture: Boolean(user.profile?.profileImageData),
  };
}

// Upload + store a new profile picture. The client reads the file via
// FileReader (base64) and posts it here — same shape as
// uploadBrandingLogo for the email-signature logo. We store the bytes
// inline on UserProfile and immediately rewrite User.image to the
// /api/avatar/<userId>?v=<timestamp> URL so every NextAuth-driven
// avatar surface picks up the new picture on the next session refresh.
export async function uploadProfilePicture(input: {
  filename: string;
  mimeType: string;
  dataBase64: string;
}): Promise<ResultWithValue<{ imageUrl: string }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const mime = input.mimeType || "image/png";
  if (!ALLOWED_PROFILE_PICTURE_MIMES.has(mime)) {
    return {
      ok: false,
      error: `Unsupported image type: ${mime}. PNG, JPG, or WebP only.`,
    };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.dataBase64, "base64");
  } catch {
    return { ok: false, error: "Image payload was not valid base64." };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, error: "Image file is empty." };
  }
  if (bytes.byteLength > MAX_PROFILE_PICTURE_BYTES) {
    return {
      ok: false,
      error: `Image is ${Math.round(bytes.byteLength / 1024)}KB — max is ${MAX_PROFILE_PICTURE_BYTES / 1024}KB.`,
    };
  }
  // Prisma's Bytes column wants Uint8Array<ArrayBuffer>; Buffer is a
  // Uint8Array but backed by ArrayBufferLike, which the generated type
  // rejects. Copy into a fresh ArrayBuffer-backed view — same trick
  // uploadBrandingLogo uses (branding-actions.ts:96).
  const ab = new ArrayBuffer(bytes.byteLength);
  const profileImageData = new Uint8Array(ab);
  profileImageData.set(bytes);

  // ?v=<timestamp> cache-busts the 5-minute Cache-Control on the
  // /api/avatar route so the new picture is visible immediately
  // instead of waiting for the old response to expire.
  const imageUrl = `/api/avatar/${userId}?v=${Date.now()}`;

  try {
    await prisma.$transaction([
      prisma.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          profileImageData,
          profileImageMimeType: mime,
        },
        update: {
          profileImageData,
          profileImageMimeType: mime,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { image: imageUrl },
      }),
    ]);
    // Every page that renders an avatar pulls it from either the
    // session (client) or User.image directly (server). Refresh the
    // page caches so server-rendered surfaces (calendar team list,
    // event tile owner dots) re-fetch with the new URL.
    revalidatePath("/", "layout");
    return { ok: true, value: { imageUrl } };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to save picture.",
    };
  }
}

// Reverts to the user's default photo — clears the custom bytes and
// nulls User.image. NextAuth's PrismaAdapter will re-populate
// User.image with the Google OAuth picture on the next sign-in, which
// is exactly what the user wants when they pick "Use default photo"
// (i.e. "stop using my upload, go back to whatever Google gave me").
export async function resetProfilePicture(): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  try {
    await prisma.$transaction([
      prisma.userProfile.updateMany({
        where: { userId },
        data: {
          profileImageData: null,
          profileImageMimeType: null,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { image: null },
      }),
    ]);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to reset picture.",
    };
  }
}
