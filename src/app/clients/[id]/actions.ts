"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recruiterflow } from "@/lib/recruiterflow";
import { summarizeBenefits as summarizeBenefitsWithClaude } from "@/lib/claude";

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

const BENEFITS_ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export type UploadBenefitsFileResult = ActionResult<{ id: string }>;

export async function uploadBenefitsFile(clientId: number, formData: FormData): Promise<UploadBenefitsFileResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file attached." };
  if (file.size === 0) return { ok: false, error: "File is empty." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `File is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB).` };
  if (!BENEFITS_ALLOWED_MIME.has(file.type)) {
    return { ok: false, error: "Only PDF, Word, or plain-text files are accepted." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const created = await prisma.clientBenefitsFile.create({
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

export async function deleteBenefitsFile(fileId: string): Promise<ActionResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  const existing = await prisma.clientBenefitsFile.findUnique({
    where: { id: fileId },
    select: { clientRfId: true },
  });
  if (!existing) return { ok: false, error: "File not found." };
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
    select: { filename: true, mimeType: true, data: true },
  });

  try {
    const summary = await summarizeBenefitsWithClaude({
      pastedText,
      attachments: files.map((f) => ({
        filename: f.filename,
        mimeType: f.mimeType,
        data: Buffer.from(f.data),
      })),
    });
    return { ok: true, value: { summary } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Claude summarization failed";
    return { ok: false, error: msg };
  }
}
