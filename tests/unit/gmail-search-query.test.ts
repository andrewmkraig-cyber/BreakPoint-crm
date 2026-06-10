// Standalone test for src/lib/gmail-search-query.ts.
//
// Run via: npx tsx tests/unit/gmail-search-query.test.ts

import assert from "node:assert/strict";
import { expandGmailThreadSearchQueries } from "@/lib/gmail-search-query";

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

console.log("gmail search query tests passed");
