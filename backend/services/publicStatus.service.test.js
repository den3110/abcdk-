import test from "node:test";
import assert from "node:assert/strict";

import {
  mapStorageHealthToStatus,
  reduceOverallStatus,
  resolveConfiguredPort,
} from "./publicStatus.service.js";

test("resolveConfiguredPort uses the first configured env value", () => {
  const port = resolveConfiguredPort(
    {
      BACKEND_GO_PORT: "",
      RTMP_PORT: "5002",
    },
    ["BACKEND_GO_PORT", "RTMP_PORT"],
    8005
  );

  assert.equal(port, "5002");
});

test("resolveConfiguredPort falls back to the provided default", () => {
  const port = resolveConfiguredPort({}, ["BACKEND_GO_SCHEDULER_PORT"], 8010);
  assert.equal(port, "8010");
});

test("reduceOverallStatus returns down when public-api is not operational", () => {
  const overall = reduceOverallStatus([
    { key: "public-api", status: "down" },
    { key: "go-api", status: "operational" },
  ]);

  assert.equal(overall, "down");
});

test("reduceOverallStatus returns degraded when a dependency is degraded", () => {
  const overall = reduceOverallStatus([
    { key: "public-api", status: "operational" },
    { key: "go-api", status: "operational" },
    { key: "recording-storage", status: "degraded" },
  ]);

  assert.equal(overall, "degraded");
});

test("reduceOverallStatus returns operational when all services are operational", () => {
  const overall = reduceOverallStatus([
    { key: "public-api", status: "operational" },
    { key: "go-api", status: "operational" },
    { key: "recording-storage", status: "operational" },
  ]);

  assert.equal(overall, "operational");
});

test("mapStorageHealthToStatus returns unknown when no targets are configured", () => {
  const status = mapStorageHealthToStatus({
    healthyTargetCount: 0,
    targets: [],
  });

  assert.equal(status, "unknown");
});

test("mapStorageHealthToStatus returns operational when all targets are healthy", () => {
  const status = mapStorageHealthToStatus({
    healthyTargetCount: 2,
    targets: [
      { alive: true, probeable: true, status: "alive" },
      { alive: true, probeable: true, status: "alive" },
    ],
  });

  assert.equal(status, "operational");
});

test("mapStorageHealthToStatus returns degraded when health is partial", () => {
  const status = mapStorageHealthToStatus({
    healthyTargetCount: 1,
    targets: [
      { alive: true, probeable: true, status: "alive" },
      { alive: false, probeable: true, status: "dead" },
    ],
  });

  assert.equal(status, "degraded");
});

test("mapStorageHealthToStatus returns down when all probeable targets are dead", () => {
  const status = mapStorageHealthToStatus({
    healthyTargetCount: 0,
    targets: [
      { alive: false, probeable: true, status: "dead" },
      { alive: false, probeable: true, status: "dead" },
    ],
  });

  assert.equal(status, "down");
});
