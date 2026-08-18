"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { linkedinUrlFrom, normalizeToE164 } from "@/lib/rf-payload-shapes";
import { backfillClientGmailThreadTags } from "@/lib/gmail";
import { createContact } from "@/lib/contacts";
import {
  summarizeAgreementTerms as summarizeAgreementTermsWithClaude,
  summarizeBenefits as summarizeBenefitsWithClaude,
  normalizeClientBlurb,
} from "@/lib/claude";
import { generateAndSaveClientBlurb } from "@/lib/client-blurb";

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };


// Builds the stored phone JSON entry, dropping an empty extension/type so a
// blank field never persists as a "" key. `number` is required — callers
// filter out entries without one before mapping through this.
function phoneEntry(p: { number: string; extension?: string; type?: string }) {
  const extension = (p.extension ?? "").trim();
  const type = (p.type ?? "").trim();
  return {
    number: p.number,
    ...(extension ? { extension } : {}),
    ...(type ? { type } : {}),
  };
}

async function requireUserId(): Promise<{ id: string; email: string } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, email: true } });
  if (!user?.email) return null;
  return { id: user.id, email: user.email };
}

// ---- Contacts ----

export type AddContactResult = ActionResult<{ id: string }>;

export async function addContact(clientCuid: string, formData: FormData): Promise<AddContactResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };

  const first = String(formData.get("first_name") ?? "").trim();
  const last = String(formData.get("last_name") ?? "").trim();
  // Multiple email + phone rows arrive as repeated form fields (index 0 is
  // primary). Trim, drop blanks, and zip phone numbers to their extensions
  // by row index.
  const emails = formData
    .getAll("email")
    .map((v) => String(v).trim())
    .filter(Boolean);
  // phone_type / phone_number / phone_extension arrive as parallel arrays,
  // one entry per row, aligned by index (every row always submits all three).
  const phoneNumbersRaw = formData.getAll("phone_number").map((v) => String(v).trim());
  const phoneExtsRaw = formData.getAll("phone_extension").map((v) => String(v).trim());
  const phoneTypesRaw = formData.getAll("phone_type").map((v) => String(v).trim());
  const phones = phoneNumbersRaw
    .map((number, i) => ({
      number: normalizeToE164(number) ?? "",
      extension: phoneExtsRaw[i] ?? "",
      type: phoneTypesRaw[i] ?? "",
    }))
    .filter((p) => p.number)
    .map(phoneEntry);
  const title = String(formData.get("current_designation") ?? "").trim();
  const linkedinRaw = String(formData.get("linkedin_profile") ?? "").trim();
  // Persist a fully-qualified LinkedIn URL so the rendered <a href>
  // can never resolve as a site-relative link (which 404'd against
  // ace.breakpointtalent.com).
  const linkedin = linkedinUrlFrom(linkedinRaw);

  if (!first) return { ok: false, error: "First name is required." };

  try {
    const org = await getCurrentOrg();
    const client = await prisma.client.findFirst({
      where: { id: clientCuid, organizationId: org.id },
      select: { id: true, legacyRfId: true },
    });
    if (!client) return { ok: false, error: "Client not found." };

    // Single shared insert path (also used by the Assistant create_contact
    // tool) — see createContact in @/lib/contacts. Same row shape + Gmail
    // backfill this action has always performed.
    const created = await createContact({
      organizationId: org.id,
      userId: user.id,
      clientId: client.id,
      firstName: first,
      lastName: last,
      emails,
      phones,
      title,
      linkedin,
    });
    const urlSlug = client.legacyRfId != null ? String(client.legacyRfId) : client.id;
    revalidatePath(`/clients/${urlSlug}`);
    return { ok: true, value: { id: created.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create contact" };
  }
}

export type ContactPhone = { number: string; extension: string; type: string };

export type UpdateContactInput = {
  contactId: string;
  firstName: string;
  lastName: string;
  title: string;
  emails: string[];
  phones: ContactPhone[];
  linkedin: string;
  notes: string;
};

export type UpdateContactResult = ActionResult<{
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  title: string;
  // Primary (index 0) values for back-compat with single-value readers.
  email: string;
  phone: string;
  extension: string;
  // Full ordered lists for the multi-value UI.
  emails: string[];
  phones: ContactPhone[];
  linkedin: string;
  notes: string;
}>;

// Edits a single contact from the client-profile Contacts tab. Scoped by
// organizationId — refuses to write if the contact isn't in the caller's
// org, even if a malicious client forged the contactId. Shapes the
// response so the optimistic UI update in ContactsTab can replace the
// row without a full router.refresh().
export async function updateContact(input: UpdateContactInput): Promise<UpdateContactResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.contactId) return { ok: false, error: "Missing contact id." };

  const first = input.firstName.trim();
  const last = input.lastName.trim();
  if (!first) return { ok: false, error: "First name is required." };

  try {
    const org = await getCurrentOrg();
    const existing = await prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: org.id },
      select: { id: true, client: { select: { id: true, legacyRfId: true } } },
    });
    if (!existing) return { ok: false, error: "Contact not found." };

    const emails = (input.emails ?? []).map((e) => e.trim()).filter(Boolean);
    const phones = (input.phones ?? [])
      .map((p) => ({
        number: normalizeToE164(p.number) ?? "",
        extension: p.extension.trim(),
        type: (p.type ?? "").trim(),
      }))
      .filter((p) => p.number)
      .map(phoneEntry);
    const title = input.title.trim();
    const linkedin = linkedinUrlFrom(input.linkedin);
    const notes = input.notes.trim();
    const combined = [first, last].filter(Boolean).join(" ");

    const updated = await prisma.contact.update({
      where: { id: existing.id },
      data: {
        firstName: first,
        lastName: last || null,
        name: combined,
        emails,
        phoneNumbers: phones.length ? phones : undefined,
        currentDesignation: title || null,
        linkedinProfile: linkedin || null,
        notes: notes || null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        name: true,
        currentDesignation: true,
        emails: true,
        phoneNumbers: true,
        linkedinProfile: true,
        notes: true,
      },
    });

    if (existing.client) {
      const slug =
        existing.client.legacyRfId != null
          ? String(existing.client.legacyRfId)
          : existing.client.id;
      revalidatePath(`/clients/${slug}`);
    }

    const phonesOut: ContactPhone[] = (() => {
      const pn = updated.phoneNumbers as Array<{
        number?: string | null;
        extension?: string | null;
        type?: string | null;
      }> | null;
      if (!Array.isArray(pn)) return [];
      return pn
        .map((p) => ({
          number: (p?.number ?? "").trim(),
          extension: (p?.extension ?? "").trim(),
          type: (p?.type ?? "").trim(),
        }))
        .filter((p) => p.number);
    })();
    const emailsOut = Array.isArray(updated.emails)
      ? updated.emails.filter((e): e is string => typeof e === "string" && e.trim().length > 0)
      : [];
    if (existing.client) {
      await backfillClientGmailThreadTags({
        userId: user.id,
        organizationId: org.id,
        clientId: existing.client.id,
        addresses: emailsOut,
      }).catch((err) => {
        console.warn("[updateContact] Gmail backfill failed", err);
      });
    }

    return {
      ok: true,
      value: {
        id: updated.id,
        firstName: updated.firstName ?? "",
        lastName: updated.lastName ?? "",
        name: updated.name ?? combined,
        title: updated.currentDesignation ?? "",
        email: emailsOut[0] ?? "",
        phone: phonesOut[0]?.number ?? "",
        extension: phonesOut[0]?.extension ?? "",
        emails: emailsOut,
        phones: phonesOut,
        linkedin: updated.linkedinProfile ?? "",
        notes: updated.notes ?? "",
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update contact." };
  }
}

// ---- Agreements ----
// Uploads go through /api/uploads/agreement (chunked). Summarize and delete
// stay as server actions because they're small one-shot calls.

// Fields Claude detected in the agreement, surfaced to the UI's "Detected:"
// confirm box. signed/feePct are null when not confidently extracted (the UI
// omits a null field rather than guessing). agreementDateIso is the upload
// date (YYYY-MM-DD) — we use the upload date as the agreement date, so it is
// always present.
export type DetectedAgreementFields = {
  signed: boolean | null;
  feePct: number | null;
  // Payable window in days from the agreement ("10 day payable" → 10).
  paymentTermsDays: number | null;
  agreementDateIso: string;
};

// What summarize actually WROTE to the client (write-if-empty auto-apply).
// A field is non-null here only when it was both detected AND the client's
// corresponding field was empty, so we never clobber a recruiter-set value.
export type AppliedAgreementFields = {
  signed: boolean | null;
  feePct: number | null;
  paymentTermsDays: number | null;
  signedAt: string | null; // YYYY-MM-DD, set when signed was auto-applied
};

export type SummarizeAgreementResult = ActionResult<{
  summary: string;
  summaryUpdatedAt: string;
  detected: DetectedAgreementFields;
  applied: AppliedAgreementFields;
}>;

export async function summarizeAgreement(agreementId: string): Promise<SummarizeAgreementResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };

  const org = await getCurrentOrg();
  const agreement = await prisma.clientAgreement.findFirst({
    where: { id: agreementId, organizationId: org.id },
    select: { clientId: true, filename: true, mimeType: true, data: true, uploadedAt: true },
  });
  if (!agreement) return { ok: false, error: "Agreement not found." };

  try {
    const { summary, extracted } = await summarizeAgreementTermsWithClaude({
      filename: agreement.filename,
      mimeType: agreement.mimeType,
      data: Buffer.from(agreement.data),
    });
    const now = new Date();
    const agreementDateIso = agreement.uploadedAt.toISOString().slice(0, 10);
    await prisma.clientAgreement.update({
      where: { id: agreementId },
      data: { summary, summaryUpdatedAt: now },
    });

    // Auto-apply the detected fee-agreement fields to the client, WRITE-IF-
    // EMPTY only. This is what makes Summarize Terms actually populate the
    // Company & Fee Agreement section end-to-end: it persists server-side and
    // survives a refresh. The previous flow wrote nothing here and relied on
    // an ephemeral in-memory "Apply" box, so a user who summarized and then
    // refreshed/navigated away (as happens naturally) lost the detection and
    // the fields stayed blank. We only fill a field that is currently empty,
    // so a value the recruiter set by hand is never clobbered; genuine
    // conflicts still surface the manual Apply box in the UI for an explicit
    // overwrite.
    const applied: AppliedAgreementFields = {
      signed: null,
      feePct: null,
      paymentTermsDays: null,
      signedAt: null,
    };
    if (agreement.clientId) {
      const client = await prisma.client.findUnique({
        where: { id: agreement.clientId },
        select: {
          feeAgreementSigned: true,
          feeAgreementSignedAt: true,
          feePct: true,
          paymentTermsDays: true,
        },
      });
      if (client) {
        const data: {
          feeAgreementSigned?: boolean;
          feeAgreementSignedAt?: Date;
          feePct?: number;
          paymentTermsDays?: number;
        } = {};
        if (extracted.signed !== null && client.feeAgreementSigned === null) {
          data.feeAgreementSigned = extracted.signed;
          applied.signed = extracted.signed;
          if (extracted.signed === true && client.feeAgreementSignedAt === null) {
            data.feeAgreementSignedAt = agreement.uploadedAt;
            applied.signedAt = agreementDateIso;
          }
        }
        if (extracted.feePercent !== null && client.feePct === null) {
          data.feePct = extracted.feePercent;
          applied.feePct = extracted.feePercent;
        }
        // Same write-if-empty rule as the fee: a payable window the recruiter
        // already set by hand is never overwritten by the extractor.
        if (extracted.paymentTermsDays !== null && client.paymentTermsDays === null) {
          data.paymentTermsDays = extracted.paymentTermsDays;
          applied.paymentTermsDays = extracted.paymentTermsDays;
        }
        if (Object.keys(data).length > 0) {
          await prisma.client.update({ where: { id: agreement.clientId }, data });
        }
      }
    }

    if (agreement.clientId) revalidatePath(`/clients/${agreement.clientId}`);
    // Auto-apply can change fee/signed; refresh the grid too so the card's
    // "Fee X%" + verified shield update without a full reload.
    revalidatePath(`/clients`);
    return {
      ok: true,
      value: {
        summary,
        summaryUpdatedAt: now.toISOString(),
        detected: {
          signed: extracted.signed,
          feePct: extracted.feePercent,
          paymentTermsDays: extracted.paymentTermsDays,
          // Agreement date = the upload date (YYYY-MM-DD, local-safe slice).
          agreementDateIso,
        },
        applied,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Claude summarization failed" };
  }
}

export async function deleteAgreement(agreementId: string): Promise<ActionResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  const existing = await prisma.clientAgreement.findFirst({
    where: { id: agreementId, organizationId: org.id },
    select: { clientId: true },
  });
  if (!existing) return { ok: false, error: "Agreement not found." };
  await prisma.clientAgreement.delete({ where: { id: agreementId } });
  if (existing.clientId) revalidatePath(`/clients/${existing.clientId}`);
  return { ok: true };
}

// ---- Benefits ----

export type SaveBenefitsResult = ActionResult<{ updatedAt: string }>;

export async function saveBenefits(clientId: string, body: string): Promise<SaveBenefitsResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!clientId) return { ok: false, error: "Missing client id." };

  const org = await getCurrentOrg();
  // Confirm the client is in the caller's org before keying the upsert on it.
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: org.id },
    select: { id: true },
  });
  if (!client) return { ok: false, error: "Client not found." };

  const trimmed = body.slice(0, 64_000);
  const row = await prisma.clientBenefits.upsert({
    where: { clientId },
    update: { body: trimmed, updatedById: user.id },
    create: { clientId, body: trimmed, updatedById: user.id, organizationId: org.id },
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
  const org = await getCurrentOrg();
  const existing = await prisma.clientBenefitsFile.findFirst({
    where: { id: fileId, organizationId: org.id },
    select: { clientId: true, blobUrl: true },
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
  if (existing.clientId) revalidatePath(`/clients/${existing.clientId}`);
  return { ok: true };
}

// ---- Summarize with Claude ----

export type SummarizeBenefitsResult = ActionResult<{ summary: string }>;

export async function summarizeBenefitsWithAI(
  clientId: string,
  pastedText: string,
): Promise<SummarizeBenefitsResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!clientId) return { ok: false, error: "Missing client id." };

  const org = await getCurrentOrg();
  const files = await prisma.clientBenefitsFile.findMany({
    where: { clientId, organizationId: org.id },
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

// ---- Company + Fee Agreement (client/update) ----

export type UpdateClientInput = {
  clientCuid: string;
  name: string;
  website: string;
  linkedin: string;
  phones: string[];
  industry: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  feeAgreementSigned: boolean;
  feeAgreementSignedAt: string;
  feePct: string;
  // Payable window in days, free-text from the form ("10"). Empty clears it
  // and invoices fall back to the 30-day default.
  paymentTermsDays: string;
  feeBillingContact: string;
};

export async function updateClientCompany(input: UpdateClientInput): Promise<ActionResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.clientCuid) return { ok: false, error: "Missing client id." };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Client name is required." };

  const domain = input.website.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");

  try {
    const org = await getCurrentOrg();
    const existing = await prisma.client.findFirst({
      where: { id: input.clientCuid, organizationId: org.id },
      select: { id: true, legacyRfId: true, contacts: { select: { emails: true } } },
    });
    if (!existing) return { ok: false, error: "Client not found." };

    const location = {
      street_address_1: input.street1.trim() || null,
      street_address_2: input.street2.trim() || null,
      city: input.city.trim() || null,
      state: input.state.trim() || null,
      postal_code: input.postalCode.trim() || null,
      country: "United States of America",
    };
    const phoneEntries = (input.phones ?? [])
      .map((p) => normalizeToE164(p) ?? "")
      .filter(Boolean)
      .map((number) => ({ number }));
    const signedAtTrimmed = input.feeAgreementSignedAt.trim();
    const signedAtDate = signedAtTrimmed ? new Date(signedAtTrimmed) : null;
    const feePctTrimmed = input.feePct.trim();
    const feePctValue = feePctTrimmed ? Number(feePctTrimmed) : null;
    const termsTrimmed = (input.paymentTermsDays ?? "").trim();
    const termsParsed = termsTrimmed ? Number(termsTrimmed) : null;
    const termsDaysValue =
      termsParsed != null && Number.isFinite(termsParsed) && termsParsed >= 0
        ? Math.trunc(termsParsed)
        : null;

    await prisma.client.update({
      where: { id: existing.id },
      data: {
        name,
        domain: domain || null,
        industry: input.industry.trim() || null,
        linkedinPage: linkedinUrlFrom(input.linkedin) || null,
        phoneNumbers: phoneEntries,
        location,
        feeAgreementSigned: input.feeAgreementSigned,
        feeAgreementSignedAt:
          signedAtDate && !Number.isNaN(signedAtDate.getTime()) ? signedAtDate : null,
        feePct: feePctValue != null && !Number.isNaN(feePctValue) ? feePctValue : null,
        paymentTermsDays: termsDaysValue,
        feeBillingContact: input.feeBillingContact.trim() || null,
      },
    });
    await backfillClientGmailThreadTags({
      userId: user.id,
      organizationId: org.id,
      clientId: existing.id,
      addresses: existing.contacts.flatMap((c) => c.emails),
      domains: [domain],
    }).catch((err) => {
      console.warn("[updateClientCompany] Gmail backfill failed", err);
    });

    const slug = existing.legacyRfId != null ? String(existing.legacyRfId) : existing.id;
    revalidatePath(`/clients/${slug}`);
    revalidatePath(`/clients`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update client." };
  }
}

// ---- Candidate-facing blurb (the {{client_blurb}} merge field) ----

export type ClientBlurbResult = ActionResult<{ blurb: string }>;

// Generate-with-Claude for the client page. Loads the client (org-scoped),
// asks Claude for the anonymous blurb, saves it, and returns it so the
// editable field can fill in-place. Org-scoped via the shared helper.
export async function generateClientBlurb(clientCuid: string): Promise<ClientBlurbResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!clientCuid) return { ok: false, error: "Missing client id." };

  try {
    const org = await getCurrentOrg();
    const existing = await prisma.client.findFirst({
      where: { id: clientCuid, organizationId: org.id },
      select: { id: true, legacyRfId: true },
    });
    if (!existing) return { ok: false, error: "Client not found." };

    const blurb = await generateAndSaveClientBlurb({
      clientId: existing.id,
      organizationId: org.id,
    });

    const slug = existing.legacyRfId != null ? String(existing.legacyRfId) : existing.id;
    revalidatePath(`/clients/${slug}`);
    return { ok: true, value: { blurb } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to generate blurb." };
  }
}

// Inline save for a manually-edited blurb. Normalizes the same way the
// generator does (strips quotes/dashes/trailing period, lowercase start)
// so a hand-typed value renders identically in the outreach sentence.
// An empty value clears the column back to null.
export async function updateClientBlurb(
  clientCuid: string,
  blurb: string,
): Promise<ClientBlurbResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!clientCuid) return { ok: false, error: "Missing client id." };

  try {
    const org = await getCurrentOrg();
    const existing = await prisma.client.findFirst({
      where: { id: clientCuid, organizationId: org.id },
      select: { id: true, legacyRfId: true },
    });
    if (!existing) return { ok: false, error: "Client not found." };

    const cleaned = blurb.trim() ? normalizeClientBlurb(blurb) : "";
    await prisma.client.update({
      where: { id: existing.id },
      data: { candidateBlurb: cleaned || null },
    });

    const slug = existing.legacyRfId != null ? String(existing.legacyRfId) : existing.id;
    revalidatePath(`/clients/${slug}`);
    return { ok: true, value: { blurb: cleaned } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save blurb." };
  }
}

// ---- Ownership (per-user client claim) ----
//
// Claims an unowned client for the signed-in user. Used by the
// "Available - Claim this client" banner on the detail page. Org-scoped
// (Architecture rule #8) and refuses to overwrite an existing owner, so
// two recruiters racing on the same available client can't clobber each
// other - the second one gets "already owned" and re-renders read-only.
export async function claimClient(clientCuid: string): Promise<ActionResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!clientCuid) return { ok: false, error: "Missing client id." };

  try {
    const org = await getCurrentOrg();
    const existing = await prisma.client.findFirst({
      where: { id: clientCuid, organizationId: org.id },
      select: { id: true, legacyRfId: true, ownerId: true },
    });
    if (!existing) return { ok: false, error: "Client not found." };
    if (existing.ownerId) return { ok: false, error: "This client is already owned." };

    await prisma.client.update({
      where: { id: existing.id },
      data: { ownerId: user.id },
    });

    const slug = existing.legacyRfId != null ? String(existing.legacyRfId) : existing.id;
    revalidatePath(`/clients/${slug}`);
    revalidatePath(`/clients`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to claim client." };
  }
}

// Hard-delete a client and every row that references it. Mirrors
// deleteCandidate's strategy: explicit cascade rather than relying on
// schema-level onDelete alone, because Job and Contact use SetNull
// (would leave orphan rows pointing at a missing client), and
// ActivityLog/SmsMessage/CallLog/AiWorkspaceMessage carry clientId
// without a foreign key relation. Wrapping the sequence in
// $transaction keeps it atomic.
//
// Tenant scope (Architecture rule #8): the client is resolved via an
// org-scoped lookup before any delete fires. A forged id from another
// tenant returns "Client not found." with no rows touched.
//
// Phone-trail rows (SmsMessage / CallLog) get clientId set to null
// rather than being deleted — those conversations are owned by the
// candidate side and should outlive the client they happened to
// reference.
export async function deleteClient(clientCuid: string): Promise<ActionResult> {
  const user = await requireUserId();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!clientCuid) return { ok: false, error: "Missing client id." };

  try {
    const org = await getCurrentOrg();
    const existing = await prisma.client.findFirst({
      where: { id: clientCuid, organizationId: org.id },
      select: { id: true, legacyRfId: true },
    });
    if (!existing) return { ok: false, error: "Client not found." };

    const jobs = await prisma.job.findMany({
      where: { clientId: existing.id },
      select: { id: true, legacyRfId: true },
    });
    const jobIds = jobs.map((j) => j.id);
    const jobLegacyIds = jobs
      .map((j) => j.legacyRfId)
      .filter((v): v is number => typeof v === "number");

    await prisma.$transaction(async (tx) => {
      // ActivityLog rows are loose-typed (targetType + targetId, no FK)
      // so they don't cascade — clear the client and job entries by hand.
      await tx.activityLog.deleteMany({
        where: { targetType: "client", targetId: existing.id },
      });
      if (existing.legacyRfId != null) {
        await tx.activityLog.deleteMany({
          where: { targetType: "client", targetId: String(existing.legacyRfId) },
        });
      }
      if (jobIds.length > 0) {
        await tx.activityLog.deleteMany({
          where: { targetType: "job", targetId: { in: jobIds } },
        });
      }
      if (jobLegacyIds.length > 0) {
        await tx.activityLog.deleteMany({
          where: {
            targetType: "job",
            targetId: { in: jobLegacyIds.map(String) },
          },
        });
      }

      // AiWorkspace pages (Game Plan tab) are keyed by stringified rfId
      // for client + numeric id for jobs. Clear both forms so a future
      // client at the same legacyRfId doesn't inherit prior chats.
      if (existing.legacyRfId != null) {
        await tx.aiWorkspaceMessage.deleteMany({
          where: { entityType: "client", entityId: String(existing.legacyRfId) },
        });
      }
      await tx.aiWorkspaceMessage.deleteMany({
        where: { entityType: "client", entityId: existing.id },
      });
      if (jobIds.length > 0) {
        await tx.aiWorkspaceMessage.deleteMany({
          where: { entityType: "job", entityId: { in: jobIds } },
        });
      }
      if (jobLegacyIds.length > 0) {
        await tx.aiWorkspaceMessage.deleteMany({
          where: {
            entityType: "job",
            entityId: { in: jobLegacyIds.map(String) },
          },
        });
      }

      // Phone trail: keep the rows (they belong to candidates) but
      // null out the now-stale client pointer.
      await tx.smsMessage.updateMany({
        where: { clientId: existing.id },
        data: { clientId: null },
      });
      await tx.callLog.updateMany({
        where: { clientId: existing.id },
        data: { clientId: null },
      });

      // Contact uses onDelete: SetNull on its clientId FK — orphaning
      // a contact when its company is gone is rarely useful, so wipe
      // those rows along with the client.
      await tx.contact.deleteMany({ where: { clientId: existing.id } });

      // Job uses onDelete: SetNull as well. Deleting the jobs first
      // cascades their dependents (JobOverride, Placement, Interview)
      // before we drop the client.
      if (jobIds.length > 0) {
        await tx.job.deleteMany({ where: { id: { in: jobIds } } });
      }

      // Final blow. Schema-level cascades clean up the rest:
      //   ClientAgreement, ClientBenefits, ClientBenefitsFile,
      //   Placement, Interview, GmailThreadTag.
      await tx.client.delete({ where: { id: existing.id } });
    });

    revalidatePath("/clients");
    revalidatePath(`/clients/${existing.id}`);
    if (existing.legacyRfId != null) revalidatePath(`/clients/${existing.legacyRfId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete client." };
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
