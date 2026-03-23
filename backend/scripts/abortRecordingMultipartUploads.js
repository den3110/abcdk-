import "dotenv/config";

const DEFAULT_RECORDING_PREFIX = "recordings/v2/";

function parseCsv(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function parseArgs(argv = []) {
  const options = {
    execute: false,
    fullBucket: false,
    prefix: DEFAULT_RECORDING_PREFIX,
    targetIds: [],
    sampleSize: 10,
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

function buildPreview(summary, sampleSize) {
  return {
    targetId: summary.targetId,
    targetLabel: summary.targetLabel,
    bucketName: summary.bucketName,
    prefix: summary.prefix || null,
    uploadCount: summary.uploadCount,
    sampleUploads: summary.uploads.slice(0, sampleSize).map((item) => ({
      key: item.key,
      uploadId: item.uploadId,
      initiatedAt: item.initiatedAt || null,
    })),
  };
}

async function main() {
  const {
    abortRecordingMultipartUpload,
    getRecordingStorageTargets,
    listRecordingMultipartUploads,
  } = await import("../services/liveRecordingV2Storage.service.js");

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
          totalUploadCount: 0,
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
    const summary = await listRecordingMultipartUploads({
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
    totalUploadCount: preview.reduce((sum, item) => sum + item.uploadCount, 0),
    targets: preview,
  };

  if (!options.execute) {
    console.log(JSON.stringify(baseResponse, null, 2));
    return;
  }

  const results = [];
  for (const summary of targetSummaries) {
    let abortedCount = 0;
    const failures = [];

    for (const upload of summary.uploads) {
      try {
        await abortRecordingMultipartUpload({
          objectKey: upload.key,
          uploadId: upload.uploadId,
          storageTargetId: summary.targetId,
        });
        abortedCount += 1;
      } catch (error) {
        failures.push({
          key: upload.key,
          uploadId: upload.uploadId,
          error: error?.message || String(error),
        });
      }
    }

    results.push({
      targetId: summary.targetId,
      bucketName: summary.bucketName,
      uploadCount: summary.uploadCount,
      abortedCount,
      failedCount: failures.length,
      failures: failures.slice(0, 20),
    });
  }

  console.log(
    JSON.stringify(
      {
        ...baseResponse,
        executedTargetCount: results.length,
        abortedCount: results.reduce((sum, item) => sum + item.abortedCount, 0),
        failedCount: results.reduce((sum, item) => sum + item.failedCount, 0),
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
