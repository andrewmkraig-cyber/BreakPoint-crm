import assert from "node:assert/strict";
import { buildSmartGreeting } from "../../src/lib/merge-fields";

assert.equal(
  buildSmartGreeting([{ name: "Jane Smith", email: "jane@example.com" }]),
  "Hi Jane,",
);

assert.equal(
  buildSmartGreeting([
    { name: "Jane Smith", email: "jane@example.com" },
    { name: "Tom Brown", email: "tom@example.com" },
  ]),
  "Hi Jane and Tom,",
);

assert.equal(
  buildSmartGreeting([
    { name: "Jane Smith", email: "jane@example.com" },
    { name: "Tom Brown", email: "tom@example.com" },
    { name: "Priya Rao", email: "priya@example.com" },
  ]),
  "Hi Team,",
);

assert.equal(
  buildSmartGreeting([
    { name: "Jane Smith", email: "jane@example.com" },
    { name: "Jane Smith", email: "jane@example.com" },
  ]),
  "Hi Jane,",
);

assert.equal(buildSmartGreeting([]), "Hi there,");

console.log("smart-greeting tests passed");
