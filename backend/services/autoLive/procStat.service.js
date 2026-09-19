// Đọc /proc (Linux) để đo CPU/RAM của cây tiến trình worker+ffmpeg mỗi phiên
// auto-live. CPU% tính theo "phần trăm 1 lõi" (100% = 1 core đầy).
import fs from "fs";
import os from "os";

const CLK_TCK = 100; // getconf CLK_TCK trên Linux thường = 100
// pid → { jiffies, at } lần đo trước để tính delta CPU
const prev = new Map();

function readStatJiffies(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const rp = s.lastIndexOf(")");
    const rest = s.slice(rp + 2).split(" "); // rest[0]=state(field3)
    const utime = Number(rest[11]); // field14
    const stime = Number(rest[12]); // field15
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return 0;
    return utime + stime;
  } catch { return 0; }
}

function readRssKb(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const m = s.match(/VmRSS:\s+(\d+)\s+kB/);
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}

function childrenOf(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
    return s ? s.split(/\s+/).map(Number).filter(Boolean) : [];
  } catch { return []; }
}

function collectTree(pid, acc) {
  if (!pid || acc.has(pid)) return;
  acc.add(pid);
  for (const c of childrenOf(pid)) collectTree(c, acc);
}

/**
 * Đo CPU%/RAM của worker pid + toàn bộ con (ffmpeg). Gọi định kỳ (~5s) cho
 * cùng key để CPU% có delta chính xác. Trả { cpuPct, memMB, procCount }.
 */
export function sampleProcessTree(pid, key = String(pid)) {
  if (!pid) return { cpuPct: 0, memMB: 0, procCount: 0 };
  const pids = new Set();
  collectTree(pid, pids);
  if (!pids.size) { prev.delete(key); return { cpuPct: 0, memMB: 0, procCount: 0 }; }
  let jiffies = 0, rssKb = 0;
  for (const p of pids) { jiffies += readStatJiffies(p); rssKb += readRssKb(p); }
  const now = Date.now();
  const p0 = prev.get(key);
  prev.set(key, { jiffies, at: now });
  let cpuPct = 0;
  if (p0 && now > p0.at) {
    const dJif = jiffies - p0.jiffies;
    const dSec = (now - p0.at) / 1000;
    cpuPct = (dJif / CLK_TCK) / dSec * 100; // % của 1 lõi
  }
  return {
    cpuPct: Math.max(0, Math.round(cpuPct)),
    memMB: Math.round(rssKb / 1024),
    procCount: pids.size,
  };
}

export function clearProcSample(key) { prev.delete(String(key)); }

/** Thông tin máy chủ + ước tính số luồng live đồng thời. */
export function systemCapacity(liveSamples) {
  const cores = os.cpus().length;
  const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
  const freeMemMB = Math.round(os.freemem() / 1024 / 1024);
  const load = os.loadavg(); // 1,5,15 phút
  const live = (liveSamples || []).filter((s) => s && (s.cpuPct > 0 || s.memMB > 0));
  const n = live.length;
  const avgCore = n ? live.reduce((a, s) => a + s.cpuPct, 0) / n / 100 : 1.3; // lõi/luồng
  const avgMemMB = n ? live.reduce((a, s) => a + s.memMB, 0) / n : 220;
  const usableCores = cores * 0.8;      // chừa 20% cho hệ + node + mongo
  const usableMemMB = totalMemMB * 0.7; // chừa 30%
  const byCpu = Math.floor(usableCores / Math.max(0.3, avgCore));
  const byMem = Math.floor(usableMemMB / Math.max(80, avgMemMB));
  return {
    cores, totalMemMB, freeMemMB,
    load1: Math.round(load[0] * 100) / 100,
    liveCount: n,
    avgCorePerStream: Math.round(avgCore * 100) / 100,
    avgMemPerStreamMB: Math.round(avgMemMB),
    maxConcurrent: Math.max(n, Math.min(byCpu, byMem)),
    limitedBy: byCpu <= byMem ? "cpu" : "ram",
  };
}
