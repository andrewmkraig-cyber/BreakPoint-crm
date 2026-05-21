// Standalone test for src/lib/badge-math.ts - the reliability rule that
// keeps an unavailable Gmail count from zeroing the PWA app badge and
// knocking a known-good 4 down to 1 on a new text.
//
// Run via: npx tsx tests/unit/badge-count.test.ts
// Exits non-zero on the first assertion failure so verify scripts catch
// regressions without bringing in a test framework.

import { computeBadgeCount, badgePayloadFields } from "@/lib/badge-math";

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
}

// 1. THE BUG: Gmail unavailable (mailUnread null) + 1 unread text must
// NOT produce badgeCount 1. It must be null so the push omits it and the
// SW leaves the existing app badge (e.g. 4) untouched.
assert(
  computeBadgeCount({ mailUnread: null, phoneUnread: 1 }) === null,
  "unavailable Gmail + phone 1 -> badgeCount null (NOT 1)",
);

// 2. Both reliable: 5 mail + 1 phone -> 6.
assert(
  computeBadgeCount({ mailUnread: 5, phoneUnread: 1 }) === 6,
  "mail 5 + phone 1 -> badgeCount 6",
);

// 3. A genuine zero on both sides is a real 0 (clear the badge),
// distinct from unavailable.
assert(
  computeBadgeCount({ mailUnread: 0, phoneUnread: 0 }) === 0,
  "mail 0 + phone 0 -> badgeCount 0",
);

// 4. Phone count unavailable also makes the badge unprovable.
assert(
  computeBadgeCount({ mailUnread: 5, phoneUnread: null }) === null,
  "mail 5 + phone unavailable -> badgeCount null",
);

// 5. badgePayloadFields OMITS the badge fields entirely when unreliable,
// so the push payload literally has no badgeCount key (cannot send 1).
const omitted = badgePayloadFields({
  mailUnread: null,
  phoneUnread: 1,
  badgeCount: null,
});
assert(
  !("badgeCount" in omitted),
  "unreliable -> payload omits badgeCount (no badgeCount: 1)",
);

// 6. badgePayloadFields carries the real total when reliable.
const included = badgePayloadFields({
  mailUnread: 5,
  phoneUnread: 1,
  badgeCount: 6,
});
assert(
  "badgeCount" in included &&
    (included as { badgeCount: number }).badgeCount === 6,
  "reliable -> payload carries badgeCount 6",
);

console.log(`PASS: badge-count reliability (${passed} assertions)`);
