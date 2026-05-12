import { notFound } from "next/navigation";
import Link from "next/link";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getBillingSettings } from "@/lib/billing-settings";
import { getInvoice, parseInvoiceContacts } from "@/lib/invoices";

import { InvoiceDetail } from "./invoice-detail";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await getCurrentOrg();
  const [invoice, billing] = await Promise.all([
    getInvoice(id, org.id),
    getBillingSettings(),
  ]);
  if (!invoice) notFound();

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
        sentAt={invoice.sentAt ? invoice.sentAt.toISOString() : null}
        paidAt={invoice.paidAt ? invoice.paidAt.toISOString() : null}
        candidateName={candidateName}
        candidateId={invoice.candidate?.id ?? null}
        candidateEmail={invoice.candidate?.email ?? null}
        clientName={invoice.client?.name ?? ""}
        clientId={invoice.client?.id ?? null}
        accountExecName={accountExecName}
        baseSalary={invoice.placement?.acceptedSalary ?? null}
        feePercentage={invoice.placement?.feePercentage ?? null}
        billingContacts={billingContacts}
        hiringContacts={hiringContacts}
        billingCompanyName={billing.companyName}
        billingArEmail={billing.arEmail}
        billingDisplayAddress={`${billing.addressLine1} · ${billing.city}, ${billing.state} ${billing.zip}`}
      />
    </div>
  );
}
