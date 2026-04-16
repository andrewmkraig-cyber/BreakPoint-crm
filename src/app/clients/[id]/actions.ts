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

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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

export type UploadAgreementResult = ActionResult<{ id: string }>;

export async function uploadAgreement(clientId: number, formData: FormData): Promise<UploadAgreementResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file attached." };
  if (file.size === 0) return { ok: false, error: "File is empty." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `File is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB).` };

  const allowed = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]);
  if (!allowed.has(file.type)) {
    return { ok: false, error: "Only PDF or Word documents are accepted." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const created = await prisma.clientAgreement.create({
    data: {
      clientRfId: clientId,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      data: buffer,
      uploadedById: user.id,
    },
    select: { id: true },
  });

  revalidatePath(`/clients/${clientId}`);
  return { ok: true, value: { id: created.id } };
}

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
// Stored in Vercel Blob (private) — browser uploads directly, we only persist
// metadata here. Bypasses the Vercel 4.5MB serverless function body limit.

export type RegisterBenefitsFileResult = ActionResult<{ id: string }>;

export async function registerBenefitsFile(
  clientId: number,
  meta: {
    filename: string;
    mimeType: string;
    size: number;
    blobUrl: string;
    blobPathname: string;
  },
): Promise<RegisterBenefitsFileResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };

  if (!meta.blobUrl || !meta.blobPathname) return { ok: false, error: "Missing blob URL." };
  if (!meta.filename.trim()) return { ok: false, error: "Missing filename." };

  const created = await prisma.clientBenefitsFile.create({
    data: {
      clientRfId: clientId,
      filename: meta.filename,
      mimeType: meta.mimeType,
      size: meta.size,
      blobUrl: meta.blobUrl,
      blobPathname: meta.blobPathname,
      uploadedById: user.id,
    },
    select: { id: true },
  });

  revalidatePath(`/clients/${clientId}`);
  return { ok: true, value: { id: created.id } };
}

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

async function fetchBlobBytes(url: string): Promise<Buffer> {
  const { head } = await import("@vercel/blob");
  // For private blob stores, head() returns a short-lived downloadUrl.
  const meta = (await head(url)) as { downloadUrl?: string; url?: string };
  const downloadUrl = meta.downloadUrl ?? meta.url ?? url;
  const res = await fetch(downloadUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch blob (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
