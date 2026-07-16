import assert from "node:assert/strict";
import {
  normalizeUsState,
  usStateNameForAbbr,
} from "../../src/lib/utils";

assert.equal(normalizeUsState("CA"), "CA");
assert.equal(normalizeUsState("California"), "CA");
assert.equal(normalizeUsState("new york"), "NY");
assert.equal(normalizeUsState("Sacramento, CA"), null);
assert.equal(normalizeUsState("ZZ"), null);

assert.equal(usStateNameForAbbr("ca"), "California");
assert.equal(usStateNameForAbbr("NY"), "New York");
assert.equal(usStateNameForAbbr("ZZ"), null);

console.log("us-state-utils tests passed");
