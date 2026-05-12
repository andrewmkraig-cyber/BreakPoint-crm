import { prisma } from "@/lib/prisma";

// Billing identity surfaced on every PDF invoice + email signature: company
// address, EIN, bank/ACH details, AR contact, payment terms default. Stored
// as a single JSON blob under Setting.key="app.billing" so we don't need a
// dedicated table — same pattern as app.preferences. One row per workspace.

const BILLING_KEY = "app.billing";

export type BillingSettings = {
  companyName: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  ein: string;
  arEmail: string;
  arPhone: string;
  website: string;
  defaultPaymentTerms: string;
  bankName: string;
  bankBeneficiary: string;
  bankRouting: string;
  bankAccount: string;
  bankSwift: string;
  checkPayableTo: string;
  checkMailingAddress: string;
};

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  companyName: "BreakPoint Talent",
  addressLine1: "5074 Hidden Creek Circle",
  city: "Solon",
  state: "OH",
  zip: "44139",
  ein: "",
  arEmail: "ar@breakpointtalent.com",
  arPhone: "216-340-9511",
  website: "breakpointtalent.com",
  defaultPaymentTerms: "Net 30",
  bankName: "",
  bankBeneficiary: "BreakPoint Talent LLC",
  bankRouting: "",
  bankAccount: "",
  bankSwift: "",
  checkPayableTo: "Kraig Talent LLC",
  checkMailingAddress: "5074 Hidden Creek Circle\nSolon, OH 44139",
};

function normalize(raw: unknown): BillingSettings {
  const obj = (raw as Partial<BillingSettings> | null | undefined) ?? {};
  const merged: BillingSettings = { ...DEFAULT_BILLING_SETTINGS };
  for (const key of Object.keys(DEFAULT_BILLING_SETTINGS) as Array<keyof BillingSettings>) {
    const value = obj[key];
    if (typeof value === "string") merged[key] = value;
  }
  return merged;
}

export async function getBillingSettings(): Promise<BillingSettings> {
  const row = await prisma.setting.findUnique({ where: { key: BILLING_KEY } });
  return normalize(row?.value);
}

export async function updateBillingSettings(
  patch: Partial<BillingSettings>,
): Promise<BillingSettings> {
  const current = await getBillingSettings();
  const next: BillingSettings = { ...current };
  for (const key of Object.keys(patch) as Array<keyof BillingSettings>) {
    const v = patch[key];
    if (typeof v === "string") next[key] = v;
  }
  await prisma.setting.upsert({
    where: { key: BILLING_KEY },
    create: { key: BILLING_KEY, value: next },
    update: { value: next },
  });
  return next;
}
