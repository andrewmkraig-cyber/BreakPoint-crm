"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { createActionLog } from "@/lib/action-log";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recruiterflow } from "@/lib/recruiterflow";

// Quick-add contact used by the Schedule Interview dialog's "+ Add new
// contact" option. Creates the contact in RecruiterFlow (the source of
// truth for contacts), then returns the RF shape so the client can
// splice it into the dropdown and auto-select it.
//
// Note on the no-RF-on-create rule: that rule scopes to candidates /
// clients / jobs, which Ace is progressively owning locally. Contacts
// under existing clients still live in RF — we read them everywhere and
// the dialog needs the new contact to be visible in the same list as
// the existing ones. Pushing to RF keeps one source of truth. If RF
// rejects (rate limit, transient error), we surface the error.

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

export type CreateContactInput = {
  clientRfId: number;
  firstName: string;
  lastName?: string;
  email?: string;
  title?: string;
  phone?: string;
  linkedinUrl?: string;
};

export type CreatedContact = {
  id: number;
  name: string;
  title: string;
  email: string;
};

export async function createClientContact(
  input: CreateContactInput,
): Promise<Result<CreatedContact>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };
  if (!input.clientRfId || !Number.isFinite(input.clientRfId)) {
    return { ok: false, error: "Client id is required." };
  }
  const firstName = input.firstName.trim();
  if (!firstName) return { ok: false, error: "First name is required." };

  try {
    const created = await recruiterflow.createContact({
      first_name: firstName,
      last_name: input.lastName?.trim() || undefined,
      email: input.email?.trim() || undefined,
      phone_number: input.phone?.trim() || undefined,
      current_designation: input.title?.trim() || undefined,
      client_company_id: input.clientRfId,
      linkedin_profile: input.linkedinUrl?.trim() || undefined,
    });

    const fullName =
      [created.first_name, created.last_name].filter(Boolean).join(" ") ||
      (typeof created.name === "string" ? created.name : "") ||
      firstName;
    const firstEmail = Array.isArray(created.email)
      ? created.email[0] ?? ""
      : typeof created.email === "string"
        ? created.email
        : (input.email?.trim() ?? "");
    const value: CreatedContact = {
      id: created.id,
      name: fullName,
      title: created.current_designation ?? input.title?.trim() ?? "",
      email: firstEmail,
    };

    // Log for audit + cache busting.
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (user) {
      await createActionLog({
        userId: user.id,
        actionType: "contact_created",
        subjectType: "client",
        subjectId: String(input.clientRfId),
        metadata: {
          contactRfId: created.id,
          firstName,
          lastName: input.lastName?.trim() || null,
          email: input.email?.trim() || null,
          title: input.title?.trim() || null,
        },
      });
    }

    // Invalidate caches that fetch client contacts so the new row appears
    // across the app on next navigation.
    revalidatePath(`/clients/${input.clientRfId}`);
    revalidatePath("/candidates", "layout");

    return { ok: true, value };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create contact in RecruiterFlow.",
    };
  }
}
