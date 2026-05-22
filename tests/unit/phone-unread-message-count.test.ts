// Standalone test for phoneUnreadMessageCount in src/lib/badge-math.ts -
// the contract that the Phone NOTIFICATION badge counts unread inbound
// SMS *messages*, not unique conversations. This is THE regression: the
// badge used to collapse N texts from one sender into a single unread
// conversation and stick at 1.
//
// Run via: npx tsx tests/unit/phone-unread-message-count.test.ts
// Exits non-zero on the first assertion failure so verify scripts catch
// regressions without bringing in a test framework.

import { phoneUnreadMessageCount, type SmsUnreadRow } from "@/lib/badge-math";

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
}

// 1. THE BUG: 3 unread inbound texts from the SAME sender are 3
// notification items, so the count is 3 - not 1 (the old conversation-
// collapse result). The rows carry no sender field here precisely
// because message-count must NOT group by sender.
const sameSender: SmsUnreadRow[] = [
  { direction: "inbound", isRead: false },
  { direction: "inbound", isRead: false },
  { direction: "inbound", isRead: false },
];
assert(
  phoneUnreadMessageCount(sameSender) === 3,
  "3 unread inbound texts from one sender -> 3 (not collapsed to 1)",
);

// 2. Outbound and already-read rows never inflate the count - only
// unread inbound messages are notification items.
const mixed: SmsUnreadRow[] = [
  { direction: "inbound", isRead: false }, // counts
  { direction: "inbound", isRead: false }, // counts
  { direction: "inbound", isRead: true }, // read -> excluded
  { direction: "outbound", isRead: false }, // outbound -> excluded
];
assert(
  phoneUnreadMessageCount(mixed) === 2,
  "mixed rows -> only unread inbound counted (2)",
);

// 3. No unread inbound messages -> 0 (a real cleared state).
assert(
  phoneUnreadMessageCount([]) === 0,
  "no rows -> 0",
);
assert(
  phoneUnreadMessageCount([
    { direction: "outbound", isRead: false },
    { direction: "inbound", isRead: true },
  ]) === 0,
  "only outbound/read rows -> 0",
);

console.log(`PASS: phone-unread-message-count (${passed} assertions)`);
