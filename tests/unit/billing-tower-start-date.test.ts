// The Billing Tower books a placement's money in the quarter the candidate
// STARTED, not the quarter the invoice falls due (Andrew, 2026-09-22).
// David Foreman: $70,000 x 10% at Solutionwhere on Net 10 terms, started
// September 21, invoice due October 1. The tower read him in Q4; the deal
// happened in Q3. scheduledAt (when the money arrives) is kept for the
// Cash Forecast; bookedAt (placement start) is what the tower windows on.
//
//   npx tsx tests/unit/billing-tower-start-date.test.ts
import assert from "node:assert/strict";
import Module from "node:module";
import { Prisma } from "@prisma/client";

// billing-events.ts opens with `import "server-only"`, a Next.js guard that
// throws outside the server bundle. Resolve it to an empty module for this
// pure test, the same way Next's own test setups stub it.
type ResolveFn = (request: string, ...rest: unknown[]) => string;
const moduleWithResolver = Module as unknown as { _resolveFilename: ResolveFn };
const originalResolve = moduleWithResolver._resolveFilename;
moduleWithResolver._resolveFilename = function (request: string, ...rest: unknown[]) {
  // Any real file that exports nothing useful will do; this test file
  // itself is already loaded, so pointing at it yields an empty module.
  if (request === "server-only") return __filename;
  return originalResolve.call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const billing = require("../../src/lib/billing-events") as typeof import("../../src/lib/billing-events");
const { expandPlacementBillingEvents, expandRetainedInvoiceEvents } = billing;
type PlacementForBilling = import("../../src/lib/billing-events").PlacementForBilling;

const d = (iso: string) => new Date(iso);
const day = (x: Date) => x.toISOString().slice(0, 10);

const davidBase: PlacementForBilling = {
  id: "david",
  retainedSearchId: null,
  feeTotal: 5000,
  expectedStartDate: d("2026-09-21T00:00:00Z"),
  placedAt: d("2026-09-15T20:43:31Z"),
  startConfirmedAt: d("2026-09-22T12:01:33Z"),
  useCustomTerms: false,
  inst1Amount: null,
  inst1DaysAfterStart: null,
  inst2Amount: null,
  inst2DaysAfterStart: null,
  inst3Amount: null,
  inst3DaysAfterStart: null,
  invoices: [],
};

// --- Branch 1: a SENT invoice due next quarter books on the start date ---
{
  const events = expandPlacementBillingEvents({
    ...davidBase,
    invoices: [
      {
        id: "INV-1068",
        status: "SENT",
        feeAmount: new Prisma.Decimal("5000"),
        dueDate: d("2026-10-01T00:00:00Z"),
        sentAt: d("2026-09-22T12:02:39Z"),
        paidAt: null,
        isFuture: false,
        createdAt: d("2026-09-22T12:01:33Z"),
      },
    ],
  });
  assert.equal(events.length, 1);
  assert.equal(day(events[0].scheduledAt), "2026-10-01", "cash still expected on the due date");
  assert.equal(day(events[0].bookedAt), "2026-09-21", "but the deal books on the start date");
  assert.equal(events[0].amountCents, 500_000);
}

// --- Branch 1: a PAID invoice books on the start date too, not paidAt ---
{
  const events = expandPlacementBillingEvents({
    ...davidBase,
    invoices: [
      {
        id: "INV-1068",
        status: "PAID",
        feeAmount: new Prisma.Decimal("5000"),
        dueDate: d("2026-10-01T00:00:00Z"),
        sentAt: d("2026-09-22T12:02:39Z"),
        paidAt: d("2026-10-06T15:00:00Z"),
        isFuture: false,
        createdAt: d("2026-09-22T12:01:33Z"),
      },
    ],
  });
  assert.equal(day(events[0].bookedAt), "2026-09-21");
  assert.equal(day(events[0].paidAt as Date), "2026-10-06");
}

// --- Branch 2: installments spread the CASH but book together at start ---
{
  const events = expandPlacementBillingEvents({
    ...davidBase,
    feeTotal: 30000,
    useCustomTerms: true,
    inst1Amount: 10000,
    inst1DaysAfterStart: 0,
    inst2Amount: 10000,
    inst2DaysAfterStart: 30,
    inst3Amount: 10000,
    inst3DaysAfterStart: 60,
  });
  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((e) => day(e.scheduledAt)),
    ["2026-09-21", "2026-10-21", "2026-11-20"],
    "cash lands on the installment schedule",
  );
  assert.deepEqual(
    events.map((e) => day(e.bookedAt)),
    ["2026-09-21", "2026-09-21", "2026-09-21"],
    "every installment books in the start quarter",
  );
}

// --- Branch 3: flat fee, no invoice yet, books and lands on the start ---
{
  const events = expandPlacementBillingEvents(davidBase);
  assert.equal(events.length, 1);
  assert.equal(day(events[0].scheduledAt), "2026-09-21");
  assert.equal(day(events[0].bookedAt), "2026-09-21");
  assert.equal(events[0].source, "fee_total");
}

// --- Earliest-wins anchor still applies: a late confirmation cannot push
//     the booking into the next quarter -------------------------------------
{
  const events = expandPlacementBillingEvents({
    ...davidBase,
    startConfirmedAt: d("2026-10-10T14:00:00Z"),
    invoices: [
      {
        id: "INV-late",
        status: "SENT",
        feeAmount: new Prisma.Decimal("5000"),
        dueDate: d("2026-10-20T00:00:00Z"),
        sentAt: d("2026-10-10T14:05:00Z"),
        paidAt: null,
        isFuture: false,
        createdAt: d("2026-10-10T14:00:00Z"),
      },
    ],
  });
  assert.equal(day(events[0].bookedAt), "2026-09-21");
}

// --- A retained invoice has no start date, so it books when it is due ---
{
  const events = expandRetainedInvoiceEvents([
    {
      id: "INV-ret",
      retainedSearchId: "rs1",
      status: "SENT",
      feeAmount: new Prisma.Decimal("12500"),
      dueDate: d("2026-10-01T00:00:00Z"),
      sentAt: d("2026-09-22T12:02:39Z"),
      paidAt: null,
      isFuture: false,
      createdAt: d("2026-09-22T12:01:33Z"),
    },
  ]);
  assert.equal(events.length, 1);
  assert.equal(day(events[0].bookedAt), "2026-10-01");
  assert.equal(day(events[0].scheduledAt), "2026-10-01");
}

// --- A placement that filled a retained search still contributes nothing ---
assert.equal(
  expandPlacementBillingEvents({ ...davidBase, retainedSearchId: "rs1" }).length,
  0,
);

console.log("billing-tower-start-date: all assertions passed");
