import type { Contact, Prisma } from "@prisma/client";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { backfillClientGmailThreadTags } from "@/lib/gmail";
import type { RFContact } from "@/lib/rf-payload-shapes";

export type CreateContactInput = {
  // Tenant + actor are resolved by the CALLER from the server session
  // (Rule 8 — never client-supplied), then passed in here.
  organizationId: string;
  userId: string;
  // Client cuid, already verified to belong to organizationId by the caller.
  clientId: string;
  firstName: string;
  lastName?: string | null;
  emails?: string[];
  // Already-normalized phone entries (E.164 number + optional extension/type).
  phones?: Array<{ number: string; extension?: string; type?: string }>;
  title?: string | null;
  linkedin?: string | null;
};

// Single source of truth for inserting a Contact. Used by the client-profile
// Contacts tab (addContact) AND the Wilson create_contact tool, so
// there is exactly ONE insert path — no parallel writes. Mirrors the row shape
// addContact has always written (name composed from first+last, blank-stripped
// emails, phoneNumbers omitted when empty) and fires the same Gmail
// thread-tag backfill. Does NOT validate or dedupe — callers own that.
export async function createContact(
  input: CreateContactInput,
): Promise<{ id: string }> {
  const first = input.firstName.trim();
  const last = (input.lastName ?? "").trim();
  const emails = (input.emails ?? []).map((e) => e.trim()).filter(Boolean);
  const phones = (input.phones ?? []).filter((p) => p.number);

  const created = await prisma.contact.create({
    data: {
      firstName: first,
      lastName: last || null,
      name: [first, last].filter(Boolean).join(" "),
      emails,
      phoneNumbers: phones.length ? phones : undefined,
      currentDesignation: input.title?.trim() || null,
      linkedinProfile: input.linkedin?.trim() || null,
      clientId: input.clientId,
      organizationId: input.organizationId,
      addedAt: new Date(),
    },
    select: { id: true },
  });

  await backfillClientGmailThreadTags({
    userId: input.userId,
    organizationId: input.organizationId,
    clientId: input.clientId,
    addresses: emails,
  }).catch((err) => {
    console.warn("[createContact] Gmail backfill failed", err);
  });

  return created;
}

// Phase 5: Neon-native contact list helper. Replaces
// getRfContactsForOrg (which read from Neon too but shaped its output
// as RFContact[] for legacy callers). Callers that want the raw
// Contact row get it here; callers that want RFContact-shaped output
// still use getRfContactsForOrg in src/lib/candidates.ts (unchanged).

export type ContactListRow = {
  id: string;
  legacyRfId: number | null;
  firstName: string;
  lastName: string;
  name: string;
  emails: string[];
  phoneNumbers: Prisma.JsonValue | null;
  clientId: string | null;
  clientLegacyRfId: number | null;
  currentDesignation: string | null;
  linkedinProfile: string | null;
};

// Lists every Contact in the signed-in tenant. Joins on Client so
// callers that need the client's legacyRfId for RF-shaped downstream
// reads don't need a second query.
export async function getContactsForOrg(): Promise<ContactListRow[]> {
  const org = await getCurrentOrg();
  const rows = await prisma.contact.findMany({
    where: { organizationId: org.id },
    select: {
      id: true,
      legacyRfId: true,
      firstName: true,
      lastName: true,
      name: true,
      emails: true,
      phoneNumbers: true,
      clientId: true,
      currentDesignation: true,
      linkedinProfile: true,
      client: { select: { legacyRfId: true } },
    },
  });

  return rows.map((r) => {
    const composed = [r.firstName, r.lastName].filter(Boolean).join(" ");
    return {
      id: r.id,
      legacyRfId: r.legacyRfId,
      firstName: r.firstName ?? "",
      lastName: r.lastName ?? "",
      name: r.name ?? composed ?? "(unnamed)",
      emails: Array.isArray(r.emails) ? r.emails : [],
      phoneNumbers: (r.phoneNumbers ?? null) as Prisma.JsonValue | null,
      clientId: r.clientId,
      clientLegacyRfId: r.client?.legacyRfId ?? null,
      currentDesignation: r.currentDesignation,
      linkedinProfile: r.linkedinProfile,
    };
  });
}

// Resolves a Contact by cuid, scoped to tenant.
export async function getContactByIdentifier(id: string): Promise<Contact | null> {
  if (!id) return null;
  const org = await getCurrentOrg();
  return prisma.contact.findFirst({ where: { id, organizationId: org.id } });
}

// Backward-compat: return Contacts in the legacy RFContact shape so
// existing callers that index into `.client_company_id`, `.email[0]`,
// etc. keep working without modification. Same data as
// getContactsForOrg; different projection.
export async function getRfShapedContactsForOrg(): Promise<RFContact[]> {
  const rows = await getContactsForOrg();
  return rows.map((r) => ({
    id: r.legacyRfId ?? 0,
    first_name: r.firstName || null,
    last_name: r.lastName || null,
    name: r.name,
    email: r.emails.length > 0 ? r.emails : null,
    client_company_id: r.clientLegacyRfId,
    current_designation: r.currentDesignation,
    linkedin_profile: r.linkedinProfile,
  }));
}
