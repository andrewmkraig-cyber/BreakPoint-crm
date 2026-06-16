// Standalone test for src/lib/gmail-search-query.ts.
//
// Run via: npx tsx tests/unit/gmail-search-query.test.ts

import assert from "node:assert/strict";
import {
  buildSentRecipientDomainSearchQueries,
  expandGmailThreadSearchQueries,
} from "@/lib/gmail-search-query";

assert.deepEqual(
  expandGmailThreadSearchQueries("zoom info"),
  ["zoom info", "zoominfo"],
  "plain two-word searches also try the compact brand form",
);

assert.deepEqual(
  expandGmailThreadSearchQueries("  Zoom Info  "),
  ["Zoom Info", "ZoomInfo"],
  "query trimming preserves user casing while compacting spaces",
);

assert.deepEqual(
  expandGmailThreadSearchQueries("from:hector zoom info"),
  ["from:hector zoom info"],
  "advanced Gmail operators are not rewritten",
);

assert.deepEqual(
  expandGmailThreadSearchQueries('"zoom info"'),
  ['"zoom info"'],
  "quoted phrases are not rewritten",
);

assert.deepEqual(
  expandGmailThreadSearchQueries("zoom OR info"),
  ["zoom OR info"],
  "boolean-style queries are not compacted",
);

assert.deepEqual(expandGmailThreadSearchQueries("zoominfo"), ["zoominfo"]);
assert.deepEqual(expandGmailThreadSearchQueries(""), []);

assert.deepEqual(
  expandGmailThreadSearchQueries("elgin", [
    "elginpower.com",
    "to:elginpower.com",
    "elginpower.com",
  ]),
  ["elgin", "elginpower.com", "to:elginpower.com"],
  "extra Gmail search queries are deduped after the raw query",
);

assert.deepEqual(
  buildSentRecipientDomainSearchQueries("elgin", [
    { email: "austin.hall@elginpower.com" },
    { email: "dan.bowling@elginpower.com" },
  ]),
  [
    "elginpower.com",
    "to:elginpower.com",
    "cc:elginpower.com",
    "bcc:elginpower.com",
    "from:elginpower.com",
  ],
  "plain searches expand through matching sent-recipient domains",
);

assert.deepEqual(
  buildSentRecipientDomainSearchQueries("elgin power", [
    { email: "austin.hall@elginpower.com" },
  ]),
  [
    "elginpower.com",
    "to:elginpower.com",
    "cc:elginpower.com",
    "bcc:elginpower.com",
    "from:elginpower.com",
  ],
  "two-word company searches can match compact domains",
);

assert.deepEqual(
  buildSentRecipientDomainSearchQueries("dan", [
    { email: "dan.bowling@elginpower.com" },
  ]),
  [],
  "person-name searches do not expand to unrelated domains",
);

assert.deepEqual(
  buildSentRecipientDomainSearchQueries("from:elgin", [
    { email: "austin.hall@elginpower.com" },
  ]),
  [],
  "advanced Gmail searches are not domain-expanded",
);

console.log("gmail search query tests passed");
