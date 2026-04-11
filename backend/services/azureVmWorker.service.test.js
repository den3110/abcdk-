import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAzureConsumptionScope,
  classifyAzureBillingCategory,
  formatAzureBillingError,
  getUsageDetailPretaxCost,
  summarizeAzureUsageDetails,
} from "./azureVmWorker.service.js";

test("buildAzureConsumptionScope removes leading slash and prefixes subscriptions", () => {
  assert.equal(
    buildAzureConsumptionScope("/subscriptions/abc-123/"),
    "subscriptions/abc-123",
  );

  assert.equal(
    buildAzureConsumptionScope("abc-123"),
    "subscriptions/abc-123",
  );
});

test("formatAzureBillingError includes Azure code and HTTP status when present", () => {
  const message = formatAzureBillingError({
    statusCode: 403,
    details: {
      error: {
        code: "AuthorizationFailed",
        message: " The client does not have authorization. ",
      },
    },
  });

  assert.equal(
    message,
    "AuthorizationFailed | HTTP 403: The client does not have authorization.",
  );
});

test("formatAzureBillingError falls back to a generic message", () => {
  assert.equal(formatAzureBillingError({}), "Azure billing API error");
});

test("getUsageDetailPretaxCost prefers billed modern cost fields", () => {
  assert.equal(
    getUsageDetailPretaxCost({
      costInBillingCurrency: 1.29,
      pretaxCost: 0,
    }),
    1.29,
  );
});

test("classifyAzureBillingCategory groups common Azure charges", () => {
  assert.deepEqual(
    classifyAzureBillingCategory({
      serviceName: "Virtual Machines",
      product: "Standard_D4s_v5",
    }),
    { key: "compute", label: "Compute" },
  );

  assert.deepEqual(
    classifyAzureBillingCategory({
      meterCategory: "Managed Disks",
      product: "Premium SSD",
    }),
    { key: "storage", label: "Disk / Storage" },
  );

  assert.deepEqual(
    classifyAzureBillingCategory({
      serviceName: "Bandwidth",
      meterCategory: "Public IP Address",
    }),
    { key: "network", label: "Network / IP" },
  );
});

test("summarizeAzureUsageDetails returns category and resource breakdown", () => {
  const summary = summarizeAzureUsageDetails([
    {
      serviceName: "Virtual Machines",
      instanceName: "ffmpeg-worker-01",
      resourceGroup: "rg-live",
      pretaxCost: 1.5,
      billingCurrency: "USD",
      usageEnd: "2026-04-11T10:00:00Z",
    },
    {
      meterCategory: "Managed Disks",
      resourceGroup: "rg-live",
      resourceId:
        "/subscriptions/abc/resourceGroups/rg-live/providers/Microsoft.Compute/disks/ffmpeg-worker-01-osdisk",
      pretaxCost: 0.5,
      billingCurrency: "USD",
      usageEnd: "2026-04-11T11:00:00Z",
    },
  ]);

  assert.equal(summary.totalAmount, 2);
  assert.equal(summary.currency, "USD");
  assert.equal(summary.usageDetailCount, 2);
  assert.equal(summary.latestUsageAt, "2026-04-11T11:00:00Z");
  assert.equal(summary.categories[0].key, "compute");
  assert.equal(summary.categories[1].key, "storage");
  assert.equal(summary.resources[0].label, "ffmpeg-worker-01");
});
