"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  TSHIRT_SIZES,
  type PersonalInfoRow,
} from "@/app/settings/personal-info-constants";

// Personal-info fields (birthday, address, t-shirt size) live on
// UserProfile and are scoped per signed-in user — not per org. Loaders
// upsert an empty profile row on demand so the form has something to
// hydrate from on first visit.

type Result = { ok: true } | { ok: false; error: string };

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

export async function getPersonalInfo(): Promise<PersonalInfoRow | null> {
  const userId = await requireUserId();
  if (!userId) return null;
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { birthday: true, address: true, tshirtSize: true },
  });
  if (!profile) return { birthday: null, address: null, tshirtSize: null };
  return {
    birthday: profile.birthday
      ? profile.birthday.toISOString().slice(0, 10)
      : null,
    address: profile.address,
    tshirtSize: profile.tshirtSize,
  };
}

export async function savePersonalInfo(input: {
  birthday: string | null; // YYYY-MM-DD or empty
  address: string | null;
  tshirtSize: string | null;
}): Promise<Result> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  let birthday: Date | null = null;
  if (input.birthday && input.birthday.trim() !== "") {
    // YYYY-MM-DD → midnight UTC. Postgres `@db.Date` strips the time
    // component, but normalizing here keeps zodiacFromDate's UTC math
    // unambiguous when the same Date is read back in.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthday)) {
      return { ok: false, error: "Birthday must be in YYYY-MM-DD format." };
    }
    const parsed = new Date(`${input.birthday}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "Birthday is not a valid date." };
    }
    birthday = parsed;
  }

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

  const address =
    input.address && input.address.trim() !== "" ? input.address.trim() : null;

  try {
    await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, birthday, address, tshirtSize },
      update: { birthday, address, tshirtSize },
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
