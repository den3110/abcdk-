import mongoose from "mongoose";

function toIdString(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

export function buildCourtStationRuntimeLookup(stationRefs = []) {
  const stationIds = Array.from(
    new Set(
      (Array.isArray(stationRefs) ? stationRefs : [stationRefs])
        .map((value) => toIdString(value?._id || value))
        .filter((value) => value && mongoose.Types.ObjectId.isValid(value))
    )
  );

  return {
    stationIds,
    stationIdSet: new Set(stationIds),
  };
}

export function buildCourtStationLiveMatchQuery(lookup) {
  const stationIds = Array.isArray(lookup?.stationIds) ? lookup.stationIds : [];
  return {
    status: "live",
    courtStation: { $in: stationIds },
  };
}

export function resolveLiveMatchStationId(match, lookup) {
  const stationIdSet =
    lookup?.stationIdSet instanceof Set ? lookup.stationIdSet : new Set();
  const explicitStationId = toIdString(
    match?.courtStation?._id || match?.courtStation
  );
  return explicitStationId && stationIdSet.has(explicitStationId)
    ? explicitStationId
    : null;
}
