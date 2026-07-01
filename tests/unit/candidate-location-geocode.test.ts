import assert from "node:assert/strict";
import { coordinatePatchForCandidateLocationUpdate } from "../../src/lib/candidate-location-geocode";

async function main() {
  let calls = 0;
  const lookup = async (location: string) => {
    calls += 1;
    if (location === "Solon, OH") return { lat: 41.3897, lng: -81.4412 };
    if (location === "Hedgesville, WV 25427") return { lat: 39.5534, lng: -77.9953 };
    return null;
  };

  const unchangedWithCoords = await coordinatePatchForCandidateLocationUpdate({
    nextLocation: "Solon, OH",
    previousLocation: "Solon, OH",
    previousLat: 41.3897,
    previousLng: -81.4412,
    lookup,
  });
  assert.deepEqual(unchangedWithCoords, {});
  assert.equal(calls, 0);

  const unchangedMissingCoords = await coordinatePatchForCandidateLocationUpdate({
    nextLocation: "Solon, OH",
    previousLocation: "Solon, OH",
    previousLat: null,
    previousLng: null,
    lookup,
  });
  assert.deepEqual(unchangedMissingCoords, { lat: 41.3897, lng: -81.4412 });
  assert.equal(calls, 1);

  const changedLocation = await coordinatePatchForCandidateLocationUpdate({
    nextLocation: "Hedgesville, WV 25427",
    previousLocation: null,
    lookup,
  });
  assert.deepEqual(changedLocation, { lat: 39.5534, lng: -77.9953 });
  assert.equal(calls, 2);

  const clearedLocation = await coordinatePatchForCandidateLocationUpdate({
    nextLocation: "",
    previousLocation: "Solon, OH",
    previousLat: 41.3897,
    previousLng: -81.4412,
    lookup,
  });
  assert.deepEqual(clearedLocation, { lat: null, lng: null });
  assert.equal(calls, 2);

  const unresolvableLocation = await coordinatePatchForCandidateLocationUpdate({
    nextLocation: "Remote",
    previousLocation: "Solon, OH",
    previousLat: 41.3897,
    previousLng: -81.4412,
    lookup,
  });
  assert.deepEqual(unresolvableLocation, { lat: null, lng: null });
  assert.equal(calls, 3);

  console.log("candidate-location-geocode tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
