// Server-only PDF invoice template rendered with @react-pdf/renderer.
// One-page US Letter, BreakPoint Talent branded. Charcoal + cream + a
// single brand-green hairline rule under the header. No payment URLs,
// no QR code — ACH/Wire/Check details live in a cream panel two-thirds
// of the way down the page.
//
// Visual order top → bottom:
//   Header band         · logo wordmark + "INVOICE" + INV-NNNN
//   Meta strip          · Issue Date / Due Date / Terms / Amount Due
//   Bill To · Hiring    · billing contact + address ⟂ hiring contact
//   Placement Summary   · candidate / role / start / fee details
//   Services table      · single line item with rate × qty = amount
//   Totals              · right-aligned subtotal + amount due
//   Payment Instructions· three columns: ACH/Wire · Check · Questions
//   Footer              · guarantee clause + EIN + "Thank you."
//
// Helvetica is the @react-pdf built-in — no font fetch needed. Playfair
// Display + Inter from the design tokens require a runtime font fetch
// which we skip in this MVP for reliability; the visual hierarchy is
// preserved via weight + size + color.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { createElement } from "react";

import type { BillingSettings } from "@/lib/billing-settings";
import type { InvoiceContact } from "@/lib/invoices";

const BRAND_GREEN = "#5A9642";
const BRAND_GREEN_DARK = "#3F7030";
const INK = "#111111";
const INK_700 = "#1F2937";
const MUTED = "#6B7280";
const LINE = "#E5E8ED";
const CREAM = "#FAF8F3";

const styles = StyleSheet.create({
  page: {
    paddingTop: 47,
    paddingBottom: 47,
    paddingHorizontal: 50,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: INK,
    lineHeight: 1.4,
  },
  // --- Header band ---
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: BRAND_GREEN,
  },
  brand: { flexDirection: "column", gap: 2 },
  brandName: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.4,
    color: INK,
  },
  brandLine: { fontSize: 9, color: MUTED, marginTop: 2 },
  headerRight: { alignItems: "flex-end" },
  invoiceWord: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: INK,
    letterSpacing: 4,
  },
  invoiceNum: {
    fontSize: 11,
    color: INK_700,
    marginTop: 4,
    fontFamily: "Helvetica-Bold",
  },
  // --- Meta strip ---
  meta: {
    flexDirection: "row",
    marginTop: 18,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },
  metaCol: { flex: 1, paddingRight: 12 },
  metaLabel: {
    fontSize: 7,
    color: MUTED,
    letterSpacing: 1.4,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  metaValue: { fontSize: 11, fontFamily: "Helvetica-Bold", color: INK },
  metaValueAmount: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: INK,
  },
  // --- Bill To / Hiring ---
  twoCol: { flexDirection: "row", marginTop: 22, gap: 28 },
  col: { flex: 1 },
  sectionHeader: {
    fontSize: 8,
    color: BRAND_GREEN_DARK,
    letterSpacing: 1.6,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
  },
  contactName: { fontSize: 11, fontFamily: "Helvetica-Bold", color: INK },
  contactCompany: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: INK,
    marginBottom: 2,
  },
  contactLine: { fontSize: 9.5, color: INK_700, marginTop: 1 },
  helperLine: { fontSize: 8, color: MUTED, marginTop: 10, fontStyle: "italic" },
  // --- Placement Summary ---
  summary: {
    marginTop: 22,
    backgroundColor: CREAM,
    borderRadius: 4,
    padding: 14,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  summaryItem: { width: "25%", paddingVertical: 4, paddingRight: 8 },
  summaryLabel: {
    fontSize: 7,
    color: MUTED,
    letterSpacing: 1.2,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  summaryValue: { fontSize: 10, color: INK, fontFamily: "Helvetica-Bold" },
  // --- Services table ---
  tableHeader: {
    flexDirection: "row",
    marginTop: 22,
    paddingBottom: 6,
    borderBottomWidth: 1.4,
    borderBottomColor: INK,
  },
  th: {
    fontSize: 7,
    color: MUTED,
    letterSpacing: 1.4,
    fontFamily: "Helvetica-Bold",
  },
  thDesc: { flex: 5 },
  thQty: { flex: 1, textAlign: "right" },
  thRate: { flex: 2, textAlign: "right" },
  thAmount: { flex: 2, textAlign: "right" },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    alignItems: "flex-start",
  },
  tdDesc: { flex: 5, paddingRight: 12 },
  tdDescTitle: { fontSize: 11, color: INK, fontFamily: "Helvetica-Bold" },
  tdDescSub: { fontSize: 9, color: MUTED, marginTop: 3 },
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
  totals: { alignItems: "flex-end", marginTop: 14 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 260,
    paddingVertical: 3,
  },
  totalLabel: { fontSize: 10, color: INK_700 },
  totalValue: { fontSize: 10, color: INK, fontFamily: "Helvetica-Bold" },
  totalDueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 260,
    paddingVertical: 8,
    marginTop: 4,
    borderTopWidth: 1.4,
    borderTopColor: INK,
  },
  totalDueLabel: { fontSize: 13, color: INK, fontFamily: "Helvetica-Bold" },
  totalDueValue: { fontSize: 16, color: INK, fontFamily: "Helvetica-Bold" },
  // --- Payment Instructions ---
  payment: {
    marginTop: 22,
    padding: 16,
    backgroundColor: CREAM,
    borderRadius: 4,
  },
  paymentReference: {
    fontSize: 9,
    color: INK,
    fontFamily: "Helvetica-Bold",
    marginBottom: 10,
  },
  paymentCols: { flexDirection: "row", gap: 14 },
  paymentCol: { flex: 1 },
  paymentHeader: {
    fontSize: 8,
    color: BRAND_GREEN_DARK,
    letterSpacing: 1.4,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  paymentLine: { fontSize: 9, color: INK_700, marginBottom: 2 },
  paymentLineBold: {
    fontSize: 9,
    color: INK,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  // --- Footer ---
  footer: {
    marginTop: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: LINE,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  footerLeft: { flex: 1.4, paddingRight: 24 },
  footerRight: { alignItems: "flex-end" },
  footerSmall: { fontSize: 8, color: MUTED, lineHeight: 1.5 },
  footerThanks: {
    fontSize: 10,
    color: INK,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
  },
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
  accountExecName: string;
  billingContacts: InvoiceContact[];
  hiringContacts: InvoiceContact[];
  billing: BillingSettings;
};

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatUsdCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
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
    accountExecName,
    billingContacts,
    hiringContacts,
    billing,
  } = props;

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
          createElement(Text, { style: styles.invoiceWord }, "INVOICE"),
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
          createElement(Text, { style: styles.contactCompany }, clientName || "—"),
          primaryBilling
            ? createElement(Text, { style: styles.contactLine }, primaryBilling.name || "—")
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
                primaryHiring.name || "—",
              )
            : createElement(Text, { style: styles.contactLine }, "—"),
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
        summaryItem("CANDIDATE", candidateName || "—"),
        summaryItem("ROLE", roleTitle || "—"),
        summaryItem("START DATE", startDateLabel || "—"),
        summaryItem("PLACEMENT TYPE", "Direct Hire"),
        summaryItem("ACCOUNT EXEC", accountExecName || "—"),
        summaryItem("BASE SALARY", formatUsdCompact(baseSalaryUsd)),
        summaryItem("FEE %", feePercentage != null ? `${feePercentage}%` : "—"),
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
            `Placement Fee — ${candidateName || "candidate"}`,
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
          createElement(Text, { style: styles.totalValue }, "—"),
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
              `Beneficiary: ${billing.bankBeneficiary || "—"}`,
            ),
            createElement(
              Text,
              { style: styles.paymentLine },
              `Bank: ${billing.bankName || "—"}`,
            ),
            createElement(
              Text,
              { style: styles.paymentLine },
              `Routing: ${billing.bankRouting || "—"}`,
            ),
            createElement(
              Text,
              { style: styles.paymentLine },
              `Account: ${billing.bankAccount || "—"}`,
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
            createElement(Text, { style: styles.paymentHeader }, "BILLING QUESTIONS"),
            createElement(Text, { style: styles.paymentLineBold }, "Accounts Receivable"),
            createElement(Text, { style: styles.paymentLine }, billing.arEmail),
            createElement(Text, { style: styles.paymentLine }, billing.arPhone),
          ),
        ),
      ),
      // Footer
      createElement(
        View,
        { style: styles.footer },
        createElement(
          View,
          { style: styles.footerLeft },
          createElement(Text, { style: styles.footerSmall }, billing.guaranteeClause),
        ),
        createElement(
          View,
          { style: styles.footerRight },
          billing.ein
            ? createElement(Text, { style: styles.footerSmall }, `EIN ${billing.ein}`)
            : null,
          createElement(Text, { style: styles.footerThanks }, "Thank you."),
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
