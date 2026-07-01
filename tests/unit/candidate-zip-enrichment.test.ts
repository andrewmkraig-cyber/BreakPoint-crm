import assert from "node:assert/strict";
import { enrichCandidateZipFromCity } from "../../src/lib/candidate-zip-enrichment";

let calls = 0;
const lookup = async (city: string, state: string) => {
  calls += 1;
  if (city === "Hedgesville" && state === "WV") return "25427";
  if (city === "Cincinnati" && state === "OH") return "45202";
  return null;
};

async function main() {
  const enriched = await enrichCandidateZipFromCity(
    { location: "Hedgesville, WV", zip: null },
    lookup,
  );
  assert.deepEqual(enriched, { location: "Hedgesville, WV 25427", zip: "25427" });

  const fullState = await enrichCandidateZipFromCity(
    { location: "Hedgesville, West Virginia", zip: null },
    lookup,
  );
  assert.deepEqual(fullState, { location: "Hedgesville, WV 25427", zip: "25427" });

  const existing = await enrichCandidateZipFromCity(
    { location: "Cincinnati, OH 45213", zip: null },
    lookup,
  );
  assert.deepEqual(existing, { location: "Cincinnati, OH 45213", zip: "45213" });

  const noState = await enrichCandidateZipFromCity(
    { location: "Cincinnati", zip: null },
    lookup,
  );
  assert.deepEqual(noState, { location: "Cincinnati", zip: null });

  assert.equal(calls, 2);

  console.log("candidate-zip-enrichment tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
