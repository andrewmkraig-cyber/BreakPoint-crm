import assert from "node:assert/strict";
import {
  composeCandidateLocation,
  splitCandidateLocation,
} from "../../src/lib/candidate-location-parts";

const full = splitCandidateLocation("Solon, OH 44139");
assert.deepEqual(full, { city: "Solon", state: "OH", zip: "44139" });
assert.equal(composeCandidateLocation(full), "Solon, OH 44139");

const zip4 = splitCandidateLocation("Florence, KY 41042-1234");
assert.deepEqual(zip4, { city: "Florence", state: "KY", zip: "41042-1234" });
assert.equal(composeCandidateLocation(zip4), "Florence, KY 41042-1234");

const noZip = splitCandidateLocation("Cincinnati, OH");
assert.deepEqual(noZip, { city: "Cincinnati", state: "OH", zip: "" });
assert.equal(composeCandidateLocation(noZip), "Cincinnati, OH");

console.log("candidate-location-parts tests passed");
