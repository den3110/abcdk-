import SeoNewsSettings from "../models/seoNewsSettingsModel.js";
import { runSeoNewsPipeline } from "../services/seoNewsPipelineService.js";

let timer = null;
let started = false;
let running = false;

function getIntervalMs(settings) {
  const minutes = Math.max(5, Number(settings?.intervalMinutes) || 180);
  return Math.floor(minutes * 60 * 1000);
}

async function loadSettings() {
  return (
    (await SeoNewsSettings.findOne({ key: "default" })) ||
    (await SeoNewsSettings.create({ key: "default" }))
  );
}

async function patchCronState(patch = {}) {
  try {
    await SeoNewsSettings.findOneAndUpdate(
      { key: "default" },
      { $set: patch },
      { upsert: true }
    );
  } catch (err) {
    console.warn("[SeoNewsCron] failed to persist cron state:", err?.message || err);
  }
}

function scheduleNext(ms) {
  if (timer) {
    clearTimeout(timer);
  }

  const delay = Math.max(5_000, Number(ms) || 5_000);
  const nextRunAt = new Date(Date.now() + delay);
  patchCronState({ nextCronRunAt: nextRunAt });

  timer = setTimeout(async () => {
    await tick();
  }, delay);
}

async function tick() {
  let settings;

  try {
    settings = await loadSettings();
  } catch (err) {
    console.error("[SeoNewsCron] failed to load settings:", err?.message || err);
    scheduleNext(60_000);
    return;
  }

  const intervalMs = getIntervalMs(settings);

  if (running) {
    scheduleNext(Math.min(intervalMs, 60_000));
    return;
  }

  running = true;
  const runId = `cron_${Date.now().toString(36)}`;

  await patchCronState({
    cronRunning: true,
    cronStatus: "running",
    lastCronRunId: runId,
    lastCronRunAt: new Date(),
    lastCronError: null,
  });

  try {
    if (settings.enabled) {
      const result = await runSeoNewsPipeline({ runId });
      console.log("[SeoNewsCron] run completed", {
        runId,
        published: result?.stats?.published,
        draft: result?.stats?.draft,
      });

      await patchCronState({
        cronRunning: false,
        cronStatus: "success",
        lastCronRunId: runId,
        lastCronRunAt: new Date(),
        lastCronSuccessAt: new Date(),
        lastCronError: null,
        lastCronStats: result?.stats || null,
      });
    } else {
      console.log("[SeoNewsCron] skipped because disabled");
      await patchCronState({
        cronRunning: false,
        cronStatus: "disabled",
        lastCronRunId: runId,
        lastCronRunAt: new Date(),
        lastCronError: null,
      });
    }
  } catch (err) {
    console.error("[SeoNewsCron] run failed:", err?.message || err);
    await patchCronState({
      cronRunning: false,
      cronStatus: "error",
      lastCronRunId: runId,
      lastCronRunAt: new Date(),
      lastCronError: String(err?.message || err),
    });
  } finally {
    running = false;
    try {
      const latest = await loadSettings();
      scheduleNext(getIntervalMs(latest));
    } catch {
      scheduleNext(intervalMs);
    }
  }
}

export function initSeoNewsCron() {
  if (started) {
    return;
  }

  started = true;
  scheduleNext(10_000);
}
