import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAppPreferences } from "@/lib/preferences";

type OrgLineUser = {
  id: string;
  email: string | null;
  profile: { phone: string | null } | null;
};

export function phoneTail(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const trimmed = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return trimmed.length >= 10 ? trimmed.slice(-10) : "";
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function collectLineDigits(
  user: OrgLineUser,
  recruiterPhones: Record<string, string>,
): string[] {
  const out = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const digits = phoneTail(raw);
    if (digits) out.add(digits);
  };

  const email = normalizeEmail(user.email);
  if (email) {
    add(recruiterPhones[email]);
    add(recruiterPhones[user.email ?? ""]);
  }
  add(user.profile?.phone ?? null);

  const envOwnerEmail = normalizeEmail(
    process.env.QUO_OWNER_EMAIL ?? process.env.QUO_NOTIFICATION_OWNER_EMAIL,
  );
  if (envOwnerEmail && email === envOwnerEmail) {
    add(process.env.QUO_FROM_NUMBER);
  }

  return Array.from(out);
}

async function getOrgLineUsers(organizationId: string): Promise<OrgLineUser[]> {
  return prisma.user.findMany({
    where: { memberships: { some: { organizationId } } },
    select: {
      id: true,
      email: true,
      profile: { select: { phone: true } },
    },
  });
}

export async function getQuoLineDigitsForUserEmail(
  organizationId: string,
  email: string | null | undefined,
): Promise<string[]> {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  const [prefs, user] = await Promise.all([
    getAppPreferences(),
    prisma.user.findFirst({
      where: {
        email: { equals: normalized, mode: "insensitive" },
        memberships: { some: { organizationId } },
      },
      select: {
        id: true,
        email: true,
        profile: { select: { phone: true } },
      },
    }),
  ]);
  return user ? collectLineDigits(user, prefs.recruiterPhones) : [];
}

export async function getQuoLineDigitsForUserId(
  organizationId: string,
  userId: string,
): Promise<string[]> {
  const [prefs, user] = await Promise.all([
    getAppPreferences(),
    prisma.user.findFirst({
      where: {
        id: userId,
        memberships: { some: { organizationId } },
      },
      select: {
        id: true,
        email: true,
        profile: { select: { phone: true } },
      },
    }),
  ]);
  return user ? collectLineDigits(user, prefs.recruiterPhones) : [];
}

export async function resolveQuoLineOwnerUserId(
  organizationId: string,
  lineNumber: string | null | undefined,
): Promise<string | null> {
  const target = phoneTail(lineNumber) || phoneTail(process.env.QUO_FROM_NUMBER);
  if (!target) return null;

  const [prefs, users] = await Promise.all([
    getAppPreferences(),
    getOrgLineUsers(organizationId),
  ]);
  for (const user of users) {
    if (collectLineDigits(user, prefs.recruiterPhones).includes(target)) {
      return user.id;
    }
  }
  return null;
}

function noSmsRows(): Prisma.SmsMessageWhereInput {
  return { id: "__no_quo_line__" };
}

function noCallRows(): Prisma.CallLogWhereInput {
  return { id: "__no_quo_line__" };
}

export function smsLineWhere(
  phoneDigits: string[],
  side: "any" | "inbound" = "any",
): Prisma.SmsMessageWhereInput {
  if (phoneDigits.length === 0) return noSmsRows();
  return {
    OR: phoneDigits.flatMap((digits) =>
      side === "inbound"
        ? [{ toNumber: { contains: digits } }]
        : [
            { fromNumber: { contains: digits } },
            { toNumber: { contains: digits } },
          ],
    ),
  };
}

export function callLineWhere(
  phoneDigits: string[],
  side: "any" | "inbound" = "any",
): Prisma.CallLogWhereInput {
  if (phoneDigits.length === 0) return noCallRows();
  return {
    OR: phoneDigits.flatMap((digits) =>
      side === "inbound"
        ? [{ toNumber: { contains: digits } }]
        : [
            { fromNumber: { contains: digits } },
            { toNumber: { contains: digits } },
          ],
    ),
  };
}
