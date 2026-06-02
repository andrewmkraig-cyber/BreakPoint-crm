// Standalone guard for public/sw.js's iOS push contract.
//
// Run via: npx tsx tests/unit/service-worker-push-contract.test.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("public/sw.js"), "utf8");

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
}

// Syntax check the raw worker script. new Function parses without running it.
try {
  new Function(source);
  passed++;
} catch (err) {
  console.error("FAIL: service worker script must parse");
  console.error(err);
  process.exit(1);
}

assert(
  source.includes('const CACHE_NAME = "ace-shell-v13";'),
  "service worker version is bumped for activation",
);

assert(
  !source.includes("if (!event.data) return;"),
  "push handler must not silently return on missing payload data",
);

assert(
  !source.includes("aceFocused") && !source.includes("visibilityState === \"visible\""),
  "push handler must not suppress notifications for focused/visible clients",
);

assert(
  source.includes("readPushData(event)") &&
    source.includes("self.registration.showNotification(data.title"),
  "push handler parses fallback payloads and calls showNotification",
);

assert(
  source.includes("await applyBadge(n)") &&
    source.includes("const total = await fetchUnreadTotal()"),
  "push handler updates badge from payload or live unread fallback",
);

console.log(`PASS: service-worker push contract (${passed} assertions)`);
