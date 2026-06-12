import { NextResponse } from "next/server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getBillingSettings } from "@/lib/billing-settings";
import { getInvoice, parseInvoiceContacts } from "@/lib/invoices";
import { renderInvoicePdfBuffer } from "@/lib/invoice-pdf";
import {
  formatPlacementCompensation,
  formatPlacementFeeBasis,
  normalizePlacementCompensationType,
  placementFeeBasisAmount,
} from "@/lib/placement-compensation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatInvoiceDate(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

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

  // Field map — Invoice → PDF renderer. Kept explicit so a future reader
  // can trace any "—" rendering back to the column it reads from.
  //   Amount Due / Subtotal      ← invoice.feeAmount     (Decimal)
  //   Bill To / Hiring Contact   ← invoice.billingContacts + invoice.hiringContacts
  //                                (Json arrays; first entry is the primary)
  //                              ← invoice.client.name   (BILL TO heading)
  //   Candidate                  ← invoice.candidate.firstName + lastName
  //   Role                       ← invoice.roleTitle
  //   Issue / Due / Terms        ← invoice.startDate, invoice.dueDate, invoice.paymentTerms
  //   Base Salary / Fee %        ← invoice.baseSalary / invoice.feePercentage
  //                                (Decimal snapshot columns; populated
  //                                from placement at create time or set
  //                                directly by the test-invoice path). When
  //                                null — e.g. custom-installment drafts,
  //                                which never snapshot them — fall back to
  //                                the live placement fee fields.
  //   Rate / Qty                 ← placement.feeTotal as rate, invoice.feeAmount / rate
  //                                as decimal quantity for installment invoices
  //   Account Exec               ← invoice.placement.createdBy.name
  //                                (still joined — AE is recruiter context,
  //                                not a billing snapshot)
  //   Note (client-facing)       ← invoice.clientNote (optional, prints
  //                                on the PDF). invoice.notes is internal
  //                                only and is intentionally NOT rendered.
  const feeAmountUsd = invoice.feeAmount ? Number(invoice.feeAmount.toString()) : null;
  const baseSalaryUsd = invoice.baseSalary
    ? Number(invoice.baseSalary.toString())
    : invoice.placement?.acceptedSalary ?? null;
  const compensationType = normalizePlacementCompensationType(
    invoice.placement?.acceptedCompensationType,
  );
  const feeBasisAmountUsd = placementFeeBasisAmount(baseSalaryUsd, compensationType);
  const baseSalaryLabel =
    baseSalaryUsd != null
      ? formatPlacementCompensation(baseSalaryUsd, "USD", compensationType)
      : null;
  const feeBasisBaseLabel =
    baseSalaryUsd != null
      ? formatPlacementFeeBasis(baseSalaryUsd, "USD", compensationType)
      : null;
  const feePercentageNum = invoice.feePercentage
    ? Number(invoice.feePercentage.toString())
    : invoice.placement?.feePercentage ?? null;

  // Fee field basis (% vs Min Fee). The dollar fee already shows in the
  // line-item rate/amount, so this field just states what drove the number.
  // Render "Min Fee" when a flat fee override is set OR (base salary × fee %)
  // fell below the minimum fee; otherwise render the fee percentage. Both
  // "flat override" and "below-min" cases surface as the full placement fee
  // (feeTotal) differing from the raw percentage calc, which is the single
  // signal used here. Falls back to the plain percentage when there is no
  // placement to read a fee basis from (e.g. the test invoice / a manual
  // New Invoice), preserving the prior behavior for those.
  const placementFullFee = invoice.placement?.feeTotal ?? null;
  const placementMinFee = invoice.placement?.minFee ?? null;
  const totalFeeAmountUsd = placementFullFee ?? feeAmountUsd;
  let feeBasisLabel: string | null = null;
  if (feePercentageNum != null && feePercentageNum > 0 && feeBasisAmountUsd != null) {
    const rawFee = Math.round(feeBasisAmountUsd * (feePercentageNum / 100));
    const belowMin = placementMinFee != null && rawFee < placementMinFee;
    const flatOverride = placementFullFee != null && placementFullFee !== rawFee;
    feeBasisLabel = belowMin || flatOverride ? "Min Fee" : `${feePercentageNum}%`;
  } else if (invoice.placement != null && (placementFullFee != null || feeAmountUsd != null)) {
    // Placement-backed invoice with no percentage basis — the fee is a flat
    // number, so the minimum (or a flat override) is what drove it. Gated on
    // an actual placement so a manual placement-less invoice keeps rendering
    // a blank "-" rather than an unfounded "Min Fee".
    feeBasisLabel = "Min Fee";
  }

  // Guarantee — the real guaranteed day count for this placement. A custom
  // guarantee end date wins: show the number of days from the placement
  // start to that date. Otherwise the recruiter-entered guaranteePeriodDays,
  // falling back to the 90-day industry default. Mirrors resolveGuaranteeEnd's
  // precedence (customGuaranteeDate > guaranteePeriodDays > 90).
  const guaranteeStart =
    invoice.startDate ?? invoice.placement?.expectedStartDate ?? null;
  const customGuaranteeDate = invoice.placement?.customGuaranteeDate ?? null;
  let guaranteeDays = invoice.placement?.guaranteePeriodDays ?? 90;
  if (customGuaranteeDate && guaranteeStart) {
    const diffDays = Math.round(
      (customGuaranteeDate.getTime() - guaranteeStart.getTime()) / 86_400_000,
    );
    if (diffDays > 0) guaranteeDays = diffDays;
  }
  const guaranteeLabel = `${guaranteeDays} day${guaranteeDays === 1 ? "" : "s"}`;

  const pdfBuffer = await renderInvoicePdfBuffer({
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.startDate,
    dueDate: invoice.dueDate,
    paymentTerms: invoice.paymentTerms ?? "Net 30",
    feeAmountUsd,
    totalFeeAmountUsd,
    roleTitle: invoice.roleTitle,
    candidateName,
    clientName: invoice.client?.name ?? "",
    clientAddress,
    startDateLabel: formatInvoiceDate(invoice.startDate),
    baseSalaryUsd,
    baseSalaryLabel,
    feeBasisBaseLabel,
    feePercentage: feePercentageNum,
    feeBasisLabel,
    // Real min fee off the placement, so the line-item description can read
    // "$70,000 base (minimum fee of $7,500 applied)" when feeBasisLabel is
    // "Min Fee" (same decision used for the FEE % box above).
    minFeeUsd: placementMinFee,
    accountExecName,
    billingContacts,
    hiringContacts,
    billing,
    // Client-facing note only. invoice.notes (internal) is deliberately
    // never passed to the PDF so it stays off the client document.
    clientNote: invoice.clientNote,
    guaranteeLabel,
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
