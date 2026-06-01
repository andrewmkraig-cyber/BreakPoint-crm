// Server-only PDF invoice template rendered with @react-pdf/renderer.
// One-page US Letter, BreakPoint Talent branded. Charcoal + cream + a
// single brand-green hairline rule under the header. No payment URLs,
// no QR code - ACH/Wire/Check details live in a cream panel two-thirds
// of the way down the page.
//
// Visual order top → bottom:
//   Header band         · company wordmark + address stack ⟂ brand mark + big "Invoice" + INV-NNNN
//   Meta strip          · Issue Date / Due Date / Terms / Amount Due
//   Bill To · Hiring    · billing contact + address ⟂ hiring contact
//   Placement Summary   · candidate / role / start / fee details
//   Services table      · single line item with rate × qty = amount
//   Totals              · right-aligned subtotal + amount due
//   Payment Instructions· four columns: ACH/Wire · Check · EIN · Questions (9pt)
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
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: INK,
    lineHeight: 1.35,
  },
  // --- Header band ---
  // Two-column flex row. Left = company wordmark + address stack.
  // Right = big "Invoice" wordmark + smaller muted INV-NNNN beneath.
  // alignItems:flex-end pins the bottom of the right stack to the bottom
  // of the left stack so the brand-green hairline rule reads as a clean
  // baseline across both columns.
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: BRAND_GREEN,
  },
  brand: { flexDirection: "column", maxWidth: "60%" },
  brandName: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.2,
    color: INK,
    marginBottom: 3,
  },
  brandLine: { fontSize: 9, color: MUTED, marginTop: 1 },
  headerRight: { alignItems: "flex-end" },
  // The "Invoice" wordmark + brand mark sit on a single row, brand
  // mark on the LEFT of "Invoice". Height of the logo matches the
  // wordmark's font size so the two read as one unit.
  invoiceTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandMark: {
    width: 32,
    height: 28,
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
    marginTop: 12,
    paddingVertical: 7,
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
  // --- Bill To / Hiring ---
  twoCol: { flexDirection: "row", marginTop: 14, gap: 24 },
  col: { flex: 1 },
  sectionHeader: {
    fontSize: 8,
    color: BRAND_GREEN_DARK,
    letterSpacing: 1.4,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  contactName: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: INK },
  contactCompany: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: INK,
    marginBottom: 1,
  },
  contactLine: { fontSize: 9, color: INK_700, marginTop: 1 },
  helperLine: { fontSize: 7.5, color: MUTED, marginTop: 6, fontStyle: "italic" },
  // --- Placement Summary ---
  summary: {
    marginTop: 14,
    backgroundColor: CREAM,
    borderRadius: 4,
    padding: 10,
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
    marginTop: 14,
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
    paddingVertical: 8,
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
  totals: { alignItems: "flex-end", marginTop: 10 },
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
  // Tightened cream panel: 9pt body, 10px gap between the 3 columns,
  // smaller paddings. Same content (ACH/Wire · Check · Questions) but
  // ~30% less vertical real estate so the whole invoice stays on one
  // US Letter page.
  payment: {
    marginTop: 14,
    padding: 11,
    backgroundColor: CREAM,
    borderRadius: 4,
  },
  paymentReference: {
    fontSize: 9,
    color: INK,
    fontFamily: "Helvetica-Bold",
    marginBottom: 7,
  },
  paymentCols: { flexDirection: "row", gap: 10 },
  paymentCol: { flex: 1 },
  paymentHeader: {
    fontSize: 7.5,
    color: BRAND_GREEN_DARK,
    letterSpacing: 1.3,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  // EIN column sits between CHECK and BILLING QUESTIONS in the cream
  // panel. Label tracks the other section headers but uses BRAND_GREEN
  // (slightly lighter than BRAND_GREEN_DARK) per the "EIN in green" ask.
  einHeader: {
    fontSize: 7.5,
    color: BRAND_GREEN,
    letterSpacing: 1.3,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  einValue: {
    fontSize: 10,
    color: INK,
    fontFamily: "Helvetica-Bold",
  },
  paymentLine: { fontSize: 9, color: INK_700, marginBottom: 1 },
  paymentLineBold: {
    fontSize: 9,
    color: INK,
    fontFamily: "Helvetica-Bold",
    marginBottom: 1,
  },
  // --- Optional Note line (renders below Payment Instructions when
  // invoice.notes is populated). Small muted single-line label + body
  // so a short memo can ride along without crowding the page chrome.
  note: {
    flexDirection: "row",
    marginTop: 9,
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
    marginTop: 10,
    paddingTop: 7,
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
  roleTitle: string | null;
  candidateName: string;
  clientName: string;
  clientAddress: string;
  startDateLabel: string;
  baseSalaryUsd: number | null;
  feePercentage: number | null;
  // Pre-resolved label for the FEE field. The route decides "%" vs
  // "Min Fee" (flat override / below-minimum) from the placement's fee
  // fields and passes the final string here. When null/undefined the
  // renderer falls back to the bare percentage (or "-").
  feeBasisLabel?: string | null;
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
};

function formatDate(d: Date | null | undefined): string {
  if (!d) return "-";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
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

export function InvoicePdfDocument(props: InvoicePdfInput) {
  const {
    invoiceNumber,
    issueDate,
    dueDate,
    paymentTerms,
    feeAmountUsd,
    roleTitle,
    candidateName,
    clientName,
    clientAddress,
    startDateLabel,
    baseSalaryUsd,
    feePercentage,
    feeBasisLabel,
    accountExecName,
    billingContacts,
    hiringContacts,
    billing,
    clientNote,
  } = props;
  const trimmedNotes = clientNote?.trim() || "";

  const primaryBilling = billingContacts[0];
  const primaryHiring = hiringContacts[0];

  const lineSub = [
    roleTitle ? roleTitle : null,
    startDateLabel ? `Start date ${startDateLabel}` : null,
    feePercentage != null && baseSalaryUsd != null
      ? `${feePercentage}% of ${formatUsdCompact(baseSalaryUsd)} base`
      : null,
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
          createElement(Text, { style: styles.brandName }, billing.companyName),
          createElement(
            Text,
            { style: styles.brandLine },
            `${billing.addressLine1} · ${billing.city}, ${billing.state} ${billing.zip}`,
          ),
          createElement(
            Text,
            { style: styles.brandLine },
            `${billing.arEmail} · ${billing.arPhone} · ${billing.website}`,
          ),
        ),
        createElement(
          View,
          { style: styles.headerRight },
          createElement(
            View,
            { style: styles.invoiceTitleRow },
            BRAND_LOGO_DATA_URI
              ? createElement(Image, {
                  src: BRAND_LOGO_DATA_URI,
                  style: styles.brandMark,
                })
              : null,
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
      // Bill To / Hiring
      createElement(
        View,
        { style: styles.twoCol },
        createElement(
          View,
          { style: styles.col },
          createElement(Text, { style: styles.sectionHeader }, "BILL TO"),
          createElement(Text, { style: styles.contactCompany }, clientName || "-"),
          primaryBilling
            ? createElement(Text, { style: styles.contactLine }, primaryBilling.name || "-")
            : null,
          primaryBilling?.title
            ? createElement(Text, { style: styles.contactLine }, primaryBilling.title)
            : null,
          primaryBilling?.email
            ? createElement(Text, { style: styles.contactLine }, primaryBilling.email)
            : null,
          clientAddress
            ? createElement(Text, { style: styles.contactLine }, clientAddress)
            : null,
        ),
        createElement(
          View,
          { style: styles.col },
          createElement(Text, { style: styles.sectionHeader }, "HIRING CONTACT"),
          primaryHiring
            ? createElement(
                Text,
                { style: styles.contactName },
                primaryHiring.name || "-",
              )
            : createElement(Text, { style: styles.contactLine }, "-"),
          primaryHiring?.title
            ? createElement(Text, { style: styles.contactLine }, primaryHiring.title)
            : null,
          primaryHiring?.email
            ? createElement(Text, { style: styles.contactLine }, primaryHiring.email)
            : null,
          createElement(
            Text,
            { style: styles.helperLine },
            "On invoice for reference. Billing inquiries: Accounts Payable contact above.",
          ),
        ),
      ),
      // Placement Summary
      createElement(
        View,
        { style: styles.summary },
        summaryItem("CANDIDATE", candidateName || "-"),
        summaryItem("ROLE", roleTitle || "-"),
        summaryItem("START DATE", startDateLabel || "-"),
        summaryItem("PLACEMENT TYPE", "Direct Hire"),
        summaryItem("ACCOUNT EXEC", accountExecName || "-"),
        summaryItem("BASE SALARY", formatUsdCompact(baseSalaryUsd)),
        summaryItem(
          "FEE %",
          feeBasisLabel ?? (feePercentage != null ? `${feePercentage}%` : "-"),
        ),
        summaryItem("GUARANTEE", "90 days"),
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
            `Placement Fee - ${candidateName || "candidate"}`,
          ),
          lineSub ? createElement(Text, { style: styles.tdDescSub }, lineSub) : null,
        ),
        createElement(Text, { style: styles.tdQty }, "1"),
        createElement(Text, { style: styles.tdRate }, formatUsd(feeAmountUsd)),
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
            { style: styles.paymentCol },
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
            { style: styles.paymentCol },
            createElement(Text, { style: styles.paymentHeader }, "CHECK"),
            createElement(
              Text,
              { style: styles.paymentLineBold },
              `Payable to: ${billing.checkPayableTo || billing.companyName}`,
            ),
            ...billing.checkMailingAddress
              .split("\n")
              .map((line) => createElement(Text, { style: styles.paymentLine }, line)),
          ),
          createElement(
            View,
            { style: styles.paymentCol },
            createElement(Text, { style: styles.einHeader }, "EIN"),
            createElement(Text, { style: styles.einValue }, billing.ein || "41-4887871"),
          ),
          createElement(
            View,
            { style: styles.paymentCol },
            createElement(Text, { style: styles.paymentHeader }, "BILLING QUESTIONS"),
            createElement(Text, { style: styles.paymentLineBold }, "Accounts Receivable"),
            createElement(Text, { style: styles.paymentLine }, billing.arEmail),
            createElement(Text, { style: styles.paymentLine }, billing.arPhone),
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
