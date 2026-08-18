import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getBillingSettings } from "@/lib/billing-settings";
import { getInvoiceEmailDraftForInvoice } from "@/lib/invoice-email-drafts";
import { getInvoice, parseInvoiceContacts } from "@/lib/invoices";
import { prisma } from "@/lib/prisma";
import { loadTriggeredTemplate } from "@/lib/templated-email";
import { CONFIRMED_START_INVOICE_TRIGGER } from "@/app/settings/template-constants";

import { InvoiceDetail } from "./invoice-detail";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await getCurrentOrg();
  const session = await getServerSession(authOptions);
  const [invoice, billing, invoiceTpl, user] = await Promise.all([
    getInvoice(id, org.id),
    getBillingSettings(),
    // Active "Invoice Email" template (Settings ▸ Templates). The same
    // canonical loader every auto-trigger uses; EmailTemplate is a global
    // (single-org) table so no org scope is needed here.
    loadTriggeredTemplate(CONFIRMED_START_INVOICE_TRIGGER),
    session?.user?.email
      ? prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true },
        })
      : null,
  ]);
  if (!invoice) notFound();
  const savedEmailDraft = user
    ? await getInvoiceEmailDraftForInvoice({
        organizationId: org.id,
        userId: user.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      })
    : null;

  // Pass the RAW (unmerged) template subject + body to the client component;
  // merge fields resolve client-side at click time so recruiter edits to the
  // fee / dates / contacts in the editor are reflected in the drafted email.
  // Null when the template is missing or inactive → invoice-detail falls back
  // to its hardcoded literal so a deleted/disabled template never breaks sends.
  const invoiceEmailTemplate =
    invoiceTpl.kind === "ok"
      ? { subject: invoiceTpl.template.subject, body: invoiceTpl.template.body }
      : null;

  const billingContacts = parseInvoiceContacts(invoice.billingContacts);
  const hiringContacts = parseInvoiceContacts(invoice.hiringContacts);
  const candidateName = invoice.candidate
    ? `${invoice.candidate.firstName} ${invoice.candidate.lastName ?? ""}`.trim()
    : "";
  const accountExecName = invoice.placement?.createdBy?.name?.trim() || "";

  return (
    <div className="flex w-full flex-col gap-5 px-6 py-7 lg:px-10">
      <div>
        <Link
          href="/invoices"
          className="text-[12px] font-semibold uppercase tracking-wider text-court-fg-muted hover:text-court-fg"
        >
          ← All invoices
        </Link>
      </div>
      <InvoiceDetail
        id={invoice.id}
        invoiceNumber={invoice.invoiceNumber}
        status={invoice.status}
        roleTitle={invoice.roleTitle ?? ""}
        startDate={invoice.startDate ? invoice.startDate.toISOString().slice(0, 10) : ""}
        dueDate={invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : ""}
        feeAmount={invoice.feeAmount ? invoice.feeAmount.toString() : ""}
        paymentTerms={invoice.paymentTerms ?? "Net 30"}
        notes={invoice.notes ?? ""}
        clientNote={invoice.clientNote ?? ""}
        sentAt={invoice.sentAt ? invoice.sentAt.toISOString() : null}
        paidAt={invoice.paidAt ? invoice.paidAt.toISOString() : null}
        paymentMethod={invoice.paymentMethod ?? null}
        candidateName={candidateName}
        candidateId={invoice.candidate?.id ?? null}
        candidateEmail={invoice.candidate?.email ?? null}
        clientName={invoice.client?.name ?? ""}
        clientId={invoice.client?.id ?? null}
        clientPaymentTermsDays={invoice.client?.paymentTermsDays ?? null}
        accountExecName={accountExecName}
        baseSalary={invoice.baseSalary ? Number(invoice.baseSalary.toString()) : null}
        feePercentage={invoice.feePercentage ? Number(invoice.feePercentage.toString()) : null}
        billingContacts={billingContacts}
        hiringContacts={hiringContacts}
        billingCompanyName={billing.companyName}
        billingArEmail={billing.arEmail}
        billingDisplayAddress={`${billing.addressLine1} · ${billing.city}, ${billing.state} ${billing.zip}`}
        sendFromAlias={invoice.sendFromAlias ?? null}
        invoiceEmailTemplate={invoiceEmailTemplate}
        emailDraft={
          savedEmailDraft
            ? {
                id: savedEmailDraft.id,
                kind: savedEmailDraft.kind,
                gmailDraftId: savedEmailDraft.gmailDraftId,
                to: savedEmailDraft.to.join(", "),
                cc: savedEmailDraft.cc.join(", "),
                bcc: savedEmailDraft.bcc.join(", "),
                subject: savedEmailDraft.subject,
                bodyHtml: savedEmailDraft.bodyHtml,
                threadId: savedEmailDraft.threadId,
                sendAsEmail: savedEmailDraft.sendAsEmail,
                scheduledSendAt: savedEmailDraft.scheduledSendAt
                  ? savedEmailDraft.scheduledSendAt.toISOString()
                  : null,
                attachments: savedEmailDraft.attachments.map((attachment, index) => ({
                  key: `invoice-email-draft-${savedEmailDraft.id}-${index}`,
                  filename: attachment.filename,
                  mimeType: attachment.mimeType,
                  sizeBytes: Buffer.byteLength(attachment.dataBase64, "base64"),
                  dataBase64: attachment.dataBase64,
                })),
              }
            : null
        }
      />
    </div>
  );
}
