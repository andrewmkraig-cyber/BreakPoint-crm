"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recruiterflow } from "@/lib/recruiterflow";
import {
  summarizeAgreementTerms as summarizeAgreementTermsWithClaude,
  summarizeBenefits as summarizeBenefitsWithClaude,
} from "@/lib/claude";

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };


async function requireUserId(): Promise<{ id: string; email: string } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, email: true } });
  if (!user?.email) return null;
  return { id: user.id, email: user.email };
}

// ---- Contacts ----

export type AddContactResult = ActionResult<{ id: number }>;

export async function addContact(clientId: number, formData: FormData): Promise<AddContactResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };

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
    return { ok: true, value: { id: created.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create contact" };
  }
}

// ---- Agreements ----
// Uploads go through /api/uploads/agreement (chunked). Summarize and delete
// stay as server actions because they're small one-shot calls.

export type SummarizeAgreementResult = ActionResult<{ summary: string; summaryUpdatedAt: string }>;

export async function summarizeAgreement(agreementId: string): Promise<SummarizeAgreementResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };

  const agreement = await prisma.clientAgreement.findUnique({
    where: { id: agreementId },
    select: { clientRfId: true, filename: true, mimeType: true, data: true },
  });
  if (!agreement) return { ok: false, error: "Agreement not found." };

  try {
    const summary = await summarizeAgreementTermsWithClaude({
      filename: agreement.filename,
      mimeType: agreement.mimeType,
      data: Buffer.from(agreement.data),
    });
    const now = new Date();
    await prisma.clientAgreement.update({
      where: { id: agreementId },
      data: { summary, summaryUpdatedAt: now },
    });
    revalidatePath(`/clients/${agreement.clientRfId}`);
    return { ok: true, value: { summary, summaryUpdatedAt: now.toISOString() } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Claude summarization failed" };
  }
}

export async function deleteAgreement(agreementId: string): Promise<ActionResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  const existing = await prisma.clientAgreement.findUnique({ where: { id: agreementId }, select: { clientRfId: true } });
  if (!existing) return { ok: false, error: "Agreement not found." };
  await prisma.clientAgreement.delete({ where: { id: agreementId } });
  revalidatePath(`/clients/${existing.clientRfId}`);
  return { ok: true };
}

// ---- Benefits ----

export type SaveBenefitsResult = ActionResult<{ updatedAt: string }>;

export async function saveBenefits(clientId: number, body: string): Promise<SaveBenefitsResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };

  const trimmed = body.slice(0, 64_000);
  const row = await prisma.clientBenefits.upsert({
    where: { clientRfId: clientId },
    update: { body: trimmed, updatedById: user.id },
    create: { clientRfId: clientId, body: trimmed, updatedById: user.id },
    select: { updatedAt: true },
  });

  revalidatePath(`/clients/${clientId}`);
  return { ok: true, value: { updatedAt: row.updatedAt.toISOString() } };
}

// ---- Benefits files (PDFs/docs attached for summarization or reference) ----
// Chunked base64 uploads go through /api/uploads/benefits-file directly — no
// server action for insert. Delete stays here because it's a simple one-shot.

export async function deleteBenefitsFile(fileId: string): Promise<ActionResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  const existing = await prisma.clientBenefitsFile.findUnique({
    where: { id: fileId },
    select: { clientRfId: true, blobUrl: true },
  });
  if (!existing) return { ok: false, error: "File not found." };
  if (existing.blobUrl) {
    try {
      const { del } = await import("@vercel/blob");
      await del(existing.blobUrl);
    } catch {
      // If the blob is already gone, continue — we still want to clear the metadata row.
    }
  }
  await prisma.clientBenefitsFile.delete({ where: { id: fileId } });
  revalidatePath(`/clients/${existing.clientRfId}`);
  return { ok: true };
}

// ---- Summarize with Claude ----

export type SummarizeBenefitsResult = ActionResult<{ summary: string }>;

export async function summarizeBenefitsWithAI(
  clientId: number,
  pastedText: string,
): Promise<SummarizeBenefitsResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };

  const files = await prisma.clientBenefitsFile.findMany({
    where: { clientRfId: clientId },
    orderBy: { uploadedAt: "asc" },
    select: { filename: true, mimeType: true, data: true, blobUrl: true },
  });

  try {
    const attachments = await Promise.all(
      files.map(async (f) => {
        let data: Buffer;
        if (f.blobUrl) {
          // Fetch private blobs server-side using the RW token (fetch with auth
          // via @vercel/blob's `head()` returns a signed URL we can fetch).
          data = await fetchBlobBytes(f.blobUrl);
        } else if (f.data) {
          data = Buffer.from(f.data);
        } else {
          throw new Error(`File ${f.filename} has no data or blob URL.`);
        }
        return { filename: f.filename, mimeType: f.mimeType, data };
      }),
    );
    const summary = await summarizeBenefitsWithClaude({ pastedText, attachments });
    return { ok: true, value: { summary } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Claude summarization failed";
    return { ok: false, error: msg };
  }
}

// ---- Company (client/update) ----

export type UpdateClientInput = {
  id: number;
  website: string;
  linkedin: string;
  phone: string;
  industry: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export async function updateClientCompany(input: UpdateClientInput): Promise<ActionResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!Number.isFinite(input.id)) return { ok: false, error: "Missing client id." };

  const domain = input.website.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");

  try {
    const res = (await recruiterflow.updateClient({
      id: input.id,
      domain: domain || undefined,
      industry: input.industry || undefined,
      linkedin_page: input.linkedin.trim() || undefined,
      phone_number: input.phone.trim() || undefined,
      location: {
        street_address_1: input.street1.trim() || undefined,
        street_address_2: input.street2.trim() || undefined,
        city: input.city.trim() || undefined,
        state: input.state.trim() || undefined,
        postal_code: input.postalCode.trim() || undefined,
        country: input.country.trim() || undefined,
      },
    })) as { RESULT?: string };
    if (res && typeof res === "object" && "RESULT" in res && res.RESULT && res.RESULT !== "SUCCESS") {
      return { ok: false, error: `RecruiterFlow returned ${res.RESULT}` };
    }
    revalidatePath(`/clients/${input.id}`);
    revalidatePath(`/clients`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update client." };
  }
}

async function fetchBlobBytes(url: string): Promise<Buffer> {
  const { head } = await import("@vercel/blob");
  // For private blob stores, head() returns a short-lived downloadUrl.
  const meta = (await head(url)) as { downloadUrl?: string; url?: string };
  const downloadUrl = meta.downloadUrl ?? meta.url ?? url;
  const res = await fetch(downloadUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch blob (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
