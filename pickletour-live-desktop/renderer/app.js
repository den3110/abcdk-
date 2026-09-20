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

// ── Env check ──
(async () => {
  const env = await window.api.envCheck();
  $("runnerLabel").value = env.hostname || "";
  const ff = env.ffmpeg ? '<span class="ok">ffmpeg ✓</span>' : '<span class="bad">ffmpeg ✗</span>';
  const py = env.python ? '<span class="ok">Imou ✓</span>' : '<span class="bad">Python/Imou ✗</span>';
  $("env").innerHTML = `${ff} · ${py} · ${env.platform}`;
  state.encoders = env.encoders || [];
})();

// ── Login ──
$("loginBtn").onclick = async () => {
  $("loginErr").textContent = "";
  try {
    state.baseUrl = $("baseUrl").value.trim();
    state.runnerLabel = $("runnerLabel").value.trim();
    const r = await window.api.login({ baseUrl: state.baseUrl, email: $("email").value.trim(), password: $("password").value });
    state.token = r.token;
    await loadSetup();
    show("setupView");
  } catch (e) { $("loginErr").textContent = e.message; }
};

// ── Setup data ──
async function loadSetup() {
  // encoders
  $("encoder").innerHTML = `<option value="auto">Tự động (ưu tiên GPU)</option>` +
    state.encoders.map((e) => `<option value="${e.value}">${e.label}</option>`).join("");
  // layout corners
  for (const [sel, def] of [["lay_scoreboard", "top-left"], ["lay_brand", "top-right"], ["lay_sponsor", "bottom-right"]]) {
    $(sel).innerHTML = CORNERS.map(([v, l]) => `<option value="${v}" ${v === def ? "selected" : ""}>${l}</option>`).join("");
  }
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

// ── Destinations ──
$("destType").onchange = () => {
  const t = $("destType").value;
  $("fbPage").classList.toggle("hidden", t !== "fb");
  $("rtmpUrl").classList.toggle("hidden", t !== "rtmp");
  $("rtmpKey").classList.toggle("hidden", t !== "rtmp");
};
$("addDest").onclick = () => {
  const t = $("destType").value;
  if (t === "fb") {
    const p = state.fbPages.find((x) => x.pageId === $("fbPage").value);
    if (!p) return;
    state.destinations.push({ type: "fb", pageId: p.pageId, pageName: p.pageName, label: p.pageName });
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
  try {
    const cam = state.cams[+$("cam").value];
    if (!cam) throw new Error("Chọn camera");
    if (!state.destinations.length) throw new Error("Thêm ít nhất 1 điểm đến");
    const form = {
      tournamentId: $("tournament").value,
      courtStationId: $("court").value,
      imouDeviceId: cam.deviceId,
      venueId: cam.venueId,
      destinations: state.destinations,
      encoder: $("encoder").value,
      runnerLabel: state.runnerLabel,
      layout: {
        scoreboard: $("lay_scoreboard").value,
        brand: $("lay_brand").value,
        sponsor: $("lay_sponsor").value,
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

function startPreview(url) {
  const v = $("preview");
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  const tryLoad = (attempt = 0) => {
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ liveSyncDurationCount: 2, lowLatencyMode: true });
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
      $("statRows").innerHTML = `
        <div>Trạng thái: ${badge}</div>
        <div>Trận: <b>${s.currentMatchLabel || "—"}</b></div>
        <div>Encoder: <b>${s.encoder || "?"}</b> · CPU <b>${s.cpuPct || 0}%</b> · RAM <b>${s.memMB || 0}MB</b></div>
        <div>Máy: <b>${s.runnerLabel || state.runnerLabel}</b></div>
        <div>Uptime: <b>${up}m</b></div>
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
