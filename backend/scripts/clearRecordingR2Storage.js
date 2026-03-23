import dotenv from "dotenv";

import {
  deleteRecordingObjects,
  getRecordingStorageTargets,
  listRecordingObjects,
} from "../services/liveRecordingV2Storage.service.js";

dotenv.config();

const DEFAULT_RECORDING_PREFIX = "recordings/v2/";

function parseCsv(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

function parseArgs(argv = []) {
  const options = {
    execute: false,
    fullBucket: false,
    prefix: DEFAULT_RECORDING_PREFIX,
    targetIds: [],
    sampleSize: 5,
  };

  for (const rawArg of argv) {
    const arg = String(rawArg || "").trim();
    if (!arg) continue;

    if (arg === "--execute") {
      options.execute = true;
      continue;
    }

    if (arg === "--full-bucket") {
      options.fullBucket = true;
      options.prefix = "";
      continue;
    }

    if (arg.startsWith("--prefix=")) {
      options.prefix = String(arg.split("=")[1] || "").trim();
      continue;
    }

    if (arg.startsWith("--targetIds=")) {
      options.targetIds = parseCsv(arg.split("=")[1]);
      continue;
    }

    if (arg.startsWith("--sample=")) {
      const parsed = Number(arg.split("=")[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.sampleSize = Math.floor(parsed);
      }
    }
  }

  return options;
}

function buildPreview(targetSummary, sampleSize) {
  return {
    targetId: targetSummary.targetId,
    targetLabel: targetSummary.targetLabel,
    bucketName: targetSummary.bucketName,
    prefix: targetSummary.prefix || null,
    objectCount: targetSummary.objectCount,
    totalBytes: targetSummary.totalBytes,
    totalBytesLabel: formatBytes(targetSummary.totalBytes),
    sampleKeys: targetSummary.objects.slice(0, sampleSize).map((item) => item.key),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const configuredTargets = getRecordingStorageTargets();
  const selectedTargets = options.targetIds.length
    ? configuredTargets.filter((target) => options.targetIds.includes(target.id))
    : configuredTargets;

  if (!selectedTargets.length) {
    console.log(
      JSON.stringify(
        {
          mode: options.execute ? "execute" : "dry-run",
          message: "No recording storage targets matched",
          filters: {
            fullBucket: options.fullBucket,
            prefix: options.prefix || null,
            targetIds: options.targetIds,
          },
          matchedTargetCount: 0,
          totalObjectCount: 0,
          totalBytes: 0,
          targets: [],
        },
        null,
        2
      )
    );
    return;
  }

  const targetSummaries = [];
  for (const target of selectedTargets) {
    const summary = await listRecordingObjects({
      storageTargetId: target.id,
      prefix: options.prefix,
    });
    targetSummaries.push(summary);
  }

  const preview = targetSummaries.map((summary) =>
    buildPreview(summary, options.sampleSize)
  );

  const baseResponse = {
    mode: options.execute ? "execute" : "dry-run",
    filters: {
      fullBucket: options.fullBucket,
      prefix: options.prefix || null,
      targetIds: options.targetIds,
      sampleSize: options.sampleSize,
    },
    matchedTargetCount: preview.length,
    totalObjectCount: preview.reduce((sum, item) => sum + item.objectCount, 0),
    totalBytes: preview.reduce((sum, item) => sum + item.totalBytes, 0),
    totalBytesLabel: formatBytes(
      preview.reduce((sum, item) => sum + item.totalBytes, 0)
    ),
    targets: preview,
  };

  if (!options.execute) {
    console.log(JSON.stringify(baseResponse, null, 2));
    return;
  }

  const results = [];
  for (const summary of targetSummaries) {
    const objectKeys = summary.objects.map((item) => item.key);
    const cleanupResult = await deleteRecordingObjects(objectKeys, {
      storageTargetId: summary.targetId,
    });
    results.push({
      targetId: summary.targetId,
      bucketName: summary.bucketName,
      deletedObjectCount: cleanupResult.deletedObjectCount,
      deletedBytes: summary.totalBytes,
      deletedBytesLabel: formatBytes(summary.totalBytes),
    });
  }

  console.log(
    JSON.stringify(
      {
        ...baseResponse,
        executedTargetCount: results.length,
        deletedObjectCount: results.reduce(
          (sum, item) => sum + item.deletedObjectCount,
          0
        ),
        deletedBytes: results.reduce((sum, item) => sum + item.deletedBytes, 0),
        deletedBytesLabel: formatBytes(
          results.reduce((sum, item) => sum + item.deletedBytes, 0)
        ),
        results,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
