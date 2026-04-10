import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAzureConsumptionScope,
  formatAzureBillingError,
  getUsageDetailPretaxCost,
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
