import ffmpegStatic from "ffmpeg-static";
import { spawn } from "child_process";

console.log("FFmpeg path:", ffmpegStatic);

const test = spawn(ffmpegStatic, ["-version"]);

test.stdout.on("data", (data) => {
  console.log("✅ FFmpeg works:", data.toString());
});

test.on("error", (error) => {
  console.error("❌ FFmpeg error:", error);
});