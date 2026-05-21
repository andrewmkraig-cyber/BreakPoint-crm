// Standalone test for src/lib/quo-phone.ts - the object-tolerant phone
// extraction that keeps Quo inbound SMS pushes from silently dropping
// when data.object.from arrives as an object instead of a string.
//
// Run via: npx tsx tests/unit/quo-phone-extract.test.ts
// Exits non-zero on the first assertion failure so verify scripts catch
// regressions without bringing in a test framework.

import { pickPhone, redactPhone } from "@/lib/quo-phone";

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
}

// The exact path list the webhook passes for the inbound from-number.
const FROM_PATHS = ["data.object.from", "from_number", "from"];

// 1. Bare string at data.object.from (the existing happy path).
assert(
  pickPhone({ data: { object: { from: "+15551234567" } } }, FROM_PATHS) ===
    "+15551234567",
  "string data.object.from resolves",
);

// 2. Numeric value coerces to string (pickStr parity).
assert(
  pickPhone({ data: { object: { from: 15551234567 } } }, FROM_PATHS) ===
    "15551234567",
  "numeric data.object.from coerces to string",
);

// 3. THE BUG: object-shaped from nested under data.object now reaches the
// push gate (resolves to a truthy fromNumber) instead of being dropped.
for (const key of ["number", "phoneNumber", "phone_number", "e164", "value"]) {
  assert(
    pickPhone(
      { data: { object: { from: { [key]: "+15551234567" } } } },
      FROM_PATHS,
    ) === "+15551234567",
    `object data.object.from via "${key}" resolves`,
  );
}

// 4. Top-level fallback paths still work (legacy / alt-shape events).
assert(
  pickPhone({ from: "+15550009999" }, FROM_PATHS) === "+15550009999",
  "top-level from fallback resolves",
);

// 5. Missing / empty values resolve to undefined so the route logs the
// "fromNumber missing, push skipped" reason instead of silently passing.
assert(
  pickPhone({ data: { object: {} } }, FROM_PATHS) === undefined,
  "missing from is undefined",
);
assert(
  pickPhone({ data: { object: { from: "" } } }, FROM_PATHS) === undefined,
  "empty-string from is undefined",
);
assert(
  pickPhone({ data: { object: { from: {} } } }, FROM_PATHS) === undefined,
  "empty-object from is undefined",
);

// 6. redactPhone never emits the full number.
const full = "+15551234567";
const red = redactPhone(full);
assert(!red.includes(full), "redactPhone does not contain the full number");
assert(red === "...4567", `redactPhone shows last 4 only (got ${red})`);
assert(redactPhone(undefined) === "(none)", "redactPhone(undefined) is (none)");

console.log(`PASS: quo-phone extraction (${passed} assertions)`);
