import assert from "node:assert/strict";
import {
  clientFacingCandidateCityState,
  clientFacingCandidateLocation,
} from "../../src/lib/claude";

assert.equal(clientFacingCandidateLocation("Dayton, OH 45410"), "Dayton");
assert.equal(clientFacingCandidateCityState("Dayton, OH 45410"), "Dayton, OH");

assert.equal(clientFacingCandidateLocation("Houston TX 77001"), "Houston");
assert.equal(clientFacingCandidateCityState("Houston TX 77001"), "Houston, TX");

assert.equal(clientFacingCandidateLocation("Marysville, Ohio, United States"), "Marysville");
assert.equal(clientFacingCandidateCityState("Marysville, Ohio, United States"), "Marysville, OH");

assert.equal(clientFacingCandidateLocation("Chicago"), "Chicago");
assert.equal(clientFacingCandidateCityState("Chicago"), "Chicago");

console.log("submittal-location tests passed");
