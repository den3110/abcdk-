import dotenv from "dotenv";

import { publishObserverBackupSnapshot } from "../services/observerSink.service.js";

dotenv.config();

function asTrimmed(value) {
  return String(value || "").trim();
}

function parseNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parsePayloadJson(value) {
  const normalized = asTrimmed(value);
  if (!normalized) return {};

  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    throw new Error(`Invalid --payloadJson value: ${error.message}`);
  }
}

function parseArgs(argv = []) {
  const options = {
    scope: "generic",
    backupType: "snapshot",
    status: "ok",
    capturedAt: new Date().toISOString(),
    finishedAt: "",
    sizeBytes: null,
    durationMs: null,
    manifestUrl: "",
    checksum: "",
    note: "",
    payload: {},
  };

  for (const rawArg of argv) {
    const arg = asTrimmed(rawArg);
    if (!arg || !arg.startsWith("--")) continue;

    const [key, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");

    switch (key) {
      case "scope":
        options.scope = asTrimmed(value) || options.scope;
        break;
      case "type":
      case "backupType":
        options.backupType = asTrimmed(value) || options.backupType;
        break;
      case "status":
        options.status = asTrimmed(value).toLowerCase() || options.status;
        break;
      case "capturedAt":
        options.capturedAt = asTrimmed(value) || options.capturedAt;
        break;
      case "finishedAt":
        options.finishedAt = asTrimmed(value);
        break;
      case "sizeBytes":
        options.sizeBytes = parseNumber(value);
        break;
      case "durationMs":
        options.durationMs = parseNumber(value);
        break;
      case "manifestUrl":
        options.manifestUrl = asTrimmed(value);
        break;
      case "checksum":
        options.checksum = asTrimmed(value);
        break;
      case "note":
        options.note = asTrimmed(value);
        break;
      case "payloadJson":
        options.payload = parsePayloadJson(value);
        break;
      default:
        break;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const snapshot = {
    scope: options.scope,
    backupType: options.backupType,
    status: options.status,
    capturedAt: options.capturedAt,
    ...(options.finishedAt ? { finishedAt: options.finishedAt } : {}),
    ...(options.sizeBytes !== null ? { sizeBytes: options.sizeBytes } : {}),
    ...(options.durationMs !== null ? { durationMs: options.durationMs } : {}),
    ...(options.manifestUrl ? { manifestUrl: options.manifestUrl } : {}),
    ...(options.checksum ? { checksum: options.checksum } : {}),
    ...(options.note ? { note: options.note } : {}),
    ...options.payload,
  };

  const result = await publishObserverBackupSnapshot(snapshot);
  if (!result?.ok) {
    console.error("[observer-backup] failed to publish snapshot:", result);
    process.exit(1);
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        scope: snapshot.scope,
        backupType: snapshot.backupType,
        status: snapshot.status,
        result,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[observer-backup] error:", error);
  process.exit(1);
});
