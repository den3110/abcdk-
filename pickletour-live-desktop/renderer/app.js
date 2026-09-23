// Renderer logic — login → chọn giải/sân/cam/điểm đến → live + preview.
const $ = (id) => document.getElementById(id);
const state = {
  baseUrl: "", token: "", runnerLabel: "",
  cams: [], fbPages: [], destinations: [], encoders: [],
  session: null, hls: null, statusTimer: null,
};

const CORNERS = [
  ["top-left", "Trên·Trái"], ["top-right", "Trên·Phải"],
  ["bottom-left", "Dưới·Trái"], ["bottom-right", "Dưới·Phải"],
];

function show(view) {
  for (const v of ["loginView", "setupView", "liveView"]) $(v).classList.add("hidden");
  $(view).classList.remove("hidden");
}
function apiGet(p) { return window.api.get({ baseUrl: state.baseUrl, token: state.token, path: p }); }

const LS = "ptlive_auth";
function saveAuth() {
  try {
    localStorage.setItem(LS, JSON.stringify({
      baseUrl: state.baseUrl, token: state.token, email: $("email").value.trim(),
      runnerLabel: state.runnerLabel, remember: $("remember").checked,
    }));
  } catch {}
}
function loadAuth() { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch { return null; } }
function clearAuth() { try { localStorage.removeItem(LS); } catch {} }

// ── Env check + auto-login ──
async function refreshEnv() {
  const env = await window.api.envCheck();
  const ff = env.ffmpeg ? '<span class="ok">ffmpeg ✓</span>' : '<span class="bad">ffmpeg ✗</span>';
  const py = env.python ? '<span class="ok">Imou ✓</span>' : '<span class="bad">Python/Imou ✗</span>';
  $("env").innerHTML = `${ff} · ${py} · ${env.platform}`;
  state.encoders = env.encoders || [];
  renderSetupHelper(env);
  return env;
}

// Nút "Cài đặt tự động (1 lần)" khi thiếu Python nhưng máy có sẵn Python 3.10+.
function renderSetupHelper(env) {
  let box = $("setupHelper");
  if (env.python) { if (box) box.remove(); return; }
  if (!box) {
    box = document.createElement("div");
    box.id = "setupHelper";
    box.className = "card";
    box.style.cssText = "margin:12px 16px;border:1px solid #f59e0b55";
    const login = $("loginView");
    login.insertBefore(box, login.firstChild);
  }
  const canAuto = env.canAutoSetupPython;
  const ffWarn = env.ffmpeg ? "" :
    '<div class="err">⚠ Chưa có <b>ffmpeg</b> — cài ffmpeg và thêm vào PATH (macOS: <code>brew install ffmpeg</code>; Windows: tải ffmpeg.org rồi thêm PATH).</div>';
  box.innerHTML = `
    <h3>Thiết lập lần đầu</h3>
    <div class="hint">App cần <b>Python 3.10+</b> (đã kèm ImouPkg) và <b>ffmpeg</b> để chạy.</div>
    ${canAuto
      ? '<button id="setupPyBtn" class="primary">⚙ Cài đặt tự động (1 lần)</button>'
      : '<div class="err">⚠ Chưa thấy Python 3.10+ — cài Python (tick <b>Add to PATH</b>) rồi bấm <b>Kiểm tra lại</b>.</div>'}
    <button id="recheckBtn" class="ghost" style="margin-left:8px">↻ Kiểm tra lại</button>
    ${ffWarn}
    <div id="setupLog" class="hint" style="white-space:pre-wrap;margin-top:8px"></div>`;
  const rc = $("recheckBtn"); if (rc) rc.onclick = () => refreshEnv();
  const sb = $("setupPyBtn");
  if (sb) sb.onclick = async () => {
    sb.disabled = true; const logEl = $("setupLog");
    logEl.textContent = "Đang cài đặt… (có thể mất 1-2 phút, cần internet)";
    try {
      const r = await window.api.setupPython();
      logEl.textContent = r.already ? "Python đã sẵn sàng." : "✓ Cài đặt xong! Python đã sẵn sàng.";
      await refreshEnv();
    } catch (e) {
      logEl.innerHTML = `<span class="bad">Lỗi: ${e.message}</span>`;
      sb.disabled = false;
    }
  };
}

(async () => {
  const env = await refreshEnv();
  const saved = loadAuth();
  $("runnerLabel").value = (saved && saved.runnerLabel) || env.hostname || "";
  if (saved) {
    if (saved.baseUrl) $("baseUrl").value = saved.baseUrl;
    if (saved.email) $("email").value = saved.email;
    $("remember").checked = saved.remember !== false;
    // Ghi nhớ đăng nhập: dùng lại token, kiểm tra còn hạn không.
    if (saved.token && saved.remember !== false) {
      state.baseUrl = saved.baseUrl; state.token = saved.token; state.runnerLabel = $("runnerLabel").value.trim();
      try {
        await apiGet("/api/tournament-auto-live/fb-pages"); // ping có auth
        await loadSetup();
        $("logoutBtn").classList.remove("hidden");
        show("setupView");
      } catch { clearAuth(); }
    }
  }
})();

// ── Login ──
$("loginBtn").onclick = async () => {
  $("loginErr").textContent = "";
  try {
    state.baseUrl = $("baseUrl").value.trim();
    state.runnerLabel = $("runnerLabel").value.trim();
    const r = await window.api.login({ baseUrl: state.baseUrl, email: $("email").value.trim(), password: $("password").value });
    state.token = r.token;
    if ($("remember").checked) saveAuth(); else clearAuth();
    await loadSetup();
    $("logoutBtn").classList.remove("hidden");
    show("setupView");
  } catch (e) { $("loginErr").textContent = e.message; }
};

$("logoutBtn").onclick = () => {
  clearAuth(); state.token = ""; $("password").value = "";
  $("logoutBtn").classList.add("hidden"); show("loginView");
};

// ── Setup data ──
async function loadSetup() {
  // encoders
  $("encoder").innerHTML = `<option value="auto">Tự động (ưu tiên GPU)</option>` +
    state.encoders.map((e) => `<option value="${e.value}">${e.label}</option>`).join("");
  // layout corners
  for (const [sel, def] of [["lay_scoreboard", "top-left"], ["lay_brand", "top-right"], ["lay_sponsor", "bottom-right"]]) {
    $(sel).innerHTML = CORNERS.map(([v, l]) => `<option value="${v}" ${v === def ? "selected" : ""}>${l}</option>`).join("");
    $(sel).onchange = renderCornerMap;
  }
  renderCornerMap();
  // tournaments + cams + fb pages
  const [cams, fb] = await Promise.all([
    apiGet("/api/tournament-auto-live/available-cams"),
    apiGet("/api/tournament-auto-live/fb-pages").catch(() => []),
  ]);
  state.cams = cams || [];
  state.fbPages = fb || [];
  $("cam").innerHTML = state.cams.map((c, i) =>
    `<option value="${i}">${c.venueName} / ${c.courtName} · ${c.camName}</option>`).join("");
  $("fbPage").innerHTML = state.fbPages.map((p) => `<option value="${p.pageId}">${p.pageName}</option>`).join("");
  await loadTournaments("");
}

async function loadTournaments(q) {
  const tours = await apiGet(`/api/tournament-auto-live/tournaments${q ? `?q=${encodeURIComponent(q)}` : ""}`).catch(() => []);
  $("tournament").innerHTML = (tours || []).map((t) =>
    `<option value="${t._id}">${t.isTest ? "🧪 [TEST] " : ""}${t.name}</option>`).join("")
    || `<option value="">(không có giải)</option>`;
  await loadCourts();
}
// Advanced: cập nhật nhãn bitrate
document.addEventListener("input", (e) => {
  if (e.target && e.target.id === "adv_vbr") $("adv_vbr_lbl").textContent = e.target.value;
});

let _tourTimer;
document.addEventListener("input", (e) => {
  if (e.target && e.target.id === "tourSearch") {
    clearTimeout(_tourTimer);
    _tourTimer = setTimeout(() => loadTournaments(e.target.value.trim()), 350);
  }
});
$("tournament").onchange = loadCourts;
async function loadCourts() {
  const tid = $("tournament").value;
  if (!tid) return;
  const courts = await apiGet(`/api/tournament-auto-live/tournaments/${tid}/courts`).catch(() => []);
  $("court").innerHTML = (courts || []).map((c) =>
    `<option value="${c._id}">${c.name}${c.hasMatch ? " · (đang có trận)" : ""}</option>`).join("");
}

// ── Nguồn video: Imou cam vs Custom link ──
$("srcType").onchange = () => {
  const url = $("srcType").value === "url";
  $("camWrap").classList.toggle("hidden", url);
  $("urlWrap").classList.toggle("hidden", !url);
  stopSetupPreview(); // đổi nguồn → tắt preview cũ
};

// ── Xem thử nguồn (preview trước khi live) ──
$("testPreview").onclick = async () => {
  $("previewHint").textContent = "";
  try {
    let source;
    if ($("srcType").value === "url") {
      const u = $("srcUrl").value.trim();
      if (!u) throw new Error("Nhập link nguồn (m3u8 / RTSP / RTMP).");
      source = { kind: "url", sourceUrl: u, encoder: $("encoder").value };
    } else {
      const cam = state.cams[+$("cam").value];
      if (!cam) throw new Error("Chọn camera Imou.");
      source = { kind: "imou", imouDeviceId: cam.deviceId, encoder: $("encoder").value };
    }
    $("testPreview").disabled = true; $("testPreview").textContent = "Đang mở…";
    $("previewHint").textContent = "Đang kết nối nguồn… (RTSP/Imou có thể mất 5–10s).";
    const res = await window.api.previewStart({ baseUrl: state.baseUrl, token: state.token, source });
    $("setupPreview").classList.remove("hidden");
    $("stopPreview").classList.remove("hidden");
    $("previewLog").classList.remove("hidden");
    startSetupPreview(res.previewUrl);
  } catch (e) {
    $("previewHint").textContent = e.message;
  } finally {
    $("testPreview").disabled = false; $("testPreview").textContent = "👁 Xem thử nguồn";
  }
};
$("stopPreview").onclick = () => stopSetupPreview();
$("previewLog").onclick = () => { try { window.api.previewOpenLog(); } catch {} };

function startSetupPreview(url, readyText = "") {
  const v = $("setupPreview");
  if (state.setupHls) { try { state.setupHls.destroy(); } catch {} state.setupHls = null; }
  const tryLoad = (attempt = 0) => {
    if (!$("setupPreview") || $("setupPreview").classList.contains("hidden")) return;
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ liveSyncDurationCount: 3 });
      state.setupHls = hls;
      hls.on(window.Hls.Events.ERROR, (_e, data) => {
        // Segment HLS chưa sinh kịp / nguồn đang kết nối → thử lại tới ~60s.
        if (data.fatal && attempt < 30) {
          $("previewHint").textContent = `Đang chờ nguồn… (${attempt + 1}) — nếu lâu, bấm "Mở log".`;
          setTimeout(() => tryLoad(attempt + 1), 2000);
        }
      });
      hls.on(window.Hls.Events.FRAG_LOADED, () => { $("previewHint").textContent = readyText; });
      hls.loadSource(url); hls.attachMedia(v);
    } else { v.src = url; }
  };
  setTimeout(() => tryLoad(), 3000); // chờ segment HLS đầu
  $("previewHint").textContent = readyText || "Đang tải hình xem thử…";
}

function stopSetupPreview() {
  if (state.setupHls) { try { state.setupHls.destroy(); } catch {} state.setupHls = null; }
  const v = $("setupPreview");
  try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
  v.classList.add("hidden");
  $("stopPreview").classList.add("hidden");
  $("previewLog").classList.add("hidden");
  $("previewHint").textContent = "";
  try { window.api.previewStop(); } catch {}
}

// Worker preview / live-thẳng chết (nguồn lỗi/đứt) → báo + cho mở log.
window.api.onPreviewExit(({ code, log }) => {
  const active = ($("stopPreview") && !$("stopPreview").classList.contains("hidden")) ||
                 ($("stopDirect") && !$("stopDirect").classList.contains("hidden"));
  if (!active) return;
  const last = (log || "").trim().split("\n").filter(Boolean).slice(-1)[0] || "";
  $("previewHint").textContent = `Tiến trình dừng (mã ${code}). ${last} — bấm "Mở log" xem chi tiết.`;
});

// ── Corner map preview ──
function renderCornerMap() {
  const pos = { tl: "top:8px;left:8px", tr: "top:8px;right:8px", bl: "bottom:8px;left:8px", br: "bottom:8px;right:8px" };
  const k = (v) => ({ "top-left": "tl", "top-right": "tr", "bottom-left": "bl", "bottom-right": "br" }[v] || "tl");
  const items = [
    ["scoreboard", "Bảng điểm", $("lay_scoreboard").value],
    ["brand", "Logo", $("lay_brand").value],
    ["sponsor", "Tài trợ", $("lay_sponsor").value],
  ];
  const map = $("cornerMap"); if (!map) return;
  map.innerHTML = items.map(([cls, label, v]) =>
    `<span class="pin ${cls}" style="${pos[k(v)]}">${label}</span>`).join("");
}

// ── Destinations ──
$("destType").onchange = () => {
  const t = $("destType").value;
  $("fbPage").classList.toggle("hidden", t !== "fb");
  $("ytKey").classList.toggle("hidden", t !== "youtube");
  $("rtmpUrl").classList.toggle("hidden", t !== "rtmp");
  $("rtmpKey").classList.toggle("hidden", t !== "rtmp");
};
$("addDest").onclick = () => {
  const t = $("destType").value;
  if (t === "fb") {
    const p = state.fbPages.find((x) => x.pageId === $("fbPage").value);
    if (!p) return;
    state.destinations.push({ type: "fb", pageId: p.pageId, pageName: p.pageName, label: p.pageName });
  } else if (t === "youtube") {
    const key = $("ytKey").value.trim();
    if (!key) return;
    // YouTube ingest RTMP (dùng stream key bền từ YouTube Studio).
    state.destinations.push({
      type: "rtmp", streamUrl: "rtmp://a.rtmp.youtube.com/live2",
      streamKey: key, label: "YouTube",
    });
    $("ytKey").value = "";
  } else {
    const url = $("rtmpUrl").value.trim();
    if (!url) return;
    state.destinations.push({ type: "rtmp", streamUrl: url, streamKey: $("rtmpKey").value.trim(), label: "RTMP" });
    $("rtmpUrl").value = ""; $("rtmpKey").value = "";
  }
  renderDests();
};
function renderDests() {
  $("destList").innerHTML = state.destinations.map((d, i) =>
    `<span class="chip">${d.type.toUpperCase()} · ${d.label || ""} <span class="x" data-i="${i}">✕</span></span>`).join("");
  $("destList").querySelectorAll(".x").forEach((el) =>
    el.onclick = () => { state.destinations.splice(+el.dataset.i, 1); renderDests(); });
}

// ── Go live ──
$("goLive").onclick = async () => {
  $("setupErr").textContent = "";
  stopSetupPreview(); // bắt đầu live → tắt preview xem thử
  try {
    const useUrl = $("srcType").value === "url";
    let imouDeviceId = "", venueId = "", sourceUrl = "";
    if (useUrl) {
      sourceUrl = $("srcUrl").value.trim();
      if (!sourceUrl) throw new Error("Nhập Custom link");
    } else {
      const cam = state.cams[+$("cam").value];
      if (!cam) throw new Error("Chọn camera");
      imouDeviceId = cam.deviceId; venueId = cam.venueId;
    }
    if (!state.destinations.length) throw new Error("Thêm ít nhất 1 điểm đến");
    const form = {
      tournamentId: $("tournament").value,
      courtStationId: $("court").value,
      imouDeviceId, venueId, sourceUrl,
      destinations: state.destinations,
      encoder: $("encoder").value,
      runnerLabel: state.runnerLabel,
      layout: {
        scoreboard: $("lay_scoreboard").value,
        brand: $("lay_brand").value,
        sponsor: $("lay_sponsor").value,
      },
      advanced: {
        videoBitrateKbps: Number($("adv_vbr").value) || 4500,
        resolutionH: Number($("adv_res").value) || 1080,
        fps: Number($("adv_fps").value) || 0,
        audioBitrateKbps: Number($("adv_abr").value) || 128,
        encoder: $("encoder").value || "auto",
      },
    };
    $("goLive").disabled = true; $("goLive").textContent = "Đang khởi động…";
    const res = await window.api.start({ baseUrl: state.baseUrl, token: state.token, form });
    state.session = res;
    startPreview(res.previewUrl);
    renderWatch(res.watchUrls);
    show("liveView");
    pollStatus();
  } catch (e) {
    $("setupErr").textContent = e.message;
  } finally {
    $("goLive").disabled = false; $("goLive").textContent = "● BẮT ĐẦU LIVE";
  }
};

// ── Live THẲNG tới RTMP (không qua server pickletour) ──
$("goDirect").onclick = async () => {
  $("setupErr").textContent = "";
  stopSetupPreview(); // tắt preview xem thử nếu đang mở
  try {
    let source;
    if ($("srcType").value === "url") {
      const u = $("srcUrl").value.trim();
      if (!u) throw new Error("Nhập link nguồn (m3u8 / RTSP / RTMP).");
      source = { kind: "url", sourceUrl: u, encoder: $("encoder").value };
    } else {
      const cam = state.cams[+$("cam").value];
      if (!cam) throw new Error("Chọn camera Imou.");
      source = { kind: "imou", imouDeviceId: cam.deviceId, encoder: $("encoder").value };
    }
    // Chỉ nhận đích RTMP (YouTube được thêm dưới dạng rtmp). FB cần server → loại.
    const rtmpDests = state.destinations.filter((d) => d.type === "rtmp" && d.streamUrl);
    if (!rtmpDests.length) {
      throw new Error("Thêm ít nhất 1 đích 'RTMP tuỳ chỉnh' hoặc 'YouTube' ở mục 3.");
    }
    $("goDirect").disabled = true; $("goDirect").textContent = "Đang kết nối…";
    const res = await window.api.directStart({
      baseUrl: state.baseUrl, token: state.token, source, destinations: rtmpDests,
    });
    $("setupPreview").classList.remove("hidden");
    $("previewLog").classList.remove("hidden");
    $("stopDirect").classList.remove("hidden");
    $("goDirect").classList.add("hidden");
    $("goLive").disabled = true;
    const names = rtmpDests.map((d) => d.label || "RTMP").join(", ");
    startSetupPreview(res.previewUrl, `🔴 Đang live thẳng tới: ${names} (trễ ~2–4s).`);
  } catch (e) {
    $("setupErr").textContent = e.message;
  } finally {
    $("goDirect").disabled = false; $("goDirect").textContent = "⚡ Live thẳng RTMP";
  }
};
$("stopDirect").onclick = () => {
  try { window.api.directStop(); } catch {}
  if (state.setupHls) { try { state.setupHls.destroy(); } catch {} state.setupHls = null; }
  const v = $("setupPreview");
  try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
  v.classList.add("hidden");
  $("stopDirect").classList.add("hidden");
  $("previewLog").classList.add("hidden");
  $("goDirect").classList.remove("hidden");
  $("goLive").disabled = false;
  $("previewHint").textContent = "";
};

// ── Trận NGẪU NHIÊN (không cần giải) — tạo trận + live + chấm điểm ──
$("goRandom").onclick = async () => {
  $("setupErr").textContent = "";
  stopSetupPreview();
  try {
    let source;
    if ($("srcType").value === "url") {
      const u = $("srcUrl").value.trim();
      if (!u) throw new Error("Nhập link nguồn (mục 1).");
      source = { kind: "url", sourceUrl: u, encoder: $("encoder").value };
    } else {
      const cam = state.cams[+$("cam").value];
      if (!cam) throw new Error("Chọn camera Imou (mục 1).");
      source = { kind: "imou", imouDeviceId: cam.deviceId, encoder: $("encoder").value };
    }
    const rtmpDests = state.destinations.filter((d) => d.type === "rtmp" && d.streamUrl);
    if (!rtmpDests.length) throw new Error("Thêm ít nhất 1 đích RTMP/YouTube (mục 3).");
    const teamA = [$("rndA1").value, $("rndA2").value];
    const teamB = [$("rndB1").value, $("rndB2").value];
    if (!teamA[0].trim() && !teamB[0].trim()) throw new Error("Nhập tên VĐV ít nhất 1 đội.");
    $("goRandom").disabled = true; $("goRandom").textContent = "Đang tạo trận…";
    const res = await window.api.randomStart({
      baseUrl: state.baseUrl, token: state.token, source, destinations: rtmpDests,
      title: $("rndTitle").value, teamA, teamB,
    });
    state.randomMatchId = res.matchId;
    $("setupPreview").classList.remove("hidden");
    $("previewLog").classList.remove("hidden");
    $("stopRandom").classList.remove("hidden");
    $("goRandom").classList.add("hidden");
    $("goLive").disabled = true; $("goDirect").disabled = true;
    $("scoreAName").textContent = teamA.filter((x) => x.trim()).join(" / ") || "Đội A";
    $("scoreBName").textContent = teamB.filter((x) => x.trim()).join(" / ") || "Đội B";
    $("scorePanel").classList.remove("hidden");
    const names = rtmpDests.map((d) => d.label || "RTMP").join(", ");
    startSetupPreview(res.previewUrl, `🔴 Đang live trận "${$("rndTitle").value.trim() || "Giao hữu"}" tới: ${names}.`);
    startScorePoll();
  } catch (e) {
    $("setupErr").textContent = e.message;
  } finally {
    $("goRandom").disabled = false; $("goRandom").textContent = "🎲 Live trận ngẫu nhiên";
  }
};
$("stopRandom").onclick = () => {
  try { window.api.randomStop(); } catch {}
  clearInterval(state.scoreTimer);
  if (state.setupHls) { try { state.setupHls.destroy(); } catch {} state.setupHls = null; }
  const v = $("setupPreview");
  try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
  v.classList.add("hidden");
  $("stopRandom").classList.add("hidden");
  $("previewLog").classList.add("hidden");
  $("scorePanel").classList.add("hidden");
  $("goRandom").classList.remove("hidden");
  $("goLive").disabled = false; $("goDirect").disabled = false;
  $("previewHint").textContent = "";
  state.randomMatchId = null;
};
document.querySelectorAll(".sbtn").forEach((b) => {
  b.onclick = async () => {
    if (!state.randomMatchId) return;
    try {
      await window.api.matchScore({
        baseUrl: state.baseUrl, token: state.token,
        matchId: state.randomMatchId, side: b.dataset.side, delta: Number(b.dataset.d),
      });
      refreshScore();
    } catch (e) { $("setupErr").textContent = e.message; }
  };
});
function startScorePoll() {
  clearInterval(state.scoreTimer);
  refreshScore();
  state.scoreTimer = setInterval(refreshScore, 2000);
}
async function refreshScore() {
  if (!state.randomMatchId) return;
  try {
    const m = await apiGet(`/api/user-matches/${state.randomMatchId}`);
    const gs = Array.isArray(m.gameScores) ? m.gameScores : [];
    let idx = Number.isInteger(m.currentGame) ? m.currentGame : gs.length - 1;
    const g = gs[idx] || gs[gs.length - 1] || { a: 0, b: 0 };
    $("scoreA").textContent = g.a || 0;
    $("scoreB").textContent = g.b || 0;
  } catch {}
}

function startPreview(url) {
  const v = $("preview");
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  const tryLoad = (attempt = 0) => {
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ liveSyncDurationCount: 3 });
      state.hls = hls;
      hls.on(window.Hls.Events.ERROR, (_e, data) => {
        if (data.fatal && attempt < 30) setTimeout(() => tryLoad(attempt + 1), 2000);
      });
      hls.loadSource(url); hls.attachMedia(v);
    } else { v.src = url; }
  };
  // Chờ worker sinh segment đầu (~3-5s)
  setTimeout(() => tryLoad(), 4000);
}

function renderWatch(urls) {
  $("watchLinks").innerHTML = (urls || []).length
    ? urls.map((u) => `<span class="chip"><a href="#" data-u="${u}">↗ Mở link xem</a></span>`).join("")
    : '<span class="hint">FB link sẽ có sau ~10s (bấm làm mới trạng thái)</span>';
  $("watchLinks").querySelectorAll("a").forEach((a) =>
    a.onclick = (ev) => { ev.preventDefault(); window.api.openExternal(a.dataset.u); });
}

async function pollStatus() {
  clearInterval(state.statusTimer);
  const render = async () => {
    if (!state.session) return;
    try {
      const s = await apiGet(`/api/tournament-auto-live/${state.session.sessionId}`);
      const badge = s.status === "live" ? '<span class="badge live">LIVE</span>'
        : s.status === "error" ? '<span class="badge err">LỖI</span>'
        : `<span class="badge warn">${s.status}</span>`;
      const up = s.startedAt ? Math.round((Date.now() - new Date(s.startedAt)) / 60000) : 0;
      const spd = Number(s.speed || 0);
      const spdColor = spd >= 0.97 ? "#34d399" : spd >= 0.9 ? "#f59e0b" : "#f87171";
      const net = s.bitrateKbps
        ? `<b>${(s.bitrateKbps / 1000).toFixed(2)} Mbps</b> · ${s.fps || 0}fps · <span style="color:${spdColor}">tốc độ ${spd.toFixed(2)}×</span>`
        : "<b>—</b>";
      $("statRows").innerHTML = `
        <div>Trạng thái: ${badge}</div>
        <div>Trận: <b>${s.currentMatchLabel || "—"}</b></div>
        <div>🌐 Tốc độ live: ${net}</div>
        <div>Encoder: <b>${s.encoder || "?"}</b> · CPU <b>${s.cpuPct || 0}%</b> · RAM <b>${s.memMB || 0}MB</b></div>
        <div>Máy: <b>${s.runnerLabel || state.runnerLabel}</b></div>
        <div>Uptime: <b>${up}m</b></div>
        ${spd && spd < 0.95 ? '<div class="err">⚠ Tốc độ < realtime → mạng/CPU không đủ, sẽ giật. Giảm bitrate hoặc dùng GPU.</div>' : ""}
        ${s.lastError ? `<div class="err">${s.lastError}</div>` : ""}`;
      if (s.destinations?.some((d) => d.watchUrl)) renderWatch(s.destinations.map((d) => d.watchUrl).filter(Boolean));
    } catch (e) { /* ignore transient */ }
  };
  render();
  state.statusTimer = setInterval(render, 5000);
}

$("stopLive").onclick = async () => {
  if (state.session) {
    await window.api.stop({ baseUrl: state.baseUrl, token: state.token, sessionId: state.session.sessionId });
  }
  cleanupLive();
  show("setupView");
};
$("openLog").onclick = () => { if (state.session) window.api.openLog(state.session.sessionId); };

function cleanupLive() {
  clearInterval(state.statusTimer);
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  state.session = null;
}

window.api.onWorkerExit(({ sessionId, code }) => {
  if (state.session && state.session.sessionId === sessionId) {
    $("statRows").innerHTML += `<div class="err">Worker đã dừng (code ${code}).</div>`;
  }
});
