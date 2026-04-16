"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { recruiterflow } from "@/lib/recruiterflow";

export type AddContactResult = { ok: true; id: number } | { ok: false; error: string };

export async function addContact(clientId: number, formData: FormData): Promise<AddContactResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };

  const first = String(formData.get("first_name") ?? "").trim();
  const last = String(formData.get("last_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone_number") ?? "").trim();
  const title = String(formData.get("current_designation") ?? "").trim();
  const linkedin = String(formData.get("linkedin_profile") ?? "").trim();

  if (!first) return { ok: false, error: "First name is required." };

  try {
    const created = await recruiterflow.createContact({
      first_name: first,
      last_name: last || undefined,
      email: email || undefined,
      phone_number: phone || undefined,
      current_designation: title || undefined,
      linkedin_profile: linkedin || undefined,
      client_company_id: clientId,
    });
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, id: created.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create contact" };
  }
}
