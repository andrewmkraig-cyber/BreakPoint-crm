import { NextResponse } from "next/server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getBillingSettings } from "@/lib/billing-settings";
import { getInvoice, parseInvoiceContacts } from "@/lib/invoices";
import { renderInvoicePdfBuffer } from "@/lib/invoice-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const org = await getCurrentOrg();
  const [invoice, billing] = await Promise.all([
    getInvoice(id, org.id),
    getBillingSettings(),
  ]);
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const billingContacts = parseInvoiceContacts(invoice.billingContacts);
  const hiringContacts = parseInvoiceContacts(invoice.hiringContacts);
  const candidateName = invoice.candidate
    ? `${invoice.candidate.firstName} ${invoice.candidate.lastName ?? ""}`.trim()
    : "";
  const accountExecName = invoice.placement?.createdBy?.name?.trim() || "";

  const clientLocation = invoice.client?.location as Record<string, unknown> | null | undefined;
  const clientAddress = clientLocation
    ? [clientLocation.line1, clientLocation.city, clientLocation.state, clientLocation.zip]
        .filter((v) => typeof v === "string" && v)
        .join(", ")
    : "";

  const feeAmountUsd = invoice.feeAmount ? Number(invoice.feeAmount.toString()) : null;

  const pdfBuffer = await renderInvoicePdfBuffer({
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.startDate,
    dueDate: invoice.dueDate,
    paymentTerms: invoice.paymentTerms ?? "Net 30",
    feeAmountUsd,
    roleTitle: invoice.roleTitle,
    candidateName,
    clientName: invoice.client?.name ?? "",
    clientAddress,
    startDateLabel: invoice.startDate
      ? invoice.startDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "",
    baseSalaryUsd: invoice.placement?.acceptedSalary ?? null,
    feePercentage: invoice.placement?.feePercentage ?? null,
    accountExecName,
    billingContacts,
    hiringContacts,
    billing,
  });

  const filename = `${billing.companyName} - ${invoice.invoiceNumber}.pdf`;
  // Wrap the Node Buffer in a Blob so the Response body matches BodyInit
  // typing — Buffer/Uint8Array isn't always assignable directly under
  // strict TS lib targets.
  const blob = new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" });
  return new NextResponse(blob, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
