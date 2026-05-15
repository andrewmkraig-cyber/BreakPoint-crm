// One-shot backfill: stamp CallLog.clientId + SmsMessage.clientId on
// existing rows by phone-matching against Contact.phoneNumbers (where
// the Contact already belongs to a Client). Mirrors the live-write
// matcher in src/lib/quo-contact-match.ts so historical rows surface
// on the client profile's Calls & SMS section just like newly-arrived
// webhook events do.
//
// Idempotent: only writes rows where clientId is currently null AND
// the contact lookup resolves. Safe to re-run.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/backfill-quo-clientid.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type PhoneIndex = Map<string, { clientId: string; organizationId: string }>;

async function buildContactIndex(): Promise<PhoneIndex> {
  const contacts = await prisma.contact.findMany({
    where: { clientId: { not: null } },
    select: { clientId: true, organizationId: true, phoneNumbers: true },
  });
  const out: PhoneIndex = new Map();
  for (const c of contacts) {
    if (!c.clientId) continue;
    const nums = c.phoneNumbers;
    if (!Array.isArray(nums)) continue;
    for (const entry of nums) {
      const rawNum =
        typeof entry === "string"
          ? entry
          : entry && typeof entry === "object" && "number" in entry
            ? String((entry as { number?: unknown }).number ?? "")
            : "";
      if (!rawNum) continue;
      const digits = rawNum.replace(/\D/g, "").slice(-10);
      if (digits.length !== 10) continue;
      // First-write wins — duplicate phone numbers across Contacts
      // would otherwise flip-flop ownership between runs.
      if (!out.has(digits)) {
        out.set(digits, { clientId: c.clientId, organizationId: c.organizationId });
      }
    }
  }
  return out;
}

function lastTen(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? d : null;
}

async function backfillCalls(index: PhoneIndex): Promise<{ scanned: number; stamped: number }> {
  const rows = await prisma.callLog.findMany({
    where: { clientId: null },
    select: { id: true, direction: true, fromNumber: true, toNumber: true, organizationId: true },
  });
  let stamped = 0;
  for (const r of rows) {
    const phone = r.direction === "inbound" ? r.fromNumber : r.toNumber;
    const key = lastTen(phone);
    if (!key) continue;
    const hit = index.get(key);
    if (!hit) continue;
    await prisma.callLog.update({
      where: { id: r.id },
      data: {
        clientId: hit.clientId,
        organizationId: r.organizationId ?? hit.organizationId,
      },
    });
    stamped += 1;
  }
  return { scanned: rows.length, stamped };
}

async function backfillSms(index: PhoneIndex): Promise<{ scanned: number; stamped: number }> {
  const rows = await prisma.smsMessage.findMany({
    where: { clientId: null },
    select: { id: true, direction: true, fromNumber: true, toNumber: true, organizationId: true },
  });
  let stamped = 0;
  for (const r of rows) {
    const phone = r.direction === "inbound" ? r.fromNumber : r.toNumber;
    const key = lastTen(phone);
    if (!key) continue;
    const hit = index.get(key);
    if (!hit) continue;
    await prisma.smsMessage.update({
      where: { id: r.id },
      data: {
        clientId: hit.clientId,
        organizationId: r.organizationId ?? hit.organizationId,
      },
    });
    stamped += 1;
  }
  return { scanned: rows.length, stamped };
}

async function main() {
  const index = await buildContactIndex();
  console.log(`Contact phone index built: ${index.size} unique numbers across clients with a clientId.`);
  const calls = await backfillCalls(index);
  console.log(`CallLog: scanned ${calls.scanned} null-clientId rows, stamped ${calls.stamped}.`);
  const sms = await backfillSms(index);
  console.log(`SmsMessage: scanned ${sms.scanned} null-clientId rows, stamped ${sms.stamped}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
