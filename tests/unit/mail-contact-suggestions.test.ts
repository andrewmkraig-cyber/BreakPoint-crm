// Standalone test for src/lib/mail-contact-suggestions.ts.
//
// Run via: npx tsx tests/unit/mail-contact-suggestions.test.ts

import {
  rankMailContactSuggestions,
  scoreMailContactSuggestion,
  type MailContactSuggestion,
} from "@/lib/mail-contact-suggestions";

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
}

const aceNameMatches: MailContactSuggestion[] = [
  "Rebecca Adams",
  "Reed Baker",
  "Regina Clark",
  "Remy Diaz",
  "Renee Evans",
  "Rex Foster",
  "Reilly Grant",
].map((name, i) => ({
  name,
  email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
  source: "ace" as const,
  sourceIndex: i,
}));

const receipts: MailContactSuggestion = {
  name: "",
  email: "receipts@mercury.com",
  source: "gmail",
  sourceIndex: 0,
};

const rankedRec = rankMailContactSuggestions(
  [...aceNameMatches, receipts],
  "rec",
);
assert(
  rankedRec[0]?.email === "receipts@mercury.com",
  "local-part prefix beats ACE display-name prefixes for 'rec'",
);

const visibleEmails = rankedRec.slice(0, 8).map((s) => s.email);
assert(
  visibleEmails.includes("receipts@mercury.com"),
  "receipts@mercury.com remains visible in the expanded dropdown",
);

assert(
  scoreMailContactSuggestion("", "receipts@mercury.com", "mer").matchKind ===
    "domainPrefix",
  "typing the Mercury domain is recognized as a domain-prefix match",
);

const sameLocalRank = rankMailContactSuggestions(
  [
    {
      name: "Ace Receipt",
      email: "receipts@client.example",
      source: "ace",
      sourceIndex: 0,
    },
    receipts,
  ],
  "receipts",
);
assert(
  sameLocalRank[0]?.email === "receipts@mercury.com",
  "sent-history address wins same local-prefix tie",
);

console.log(`PASS: mail contact suggestions (${passed} assertions)`);
