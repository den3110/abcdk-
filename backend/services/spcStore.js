import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";

const DATA_DIR =
  process.env.SPC_DATA_DIR || path.join(process.cwd(), "storage", "spc");
const DATA_FILE = path.join(DATA_DIR, "spc-data.txt");
const META_FILE = path.join(DATA_DIR, "meta.json");

async function ensureDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

export function vnFold(s = "") {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}
export function fuzzyIncludes(hay = "", needle = "") {
  if (!needle) return true;
  return vnFold(hay).includes(vnFold(needle));
}

let cache = null; // { mtimeMs, items }

export async function writeSpcFile(bufOrStr, validate = true) {
  await ensureDir();
  const text = Buffer.isBuffer(bufOrStr)
    ? bufOrStr.toString("utf8")
    : String(bufOrStr);
  let parsed = null;
  if (validate) {
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error("File .txt không phải JSON hợp lệ");
    }
    if (!Array.isArray(parsed))
      throw new Error("Nội dung phải là mảng JSON các object");
  }
  await fsp.writeFile(DATA_FILE, text, "utf8");
  const sha256 = crypto.createHash("sha256").update(text).digest("hex");
  const st = await fsp.stat(DATA_FILE);
  const meta = {
    updatedAt: new Date().toISOString(),
    size: st.size,
    sha256,
    count: parsed ? parsed.length : null,
  };
  await fsp.writeFile(META_FILE, JSON.stringify(meta, null, 2), "utf8");
  cache = null; // reset cache
  return meta;
}

export async function loadAll() {
  try {
    const st = await fsp.stat(DATA_FILE);
    if (cache && cache.mtimeMs === st.mtimeMs) return cache.items;
    const text = await fsp.readFile(DATA_FILE, "utf8");
    const arr = JSON.parse(text);
    cache = { mtimeMs: st.mtimeMs, items: arr };
    return arr;
  } catch (e) {
    return [];
  }
}

export async function getMeta() {
  try {
    return JSON.parse(await fsp.readFile(META_FILE, "utf8"));
  } catch {
    const exists = fs.existsSync(DATA_FILE);
    return {
      updatedAt: null,
      size: exists ? fs.statSync(DATA_FILE).size : 0,
      sha256: null,
      count: exists ? (await loadAll()).length : 0,
    };
  }
}

export async function search({ q = "", province = "", limit = 30 }) {
  const arr = await loadAll();
  const qnorm = vnFold(q);
  const pnorm = vnFold(province);
  const digits = String(q).replace(/\D/g, "");

  let out = arr.filter((it) => {
    const name = it?.HoVaTen || "";
    const nick = it?.NickName || "";
    const phone = (it?.Phone || "").replace(/\D/g, "");
    const tinh = it?.TinhThanh || it?.TenTinhThanh || "";
    const id = String(it?.ID ?? "");

    const passProvince = !pnorm || vnFold(tinh).includes(pnorm);
    if (!passProvince) return false;

    if (!qnorm && pnorm) return true; // chỉ lọc tỉnh

    const byName = vnFold(name).includes(qnorm) || vnFold(nick).includes(qnorm);
    const byPhone = digits && phone.includes(digits);
    const byId = digits && id.includes(digits);
    return byName || byPhone || byId;
  });

  // Ưu tiên: trùng SĐT > tên > ID
  out.sort((a, b) => {
    const pa = (a?.Phone || "").replace(/\D/g, "");
    const pb = (b?.Phone || "").replace(/\D/g, "");
    const da = digits && pa.includes(digits) ? 1 : 0;
    const db = digits && pb.includes(digits) ? 1 : 0;
    if (da !== db) return db - da;

    const na = vnFold(a?.HoVaTen || "");
    const nb = vnFold(b?.HoVaTen || "");
    const tn = (na.includes(qnorm) ? 1 : 0) - (nb.includes(qnorm) ? 1 : 0);
    if (tn !== 0) return -tn;

    return String(a?.ID || "").localeCompare(String(b?.ID || ""));
  });

  if (limit && out.length > limit) out = out.slice(0, limit);
  return out;
}

export function adaptForCaption(it = {}) {
  return {
    id: it?.ID ?? it?.MaskId ?? "—",
    name: it?.HoVaTen || "—",
    nick: it?.NickName || "",
    phone: it?.Phone || it?.SoDienThoai || "",
    tinh: it?.TinhThanh || it?.TenTinhThanh || "",
    single: it?.DiemDon,
    double: it?.DiemDoi,
    joinedAt: it?.ThoiGianThamGia || it?.JoinDate || null,
    avatar: it?.HinhDaiDien || it?.Avatar || "",
  };
}
