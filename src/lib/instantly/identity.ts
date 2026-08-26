import { prisma } from "@/lib/prisma";
import { TEAM_BCC_OPTIONS } from "@/lib/team-contacts";

// =====================================================================
// "Is this one of us?"
//
// Instantly ingests the whole thread from the synced mailbox, so a reply
// YOU send lands back under email_type=received and shows up as an
// inbound lead reply. Measured on this workspace: 3 such rows, all in one
// thread, all from andrew@breakpointtalent.com, and Instantly had
// classified them i_status=1 ("interested").
//
// The two obvious rules both fail, which is why this file exists:
//
//   from_address_email === eaccount        -> matched 0 of 67 rows.
//     A Unibox send would match, but these were sent from the real
//     mailbox, so `from` is the personal address while `eaccount` is the
//     warmed sending identity.
//
//   sender domain is a sending domain      -> matched 0 of 67 rows.
//     The real address is @breakpointtalent.com; the warmed domains are
//     @breakpoint-talent.com, @breakpoint-ventures.com,
//     @breakpoint-recruiting.com, @breakpointrecruiting.com. One hyphen
//     defeats the whole rule.
//
// So identity is an EXPLICIT set, assembled from three sources:
//   1. the warmed sending accounts, read off the `eaccount` field that
//      every row carries (GET /accounts needs a scope the key lacks, and
//      deriving them from the data needs no extra permission)
//   2. Ace's own User rows
//   3. the hard-coded team roster in team-contacts.ts
// ...plus every domain any of those addresses uses.
// =====================================================================

export type OwnIdentity = {
  addresses: Set<string>;
  domains: Set<string>;
};

function normalizeEmail(e: string | null | undefined): string {
  return (e ?? "").trim().toLowerCase();
}

function domainOf(email: string): string | null {
  const d = email.split("@")[1];
  return d ? d.toLowerCase() : null;
}

/**
 * Assemble the identity set.
 *
 * `extraEaccounts` lets a caller fold in the sending identities seen in a
 * batch it is about to process, so a brand-new warmed mailbox is
 * recognized on the very first run rather than only after its first row
 * has been stored.
 */
export async function buildOwnIdentity(
  extraEaccounts: Array<string | null | undefined> = [],
): Promise<OwnIdentity> {
  const addresses = new Set<string>();

  for (const opt of TEAM_BCC_OPTIONS) {
    const e = normalizeEmail(opt.email);
    if (e) addresses.add(e);
  }

  try {
    const users = await prisma.user.findMany({ select: { email: true } });
    for (const u of users) {
      const e = normalizeEmail(u.email);
      if (e) addresses.add(e);
    }
  } catch {
    // Roster above still covers the common case.
  }

  // Sending identities already observed on stored rows.
  try {
    const seen = await prisma.instantlyReply.findMany({
      where: { eaccount: { not: null } },
      select: { eaccount: true },
      distinct: ["eaccount"],
    });
    for (const r of seen) {
      const e = normalizeEmail(r.eaccount);
      if (e) addresses.add(e);
    }
  } catch {
    // Non-fatal.
  }

  for (const e of extraEaccounts) {
    const n = normalizeEmail(e);
    if (n) addresses.add(n);
  }

  // Every domain any of our own addresses uses. A prospect is never at
  // one of these, so domain-level matching is safe here and catches
  // address variants we have not seen before (a.kraig@, andrew.kraig@,
  // and so on across four warmed domains).
  const domains = new Set<string>();
  for (const a of Array.from(addresses)) {
    const d = domainOf(a);
    if (d) domains.add(d);
  }

  return { addresses, domains };
}

/**
 * True when this sender is us, and the row is therefore our own outbound
 * mail rather than a lead reply.
 */
export function isOwnSender(
  fromEmail: string | null | undefined,
  identity: OwnIdentity,
): boolean {
  const e = normalizeEmail(fromEmail);
  if (!e) return false;
  if (identity.addresses.has(e)) return true;
  const d = domainOf(e);
  return d ? identity.domains.has(d) : false;
}
