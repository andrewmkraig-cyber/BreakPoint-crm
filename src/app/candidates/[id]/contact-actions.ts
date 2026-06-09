"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { createActionLog } from "@/lib/action-log";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { linkedinUrlFrom, normalizeToE164 } from "@/lib/rf-payload-shapes";
import { backfillClientGmailThreadTags } from "@/lib/gmail";

// Quick-add contact used by the Schedule Interview dialog's "+ Add new
// contact" option. Phase 5: contacts are Neon-native now — write goes
// straight to the Contact table scoped by organizationId. No RF call.
// The dialog's client gets back a row shaped the same way it consumes
// the existing contact list (id / name / title / email), so splicing
// the new row into the dropdown + auto-selecting it still works.

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

export type CreateContactInput = {
  // The caller may know the client by either legacyRfId (numeric, RF-
  // imported clients) or cuid (Ace-native clients). Exactly one is set.
  clientRfId?: number | null;
  clientId?: string | null;
  firstName: string;
  lastName?: string;
  email?: string;
  title?: string;
  phone?: string;
  linkedinUrl?: string;
};

export type CreatedContact = {
  // The Contact row's cuid — stable identity across both RF-imported
  // and Ace-native clients.
  id: string;
  name: string;
  title: string;
  email: string;
};

export async function createClientContact(
  input: CreateContactInput,
): Promise<Result<CreatedContact>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };

  const firstName = input.firstName.trim();
  if (!firstName) return { ok: false, error: "First name is required." };

  const clientRfId = input.clientRfId ?? null;
  const clientIdCuid = input.clientId ?? null;
  if (clientRfId == null && !clientIdCuid) {
    return { ok: false, error: "Client id is required." };
  }

  try {
    const org = await getCurrentOrg();
    // Resolve the Client row by whichever identity the caller sent.
    // Tenant-scoped so a hostile caller can't force a contact onto
    // another org's client.
    const client = clientIdCuid
      ? await prisma.client.findFirst({
          where: { id: clientIdCuid, organizationId: org.id },
          select: { id: true, legacyRfId: true },
        })
      : await prisma.client.findFirst({
          where: { legacyRfId: clientRfId!, organizationId: org.id },
          select: { id: true, legacyRfId: true },
        });
    if (!client) return { ok: false, error: "Client not found in this tenant." };

    const lastName = input.lastName?.trim() || null;
    const email = input.email?.trim() || "";
    const phone = normalizeToE164(input.phone) ?? "";
    const title = input.title?.trim() || null;
    const linkedin = linkedinUrlFrom(input.linkedinUrl) || null;

    const created = await prisma.contact.create({
      data: {
        firstName,
        lastName,
        name: [firstName, lastName].filter(Boolean).join(" "),
        emails: email ? [email] : [],
        phoneNumbers: phone ? [{ number: phone }] : undefined,
        currentDesignation: title,
        linkedinProfile: linkedin,
        clientId: client.id,
        organizationId: org.id,
        addedAt: new Date(),
      },
      select: { id: true, name: true, currentDesignation: true, emails: true },
    });

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (user) {
      await createActionLog({
        userId: user.id,
        actionType: "contact_created",
        subjectType: "client",
        subjectId: client.id,
        metadata: {
          contactId: created.id,
          clientLegacyRfId: client.legacyRfId,
          firstName,
          lastName,
          email: email || null,
          title: title,
        },
      });
      await backfillClientGmailThreadTags({
        userId: user.id,
        organizationId: org.id,
        clientId: client.id,
        addresses: email ? [email] : [],
      }).catch((err) => {
        console.warn("[createClientContact] Gmail backfill failed", err);
      });
    }

    // Invalidate caches that fetch client contacts so the new row
    // appears across the app on next navigation. /clients/[id] accepts
    // both legacyRfId and cuid slugs via getClientByIdentifier.
    const clientSlug = client.legacyRfId != null ? String(client.legacyRfId) : client.id;
    revalidatePath(`/clients/${clientSlug}`);
    revalidatePath("/candidates", "layout");

    return {
      ok: true,
      value: {
        id: created.id,
        name: created.name ?? firstName,
        title: created.currentDesignation ?? title ?? "",
        email: created.emails[0] ?? email,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create contact.",
    };
  }
}
