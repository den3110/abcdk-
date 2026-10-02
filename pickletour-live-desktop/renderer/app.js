// Renderer logic — login → chọn giải/sân/cam/điểm đến → live + preview.
const $ = (id) => document.getElementById(id);
const state = {
  baseUrl: "", token: "", runnerLabel: "",
  cams: [], fbPages: [], destinations: [], encoders: [],
  // Nhiều sân trên 1 app: mỗi sid → 1 phiên. activeSid = sân đang mở màn chi tiết.
  sessions: new Map(), activeSid: null, hls: null, pollTimer: null, pollTick: 0,
};
// Phiên đang xem chi tiết (hoặc null nếu đang ở dashboard).
function activeS() { return state.activeSid ? state.sessions.get(state.activeSid) : null; }

const CORNERS = [
  ["top-left", "Trên·Trái"], ["top-right", "Trên·Phải"],
  ["bottom-left", "Dưới·Trái"], ["bottom-right", "Dưới·Phải"],
];

function show(view) {
  for (const v of ["loginView", "dashboardView", "setupView", "liveView"]) $(v).classList.add("hidden");
  $(view).classList.remove("hidden");
}
function apiGet(p) { return window.api.get({ baseUrl: state.baseUrl, token: state.token, path: p }); }
function apiReq(method, p, body) { return window.api.req({ baseUrl: state.baseUrl, token: state.token, method, path: p, body }); }

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
        goDashboard();
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
    goDashboard();
  } catch (e) { $("loginErr").textContent = e.message; }
};

$("logoutBtn").onclick = () => {
  clearAuth(); state.token = ""; $("password").value = "";
  stopPoller();
  clearInterval(state.sysTimer); state.sysTimer = null;
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
  $("fbCrosspost").innerHTML = state.fbPages.map((p) => `<option value="${p.pageId}">${p.pageName}</option>`).join("");
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

// ── Nguồn video: Imou cam / Đầu thu Dahua P2P / Custom link ──
$("srcType").onchange = () => {
  const t = $("srcType").value;
  $("camWrap").classList.toggle("hidden", t !== "imou");
  $("dahuaWrap").classList.toggle("hidden", t !== "dahua");
  $("urlWrap").classList.toggle("hidden", t !== "url");
  if (t === "dahua") loadDahuaVenues();
  if (t === "url") loadRtspSources();
  stopSetupPreview(); // đổi nguồn → tắt preview cũ
};

// ── Thư viện nguồn RTSP có tên (label + url + vị trí overlay) — dùng chung với admin ──
const CORNER_LABELS = { "top-left": "Trên·Trái", "top-right": "Trên·Phải", "bottom-left": "Dưới·Trái", "bottom-right": "Dưới·Phải" };
async function loadRtspSources() {
  try {
    const items = await apiGet("/api/tournament-auto-live/rtsp-sources").catch(() => []);
    state.rtspSources = Array.isArray(items) ? items : [];
  } catch { state.rtspSources = []; }
  const sel = $("rtspSaved");
  sel.innerHTML = `<option value="">— Nhập thủ công —</option>` +
    state.rtspSources.map((s, i) => `<option value="${i}">${(s.label || "").replace(/</g, "&lt;")}</option>`).join("");
  $("rtspSavedWrap").classList.toggle("hidden", state.rtspSources.length === 0);
  $("rtspDeleteBtn").classList.add("hidden");
}
function applyRtspSource() {
  const idx = $("rtspSaved").value;
  const s = state.rtspSources?.[+idx];
  if (!s) { $("rtspDeleteBtn").classList.add("hidden"); return; }
  $("srcUrl").value = s.url || "";
  if (s.layout) {
    if (s.layout.scoreboard) $("lay_scoreboard").value = s.layout.scoreboard;
    if (s.layout.brand) $("lay_brand").value = s.layout.brand;
    if (s.layout.sponsor) $("lay_sponsor").value = s.layout.sponsor;
  }
  $("rtspDeleteBtn").classList.remove("hidden");
  $("rtspHint").textContent = `Đã chọn "${s.label}" → link + vị trí overlay đã điền.`;
}
$("rtspSaved").addEventListener("change", applyRtspSource);
$("rtspSaveBtn").onclick = () => {
  if (!$("srcUrl").value.trim()) { $("rtspHint").textContent = "Chưa có link RTSP để lưu."; return; }
  const cur = state.rtspSources?.[+$("rtspSaved").value];
  $("rtspLabel").value = cur?.label || "";
  $("rtspLabel").classList.remove("hidden");
  $("rtspSaveBtn").classList.add("hidden");
  $("rtspSaveConfirm").classList.remove("hidden");
  $("rtspSaveCancel").classList.remove("hidden");
  $("rtspLabel").focus();
};
$("rtspSaveCancel").onclick = () => {
  $("rtspLabel").classList.add("hidden"); $("rtspSaveConfirm").classList.add("hidden");
  $("rtspSaveCancel").classList.add("hidden"); $("rtspSaveBtn").classList.remove("hidden");
};
$("rtspSaveConfirm").onclick = async () => {
  const label = $("rtspLabel").value.trim();
  const url = $("srcUrl").value.trim();
  if (!label) { $("rtspHint").textContent = "Nhập tên gợi nhớ."; return; }
  if (!url) { $("rtspHint").textContent = "Chưa có link RTSP."; return; }
  const layout = { scoreboard: $("lay_scoreboard").value, brand: $("lay_brand").value, sponsor: $("lay_sponsor").value };
  try {
    const curId = state.rtspSources?.[+$("rtspSaved").value]?._id;
    if (curId) await apiReq("PUT", `/api/tournament-auto-live/rtsp-sources/${curId}`, { label, url, layout });
    else await apiReq("POST", "/api/tournament-auto-live/rtsp-sources", { label, url, layout });
    $("rtspSaveCancel").onclick();
    await loadRtspSources();
    $("rtspHint").textContent = "Đã lưu nguồn RTSP.";
  } catch (e) { $("rtspHint").textContent = "Lưu thất bại: " + (e?.message || e); }
};
$("rtspDeleteBtn").onclick = async () => {
  const id = state.rtspSources?.[+$("rtspSaved").value]?._id;
  if (!id) return;
  try {
    await apiReq("DELETE", `/api/tournament-auto-live/rtsp-sources/${id}`);
    $("srcUrl").value = "";
    await loadRtspSources();
    $("rtspHint").textContent = "Đã xoá nguồn.";
  } catch (e) { $("rtspHint").textContent = "Xoá thất bại: " + (e?.message || e); }
};

// Danh sách venue đã cấu hình đầu thu Dahua (mật khẩu lưu ở backend, mã hoá).
async function loadDahuaVenues() {
  if (state._dahuaLoading) return;
  state._dahuaLoading = true;
  try {
    const venues = await apiGet("/api/tournament-auto-live/dahua-venues").catch(() => []);
    state.dahuaVenues = venues || [];
    $("dahuaVenue").innerHTML = state.dahuaVenues.length
      ? state.dahuaVenues.map((v, i) =>
          `<option value="${i}">${v.venueName}${v.hasPassword ? "" : " (chưa có mật khẩu)"}</option>`).join("")
      : `<option value="">(chưa có venue cấu hình đầu thu — cấu hình ở trang admin)</option>`;
    renderDahuaChannels();
  } finally { state._dahuaLoading = false; }
}
function renderDahuaChannels() {
  const v = state.dahuaVenues?.[+$("dahuaVenue").value];
  const n = Math.max(1, Number(v?.channels) || 8);
  $("dahuaChannel").innerHTML = Array.from({ length: n }, (_, i) => i + 1)
    .map((c) => `<option value="${c}">Kênh ${c}</option>`).join("");
  $("dahuaHint").textContent = v
    ? `Serial ${v.serial}${v.hasPassword ? " · 1 tunnel/đầu thu, nhiều kênh chạy chung" : " · CHƯA có mật khẩu → cấu hình ở admin trước"}`
    : "";
}
$("dahuaVenue").addEventListener("change", renderDahuaChannels);

// ── Ẩn ngày/giờ camera (delogo) — cấu hình dùng chung cho xem thử / live / hẹn giờ ──
// Trả về { hideTimestamp, delogoBox? } để gộp vào `source` (preview) hoặc `form` (live).
function delogoCfg() {
  const on = !!$("hideTimestamp")?.checked;
  if (!on) return { hideTimestamp: false };
  const n = (id, d) => { const v = Number($(id)?.value); return Number.isFinite(v) ? v : d; };
  return {
    hideTimestamp: true,
    delogoBox: { x: n("dl_x", 1392), y: n("dl_y", 14), w: n("dl_w", 512), h: n("dl_h", 54) },
  };
}
if ($("hideTimestamp")) {
  const syncDelogoUi = () => {
    const on = $("hideTimestamp").checked;
    $("delogoBox")?.classList.toggle("hidden", !on);
    $("delogoHint")?.classList.toggle("hidden", !on);
  };
  $("hideTimestamp").onchange = syncDelogoUi;
  syncDelogoUi();
}

// ── Xem thử nguồn (preview trước khi live) ──
$("testPreview").onclick = async () => {
  $("previewHint").textContent = "";
  try {
    if ($("srcType").value === "dahua") {
      throw new Error("Nguồn Dahua P2P: bấm ● BẮT ĐẦU LIVE luôn (không xem thử để tránh mở 2 phiên P2P).");
    }
    let source;
    if ($("srcType").value === "url") {
      const u = $("srcUrl").value.trim();
      if (!u) throw new Error("Nhập link nguồn (m3u8 / RTSP / RTMP).");
      source = { kind: "url", sourceUrl: u, encoder: $("encoder").value, ...delogoCfg() };
    } else {
      const cam = state.cams[+$("cam").value];
      if (!cam) throw new Error("Chọn camera Imou.");
      source = { kind: "imou", imouDeviceId: cam.deviceId, encoder: $("encoder").value, ...delogoCfg() };
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
$("perMatchLive").addEventListener("change", () => {
  const on = $("perMatchLive").checked;
  $("liveTitle").disabled = on;
  $("liveTitle").placeholder = on
    ? "Tự động: Tên giải - Tên trận (mỗi trận)"
    : "Để trống = Tên giải - Tên sân";
  // Ghi + cắt clip / tách live theo giải chỉ dùng cho live xuyên suốt → per-match thì tắt.
  for (const id of ["recordClips", "splitPerTournament"]) {
    const el = $(id);
    if (el) { el.disabled = on; if (on) el.checked = false; }
  }
});
$("destType").onchange = () => {
  const t = $("destType").value;
  $("fbPage").classList.toggle("hidden", t !== "fb");
  $("fbCrosspostWrap").classList.toggle("hidden", t !== "fb");
  $("ytKey").classList.toggle("hidden", t !== "youtube");
  $("rtmpUrl").classList.toggle("hidden", t !== "rtmp");
  $("rtmpKey").classList.toggle("hidden", t !== "rtmp");
};
$("addDest").onclick = () => {
  const t = $("destType").value;
  if (t === "fb") {
    const p = state.fbPages.find((x) => x.pageId === $("fbPage").value);
    if (!p) return;
    // Crosspost: các page được chọn (trừ page chính).
    const cpIds = Array.from($("fbCrosspost").selectedOptions || [])
      .map((o) => o.value).filter((id) => id && id !== p.pageId);
    const cpNames = cpIds.map((id) => state.fbPages.find((x) => x.pageId === id)?.pageName || id);
    const dest = { type: "fb", pageId: p.pageId, pageName: p.pageName, label: p.pageName };
    if (cpIds.length) { dest.crosspostPageIds = cpIds; dest.crosspostNames = cpNames; }
    state.destinations.push(dest);
    // reset chọn crosspost cho lần thêm sau
    Array.from($("fbCrosspost").options).forEach((o) => (o.selected = false));
  } else if (t === "youtube") {
    const key = $("ytKey").value.trim();
    // Có key → dùng thủ công; để TRỐNG → backend tự tạo broadcast qua YouTube API
    // (đã kết nối ở /admin/youtube-live).
    state.destinations.push(key
      ? { type: "rtmp", streamUrl: "rtmp://a.rtmp.youtube.com/live2", streamKey: key, label: "YouTube" }
      : { type: "youtube", label: "YouTube (tự tạo qua API)" });
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
  $("destList").innerHTML = state.destinations.map((d, i) => {
    const cp = d.crosspostNames?.length ? ` <span class="hint">↳ chéo: ${d.crosspostNames.join(", ")}</span>` : "";
    return `<span class="chip">${d.type.toUpperCase()} · ${d.label || ""}${cp} <span class="x" data-i="${i}">✕</span></span>`;
  }).join("");
  $("destList").querySelectorAll(".x").forEach((el) =>
    el.onclick = () => { state.destinations.splice(+el.dataset.i, 1); renderDests(); });
}

// ── Go live ──
// Gom cấu hình sân từ form (dùng chung cho ● BẮT ĐẦU LIVE và ⏰ Hẹn giờ). Ném lỗi nếu thiếu.
function buildLiveForm() {
    const srcT = $("srcType").value;
    let imouDeviceId = "", venueId = "", sourceUrl = "", dahuaP2p;
    if (srcT === "url") {
      sourceUrl = $("srcUrl").value.trim();
      if (!sourceUrl) throw new Error("Nhập Custom link");
    } else if (srcT === "dahua") {
      const v = state.dahuaVenues?.[+$("dahuaVenue").value];
      if (!v) throw new Error("Chọn venue có đầu thu Dahua (cấu hình ở admin)");
      if (!v.hasPassword) throw new Error("Venue này chưa có mật khẩu đầu thu — cấu hình ở trang admin trước");
      venueId = v.venueId;
      dahuaP2p = {
        channel: Number($("dahuaChannel").value) || 1,
        subtype: Number($("dahuaSubtype")?.value ?? 1),
      };
    } else {
      const cam = state.cams[+$("cam").value];
      if (!cam) throw new Error("Chọn camera");
      imouDeviceId = cam.deviceId; venueId = cam.venueId;
    }
    if (!state.destinations.length) throw new Error("Thêm ít nhất 1 điểm đến");
    // Tên giải + tên sân (text option đang chọn) — để hiện + đặt title mặc định.
    const tournamentName = $("tournament").selectedOptions?.[0]?.textContent?.trim() || "";
    const courtName = $("court").selectedOptions?.[0]?.textContent?.trim() || "";
    const perMatch = $("perMatchLive").checked;
    // Title mặc định (live xuyên suốt) = "Tên giải - Tên sân". Per-match → backend tự
    // đặt "Tên giải - Tên trận". Người dùng nhập title riêng thì ưu tiên.
    const titleInput = $("liveTitle").value.trim();
    const defaultTitle = [tournamentName, courtName].filter(Boolean).join(" - ");
    const form = {
      tournamentId: $("tournament").value,
      courtStationId: $("court").value,
      imouDeviceId, venueId, sourceUrl, dahuaP2p,
      destinations: state.destinations,
      encoder: $("encoder").value,
      runnerLabel: state.runnerLabel,
      perMatchLive: perMatch,
      title: perMatch ? "" : (titleInput || defaultTitle),
      overlayStyle: ($("overlayStyle") && $("overlayStyle").value) || "classic",
      noTicker: $("showTicker") ? !$("showTicker").checked : false,
      brandLogoUrl: ($("brandLogoUrl") && $("brandLogoUrl").value.trim()) || "",
      browserOverlayUrl: $("browserOverlayUrl").value.trim(),
      // Ẩn ngày/giờ camera trên luồng live (delogo) + vùng tuỳ chỉnh.
      ...delogoCfg(),
      // Ghi + cắt clip từng trận lên Drive: chỉ live xuyên suốt (không per-match).
      recordClips: $("recordClips").checked && !perMatch,
      // Tách live theo giải: chỉ live xuyên suốt (không per-match).
      splitPerTournament: $("splitPerTournament").checked && !perMatch,
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
    return { form, tournamentName, courtName, perMatch };
}

$("goLive").onclick = async () => {
  $("setupErr").textContent = "";
  stopSetupPreview(); // bắt đầu live → tắt preview xem thử
  try {
    const { form, tournamentName, courtName, perMatch } = buildLiveForm();
    $("goLive").disabled = true; $("goLive").textContent = "Đang khởi động…";
    await startCourt(form, { tournamentName, courtName, perMatch });
    goDashboard();
  } catch (e) {
    $("setupErr").textContent = e.message;
  } finally {
    $("goLive").disabled = false; $("goLive").textContent = "● BẮT ĐẦU LIVE";
  }
};

// ── Hẹn giờ bắt đầu live ──
// Lịch nằm ở main (sống qua đổi view; lưu settings.json → mở lại app vẫn còn). Tới giờ
// main tự startWorker rồi báo về đây để đăng ký phiên vào dashboard.
function fmtSchedTime(ms) {
  return new Date(ms).toLocaleString("vi-VN", {
    hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
  });
}
function renderSchedList(list) {
  const box = $("schedList");
  if (!box) return;
  box.innerHTML = "";
  if (!list?.length) { box.innerHTML = '<span class="hint">Chưa có lịch hẹn.</span>'; return; }
  for (const s of list) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const name = s.title || s.label
      || [s.meta?.tournamentName, s.meta?.courtName].filter(Boolean).join(" - ") || "Sân";
    chip.textContent = `⏰ ${fmtSchedTime(s.startAt)} · ${name} `;
    const x = document.createElement("button");
    x.className = "ghost"; x.textContent = "✕"; x.title = "Huỷ lịch";
    x.onclick = async () => {
      try { const r = await window.api.scheduleCancel(s.id); renderSchedList(r.schedules); } catch {}
    };
    chip.appendChild(x);
    box.appendChild(chip);
  }
}
async function loadSchedules() {
  if (!window.api.scheduleList) return;
  try { const r = await window.api.scheduleList(); renderSchedList(r.schedules); } catch {}
}
if ($("btnSchedule")) {
  // Gợi ý mặc định: giờ tròn kế tiếp để bấm nhanh.
  try {
    const d = new Date(Date.now() + 3600e3); d.setMinutes(0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    $("schedAt").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {}
  $("btnSchedule").onclick = async () => {
    $("setupErr").textContent = "";
    try {
      const v = $("schedAt").value;
      if (!v) throw new Error("Chọn ngày giờ hẹn.");
      const startAt = new Date(v).getTime();
      if (!Number.isFinite(startAt)) throw new Error("Ngày giờ không hợp lệ.");
      if (startAt < Date.now() + 30e3) throw new Error("Thời điểm hẹn phải ở tương lai (≥ 30 giây).");
      const { form, tournamentName, courtName, perMatch } = buildLiveForm();
      const label = form.title || [tournamentName, courtName].filter(Boolean).join(" - ");
      $("btnSchedule").disabled = true;
      const r = await window.api.scheduleAdd({
        baseUrl: state.baseUrl, token: state.token, form, startAt, label,
        meta: { tournamentName, courtName, perMatch },
      });
      renderSchedList(r.schedules);
      $("previewHint").textContent = `⏰ Đã hẹn ${fmtSchedTime(startAt)} — ${label}. Giữ app mở, tới giờ sẽ tự live.`;
    } catch (e) {
      $("setupErr").textContent = e.message;
    } finally {
      $("btnSchedule").disabled = false;
    }
  };
  loadSchedules();
}
if (window.api.onScheduleStarted) {
  window.api.onScheduleFired?.(({ label }) => {
    $("setupErr").textContent = `⏰ Tới giờ — đang bắt đầu live: ${label || ""}`;
  });
  window.api.onScheduleStarted(({ result, form, meta }) => {
    try {
      if (result?.sessionId && form) {
        registerSession(result, form, {
          tournamentName: meta?.tournamentName || "", courtName: meta?.courtName || "",
        });
      }
      $("setupErr").textContent = "";
      loadSchedules();
      if ($("dashboardView") && !$("dashboardView").classList.contains("hidden")) renderDashboard();
      else goDashboard();
    } catch {}
  });
  window.api.onScheduleError(({ label, message }) => {
    $("setupErr").textContent = `⏰ Hẹn giờ "${label || ""}" lỗi: ${message}`;
    loadSchedules();
  });
}

// Bắt đầu 1 sân từ form (dùng chung cho goLive + điều khiển từ xa). Trả về phiên.
async function startCourt(form, { tournamentName = "", courtName = "", perMatch = false } = {}) {
  const res = await window.api.start({ baseUrl: state.baseUrl, token: state.token, form });
  registerSession(res, form, { tournamentName, courtName });
  return res;
}
// Đăng ký phiên vào dashboard (dùng cho startCourt + phiên do hẹn giờ tự bắt đầu ở main).
function registerSession(res, form, { tournamentName = "", courtName = "" } = {}) {
  state.sessions.set(res.sessionId, {
    sid: res.sessionId,
    tournamentName, courtName,
    title: form.title, perMatch: !!form.perMatchLive,
    recordClips: !!form.recordClips,
    previewUrl: res.previewUrl || "",
    perMatchArmed: !!res.perMatchArmed,
    watchUrls: res.watchUrls || [],
    layout: form.layout || { scoreboard: "top-left", brand: "top-right", sponsor: "bottom-right" },
    nameMode: form.nameMode === "full" ? "full" : "nick",
    hideTimestamp: !!form.hideTimestamp,
    timestampBox: form.delogoBox || { x: 1360, y: 46, w: 544, h: 72 },
    lastStatus: null, recUpload: null, clips: [], exited: null,
  });
  ensurePoller();
}

// ── Live THẲNG tới RTMP (không qua server pickletour) ──
$("goDirect").onclick = async () => {
  $("setupErr").textContent = "";
  stopSetupPreview(); // tắt preview xem thử nếu đang mở
  try {
    if ($("srcType").value === "dahua") {
      throw new Error("Nguồn Dahua P2P: dùng nút ● BẮT ĐẦU LIVE (cần lấy khoá đầu thu qua phiên).");
    }
    let source;
    if ($("srcType").value === "url") {
      const u = $("srcUrl").value.trim();
      if (!u) throw new Error("Nhập link nguồn (m3u8 / RTSP / RTMP).");
      source = { kind: "url", sourceUrl: u, encoder: $("encoder").value, ...delogoCfg() };
    } else {
      const cam = state.cams[+$("cam").value];
      if (!cam) throw new Error("Chọn camera Imou.");
      source = { kind: "imou", imouDeviceId: cam.deviceId, encoder: $("encoder").value, ...delogoCfg() };
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
    if ($("srcType").value === "dahua") {
      throw new Error("Nguồn Dahua P2P: dùng nút ● BẮT ĐẦU LIVE (cần lấy khoá đầu thu qua phiên).");
    }
    let source;
    if ($("srcType").value === "url") {
      const u = $("srcUrl").value.trim();
      if (!u) throw new Error("Nhập link nguồn (mục 1).");
      source = { kind: "url", sourceUrl: u, encoder: $("encoder").value, ...delogoCfg() };
    } else {
      const cam = state.cams[+$("cam").value];
      if (!cam) throw new Error("Chọn camera Imou (mục 1).");
      source = { kind: "imou", imouDeviceId: cam.deviceId, encoder: $("encoder").value, ...delogoCfg() };
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
    ? urls.map((u) => `<span class="chip"><a href="#" data-u="${esc(u)}">↗ Mở link xem</a></span>`).join("")
    : '<span class="hint">FB link sẽ có sau ~10s</span>';
  $("watchLinks").querySelectorAll("a").forEach((a) =>
    a.onclick = (ev) => { ev.preventDefault(); window.api.openExternal(a.dataset.u); });
}

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const CLIP_STATUS = {
  pending: ["Chờ đủ segment", "#94a3b8"],
  cutting: ["Đang cắt", "#60a5fa"],
  uploading: ["Đang lên Drive", "#f59e0b"],
  done: ["Xong", "#34d399"],
  failed: ["Lỗi", "#f87171"],
  skipped: ["Bỏ qua", "#f59e0b"],
};

function statusBadge(st) {
  return st === "live" ? '<span class="badge live">LIVE</span>'
    : st === "error" ? '<span class="badge err">LỖI</span>'
    : `<span class="badge warn">${esc(st || "…")}</span>`;
}

// Khối tiến độ đẩy segment recording (chỉ khi bật "Ghi + cắt clip từng trận").
function recUploadHtml(S) {
  if (!S.recordClips) return "";
  const u = S.recUpload;
  if (!u) return `<div>🎬 Ghi clip từng trận: <b style="color:#34d399">bật</b> <span class="hint">— đang ghi, sẽ đẩy về server để cắt + lên Drive.</span></div>`;
  const total = u.total || 0;
  const uploaded = u.uploaded || 0;
  const pct = total ? Math.round((uploaded / total) * 100) : (u.done ? 100 : 0);
  let statusTxt;
  if (u.done) statusTxt = '<b style="color:#34d399">đã đẩy xong toàn bộ</b>';
  else if (u.uploading) statusTxt = '<b style="color:#f59e0b">đang đẩy…</b>';
  else if (u.recording) statusTxt = '<b>đang ghi + đẩy dần</b>';
  else statusTxt = "<b>chờ…</b>";
  const bar = `<div style="height:6px;background:#243244;border-radius:4px;overflow:hidden;margin-top:4px">
      <div style="height:100%;width:${pct}%;background:#34d399;transition:width .4s"></div></div>`;
  return `<div>🎬 Đẩy clip: ${uploaded}/${total} segment (${pct}%) · ${statusTxt}${bar}</div>`;
}

// ── Dashboard nhiều sân ──
function goDashboard() {
  state.activeSid = null;
  if (state.hls) { try { state.hls.destroy(); } catch {} state.hls = null; }
  try { const v = $("preview"); v.pause(); v.removeAttribute("src"); v.load && v.load(); } catch {}
  renderDashboard();
  show("dashboardView");
  startSysStats(); pollSys(); // hiệu năng máy + ước tính số sân
  loadRecordsDir();
  loadControl();
  loadSchedules();
  loadOverlayOpacity();
  startMachineRegister();
}

// Đăng ký máy lên backend để ĐIỀU KHIỂN TỪ APP (qua proxy Tailscale). Cần: đã đăng nhập
// + bật "Điều khiển từ xa" (control server) + có IP Tailscale. Gửi lại mỗi 20s (heartbeat).
let _regTimer = null;
async function registerMachineOnce() {
  if (!state.token) return;
  let ci; try { ci = await window.api.controlGet(); } catch { return; }
  if (!ci?.enabled) return;            // phải bật control server
  if (!ci.tailscaleIp) return;         // phải có IP Tailscale (VPS gọi vào được)
  let perf = {}; try { perf = await window.api.sysStats(); } catch {}
  try {
    await apiReq("POST", "/api/live-control/register", {
      machineId: ci.machineId, label: ci.label,
      tailscaleIp: ci.tailscaleIp, port: ci.port, pin: ci.pin,
      cpuModel: perf.cpuModel, cpuPct: perf.cpuPct, moreCourts: perf.moreCourts,
    });
  } catch { /* transient */ }
}
function startMachineRegister() {
  if (_regTimer) return;
  registerMachineOnce();
  _regTimer = setInterval(registerMachineOnce, 20000);
}

// ── Độ hiển thị (opacity) overlay — chung mọi sân, đổi ngay khi live ──
let _opacityTimer = null;
async function loadOverlayOpacity() {
  const range = $("opacityRange"); if (!range) return;
  try {
    const r = await apiGet("/api/tournament-auto-live/overlay-opacity");
    const pct = Math.round((Number(r?.opacity) || 1) * 100);
    range.value = String(pct);
    if ($("opacityVal")) $("opacityVal").textContent = pct + "%";
  } catch {}
  range.oninput = () => {
    const pct = Number(range.value);
    if ($("opacityVal")) $("opacityVal").textContent = pct + "%";
    if (_opacityTimer) clearTimeout(_opacityTimer);
    _opacityTimer = setTimeout(async () => {
      if ($("opacityHint")) $("opacityHint").textContent = "Đang áp dụng…";
      try {
        await apiReq("PATCH", "/api/tournament-auto-live/overlay-opacity", { opacity: pct / 100 });
        if ($("opacityHint")) $("opacityHint").textContent = "✓ Đã áp dụng cho mọi sân (cập nhật ~vài giây).";
      } catch (e) {
        if ($("opacityHint")) $("opacityHint").textContent = "Lỗi: " + (e?.message || e);
      }
    }, 400);
  };
}

// ── Hiệu năng máy (CPU/RAM + ước tính còn bao nhiêu sân) ──
function renderPerf(s) {
  const card = $("perfCard");
  if (!card || !s) return;
  const cpu = s.cpuPct == null ? null : s.cpuPct;
  const cpuColor = cpu == null ? "#94a3b8" : cpu < 60 ? "#34d399" : cpu < 80 ? "#f59e0b" : "#f87171";
  const memPct = s.totalMemMB ? Math.round((s.usedMemMB / s.totalMemMB) * 100) : 0;
  const bar = (pct, color) => `<div style="height:6px;background:#243244;border-radius:4px;overflow:hidden;margin-top:3px">
      <div style="height:100%;width:${Math.max(0, Math.min(100, pct))}%;background:${color};transition:width .4s"></div></div>`;
  const more = s.moreCourts == null ? "…" : s.moreCourts;
  const moreColor = s.moreCourts == null ? "#94a3b8" : s.moreCourts > 0 ? "#34d399" : "#f87171";
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-weight:700">🖥 Hiệu năng máy</div>
      <div class="hint">${esc(s.cpuModel)} · ${s.cpuCount} lõi · ${esc(s.platform)}/${esc(s.arch)}</div>
    </div>
    <div class="row3" style="margin-top:8px;gap:16px">
      <div>
        <div class="hint">CPU ${cpu == null ? "…" : cpu + "%"}${s.loadavg && s.loadavg[0] ? ` · load ${s.loadavg[0]}` : ""}</div>
        ${bar(cpu || 0, cpuColor)}
      </div>
      <div>
        <div class="hint">RAM ${Math.round(s.usedMemMB/1024*10)/10}/${Math.round(s.totalMemMB/1024*10)/10} GB (${memPct}%)</div>
        ${bar(memPct, memPct < 80 ? "#34d399" : "#f59e0b")}
      </div>
      <div>
        <div class="hint">Đang live: <b>${s.liveCount}</b> sân</div>
        <div style="font-size:15px;margin-top:2px">Còn ~<b style="color:${moreColor}">${more}</b> sân nữa</div>
      </div>
    </div>
    <div class="hint" style="margin-top:6px">Ước tính theo headroom CPU (encode dùng GPU, decode/scale/overlay dùng CPU). Thực tế còn phụ thuộc <b>băng thông upload</b> và số phiên encode GPU cho phép.</div>`;
}

async function pollSys() {
  try { renderPerf(await window.api.sysStats()); } catch { /* ignore */ }
}

// ── Thư mục lưu record / segment / clip ──
async function loadRecordsDir() {
  if (!window.api.recordsDirGet) return;
  try {
    const r = await window.api.recordsDirGet();
    const isDefault = !r.custom;
    $("recDirPath").textContent = `${r.dir}${isDefault ? "  (mặc định — cạnh file chạy)" : ""}`;
  } catch { /* ignore */ }
}
if ($("recDirPick")) {
  $("recDirPick").onclick = async () => {
    try { await window.api.recordsDirPick(); await loadRecordsDir(); } catch {}
  };
  $("recDirReset").onclick = async () => {
    try { await window.api.recordsDirReset(); await loadRecordsDir(); } catch {}
  };
  $("recDirOpen").onclick = () => { try { window.api.recordsDirOpen(); } catch {} };
}
function startSysStats() {
  if (state.sysTimer) return;
  pollSys();
  state.sysTimer = setInterval(() => { if (!$("dashboardView").classList.contains("hidden")) pollSys(); }, 5000);
}

function cardHtml(S) {
  const s = S.lastStatus || {};
  const spd = Number(s.speed || 0);
  const spdColor = spd >= 0.97 ? "#34d399" : spd >= 0.9 ? "#f59e0b" : "#f87171";
  const net = s.bitrateKbps
    ? `${(s.bitrateKbps / 1000).toFixed(2)}Mbps · ${s.fps || 0}fps · <span style="color:${spdColor}">${spd.toFixed(2)}×</span>`
    : "—";
  const clips = S.clips || [];
  const doneN = clips.filter((c) => c.status === "done").length;
  const clipLine = S.recordClips
    ? `<div class="hint">🎬 Clip: ${doneN}/${clips.length} lên Drive${S.recUpload && S.recUpload.total ? ` · đẩy ${S.recUpload.uploaded || 0}/${S.recUpload.total}` : ""}</div>`
    : "";
  const exitedLine = (S.exited && !S.perMatch)
    ? `<div class="err">Worker đã dừng (mã ${esc(S.exited.code)})</div>` : "";
  const errLine = s.lastError ? `<div class="err">${esc(s.lastError)}</div>` : "";
  return `<div class="card courtcard">
    <div class="courtcard-head">
      <div><b>${esc(S.courtName) || "Sân"}</b> ${statusBadge(s.status)}
        <div class="hint">${esc(S.tournamentName)}</div></div>
    </div>
    <div>Trận: <b>${esc(s.currentMatchLabel) || "—"}</b></div>
    <div class="hint">🌐 ${net} · CPU ${s.cpuPct || 0}% · RAM ${s.memMB || 0}MB</div>
    ${clipLine}${exitedLine}${errLine}
    <div class="actions" style="margin-top:8px">
      <button class="ghost" data-act="view" data-sid="${S.sid}">👁 Xem</button>
      <button class="ghost" data-act="log" data-sid="${S.sid}">Log</button>
      <button class="danger" data-act="stop" data-sid="${S.sid}">■ Dừng</button>
    </div>
  </div>`;
}

function renderDashboard() {
  const arr = [...state.sessions.values()];
  $("dashEmpty").classList.toggle("hidden", arr.length > 0);
  const wrap = $("courtCards");
  wrap.innerHTML = arr.map(cardHtml).join("");
  wrap.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.onclick = () => {
      const sid = btn.dataset.sid, act = btn.dataset.act;
      if (act === "view") openDetail(sid);
      else if (act === "log") window.api.openLog(sid);
      else if (act === "stop") stopSession(sid);
    };
  });
}

// ── Chi tiết 1 sân (màn liveView, bám activeSid) ──
function openDetail(sid) {
  const S = state.sessions.get(sid);
  if (!S) return;
  state.activeSid = sid;
  if (state.hls) { try { state.hls.destroy(); } catch {} state.hls = null; }
  try { const v = $("preview"); v.pause(); v.removeAttribute("src"); v.load && v.load(); } catch {}
  if (S.previewUrl) startPreview(S.previewUrl);
  renderDetail();
  setupLiveOverlay(S);
  show("liveView");
}

// Điều khiển VỊ TRÍ overlay NGAY khi đang live (gọi PATCH .../:id/layout → overlay cập nhật ~2s).
function setupLiveOverlay(S) {
  if (!S) return;
  const defs = [
    ["live_lay_scoreboard", "scoreboard", "top-left"],
    ["live_lay_brand", "brand", "top-right"],
    ["live_lay_sponsor", "sponsor", "bottom-right"],
  ];
  const lay = S.layout || {};
  for (const [selId, key, def] of defs) {
    const el = $(selId);
    if (!el) continue;
    el.innerHTML = CORNERS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    el.value = lay[key] || def;
    el.onchange = async () => {
      const layout = {
        scoreboard: $("live_lay_scoreboard").value,
        brand: $("live_lay_brand").value,
        sponsor: $("live_lay_sponsor").value,
      };
      if ($("liveLayoutHint")) $("liveLayoutHint").textContent = "Đang cập nhật…";
      try {
        await apiReq("PATCH", `/api/tournament-auto-live/${S.sid}/layout`, { layout });
        S.layout = layout;
        if ($("liveLayoutHint")) $("liveLayoutHint").textContent = "✓ Đã đổi vị trí — overlay cập nhật sau ~2 giây.";
      } catch (e) {
        if ($("liveLayoutHint")) $("liveLayoutHint").textContent = "Lỗi: " + (e?.message || e);
      }
    };
  }
  // Che ngày/giờ camera (bật/tắt + vùng) — áp NGAY khi đang live.
  const box = S.timestampBox || { x: 1360, y: 46, w: 544, h: 72 };
  if ($("live_hideTs")) {
    $("live_hideTs").checked = !!S.hideTimestamp;
    for (const [id, v] of [["live_dl_x", box.x], ["live_dl_y", box.y], ["live_dl_w", box.w], ["live_dl_h", box.h]]) {
      if ($(id)) $(id).value = v;
    }
    const syncBox = () => $("live_dlBox")?.classList.toggle("hidden", !$("live_hideTs").checked);
    syncBox();
    const applyTs = async () => {
      syncBox();
      const payload = {
        hideTimestamp: $("live_hideTs").checked,
        box: {
          x: Number($("live_dl_x").value) || 1360, y: Number($("live_dl_y").value) || 46,
          w: Number($("live_dl_w").value) || 544, h: Number($("live_dl_h").value) || 72,
        },
      };
      if ($("live_tsHint")) $("live_tsHint").textContent = "Đang áp dụng (khởi động lại luồng ~vài giây)…";
      try {
        const r = await window.api.toggleDelogo({ sid: S.sid, hideTimestamp: payload.hideTimestamp, box: payload.box });
        S.hideTimestamp = payload.hideTimestamp; S.timestampBox = payload.box;
        if (r?.previewUrl) { S.previewUrl = r.previewUrl; if (state.activeSid === S.sid) startPreview(r.previewUrl); }
        if ($("live_tsHint")) $("live_tsHint").textContent = "✓ Đã áp dụng (làm mờ bằng delogo).";
      } catch (e) {
        if ($("live_tsHint")) $("live_tsHint").textContent = "Lỗi: " + (e?.message || e);
      }
    };
    $("live_hideTs").onchange = applyTs;
    for (const id of ["live_dl_x", "live_dl_y", "live_dl_w", "live_dl_h"]) {
      if ($(id)) $(id).onchange = () => { if ($("live_hideTs").checked) applyTs(); };
    }
  }
}

function renderDetail() {
  const S = activeS();
  if (!S) return;
  const s = S.lastStatus || {};
  const up = s.startedAt ? Math.round((Date.now() - new Date(s.startedAt)) / 60000) : 0;
  const spd = Number(s.speed || 0);
  const spdColor = spd >= 0.97 ? "#34d399" : spd >= 0.9 ? "#f59e0b" : "#f87171";
  const net = s.bitrateKbps
    ? `<b>${(s.bitrateKbps / 1000).toFixed(2)} Mbps</b> · ${s.fps || 0}fps · <span style="color:${spdColor}">tốc độ ${spd.toFixed(2)}×</span>`
    : "<b>—</b>";
  $("statRows").innerHTML = `
    <div>Giải: <b>${esc(S.tournamentName) || "—"}</b></div>
    <div>Sân: <b>${esc(S.courtName) || "—"}</b></div>
    <div>Tiêu đề: <b>${esc(S.perMatch ? "Tự động: Tên giải - Tên trận" : (S.title || "—"))}</b></div>
    <div>Trạng thái: ${statusBadge(s.status)}</div>
    <div>Trận: <b>${esc(s.currentMatchLabel) || "—"}</b></div>
    <div>🌐 Tốc độ live: ${net}</div>
    <div>Encoder: <b>${esc(s.encoder) || "?"}</b> · CPU <b>${s.cpuPct || 0}%</b> · RAM <b>${s.memMB || 0}MB</b></div>
    <div>Máy: <b>${esc(s.runnerLabel || state.runnerLabel)}</b></div>
    <div>Uptime: <b>${up}m</b></div>
    ${recUploadHtml(S)}
    ${S.exited && !S.perMatch ? `<div class="err">Worker đã dừng (mã ${esc(S.exited.code)}).</div>` : ""}
    ${spd && spd < 0.95 ? '<div class="err">⚠ Tốc độ < realtime → mạng/CPU không đủ, sẽ giật. Giảm bitrate hoặc dùng GPU.</div>' : ""}
    ${s.lastError ? `<div class="err">${esc(s.lastError)}</div>` : ""}`;
  const urls = s.destinations?.some((d) => d.watchUrl)
    ? s.destinations.map((d) => d.watchUrl).filter(Boolean)
    : (S.watchUrls || []);
  renderWatch(urls);
  renderClips(S);
}

function renderClips(S) {
  const box = $("clipBox");
  const clips = S.clips || [];
  if (!S.recordClips || !clips.length) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  const done = clips.filter((c) => c.status === "done").length;
  $("clipSummary").textContent = `(${done}/${clips.length} đã lên Drive)`;
  $("clipList").innerHTML = clips.map((c) => {
    const [label, color] = CLIP_STATUS[c.status] || [c.status, "#94a3b8"];
    const name = esc(c.matchCode || c.title || "Trận");
    const link = c.driveUrl ? ` · <a href="#" class="cliplink" data-u="${esc(c.driveUrl)}">↗ Mở Drive</a>` : "";
    const errTip = c.status === "failed" && c.lastError ? ` title="${esc(c.lastError)}"` : "";
    return `<div${errTip}><b>${name}</b> — <span style="color:${color}">${esc(label)}</span>${link}</div>`;
  }).join("");
  $("clipList").querySelectorAll("a.cliplink").forEach((a) =>
    a.onclick = (ev) => { ev.preventDefault(); window.api.openExternal(a.dataset.u); });
}

// ── Master poller: cập nhật mọi sân ──
function ensurePoller() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(pollAll, 5000);
  pollAll();
}
function stopPoller() { clearInterval(state.pollTimer); state.pollTimer = null; }

async function pollAll() {
  if (!state.sessions.size) { stopPoller(); return; }
  state.pollTick++;
  const doClips = state.pollTick % 4 === 0; // ~20s
  for (const S of state.sessions.values()) {
    try { S.lastStatus = await apiGet(`/api/tournament-auto-live/${S.sid}`); } catch { /* transient */ }
    if (S.recordClips && doClips) {
      try { S.clips = (await apiGet(`/api/tournament-auto-live/clips?sessionId=${S.sid}`)) || []; } catch { /* transient */ }
    }
  }
  renderDashboard();
  if (state.activeSid) renderDetail();
}

async function stopSession(sid) {
  const S = state.sessions.get(sid);
  if (!S) return;
  try { await window.api.stop({ baseUrl: state.baseUrl, token: state.token, sessionId: sid }); } catch {}
  state.sessions.delete(sid);
  if (state.activeSid === sid) {
    state.activeSid = null;
    if (state.hls) { try { state.hls.destroy(); } catch {} state.hls = null; }
  }
  if (!state.sessions.size) stopPoller();
  goDashboard();
}

$("stopLive").onclick = () => { if (state.activeSid) stopSession(state.activeSid); };
$("openLog").onclick = () => { if (state.activeSid) window.api.openLog(state.activeSid); };
$("backToDash").onclick = () => goDashboard();

window.api.onWorkerExit(({ sessionId, code }) => {
  const S = state.sessions.get(sessionId);
  if (!S) return;
  S.exited = { code };
  renderDashboard();
  if (state.activeSid === sessionId) renderDetail();
});

// Tiến độ đẩy segment recording (clip từng trận).
if (window.api.onRecUpload) {
  window.api.onRecUpload((p) => {
    const S = state.sessions.get(p.sessionId);
    if (!S) return;
    S.recUpload = p;
    renderDashboard();
    if (state.activeSid === p.sessionId) renderDetail();
  });
}

// perMatchLive: trận bắt đầu → gắn preview; trận kết thúc → tháo preview.
window.api.onPerMatch((p) => {
  const S = state.sessions.get(p.sessionId);
  if (!S) return;
  if (p.kind === "live") {
    S.previewUrl = p.previewUrl || S.previewUrl;
    S.watchUrls = p.watchUrls || S.watchUrls;
    if (state.activeSid === p.sessionId && S.previewUrl) startPreview(S.previewUrl);
  } else if (p.kind === "paused") {
    S.previewUrl = "";
    if (state.activeSid === p.sessionId) {
      if (state.hls) { try { state.hls.destroy(); } catch {} state.hls = null; }
      try { const v = $("preview"); v.removeAttribute("src"); v.load && v.load(); } catch {}
    }
  } else if (p.kind === "error") {
    S.perMatchError = p.message || "";
  }
  renderDashboard();
  if (state.activeSid === p.sessionId) renderDetail();
});

// ── Thêm sân / quay lại ──
$("addCourtBtn").onclick = () => { resetSetupForNewCourt(); show("setupView"); };
$("cancelSetup").onclick = () => goDashboard();

function resetSetupForNewCourt() {
  // Mỗi sân cấu hình riêng: xoá điểm đến + tiêu đề của sân trước (giữ overlay corners
  // làm mặc định tiện dụng). Overlay/sponsor/logo + title vẫn chỉnh được cho từng sân.
  state.destinations = [];
  try { renderDests(); } catch { const dl = $("destList"); if (dl) dl.innerHTML = ""; }
  $("liveTitle").value = "";
  $("perMatchLive").checked = false;
  $("recordClips").checked = false;
  $("recordClips").disabled = false;
  if ($("splitPerTournament")) { $("splitPerTournament").checked = false; $("splitPerTournament").disabled = false; }
  $("liveTitle").disabled = false;
  $("setupErr").textContent = "";
  stopSetupPreview();
}

// ══════════ Điều khiển từ xa (nhận lệnh từ web mobile qua main) ══════════
function buildRemoteState() {
  const sessions = [...state.sessions.values()].map((S) => {
    const s = S.lastStatus || {};
    const clips = S.clips || [];
    // Link xem live: từ destinations (đã có watchUrl) hoặc watchUrls lúc start.
    const watchUrls = [...new Set([
      ...((s.destinations || []).map((d) => d.watchUrl).filter(Boolean)),
      ...((S.watchUrls || []).filter(Boolean)),
    ])];
    return {
      sid: S.sid,
      court: S.courtName || "",
      tournament: S.tournamentName || "",
      status: s.status || (S.perMatchArmed ? "paused" : "…"),
      match: s.currentMatchLabel || "",
      speed: Number(s.speed || 0),
      bitrateKbps: s.bitrateKbps || 0,
      recordClips: !!S.recordClips,
      clipsDone: clips.filter((c) => c.status === "done").length,
      clipsTotal: clips.length,
      watchUrls,
      layout: S.layout || { scoreboard: "top-left", brand: "top-right", sponsor: "bottom-right" },
      nameMode: S.nameMode === "full" ? "full" : "nick",
      hideTimestamp: !!S.hideTimestamp,
      timestampBox: S.timestampBox || { x: 1360, y: 46, w: 544, h: 72 },
      exited: !!(S.exited && !S.perMatch),
    };
  });
  return { sessions, loggedIn: !!state.token };
}

// Đổi vị trí overlay 1 sân từ xa (điều khiển điện thoại).
async function remoteSetLayout(p = {}) {
  if (!state.token) throw new Error("App chưa đăng nhập");
  const sid = p.sid;
  const S = sid && state.sessions.get(sid);
  if (!S) throw new Error("Không tìm thấy sân");
  const layout = {
    scoreboard: p.layout?.scoreboard || S.layout?.scoreboard || "top-left",
    brand: p.layout?.brand || S.layout?.brand || "top-right",
    sponsor: p.layout?.sponsor || S.layout?.sponsor || "bottom-right",
  };
  // Kiểu tên hiển thị overlay (nick|full) — đổi được ngay khi đang live.
  const body = { layout };
  const nm = (p.nameMode === "nick" || p.nameMode === "full") ? p.nameMode : "";
  if (nm) body.nameMode = nm;
  await apiReq("PATCH", `/api/tournament-auto-live/${sid}/layout`, body);
  S.layout = layout;
  if (nm) S.nameMode = nm;
  if (state.activeSid === sid) setupLiveOverlay(S);
  return { ok: true, layout, nameMode: S.nameMode || "nick" };
}

async function remoteOptions(payload = {}) {
  if (!state.token) throw new Error("App chưa đăng nhập");
  // Lấy sân theo giải.
  if (payload.tournamentId) {
    const courts = await apiGet(`/api/tournament-auto-live/tournaments/${payload.tournamentId}/courts`).catch(() => []);
    return { courts: (courts || []).map((c) => ({ _id: c._id, name: c.name, hasMatch: !!c.hasMatch })) };
  }
  const q = (payload.q || "").trim();
  const tours = await apiGet(`/api/tournament-auto-live/tournaments${q ? `?q=${encodeURIComponent(q)}` : ""}`).catch(() => []);
  const tournaments = (tours || []).map((t) => ({ _id: t._id, name: `${t.isTest ? "[TEST] " : ""}${t.name}` }));
  // Chế độ tìm kiếm: chỉ trả danh sách giải (giữ cam/fb/rtsp đã nạp ở client).
  if (payload.q != null) return { tournaments };
  const rtsp = await apiGet("/api/tournament-auto-live/rtsp-sources").catch(() => []);
  return {
    tournaments,
    cams: (state.cams || []).map((c, i) => ({ i, label: `${c.venueName}/${c.courtName}·${c.camName}`, deviceId: c.deviceId, venueId: c.venueId })),
    fbPages: (state.fbPages || []).map((p) => ({ pageId: p.pageId, pageName: p.pageName })),
    rtspSources: (Array.isArray(rtsp) ? rtsp : []).map((s) => ({ label: s.label, url: s.url })),
    encoders: (state.encoders || []).map((e) => ({ value: e.value, label: e.label })),
    corners: [
      ["top-left", "Trên·Trái"], ["top-right", "Trên·Phải"],
      ["bottom-left", "Dưới·Trái"], ["bottom-right", "Dưới·Phải"],
    ],
  };
}

// Dựng form từ payload điều khiển từ xa (dùng chung cho live ngay + hẹn giờ).
function buildRemoteForm(p = {}) {
  if (!state.token) throw new Error("App chưa đăng nhập");
  if (!p.tournamentId || !p.courtStationId) throw new Error("Thiếu giải/sân");
  const dests = Array.isArray(p.destinations) ? p.destinations : [];
  if (!dests.length) throw new Error("Thiếu điểm đến");
  const perMatch = !!p.perMatchLive;
  const src = p.source || {};
  const form = {
    tournamentId: p.tournamentId,
    courtStationId: p.courtStationId,
    imouDeviceId: src.imouDeviceId || "",
    venueId: src.venueId || "",
    sourceUrl: src.sourceUrl || "",
    dahuaP2p: src.dahua || undefined,
    destinations: dests,
    encoder: p.encoder || "auto",
    runnerLabel: state.runnerLabel,
    perMatchLive: perMatch,
    title: perMatch ? "" : (p.title || [p.tournamentName, p.courtName].filter(Boolean).join(" - ")),
    overlayStyle: p.overlayStyle || "classic",
    noTicker: !!p.noTicker,
    brandLogoUrl: p.brandLogoUrl || "",
    browserOverlayUrl: p.browserOverlayUrl || "",
    hideTimestamp: !!p.hideTimestamp,
    delogoBox: p.delogoBox || undefined,
    recordClips: !!p.recordClips && !perMatch,
    splitPerTournament: !!p.splitPerTournament && !perMatch,
    layout: {
      scoreboard: p.layout?.scoreboard || "top-left",
      brand: p.layout?.brand || "top-right",
      sponsor: p.layout?.sponsor || "bottom-right",
    },
    advanced: {
      videoBitrateKbps: Number(p.advanced?.videoBitrateKbps) || 4500,
      resolutionH: Number(p.advanced?.resolutionH) || 1080,
      fps: Number(p.advanced?.fps) || 0,
      audioBitrateKbps: Number(p.advanced?.audioBitrateKbps) || 128,
      encoder: p.encoder || "auto",
    },
  };
  return { form, tournamentName: p.tournamentName || "", courtName: p.courtName || "", perMatch };
}

async function remoteStart(p = {}) {
  if (!state.token) throw new Error("App chưa đăng nhập");
  if (!p.tournamentId || !p.courtStationId) throw new Error("Thiếu giải/sân");
  const dests = Array.isArray(p.destinations) ? p.destinations : [];
  if (!dests.length) throw new Error("Thiếu điểm đến");
  const perMatch = !!p.perMatchLive;
  const src = p.source || {};
  const form = {
    tournamentId: p.tournamentId,
    courtStationId: p.courtStationId,
    imouDeviceId: src.imouDeviceId || "",
    venueId: src.venueId || "",
    sourceUrl: src.sourceUrl || "",
    dahuaP2p: src.dahua || undefined,
    destinations: dests,
    encoder: p.encoder || "auto",
    runnerLabel: state.runnerLabel,
    perMatchLive: perMatch,
    title: perMatch ? "" : (p.title || [p.tournamentName, p.courtName].filter(Boolean).join(" - ")),
    overlayStyle: p.overlayStyle || "classic",
    noTicker: !!p.noTicker,
    brandLogoUrl: p.brandLogoUrl || "",
    browserOverlayUrl: p.browserOverlayUrl || "",
    // Ẩn ngày/giờ camera (delogo) — điều khiển từ xa gửi kèm nếu có.
    hideTimestamp: !!p.hideTimestamp,
    delogoBox: p.delogoBox || undefined,
    recordClips: !!p.recordClips && !perMatch,
    splitPerTournament: !!p.splitPerTournament && !perMatch,
    layout: {
      scoreboard: p.layout?.scoreboard || "top-left",
      brand: p.layout?.brand || "top-right",
      sponsor: p.layout?.sponsor || "bottom-right",
    },
    advanced: {
      videoBitrateKbps: Number(p.advanced?.videoBitrateKbps) || 4500,
      resolutionH: Number(p.advanced?.resolutionH) || 1080,
      fps: Number(p.advanced?.fps) || 0,
      audioBitrateKbps: Number(p.advanced?.audioBitrateKbps) || 128,
      encoder: p.encoder || "auto",
    },
  };
  const res = await startCourt(form, { tournamentName: p.tournamentName, courtName: p.courtName, perMatch });
  if (!state.activeSid && $("dashboardView") && !$("dashboardView").classList.contains("hidden")) renderDashboard();
  return { sessionId: res.sessionId };
}

// Bật/tắt che ngày giờ 1 sân từ xa (điều khiển điện thoại) — áp ngay khi live.
async function remoteSetTimestampCover(p = {}) {
  if (!state.token) throw new Error("App chưa đăng nhập");
  const S = p.sid && state.sessions.get(p.sid);
  if (!S) throw new Error("Không tìm thấy sân");
  // Làm mờ ngày giờ = ffmpeg delogo → khởi động lại worker sân (gián đoạn ~vài giây).
  const r = await window.api.toggleDelogo({ sid: p.sid, hideTimestamp: !!p.hideTimestamp, box: p.box });
  S.hideTimestamp = !!p.hideTimestamp;
  if (p.box) S.timestampBox = p.box;
  if (r?.previewUrl) { S.previewUrl = r.previewUrl; if (state.activeSid === p.sid) startPreview(r.previewUrl); }
  if (state.activeSid === p.sid) setupLiveOverlay(S);
  return r || { ok: true };
}

// Hẹn giờ bắt đầu live 1 sân từ xa (điều khiển điện thoại) → đặt lịch ở main.
async function remoteSchedule(p = {}) {
  const startAt = Number(p.startAt);
  if (!Number.isFinite(startAt)) throw new Error("Thời điểm hẹn không hợp lệ");
  const { form, tournamentName, courtName, perMatch } = buildRemoteForm(p);
  const label = form.title || [tournamentName, courtName].filter(Boolean).join(" - ");
  const r = await window.api.scheduleAdd({
    baseUrl: state.baseUrl, token: state.token, form, startAt, label,
    meta: { tournamentName, courtName, perMatch },
  });
  return { ok: true, schedules: r?.schedules || [] };
}

if (window.api.onRemoteCmd) {
  window.api.onRemoteCmd(async ({ id, action, payload }) => {
    let ok = true, data = null, error = "";
    try {
      if (action === "state") data = buildRemoteState();
      else if (action === "options") data = await remoteOptions(payload || {});
      else if (action === "stop") { await stopSession(payload?.sid); data = { stopped: payload?.sid }; }
      else if (action === "stopAll") { for (const sid of [...state.sessions.keys()]) await stopSession(sid); data = { stopped: "all" }; }
      else if (action === "start") data = await remoteStart(payload || {});
      else if (action === "setLayout") data = await remoteSetLayout(payload || {});
      else if (action === "schedule") data = await remoteSchedule(payload || {});
      else if (action === "setTimestampCover") data = await remoteSetTimestampCover(payload || {});
      else if (action === "getOpacity") data = await apiGet("/api/tournament-auto-live/overlay-opacity");
      else if (action === "setOpacity") data = await apiReq("PATCH", "/api/tournament-auto-live/overlay-opacity", { opacity: Number(payload?.opacity) });
      else { ok = false; error = "unknown action"; }
    } catch (e) { ok = false; error = e?.message || String(e); }
    window.api.remoteReply({ id, ok, data, error });
  });
}

// ── Card điều khiển từ xa (bật/tắt server + hiện URL + PIN) ──
async function loadControl() {
  if (!window.api.controlGet) return;
  try { renderControl(await window.api.controlGet()); } catch {}
}
function renderControl(c) {
  const on = !!c.enabled;
  $("controlToggle").checked = on;
  $("controlPinBtn").classList.toggle("hidden", !on);
  const qrBox = $("controlQr");
  if (!on) {
    $("controlInfo").textContent = "Tắt — bật để điều khiển từ điện thoại.";
    if (qrBox) qrBox.classList.add("hidden");
    return;
  }
  const ips = (c.ips || []);
  const urls = ips.map((ip) => `http://${ip.address}:${c.port}/?k=${c.pin}${ip.tailscale ? " (Tailscale)" : ""}`);
  $("controlInfo").innerHTML = `PIN: <b>${esc(c.pin)}</b> · mở trên điện thoại:<br>` +
    (urls.length ? urls.map((u) => esc(u)).join("<br>") : `http://&lt;IP máy&gt;:${c.port}/?k=${esc(c.pin)}`);
  // QR: ưu tiên IP Tailscale (ip.tailscale), fallback IP đầu tiên.
  const primary = ips.find((ip) => ip.tailscale) || ips[0];
  if (qrBox && primary && window.qrcode) {
    const url = `http://${primary.address}:${c.port}/?k=${c.pin}`;
    try {
      const qr = window.qrcode(0, "M");
      qr.addData(url);
      qr.make();
      $("controlQrImg").src = qr.createDataURL(6, 8);
      $("controlQrCap").innerHTML = `Quét QR để mở thẳng${primary.tailscale ? " (Tailscale)" : ""}:<br><b>${esc(url)}</b>`;
      qrBox.classList.remove("hidden");
    } catch { qrBox.classList.add("hidden"); }
  } else if (qrBox) {
    qrBox.classList.add("hidden");
  }
}
if ($("controlToggle")) {
  $("controlToggle").onchange = async () => {
    try { renderControl(await window.api.controlEnable($("controlToggle").checked)); } catch {}
  };
  $("controlPinBtn").onclick = async () => {
    try { await window.api.controlRegenPin(); await loadControl(); } catch {}
  };
}
