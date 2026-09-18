// Server-only PDF templates for the two consulting invoices, rendered with
// @react-pdf/renderer like src/lib/invoice-pdf.tsx. Each company has its
// own document because the two source invoices are laid out differently
// and the point is to match each one exactly, not to share chrome.
//
// Arfie Management LLC
//   Black header bar: company / address / EIN on the left, INVOICE with
//   number / date / terms on the right. BILL TO block, a two-column
//   Description / Amount table, Total Due, and a one-line sign-off. No
//   bank or remit information.
//
// Branzino Holdings LLC
//   Light gray header bar with the company in caps. BILL TO on the left
//   beside an INVOICE NO. / INVOICE DATE / TERMS / DUE DATE key-value
//   block. A three-column Description / Service Period / Amount table,
//   Subtotal + Payments/Credits + TOTAL DUE, then a REMIT TO bank block
//   and the "Please reference Invoice No." line.
//
// Colors here are literal because this is a printed document, not a Court
// Mode surface, the same as invoice-pdf.tsx. Helvetica is the @react-pdf
// built-in so no font fetch is needed on Vercel.

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { createElement } from "react";

import {
  CONSULTING_COMPANIES,
  type ConsultingCompanyKey,
  formatConsultingDateLong,
  formatConsultingDateShort,
  formatConsultingInvoiceNumber,
  formatConsultingUsd,
} from "@/lib/consulting-invoices-shared";

const INK = "#111111";
const INK_700 = "#1F2937";
const MUTED = "#6B7280";
const LINE = "#D9DDE3";
const BLACK_BAR = "#111111";
const GRAY_BAR = "#EEF0F3";
const GRAY_PANEL = "#F4F5F7";
const WHITE = "#FFFFFF";

export type ConsultingInvoicePdfInput = {
  company: ConsultingCompanyKey;
  invoiceNumber: number;
  amountUsd: number;
  // YYYY-MM-DD
  invoiceDate: string;
  dueDate: string;
  // Branzino only. Both or neither.
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
};

export const BRANZINO_REMIT_TO: Array<[string, string]> = [
  ["Bank", "JPMorgan Chase Bank, N.A."],
  ["Account Name", "Branzino Holdings LLC"],
  ["Account Number", "687698673"],
  ["Wire Routing (ABA)", "021000021"],
  ["ACH Routing (ABA)", "322271627"],
];

const arfie = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: INK,
    lineHeight: 1.4,
    paddingBottom: 40,
  },
  headerBar: {
    backgroundColor: BLACK_BAR,
    color: WHITE,
    paddingVertical: 26,
    paddingHorizontal: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerLeft: { flexDirection: "column" },
  headerRight: { flexDirection: "column", alignItems: "flex-end" },
  companyName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: WHITE, marginBottom: 4 },
  headerLine: { fontSize: 9.5, color: WHITE, marginTop: 1 },
  invoiceWord: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    color: WHITE,
    letterSpacing: 1,
    lineHeight: 1,
    marginBottom: 8,
  },
  body: { paddingHorizontal: 48, paddingTop: 30 },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: MUTED,
    marginBottom: 5,
  },
  billToLine: { fontSize: 10.5, color: INK, marginTop: 1 },
  billToName: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: INK },
  tableHeader: {
    flexDirection: "row",
    marginTop: 30,
    paddingBottom: 6,
    borderBottomWidth: 1.2,
    borderBottomColor: INK,
  },
  th: { fontSize: 9, fontFamily: "Helvetica-Bold", color: INK },
  thDesc: { flex: 5 },
  thAmount: { flex: 2, textAlign: "right" },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },
  tdDesc: { flex: 5, fontSize: 10.5, color: INK },
  tdAmount: { flex: 2, textAlign: "right", fontSize: 10.5, color: INK },
  totals: { alignItems: "flex-end", marginTop: 14 },
  totalDueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 220,
    paddingVertical: 6,
    borderTopWidth: 1.2,
    borderTopColor: INK,
  },
  totalDueLabel: { fontSize: 12, fontFamily: "Helvetica-Bold", color: INK },
  totalDueValue: { fontSize: 12, fontFamily: "Helvetica-Bold", color: INK },
  signOff: { marginTop: 36, fontSize: 9.5, color: INK_700 },
});

const branzino = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: INK,
    lineHeight: 1.4,
    paddingBottom: 40,
  },
  headerBar: {
    backgroundColor: GRAY_BAR,
    paddingVertical: 26,
    paddingHorizontal: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerLeft: { flexDirection: "column" },
  companyName: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.2,
    color: INK,
    marginBottom: 4,
  },
  headerLine: { fontSize: 9.5, color: INK_700, marginTop: 1 },
  invoiceWord: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    color: INK,
    letterSpacing: 1,
    lineHeight: 1,
  },
  body: { paddingHorizontal: 48, paddingTop: 28 },
  metaGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 24,
  },
  billTo: { flex: 1.2 },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: MUTED,
    marginBottom: 5,
  },
  billToLine: { fontSize: 10.5, color: INK, marginTop: 1 },
  billToName: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: INK },
  kv: { flex: 1, flexDirection: "column" },
  kvRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  kvKey: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1.2, color: MUTED },
  kvValue: { fontSize: 10, color: INK, textAlign: "right" },
  tableHeader: {
    flexDirection: "row",
    marginTop: 28,
    paddingBottom: 6,
    borderBottomWidth: 1.2,
    borderBottomColor: INK,
  },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1.2, color: INK },
  thDesc: { flex: 3 },
  thPeriod: { flex: 3 },
  thAmount: { flex: 2, textAlign: "right" },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },
  tdDesc: { flex: 3, fontSize: 10.5, color: INK },
  tdPeriod: { flex: 3, fontSize: 10, color: INK_700 },
  tdAmount: { flex: 2, textAlign: "right", fontSize: 10.5, color: INK },
  totals: { alignItems: "flex-end", marginTop: 12 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 240,
    paddingVertical: 2,
  },
  totalLabel: { fontSize: 10, color: INK_700 },
  totalValue: { fontSize: 10, color: INK },
  totalDueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 240,
    paddingVertical: 6,
    marginTop: 4,
    borderTopWidth: 1.2,
    borderTopColor: INK,
  },
  totalDueLabel: { fontSize: 11, fontFamily: "Helvetica-Bold", letterSpacing: 1, color: INK },
  totalDueValue: { fontSize: 12, fontFamily: "Helvetica-Bold", color: INK },
  remit: {
    marginTop: 30,
    padding: 12,
    backgroundColor: GRAY_PANEL,
    borderRadius: 4,
  },
  remitRow: { flexDirection: "row", paddingVertical: 2 },
  remitKey: { width: 130, fontSize: 9.5, color: INK_700 },
  remitValue: { flex: 1, fontSize: 9.5, fontFamily: "Helvetica-Bold", color: INK },
  reference: { marginTop: 16, fontSize: 9.5, color: INK_700 },
});

const el = createElement;

function ArfieDocument(input: ConsultingInvoicePdfInput) {
  const co = CONSULTING_COMPANIES.arfie;
  const amount = formatConsultingUsd(input.amountUsd);
  return el(
    Document,
    {},
    el(
      Page,
      { size: "LETTER", style: arfie.page },
      el(
        View,
        { style: arfie.headerBar },
        el(
          View,
          { style: arfie.headerLeft },
          el(Text, { style: arfie.companyName }, co.name),
          ...co.addressLines.map((line) => el(Text, { style: arfie.headerLine }, line)),
          el(Text, { style: arfie.headerLine }, `EIN: ${co.ein}`),
        ),
        el(
          View,
          { style: arfie.headerRight },
          el(Text, { style: arfie.invoiceWord }, "INVOICE"),
          el(Text, { style: arfie.headerLine }, `Invoice #: ${input.invoiceNumber}`),
          el(Text, { style: arfie.headerLine }, `Date: ${formatConsultingDateLong(input.invoiceDate)}`),
          el(Text, { style: arfie.headerLine }, `Terms: ${co.terms}`),
        ),
      ),
      el(
        View,
        { style: arfie.body },
        el(Text, { style: arfie.sectionLabel }, "BILL TO"),
        ...co.billToLines.map((line, i) =>
          el(Text, { style: i === 0 ? arfie.billToName : arfie.billToLine }, line),
        ),
        el(
          View,
          { style: arfie.tableHeader },
          el(Text, { style: [arfie.th, arfie.thDesc] }, "Description"),
          el(Text, { style: [arfie.th, arfie.thAmount] }, "Amount"),
        ),
        el(
          View,
          { style: arfie.tableRow },
          el(Text, { style: arfie.tdDesc }, "Consulting Fee"),
          el(Text, { style: arfie.tdAmount }, amount),
        ),
        el(
          View,
          { style: arfie.totals },
          el(
            View,
            { style: arfie.totalDueRow },
            el(Text, { style: arfie.totalDueLabel }, "Total Due:"),
            el(Text, { style: arfie.totalDueValue }, amount),
          ),
        ),
        el(Text, { style: arfie.signOff }, "Payment due upon receipt. Thank you."),
      ),
    ),
  );
}

function BranzinoDocument(input: ConsultingInvoicePdfInput) {
  const co = CONSULTING_COMPANIES.branzino;
  const number = formatConsultingInvoiceNumber("branzino", input.invoiceNumber);
  const amount = formatConsultingUsd(input.amountUsd);
  const period =
    input.servicePeriodStart && input.servicePeriodEnd
      ? `${formatConsultingDateShort(input.servicePeriodStart)} - ${formatConsultingDateShort(input.servicePeriodEnd)}`
      : "";
  return el(
    Document,
    {},
    el(
      Page,
      { size: "LETTER", style: branzino.page },
      el(
        View,
        { style: branzino.headerBar },
        el(
          View,
          { style: branzino.headerLeft },
          el(Text, { style: branzino.companyName }, co.name.toUpperCase()),
          ...co.addressLines.map((line) => el(Text, { style: branzino.headerLine }, line)),
          el(Text, { style: branzino.headerLine }, `EIN ${co.ein}`),
        ),
        el(Text, { style: branzino.invoiceWord }, "INVOICE"),
      ),
      el(
        View,
        { style: branzino.body },
        el(
          View,
          { style: branzino.metaGrid },
          el(
            View,
            { style: branzino.billTo },
            el(Text, { style: branzino.sectionLabel }, "BILL TO"),
            ...co.billToLines.map((line, i) =>
              el(Text, { style: i === 0 ? branzino.billToName : branzino.billToLine }, line),
            ),
          ),
          el(
            View,
            { style: branzino.kv },
            kvRow("INVOICE NO.", number),
            kvRow("INVOICE DATE", formatConsultingDateLong(input.invoiceDate)),
            kvRow("TERMS", co.terms),
            kvRow("DUE DATE", formatConsultingDateLong(input.dueDate)),
          ),
        ),
        el(
          View,
          { style: branzino.tableHeader },
          el(Text, { style: [branzino.th, branzino.thDesc] }, "DESCRIPTION"),
          el(Text, { style: [branzino.th, branzino.thPeriod] }, "SERVICE PERIOD"),
          el(Text, { style: [branzino.th, branzino.thAmount] }, "AMOUNT"),
        ),
        el(
          View,
          { style: branzino.tableRow },
          el(Text, { style: branzino.tdDesc }, "Consulting Fee"),
          el(Text, { style: branzino.tdPeriod }, period),
          el(Text, { style: branzino.tdAmount }, amount),
        ),
        el(
          View,
          { style: branzino.totals },
          el(
            View,
            { style: branzino.totalRow },
            el(Text, { style: branzino.totalLabel }, "Subtotal"),
            el(Text, { style: branzino.totalValue }, amount),
          ),
          el(
            View,
            { style: branzino.totalRow },
            el(Text, { style: branzino.totalLabel }, "Payments/Credits"),
            el(Text, { style: branzino.totalValue }, formatConsultingUsd(0)),
          ),
          el(
            View,
            { style: branzino.totalDueRow },
            el(Text, { style: branzino.totalDueLabel }, "TOTAL DUE"),
            el(Text, { style: branzino.totalDueValue }, amount),
          ),
        ),
        el(
          View,
          { style: branzino.remit },
          el(Text, { style: branzino.sectionLabel }, "REMIT TO"),
          ...BRANZINO_REMIT_TO.map(([k, v]) =>
            el(
              View,
              { style: branzino.remitRow },
              el(Text, { style: branzino.remitKey }, k),
              el(Text, { style: branzino.remitValue }, v),
            ),
          ),
        ),
        el(
          Text,
          { style: branzino.reference },
          `Please reference Invoice No. ${number} on all remittances.`,
        ),
      ),
    ),
  );
}

function kvRow(key: string, value: string) {
  return el(
    View,
    { style: branzino.kvRow },
    el(Text, { style: branzino.kvKey }, key),
    el(Text, { style: branzino.kvValue }, value),
  );
}

export function ConsultingInvoicePdfDocument(input: ConsultingInvoicePdfInput) {
  return input.company === "arfie" ? ArfieDocument(input) : BranzinoDocument(input);
}

export async function renderConsultingInvoicePdfBuffer(
  input: ConsultingInvoicePdfInput,
): Promise<Buffer> {
  return renderToBuffer(ConsultingInvoicePdfDocument(input));
}

export function consultingInvoicePdfFilename(input: ConsultingInvoicePdfInput): string {
  const co = CONSULTING_COMPANIES[input.company];
  const number = formatConsultingInvoiceNumber(input.company, input.invoiceNumber).replace(
    "#",
    "",
  );
  const slug = co.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug}-Invoice-${number}.pdf`;
}
