// scripts/findUnrelatedNicknames.js
// Lọc các user có nickname KHÔNG liên quan tới name (họ và tên).
// Cách chấm: normalize (lowercase + strip dấu + strip non-alphanumeric) rồi
// check các heuristic dưới; nếu KHÔNG khớp bất kỳ heuristic nào → coi là "không liên quan".
//
// Heuristic "liên quan":
//   1. nickname là substring của name hoặc ngược lại (>=3 ký tự)
//   2. nickname chứa ≥1 từ trong name (từ >= 3 ký tự)
//   3. nickname trùng initials của name (VD "nguyen van a" ↔ "nva")
//   4. Levenshtein tương đối < 0.5 (tương đồng ≥ 50%)
//
// Chạy:
//   node backend/scripts/findUnrelatedNicknames.js
//   node backend/scripts/findUnrelatedNicknames.js --csv > unrelated.csv
//   node backend/scripts/findUnrelatedNicknames.js --limit 500
//   node backend/scripts/findUnrelatedNicknames.js --json

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../models/userModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const args = process.argv.slice(2);
const CSV = args.includes("--csv");
const JSON_OUT = args.includes("--json");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  if (i >= 0 && args[i + 1]) return parseInt(args[i + 1], 10) || 0;
  return 0;
})();

const MONGO_URI =
  process.env.NODE_ENV === "production"
    ? process.env.MONGO_URI_PROD
    : process.env.MONGO_URI;

/** Normalize: lowercase, strip Vietnamese diacritics, keep alnum only */
function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Normalize but keep spaces for word-based checks */
function normWords(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Levenshtein distance */
function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = m[0];
    m[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = m[j];
      m[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : Math.min(prev, m[j], m[j - 1]) + 1;
      prev = tmp;
    }
  }
  return m[b.length];
}

/** True nếu nickname được coi là "liên quan" tới name */
function isRelated(name, nickname) {
  const nn = norm(nickname);
  const nm = norm(name);
  if (!nn || !nm) return true; // thiếu 1 trong 2 → không đánh giá được, skip

  // 1. Substring 2 chiều (≥3 ký tự để tránh false positive kiểu "a" khớp mọi thứ)
  if (nn.length >= 3 && nm.includes(nn)) return true;
  if (nm.length >= 3 && nn.includes(nm)) return true;

  // 2. Chứa ≥1 từ của name (từ có ≥3 ký tự)
  const nameWords = normWords(name).filter((w) => w.length >= 3);
  for (const w of nameWords) {
    if (nn.includes(w)) return true;
  }
  // Từ trong nickname có nằm trong name không (VD nickname "chi123" ↔ name "Nguyen Thi Chi")
  const nickWords = normWords(nickname).filter((w) => w.length >= 3);
  for (const w of nickWords) {
    if (nm.includes(w)) return true;
  }

  // 3. Initials — VD "nva" == initials của "Nguyen Van A"
  const initials = nameWords.map((w) => w[0]).join("");
  if (initials.length >= 2 && (nn === initials || nn.startsWith(initials))) return true;

  // 4. Levenshtein tương đối
  const maxLen = Math.max(nn.length, nm.length);
  if (maxLen > 0) {
    const dist = lev(nn, nm);
    if (dist / maxLen < 0.5) return true; // ≥50% giống nhau
  }

  return false;
}

async function main() {
  if (!MONGO_URI) {
    console.error("MISSING MONGO_URI (or MONGO_URI_PROD) in .env");
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);

  const users = await User.find({
    nickname: { $exists: true, $ne: "", $nin: [null] },
    name: { $exists: true, $ne: "", $nin: [null] },
  })
    .select("_id name nickname phone email province role createdAt")
    .lean();

  const flagged = [];
  for (const u of users) {
    if (!isRelated(u.name, u.nickname)) {
      flagged.push({
        _id: String(u._id),
        name: u.name,
        nickname: u.nickname,
        phone: u.phone || "",
        email: u.email || "",
        province: u.province || "",
        role: u.role || "user",
        createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : "",
      });
    }
  }

  const sliced = LIMIT > 0 ? flagged.slice(0, LIMIT) : flagged;

  if (CSV) {
    console.log(
      "id,name,nickname,phone,email,province,role,createdAt"
    );
    for (const r of sliced) {
      const esc = (v) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      console.log(
        [r._id, r.name, r.nickname, r.phone, r.email, r.province, r.role, r.createdAt]
          .map(esc)
          .join(",")
      );
    }
  } else if (JSON_OUT) {
    console.log(JSON.stringify(sliced, null, 2));
  } else {
    console.log(
      `Tổng user có cả name + nickname: ${users.length}`
    );
    console.log(`Nickname KHÔNG liên quan tới name: ${flagged.length}\n`);
    console.log(
      "id".padEnd(26) +
        " | " +
        "name".padEnd(35) +
        " | " +
        "nickname".padEnd(25) +
        " | phone"
    );
    console.log("-".repeat(120));
    for (const r of sliced) {
      console.log(
        `${r._id.padEnd(26)} | ${String(r.name).slice(0, 33).padEnd(35)} | ${String(r.nickname).slice(0, 23).padEnd(25)} | ${r.phone}`
      );
    }
    if (LIMIT > 0 && flagged.length > LIMIT) {
      console.log(`\n... (${flagged.length - LIMIT} dòng nữa — bỏ --limit để xem hết, hoặc --csv để export)`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
