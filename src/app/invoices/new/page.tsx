import Link from "next/link";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getBillingSettings } from "@/lib/billing-settings";
import { nextInvoiceNumber } from "@/lib/invoices";

import { InvoiceDetail } from "@/app/invoices/[id]/invoice-detail";

export const dynamic = "force-dynamic";

// Blank "New Invoice" editor. Renders InvoiceDetail in new mode (id={null}) —
// NO database row is created on open. The DRAFT row is written only when the
// recruiter explicitly clicks Save draft or Mark as sent. The shown invoice
// number is a preview of nextInvoiceNumber; the real number is assigned at
// save-time via the same sequence, so opening + cancelling consumes nothing.
export default async function NewInvoicePage() {
  const org = await getCurrentOrg();
  const [previewNumber, billing] = await Promise.all([
    nextInvoiceNumber(org.id),
    getBillingSettings(),
  ]);

  const today = new Date();
  const due = new Date(today);
  due.setDate(due.getDate() + 30);
  const toISODate = (d: Date) => d.toISOString().slice(0, 10);

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
        id={null}
        invoiceNumber={previewNumber}
        status="DRAFT"
        roleTitle=""
        startDate={toISODate(today)}
        dueDate={toISODate(due)}
        feeAmount=""
        paymentTerms="Net 30"
        notes=""
        sentAt={null}
        paidAt={null}
        paymentMethod={null}
        candidateName=""
        candidateId={null}
        candidateEmail={null}
        clientName=""
        clientId={null}
        accountExecName=""
        baseSalary={null}
        feePercentage={null}
        billingContacts={[]}
        hiringContacts={[]}
        billingCompanyName={billing.companyName}
        billingArEmail={billing.arEmail}
        billingDisplayAddress={`${billing.addressLine1} · ${billing.city}, ${billing.state} ${billing.zip}`}
        sendFromAlias={null}
      />
    </div>
  );
}
