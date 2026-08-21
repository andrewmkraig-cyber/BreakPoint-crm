// Server-only PDF invoice template rendered with @react-pdf/renderer.
// One-page US Letter, BreakPoint Talent branded. Charcoal + cream + a
// single brand-green hairline rule under the header. No payment URLs,
// no QR code - ACH/Wire/Check details live in a cream panel two-thirds
// of the way down the page.
//
// Visual order top → bottom:
//   Header band         · brand mark + company wordmark/contact stack ⟂ big "Invoice" + INV-NNNN
//   Meta strip          · Issue Date / Due Date / Terms / Amount Due
//   Bill To · Contacts  · client ⟂ hiring contact ⟂ billing contact
//   Placement Summary   · candidate / role / start / fee details
//   Services table      · single line item with rate × qty = amount
//   Totals              · right-aligned subtotal + amount due
//   Payment Instructions· three columns: ACH/Wire · Check · EIN (9pt)
//   Note (optional)     · small muted "Note: …" line if invoice.notes set
//   Footer              · bottom-left grey "Kraig Talent LLC dba BreakPoint Talent"
//
// Spacing was tightened in Ace 42 so the entire document fits on a single
// US Letter page - section margins were reduced ~30% across the board and
// the prior two-row footer was collapsed into a single inline line.
//
// Helvetica is the @react-pdf built-in - no font fetch needed. Playfair
// Display + Inter from the design tokens require a runtime font fetch
// which we skip in this MVP for reliability; the visual hierarchy is
// preserved via weight + size + color.

import {
  Document,
  Page,
  Image,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { readFileSync } from "fs";
import { join } from "path";
import { createElement } from "react";

import type { BillingSettings } from "@/lib/billing-settings";
import type { InvoiceContact } from "@/lib/invoices";

// Read the brand mark once at module load. @react-pdf accepts a base64
// data URI as Image.src, which sidesteps the need to resolve a file path
// at render time on Vercel (where the working dir differs from local).
const BRAND_LOGO_DATA_URI = (() => {
  try {
    const buf = readFileSync(
      join(process.cwd(), "public/brand/breakpoint_logo_transparent.png"),
    );
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
})();

const BRAND_GREEN = "#5A9642";
const BRAND_GREEN_DARK = "#3F7030";
const INK = "#111111";
const INK_700 = "#1F2937";
const MUTED = "#6B7280";
const LINE = "#E5E8ED";
const CREAM = "#FAF8F3";

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: INK,
    lineHeight: 1.35,
  },
  // --- Header band ---
  // Two-column flex row. Left = logo + company wordmark/contact stack.
  // Right = big "Invoice" wordmark + smaller muted INV-NNNN beneath.
  // alignItems:flex-end pins the bottom of the right stack to the bottom
  // of the left stack so the brand-green hairline rule reads as a clean
  // baseline across both columns.
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: BRAND_GREEN,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    maxWidth: "65%",
  },
  brandCopy: { flexDirection: "column" },
  brandName: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.2,
    color: INK,
    marginBottom: 2,
  },
  brandLine: { fontSize: 9, color: MUTED, marginTop: 1 },
  headerRight: { alignItems: "flex-end" },
  // The "Invoice" wordmark sits alone now; the brand mark anchors the
  // far-left header beside the company identity.
  invoiceTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  brandMark: {
    width: 54,
    height: 54,
    objectFit: "contain",
  },
  invoiceWord: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    color: INK,
    letterSpacing: -0.5,
    lineHeight: 1,
  },
  invoiceNum: {
    fontSize: 10,
    color: MUTED,
    marginTop: 4,
    fontFamily: "Helvetica",
    letterSpacing: 0.8,
  },
  // --- Meta strip ---
  meta: {
    flexDirection: "row",
    marginTop: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },
  metaCol: { flex: 1, paddingRight: 10 },
  metaLabel: {
    fontSize: 7,
    color: MUTED,
    letterSpacing: 1.2,
    fontFamily: "Helvetica-Bold",
    marginBottom: 3,
  },
  metaValue: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: INK },
  metaValueAmount: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: INK,
  },
  // --- Bill To / Contacts ---
  contactGrid: {
    flexDirection: "row",
    marginTop: 12,
    gap: 18,
    alignItems: "flex-start",
  },
  billToCol: { flex: 1.15 },
  contactCol: { flex: 1 },
  sectionHeader: {
    fontSize: 8,
    color: BRAND_GREEN_DARK,
    letterSpacing: 1.4,
    fontFamily: "Helvetica-Bold",
    marginBottom: 5,
  },
  contactName: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: INK },
  contactCompany: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: INK,
    marginBottom: 1,
  },
  contactLine: { fontSize: 9, color: INK_700, marginTop: 1 },
  // --- Placement Summary ---
  summary: {
    marginTop: 12,
    backgroundColor: CREAM,
    borderRadius: 4,
    padding: 9,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  summaryItem: { width: "25%", paddingVertical: 3, paddingRight: 8 },
  summaryLabel: {
    fontSize: 7,
    color: MUTED,
    letterSpacing: 1.1,
    fontFamily: "Helvetica-Bold",
    marginBottom: 1,
  },
  summaryValue: { fontSize: 9.5, color: INK, fontFamily: "Helvetica-Bold" },
  // --- Services table ---
  tableHeader: {
    flexDirection: "row",
    marginTop: 12,
    paddingBottom: 5,
    borderBottomWidth: 1.2,
    borderBottomColor: INK,
  },
  th: {
    fontSize: 7,
    color: MUTED,
    letterSpacing: 1.3,
    fontFamily: "Helvetica-Bold",
  },
  thDesc: { flex: 5 },
  thQty: { flex: 1, textAlign: "right" },
  thRate: { flex: 2, textAlign: "right" },
  thAmount: { flex: 2, textAlign: "right" },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    alignItems: "flex-start",
  },
  tdDesc: { flex: 5, paddingRight: 12 },
  tdDescTitle: { fontSize: 10.5, color: INK, fontFamily: "Helvetica-Bold" },
  tdDescSub: { fontSize: 8.5, color: MUTED, marginTop: 2 },
  tdQty: { flex: 1, textAlign: "right", fontSize: 10, color: INK },
  tdRate: { flex: 2, textAlign: "right", fontSize: 10, color: INK },
  tdAmount: {
    flex: 2,
    textAlign: "right",
    fontSize: 10,
    color: INK,
    fontFamily: "Helvetica-Bold",
  },
  // --- Totals ---
  totals: { alignItems: "flex-end", marginTop: 8 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 240,
    paddingVertical: 2,
  },
  totalLabel: { fontSize: 10, color: INK_700 },
  totalValue: { fontSize: 10, color: INK, fontFamily: "Helvetica-Bold" },
  totalDueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 240,
    paddingVertical: 6,
    marginTop: 3,
    borderTopWidth: 1.2,
    borderTopColor: INK,
  },
  totalDueLabel: { fontSize: 12, color: INK, fontFamily: "Helvetica-Bold" },
  totalDueValue: { fontSize: 14, color: INK, fontFamily: "Helvetica-Bold" },
  // --- Payment Instructions ---
  // Tightened cream panel: three evenly-spaced columns with ACH/Wire
  // widened so the bank name can sit on one line.
  payment: {
    marginTop: 12,
    padding: 10,
    backgroundColor: CREAM,
    borderRadius: 4,
  },
  paymentReference: {
    fontSize: 9,
    color: INK,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
  },
  paymentCols: { flexDirection: "row", gap: 18, alignItems: "flex-start" },
  paymentCol: { flexDirection: "column" },
  paymentAchCol: { width: "44%" },
  paymentCheckCol: { width: "34%" },
  paymentEinCol: { width: "14%" },
  paymentHeader: {
    fontSize: 7.5,
    color: BRAND_GREEN_DARK,
    letterSpacing: 1.3,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  // EIN uses the same section-label treatment as the payment columns,
  // with the slightly brighter brand green to keep it legible at 7.5pt.
  einHeader: {
    fontSize: 7.5,
    color: BRAND_GREEN,
    letterSpacing: 1.3,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  // EIN number renders at normal weight (only the "Please reference"
  // header is bold in the payment footer).
  einValue: {
    fontSize: 10,
    color: INK,
  },
  paymentLine: { fontSize: 8.8, color: INK_700, marginBottom: 1 },
  paymentLineBold: {
    fontSize: 8.8,
    color: INK,
    fontFamily: "Helvetica-Bold",
    marginBottom: 1,
  },
  // --- Optional Note line (renders below Payment Instructions when
  // clientNote is populated). Small muted single-line label + body
  // so a short memo can ride along without crowding the page chrome.
  note: {
    flexDirection: "row",
    marginTop: 8,
    gap: 4,
    paddingHorizontal: 2,
  },
  noteLabel: {
    fontSize: 9,
    color: INK_700,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.4,
  },
  // Client-facing note body — slightly larger + darker than the old
  // internal-memo styling so payment-agreement language reads cleanly.
  noteBody: { fontSize: 9, color: INK_700, lineHeight: 1.4, flex: 1 },
  // --- Footer ---
  // Single muted line: "Kraig Talent LLC dba BreakPoint Talent" in the
  // bottom-left. EIN moved into the cream panel above; the prior "Thank
  // you for your business" line was removed per the Ace 43 spec.
  footer: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: LINE,
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  footerLine: { fontSize: 8, color: MUTED },
});

export type InvoicePdfInput = {
  invoiceNumber: string;
  issueDate: Date | null;
  dueDate: Date | null;
  paymentTerms: string;
  feeAmountUsd: number | null;
  totalFeeAmountUsd?: number | null;
  roleTitle: string | null;
  candidateName: string;
  clientName: string;
  clientAddress: string;
  startDateLabel: string;
  baseSalaryUsd: number | null;
  baseSalaryLabel?: string | null;
  feeBasisBaseLabel?: string | null;
  feePercentage: number | null;
  // Pre-resolved label for the FEE field. The route decides "%" vs
  // "Min Fee" (flat override / below-minimum) from the placement's fee
  // fields and passes the final string here. When null/undefined the
  // renderer falls back to the bare percentage (or "-").
  feeBasisLabel?: string | null;
  // The placement's real minimum fee (Int dollars). Used in the line-item
  // description when feeBasisLabel === "Min Fee" so it reads
  // "$70,000 base (minimum fee of $7,500 applied)" instead of a percentage
  // that did not actually drive the amount.
  minFeeUsd?: number | null;
  // True when this invoice bills a retained search rather than a placement.
  // A retained engagement has no candidate, no start date, and no salary-
  // derived fee basis, so the renderer swaps the CANDIDATE summary box for
  // the engagement label and drops the candidate/start-date wording from the
  // line item. Everything else — layout, type, spacing, colors, totals,
  // payment blocks — renders identically to a placement invoice.
  isRetained?: boolean;
  accountExecName: string;
  billingContacts: InvoiceContact[];
  hiringContacts: InvoiceContact[];
  billing: BillingSettings;
  // Optional CLIENT-FACING note written from the detail page's "Client
  // note" field (Invoice.clientNote column). Prints in the "Note:" block.
  // The internal `notes` memo is deliberately NOT passed here so it never
  // reaches the client document. Falsy → the note row is skipped entirely
  // so a blank-note invoice has clean whitespace under the payment panel.
  clientNote?: string | null;
  // Pre-resolved guarantee label for the GUARANTEE summary field, e.g.
  // "214 days". The route computes the real guaranteed day count from the
  // placement: a custom guarantee end date wins (days from start to that
  // date), otherwise guaranteePeriodDays, falling back to the 90-day
  // default. Null/undefined → renders the legacy "90 days".
  guaranteeLabel?: string | null;
};

function formatDate(d: Date | null | undefined): string {
  if (!d) return "-";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatUsdCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatQuantity(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "1";
  const rounded = Math.round(n * 100) / 100;
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

export function InvoicePdfDocument(props: InvoicePdfInput) {
  const {
    invoiceNumber,
    issueDate,
    dueDate,
    paymentTerms,
    feeAmountUsd,
    totalFeeAmountUsd,
    roleTitle,
    candidateName,
    clientName,
    clientAddress,
    startDateLabel,
    baseSalaryUsd,
    baseSalaryLabel,
    feeBasisBaseLabel,
    feePercentage,
    feeBasisLabel,
    minFeeUsd,
    isRetained = false,
    accountExecName,
    guaranteeLabel,
    billingContacts,
    hiringContacts,
    billing,
    clientNote,
  } = props;
  const trimmedNotes = clientNote?.trim() || "";

  const primaryBilling = billingContacts[0];
  const primaryHiring = hiringContacts[0];
  const lineItemRateUsd =
    totalFeeAmountUsd != null &&
    Number.isFinite(totalFeeAmountUsd) &&
    feeAmountUsd != null &&
    totalFeeAmountUsd > feeAmountUsd
      ? totalFeeAmountUsd
      : feeAmountUsd;
  const lineItemQty =
    feeAmountUsd != null && lineItemRateUsd != null && lineItemRateUsd > 0
      ? feeAmountUsd / lineItemRateUsd
      : 1;
  // Fee basis line. When the minimum fee (or flat override) is what drove
  // the amount - the SAME signal that makes the FEE % box read "Min Fee"
  // (feeBasisLabel) - state the base salary + the real min fee applied,
  // instead of a percentage that did not actually produce the number. When
  // a true percentage drove it, keep the "X% of $[base] base" wording.
  const minimumFeeAppliedUsd = minFeeUsd ?? lineItemRateUsd;
  const resolvedFeeBasisBaseLabel =
    feeBasisBaseLabel ??
    (baseSalaryUsd != null ? `${formatUsdCompact(baseSalaryUsd)} base` : null);
  const feeBasisDescription =
    feeBasisLabel === "Min Fee" && minimumFeeAppliedUsd != null && resolvedFeeBasisBaseLabel != null
      ? `${resolvedFeeBasisBaseLabel} (minimum fee of ${formatUsdCompact(minimumFeeAppliedUsd)} applied)`
      : feePercentage != null && resolvedFeeBasisBaseLabel != null
        ? `${feePercentage}% of ${resolvedFeeBasisBaseLabel}`
        : resolvedFeeBasisBaseLabel
          ? resolvedFeeBasisBaseLabel
          : null;
  const feeSummaryLabel = feeBasisLabel ?? (feePercentage != null ? `${feePercentage}%` : "-");

  // A retained invoice's sub-line carries neither a candidate start date
  // (nobody has started) nor a salary-derived fee basis (the retainer is a
  // negotiated amount), and its role already prints in the line title, so
  // the sub-line collapses to empty rather than printing misleading fields.
  const lineSub = isRetained
    ? ""
    : [
        roleTitle ? roleTitle : null,
        startDateLabel ? `Start date ${startDateLabel}` : null,
        feeBasisDescription,
      ]
        .filter(Boolean)
        .join(" · ");

  return createElement(
    Document,
    {},
    createElement(
      Page,
      { size: "LETTER", style: styles.page },
      // Header band
      createElement(
        View,
        { style: styles.header },
        createElement(
          View,
          { style: styles.brand },
          BRAND_LOGO_DATA_URI
            ? createElement(Image, {
                src: BRAND_LOGO_DATA_URI,
                style: styles.brandMark,
              })
            : null,
          createElement(
            View,
            { style: styles.brandCopy },
            createElement(Text, { style: styles.brandName }, billing.companyName),
            createElement(
              Text,
              { style: styles.brandLine },
              `${billing.arEmail} · ${billing.arPhone} · ${billing.website}`,
            ),
          ),
        ),
        createElement(
          View,
          { style: styles.headerRight },
          createElement(
            View,
            { style: styles.invoiceTitleRow },
            createElement(Text, { style: styles.invoiceWord }, "Invoice"),
          ),
          createElement(Text, { style: styles.invoiceNum }, invoiceNumber),
        ),
      ),
      // Meta strip
      createElement(
        View,
        { style: styles.meta },
        createElement(
          View,
          { style: styles.metaCol },
          createElement(Text, { style: styles.metaLabel }, "ISSUE DATE"),
          createElement(Text, { style: styles.metaValue }, formatDate(issueDate)),
        ),
        createElement(
          View,
          { style: styles.metaCol },
          createElement(Text, { style: styles.metaLabel }, "DUE DATE"),
          createElement(Text, { style: styles.metaValue }, formatDate(dueDate)),
        ),
        createElement(
          View,
          { style: styles.metaCol },
          createElement(Text, { style: styles.metaLabel }, "TERMS"),
          createElement(Text, { style: styles.metaValue }, paymentTerms || "Net 30"),
        ),
        createElement(
          View,
          { style: styles.metaCol },
          createElement(Text, { style: styles.metaLabel }, "AMOUNT DUE"),
          createElement(Text, { style: styles.metaValueAmount }, formatUsd(feeAmountUsd)),
        ),
      ),
      // Bill To / Contacts
      createElement(
        View,
        { style: styles.contactGrid },
        createElement(
          View,
          { style: styles.billToCol },
          createElement(Text, { style: styles.sectionHeader }, "BILL TO"),
          createElement(Text, { style: styles.contactCompany }, clientName || "-"),
          clientAddress
            ? createElement(Text, { style: styles.contactLine }, clientAddress)
            : null,
        ),
        createElement(
          View,
          { style: styles.contactCol },
          createElement(Text, { style: styles.sectionHeader }, "HIRING CONTACT"),
          primaryHiring
            ? createElement(Text, { style: styles.contactName }, primaryHiring.name || "-")
            : createElement(Text, { style: styles.contactLine }, "-"),
          primaryHiring?.title
            ? createElement(Text, { style: styles.contactLine }, primaryHiring.title)
            : null,
          primaryHiring?.email
            ? createElement(Text, { style: styles.contactLine }, primaryHiring.email)
            : null,
        ),
        createElement(
          View,
          { style: styles.contactCol },
          createElement(Text, { style: styles.sectionHeader }, "BILLING CONTACT"),
          primaryBilling
            ? createElement(Text, { style: styles.contactName }, primaryBilling.name || "-")
            : createElement(Text, { style: styles.contactLine }, "-"),
          primaryBilling?.title
            ? createElement(Text, { style: styles.contactLine }, primaryBilling.title)
            : null,
          primaryBilling?.email
            ? createElement(Text, { style: styles.contactLine }, primaryBilling.email)
            : null,
        ),
      ),
      // Placement Summary
      createElement(
        View,
        { style: styles.summary },
        // Retained engagements have no candidate and no start date yet, so
        // the first box names the engagement instead of an empty person and
        // START DATE reads "-" rather than echoing the issue date as though
        // someone had started.
        isRetained
          ? summaryItem("ENGAGEMENT", "Retained search")
          : summaryItem("CANDIDATE", candidateName || "-"),
        summaryItem("ROLE", roleTitle || "-"),
        summaryItem("START DATE", isRetained ? "-" : startDateLabel || "-"),
        summaryItem("PLACEMENT TYPE", isRetained ? "Retained" : "Direct Hire"),
        summaryItem("ACCOUNT EXEC", accountExecName || "-"),
        summaryItem("COMPENSATION", baseSalaryLabel ?? formatUsdCompact(baseSalaryUsd)),
        summaryItem("FEE %", feeSummaryLabel),
        summaryItem("GUARANTEE", guaranteeLabel || "90 days"),
      ),
      // Services table
      createElement(
        View,
        { style: styles.tableHeader },
        createElement(Text, { style: [styles.th, styles.thDesc] }, "DESCRIPTION"),
        createElement(Text, { style: [styles.th, styles.thQty] }, "QTY"),
        createElement(Text, { style: [styles.th, styles.thRate] }, "RATE"),
        createElement(Text, { style: [styles.th, styles.thAmount] }, "AMOUNT"),
      ),
      createElement(
        View,
        { style: styles.tableRow },
        createElement(
          View,
          { style: styles.tdDesc },
          createElement(
            Text,
            { style: styles.tdDescTitle },
            isRetained
              ? `Retained search fee - ${roleTitle || "search"}`
              : `Placement Fee - ${candidateName || "candidate"}`,
          ),
          lineSub ? createElement(Text, { style: styles.tdDescSub }, lineSub) : null,
        ),
        createElement(Text, { style: styles.tdQty }, formatQuantity(lineItemQty)),
        createElement(Text, { style: styles.tdRate }, formatUsd(lineItemRateUsd)),
        createElement(Text, { style: styles.tdAmount }, formatUsd(feeAmountUsd)),
      ),
      // Totals
      createElement(
        View,
        { style: styles.totals },
        createElement(
          View,
          { style: styles.totalRow },
          createElement(Text, { style: styles.totalLabel }, "Subtotal"),
          createElement(Text, { style: styles.totalValue }, formatUsd(feeAmountUsd)),
        ),
        createElement(
          View,
          { style: styles.totalRow },
          createElement(Text, { style: styles.totalLabel }, "Tax"),
          createElement(Text, { style: styles.totalValue }, "-"),
        ),
        createElement(
          View,
          { style: styles.totalDueRow },
          createElement(Text, { style: styles.totalDueLabel }, "Amount Due"),
          createElement(Text, { style: styles.totalDueValue }, formatUsd(feeAmountUsd)),
        ),
      ),
      // Payment Instructions
      createElement(
        View,
        { style: styles.payment },
        createElement(
          Text,
          { style: styles.paymentReference },
          `Please reference ${invoiceNumber} on payment.`,
        ),
        createElement(
          View,
          { style: styles.paymentCols },
          createElement(
            View,
            { style: [styles.paymentCol, styles.paymentAchCol] },
            createElement(Text, { style: styles.paymentHeader }, "ACH / WIRE"),
            createElement(
              Text,
              { style: styles.paymentLine },
              `Beneficiary: ${billing.bankBeneficiary || "-"}`,
            ),
            createElement(
              Text,
              { style: styles.paymentLine },
              `Bank: ${billing.bankName || "-"}`,
            ),
            createElement(
              Text,
              { style: styles.paymentLine },
              `Routing: ${billing.bankRouting || "-"}`,
            ),
            createElement(
              Text,
              { style: styles.paymentLine },
              `Account: ${billing.bankAccount || "-"}`,
            ),
            billing.bankSwift
              ? createElement(
                  Text,
                  { style: styles.paymentLine },
                  `SWIFT: ${billing.bankSwift}`,
                )
              : null,
          ),
          createElement(
            View,
            { style: [styles.paymentCol, styles.paymentCheckCol] },
            createElement(Text, { style: styles.paymentHeader }, "CHECK"),
            createElement(
              Text,
              { style: styles.paymentLine },
              "Payable to:",
            ),
            createElement(
              Text,
              { style: styles.paymentLineBold },
              billing.checkPayableTo || billing.companyName,
            ),
            ...billing.checkMailingAddress
              .split("\n")
              .map((line) => createElement(Text, { style: styles.paymentLine }, line)),
          ),
          createElement(
            View,
            { style: [styles.paymentCol, styles.paymentEinCol] },
            createElement(Text, { style: styles.einHeader }, "EIN"),
            createElement(Text, { style: styles.einValue }, billing.ein || "41-4887871"),
          ),
        ),
      ),
      // Optional Note line (renders only when invoice.notes is set)
      trimmedNotes
        ? createElement(
            View,
            { style: styles.note },
            createElement(Text, { style: styles.noteLabel }, "Note:"),
            createElement(Text, { style: styles.noteBody }, trimmedNotes),
          )
        : null,
      // Footer - bottom-left grey legal name. EIN moved into the cream
      // panel; the prior "Thank you for your business" line was removed
      // per the Ace 43 invoice spec.
      createElement(
        View,
        { style: styles.footer },
        createElement(
          Text,
          { style: styles.footerLine },
          "Kraig Talent LLC dba BreakPoint Talent",
        ),
      ),
    ),
  );
}

function summaryItem(label: string, value: string) {
  return createElement(
    View,
    { style: styles.summaryItem },
    createElement(Text, { style: styles.summaryLabel }, label),
    createElement(Text, { style: styles.summaryValue }, value),
  );
}

export async function renderInvoicePdfBuffer(input: InvoicePdfInput): Promise<Buffer> {
  const element = InvoicePdfDocument(input);
  return renderToBuffer(element);
}
