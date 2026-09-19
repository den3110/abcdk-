// scripts/autoLive/save-imou-session.js
// CLI helper trên VPS: login Imou qua ImouPkg → lưu session vào DB venue.
//
// Dùng khi mobile app chưa expose native getSessionInfo (native change chưa
// build). Chủ sân đã upload creds → dev/admin chạy 1 lần trên VPS:
//
//   node scripts/autoLive/save-imou-session.js <venueId> [twoCaptchaKey]
//
// Script sẽ decrypt creds đã lưu, gọi `python3 -m imou.cli login`, đọc
// session ~/.config/imou/session.json, mã hoá lại và ghi vào venue.imouSession.
//
// Nếu account Imou chưa bị Geetest gate, không cần twoCaptchaKey. Nếu bị gate
// (thường sau vài lần login từ IP mới), phải mua 2captcha.com API key.

import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

import Venue from "../../models/venueModel.js";
import { decryptToken, encryptToken } from "../../services/secret.service.js";

const [, , venueIdArg, twoCaptchaKey] = process.argv;
if (!venueIdArg) {
  console.error("Usage: node scripts/autoLive/save-imou-session.js <venueId> [twoCaptchaKey]");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI || process.env.MONGO_URL);

const venue = await Venue.findById(venueIdArg).select("name imouCreds imouAccount imouSession");
if (!venue) { console.error("Venue không tồn tại"); process.exit(2); }
console.log(`Venue: ${venue.name} (${venue._id})`);
if (venue.imouSession?.cipher) console.log("→ Đã có imouSession (sẽ ghi đè).");

if (!venue.imouCreds?.cipher) {
  console.error("Venue chưa lưu creds Imou. Chủ sân cần login lần đầu qua app mobile.");
  process.exit(3);
}
const plainCreds = decryptToken(venue.imouCreds.cipher);
if (!plainCreds) { console.error("Decrypt creds fail"); process.exit(4); }
const { phone, password, areaCode = "84" } = JSON.parse(plainCreds);
if (!phone || !password) { console.error("Creds thiếu phone/password"); process.exit(5); }

// Path mặc định của ImouPkg: ~/.imou-session.json (override qua env IMOU_SESSION)
const sessionFile = process.env.IMOU_SESSION
  ? path.resolve(process.env.IMOU_SESSION)
  : path.join(os.homedir(), ".imou-session.json");
if (fs.existsSync(sessionFile)) {
  console.log("→ Xoá session cũ ~/.config/imou/session.json trước khi login lại.");
  try { fs.unlinkSync(sessionFile); } catch {}
}

const args = ["-m", "imou.cli", "login", phone, password, "--area-code", areaCode];
if (twoCaptchaKey) args.push("--2captcha", twoCaptchaKey);
console.log(`Running: python3 ${args.join(" ")}`);
const r = spawnSync("python3", args, { stdio: "inherit" });
if (r.status !== 0) {
  console.error(`imou.cli login exited code=${r.status}`);
  process.exit(6);
}

if (!fs.existsSync(sessionFile)) { console.error("Session file không được tạo"); process.exit(7); }
const raw = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
console.log("→ Session keys:", Object.keys(raw).join(", "));

// Chuyển sang camelCase để khớp shape mobile app upload (backend đã dùng shape này).
const forStorage = {
  uuidUser: raw.uuid_user,
  uuidKey: raw.uuid_key,
  sessionId: raw.session_id,
  regionalHost: raw.regional_host,
  loginResponse: raw.login_response || {},
};
if (!forStorage.uuidUser || !forStorage.sessionId) {
  console.error("Session thiếu uuid_user/session_id"); process.exit(8);
}
venue.imouSession = { cipher: encryptToken(JSON.stringify(forStorage)), updatedAt: new Date() };
await venue.save();
console.log(`✓ Đã lưu venue.imouSession (updatedAt=${venue.imouSession.updatedAt.toISOString()})`);
await mongoose.disconnect();
process.exit(0);
