import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const SCRIPT_PATH = path.join(
  process.cwd(),
  "backend",
  "scripts",
  "edge_tts_adapter.py"
);
const SUPPORTED_MODELS = ["edge-tts", "edge-tts-free"];

function safeText(value) {
  return String(value || "").trim();
}

function buildPythonCommands() {
  return [
    { cmd: "python", prefixArgs: [] },
    { cmd: "py", prefixArgs: ["-3"] },
  ];
}

function runProcess(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      const error = new Error(
        safeText(stderr) || safeText(stdout) || `process_exit_${code}`
      );
      error.code = code;
      reject(error);
    });
  });
}

async function runEdgeTtsPython(args = []) {
  let lastError = null;
  for (const candidate of buildPythonCommands()) {
    try {
      return await runProcess(candidate.cmd, [
        ...candidate.prefixArgs,
        SCRIPT_PATH,
        ...args,
      ]);
    } catch (error) {
      lastError = error;
      if (error?.code !== "ENOENT") {
        continue;
      }
    }
  }
  throw lastError || new Error("python_not_found");
}

export async function probeAiTtsAdapter() {
  const result = await runEdgeTtsPython(["--probe"]);
  const payload = JSON.parse(result.stdout || "{}");
  return payload;
}

export async function listAiTtsAdapterModels() {
  await probeAiTtsAdapter();
  return SUPPORTED_MODELS.map((id) => ({
    id,
    object: "model",
    owned_by: "local-edge-tts",
  }));
}

export async function synthesizeAiTtsSpeech({
  text,
  voice = "alloy",
  instructions = "",
  speed = 1,
} = {}) {
  const nextText = safeText(text);
  if (!nextText) {
    const error = new Error("tts_input_required");
    error.statusCode = 400;
    throw error;
  }

  const workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pickletour-edge-tts-")
  );
  const outputPath = path.join(workDir, "speech.mp3");

  try {
    const result = await runEdgeTtsPython([
      "--text",
      nextText,
      "--voice",
      safeText(voice) || "alloy",
      "--instructions",
      safeText(instructions),
      "--speed",
      String(speed || 1),
      "--output",
      outputPath,
    ]);
    const meta = JSON.parse(result.stdout || "{}");
    const buffer = await fs.readFile(outputPath);
    return {
      buffer,
      contentType: "audio/mpeg",
      voice: meta?.voice || safeText(voice) || "alloy",
      provider: meta?.provider || "edge-tts",
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
