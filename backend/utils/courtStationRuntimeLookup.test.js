import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCourtStationLiveMatchQuery,
  buildCourtStationRuntimeLookup,
  resolveLiveMatchStationId,
} from "./courtStationRuntimeLookup.js";

const STATION_A_ID = "507f1f77bcf86cd799439021";
const STATION_B_ID = "507f1f77bcf86cd799439022";

function createLookup() {
  return buildCourtStationRuntimeLookup([
    { _id: STATION_A_ID, name: "Court 1" },
    { _id: STATION_B_ID, name: "Court 2" },
  ]);
}

test("live match lookup query only uses explicit courtStation ids", () => {
  const lookup = createLookup();
  const query = buildCourtStationLiveMatchQuery(lookup);

  assert.deepEqual(query, {
    status: "live",
    courtStation: { $in: [STATION_A_ID, STATION_B_ID] },
  });
});

test("resolveLiveMatchStationId prefers explicit station id", () => {
  const lookup = createLookup();
  const stationId = resolveLiveMatchStationId(
    {
      courtStation: STATION_B_ID,
      courtStationLabel: "Court 1",
      courtLabel: "Legacy Court",
    },
    lookup
  );

  assert.equal(stationId, STATION_B_ID);
});

test("resolveLiveMatchStationId ignores legacy label-only mapping", () => {
  const lookup = createLookup();
  const stationId = resolveLiveMatchStationId(
    {
      courtStation: null,
      courtStationLabel: "Court 1",
      courtLabel: "Legacy Court",
      courtClusterLabel: "Legacy Cluster",
    },
    lookup
  );

  assert.equal(stationId, null);
});
