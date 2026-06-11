"use server";

import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getQuoLineDigitsForUserEmail, smsLineWhere } from "@/lib/quo-line-owner";

// Normalize a phone number to its 10-digit form. Strips all non-digits,
// then drops a leading "1" if the result is 11 digits long. Returns ""
// for inputs that don't yield 10 digits — callers should treat that as
// "no match attempt".
function toTenDigits(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const trimmed = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return trimmed.length === 10 ? trimmed : "";
}

// NOTE: cross-device phone badge-sync removed. A silent (no-notification)
// push burns the iOS userVisibleOnly budget and gets the PushSubscription
// revoked, which kills ALL background push delivery. After marking a thread
// read here the badge reconciles to the true unread total via the in-app
// poll (PhoneProvider / mail-tab-title-sync) when a tab is open, and via the
// SW activate self-heal when the closed PWA next wakes.

export type PhoneMatch =
  | { type: "candidate"; id: string; name: string }
  | { type: "client"; id: string; name: string }
  | { type: null; id: null; name: null };

// Phone Tab: resolves a thread's remote number to a Candidate or
// Contact's parent Client so the thread header can show an "Open
// Profile" jump button. Candidate match wins over Contact match because
// candidates are the primary recruiting subject; in practice a number
// rarely belongs to both.
export async function matchContactByPhone(phoneNumber: string): Promise<PhoneMatch> {
  const ten = toTenDigits(phoneNumber);
  if (!ten) return { type: null, id: null, name: null };
  const org = await getCurrentOrg();

  const candRows = await prisma.$queryRaw<Array<{ id: string; firstName: string | null; lastName: string | null }>>(
    Prisma.sql`
      SELECT id, "firstName", "lastName"
      FROM "Candidate"
      WHERE "organizationId" = ${org.id}
        AND phone IS NOT NULL
        AND regexp_replace(phone, '\D', '', 'g') LIKE ${`%${ten}`}
      LIMIT 1
    `,
  );
  if (candRows.length > 0) {
    const c = candRows[0];
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "(unnamed)";
    return { type: "candidate", id: c.id, name };
  }

  // Contact.phoneNumbers is a JSON array of { number, type } objects
  // imported from RF. jsonb_array_elements_text fans the array out so
  // we can normalize each element to digits and compare. Joins to
  // Client to return the parent client's identity (the "Open Profile"
  // jump goes to the client page, not a contact-only page).
  const clientRows = await prisma.$queryRaw<Array<{ id: string; legacyRfId: number | null; name: string }>>(
    Prisma.sql`
      SELECT cl.id, cl."legacyRfId", cl.name
      FROM "Contact" co
      JOIN "Client" cl ON cl.id = co."clientId"
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(co."phoneNumbers", '[]'::jsonb)) AS pn
      WHERE co."organizationId" = ${org.id}
        AND cl."organizationId" = ${org.id}
        AND regexp_replace(COALESCE(pn->>'number', ''), '\D', '', 'g') LIKE ${`%${ten}`}
      LIMIT 1
    `,
  );
  if (clientRows.length > 0) {
    const c = clientRows[0];
    // Slug used by /clients/[id] — legacyRfId-as-string for RF imports
    // (back-compat URLs), cuid for Ace-native rows. Mirrors the same
    // back-compat rule used by quickSearchGlobal.
    const slug = c.legacyRfId != null ? String(c.legacyRfId) : c.id;
    return { type: "client", id: slug, name: c.name || "(unnamed)" };
  }

  return { type: null, id: null, name: null };
}

// Marks every inbound SMS in the opened thread as read. Accepts the
// prefixed thread id shape produced by /api/phone/threads:
//   "cand:<candidateId>"  → candidate-matched thread, update by FK
//   "unk:<10-digit-tail>" → unknown-number thread, update by phone digits
// Plain (unprefixed) cuids are accepted for back-compat with any
// remaining callers from before the prefixing rewrite.
//
// Outbound rows are ignored (always read by definition). Org-scoped so
// a forged thread id from another tenant is a no-op rather than an
// error.
export async function markThreadRead(threadId: string): Promise<{ updated: number }> {
  const org = await getCurrentOrg();
  const session = await getServerSession(authOptions);
  const lineDigits = await getQuoLineDigitsForUserEmail(org.id, session?.user?.email);
  if (lineDigits.length === 0) return { updated: 0 };

  if (threadId.startsWith("cand:")) {
    const candidateId = threadId.slice("cand:".length);
    if (!candidateId) return { updated: 0 };
    const res = await prisma.smsMessage.updateMany({
      where: {
        candidateId,
        organizationId: org.id,
        direction: "inbound",
        isRead: false,
        AND: [smsLineWhere(lineDigits, "inbound")],
      },
      data: { isRead: true },
    });
    return { updated: res.count };
  }

  if (threadId.startsWith("unk:")) {
    const digits = threadId.slice("unk:".length).replace(/\D/g, "").slice(-10);
    // Short codes (5–6 digit verification senders like 22395) and any
    // sub-10-digit sender are valid threads: /api/phone/threads keys them
    // by the SAME slice(-10) of their digits, and the right(…,10) match
    // below already works for any length (right of a 5-digit number is the
    // whole code, so it only matches rows whose number IS that short code,
    // never a 10-digit number ending in those digits). The old
    // `digits.length !== 10` guard silently no-op'd every short-code thread,
    // so those text notifications could never be cleared. Only bail when
    // there are no digits at all (malformed/empty key).
    if (!digits) return { updated: 0 };
    // No way to express "fromNumber ends with these 10 digits" in
    // Prisma's typed updateMany — drop to raw SQL. Same WHERE shape
    // as /api/phone/threads' normalizeOther grouping so the rows we
    // mark are exactly the rows the thread aggregates.
    const updated = await prisma.$executeRaw(
      Prisma.sql`
        UPDATE "SmsMessage"
        SET "isRead" = true
        WHERE "organizationId" = ${org.id}
          AND direction = 'inbound'
          AND "isRead" = false
          AND "candidateId" IS NULL
          AND right(regexp_replace(COALESCE("fromNumber", ''), '\D', '', 'g'), 10) = ${digits}
          AND right(regexp_replace(COALESCE("toNumber", ''), '\D', '', 'g'), 10) IN (${Prisma.join(lineDigits)})
      `,
    );
    return { updated };
  }

  // Back-compat: bare candidateId.
  const res = await prisma.smsMessage.updateMany({
    where: {
      candidateId: threadId,
      organizationId: org.id,
      direction: "inbound",
      isRead: false,
      AND: [smsLineWhere(lineDigits, "inbound")],
    },
    data: { isRead: true },
  });
  return { updated: res.count };
}
