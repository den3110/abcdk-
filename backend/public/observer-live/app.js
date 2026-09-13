const $ = (s) => document.querySelector(s);
const KEY_LS = "pkt_observer_read_key";
const keyEl = $("#key"), gridEl = $("#grid"), countsEl = $("#counts"), statusEl = $("#status");
keyEl.value = localStorage.getItem(KEY_LS) || "";
let timer = null, openIds = new Set();

function fmtAgo(d){ if(!d) return "—"; const ms = Date.now()-new Date(d).getTime(); if(ms<0) return "vừa xong";
  const s=Math.floor(ms/1000); if(s<60) return s+"s trước"; const m=Math.floor(s/60); if(m<60) return m+"m trước"; const h=Math.floor(m/60); return h+"h trước"; }
function esc(s){ return String(s??"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }

function chip(label, val, cls){ return `<span class="chip ${cls||''}">${label} <b>${val}</b></span>`; }

function renderCounts(c){
  countsEl.innerHTML =
    chip("Tổng", c.total||0) +
    chip("Online", c.online||0, "ok") +
    chip("Đang live", c.live||0, "ok") +
    chip("Overlay lỗi", c.overlayIssues||0, (c.overlayIssues?"warn":"")) +
    chip("Recovery nặng", c.criticalRecoveries||0, (c.criticalRecoveries?"err":"")) +
    chip("Nghi crash", c.suspectedCrashes||0, (c.suspectedCrashes?"err":""));
}

function deviceTitle(d){ return d.deviceName || d.deviceModel || d.operatorName || d.deviceId?.slice(0,10) || "Máy live"; }

function card(d){
  const streamState = (d.streamState||"").toLowerCase();
  const liveLike = ["live","connecting","reconnecting"].includes(streamState);
  const dotCls = !d.isOnline ? "off" : (liveLike ? "live" : "on");
  const plat = (d.platform||"ios").toLowerCase();
  const platBadge = `<span class="badge b-${plat==='android'?'android':'ios'}">${plat}</span>`;
  const liveBadge = liveLike ? `<span class="badge b-live">LIVE</span>` : `<span class="badge b-idle">${esc(d.streamState||d.screenState||'idle')}</span>`;
  const battery = n(d.battery?.level); const batPct = battery!=null ? Math.round(battery*100)+"%" : (d.battery?.levelText||"—");
  const flags = [];
  if(d.overlayIssue) flags.push(`<span class="flag err">overlay: ${esc(d.overlayIssue)}</span>`);
  if((d.recoverySeverity||"").toLowerCase()==="critical") flags.push(`<span class="flag err">recovery ${esc(d.recoveryStage||'critical')}</span>`);
  else if(d.recoverySeverity) flags.push(`<span class="flag warn">recovery ${esc(d.recoverySeverity)}</span>`);
  const thermal = d.thermal?.state || d.thermal?.level; if(thermal && !/nominal|normal|fair/i.test(thermal)) flags.push(`<span class="flag warn">nhiệt: ${esc(thermal)}</span>`);
  if((d.warningCount||0)>0) flags.push(`<span class="flag warn">${d.warningCount} cảnh báo</span>`);
  const netType = d.network?.type || d.network?.connectionType; if(netType && /none|offline/i.test(netType)) flags.push(`<span class="flag err">mất mạng</span>`);

  const rec = d.recording||{}; const recTxt = rec.stateText || rec.status || "";
  const open = openIds.has(d.id);
  const crashBar = d.suspectedCrash ? `<div class="crashbar">⚠ Nghi crash · ${esc(d.suspectedCrashReason||'')} · offline ${Math.round((d.offlineForMs||0)/1000)}s</div>` : "";

  return `<div class="card ${d.suspectedCrash?'crash':''} ${d.isOnline?'':'offline'}" data-id="${d.id}">
    ${crashBar}
    <div class="chead" data-toggle="${d.id}">
      <span class="dot ${dotCls}"></span>
      <div style="flex:1;min-width:0">
        <div class="cname">${esc(deviceTitle(d))} ${platBadge}</div>
        <div class="cmeta muted">${esc(d.operatorName||'—')} · ${d.isOnline?'online':'offline '+fmtAgo(d.lastSeenAt)}</div>
      </div>
      ${liveBadge}
    </div>
    <div class="grid">
      <span class="k">Sân</span><span>${esc(d.courtName||d.courtId||'—')}</span>
      <span class="k">Trận</span><span>${esc(d.matchCode||d.matchId||'—')}</span>
      <span class="k">Màn</span><span>${esc(d.routeLabel||d.screenState||'—')}</span>
      <span class="k">Ghi hình</span><span>${esc(recTxt||'—')}</span>
      <span class="k">Pin</span><span>${esc(batPct)}${d.battery?.state?(' · '+esc(d.battery.state)):''}</span>
      <span class="k">Sự cố cuối</span><span>${esc(d.lastEventReasonText||d.lastEventType||'—')} ${d.lastEventAt?('· '+fmtAgo(d.lastEventAt)):''}</span>
    </div>
    ${flags.length?`<div style="padding:0 13px 11px">${flags.join('')}</div>`:''}
    <div class="detail ${open?'open':''}" data-detail="${d.id}">
      <a class="tab" data-events="${d.deviceId}">Xem sự cố gần đây ▾</a>
      <div data-eventbox="${d.deviceId}"></div>
      <pre>${esc(JSON.stringify({app:d.app,device:d.device,stream:d.stream,recording:d.recording,overlay:d.overlay,thermal:d.thermal,network:d.network,recovery:d.recovery,warnings:d.warnings,diagnostics:d.diagnostics}, null, 2))}</pre>
    </div>
  </div>`;
}

async function api(path){
  const key = keyEl.value.trim();
  const r = await fetch(path, { headers: { "x-pkt-observer-key": key } });
  if(!r.ok){ const j = await r.json().catch(()=>({})); throw new Error(j.message||("HTTP "+r.status)); }
  return r.json();
}

async function load(){
  const key = keyEl.value.trim();
  if(!key){ gridEl.innerHTML='<div class="empty">Nhập read key rồi bấm Làm mới…</div>'; return; }
  localStorage.setItem(KEY_LS, key);
  const q = new URLSearchParams();
  if($("#platform").value) q.set("platform", $("#platform").value);
  if($("#onlineOnly").checked) q.set("onlineOnly","1");
  q.set("limit","100");
  try {
    const data = await api("/api/observer/read/live-devices?"+q.toString());
    renderCounts(data.counts||{});
    const items = data.items||[];
    gridEl.innerHTML = items.length ? items.map(card).join("") : '<div class="empty">Chưa có máy live nào gửi telemetry.</div>';
    statusEl.textContent = "Cập nhật " + new Date().toLocaleTimeString("vi-VN");
  } catch(e){
    statusEl.textContent = "Lỗi: " + e.message;
    if(/401|invalid/i.test(e.message)) gridEl.innerHTML='<div class="empty">Read key sai. Kiểm tra OBSERVER_READ_API_KEY.</div>';
  }
}

async function loadEvents(deviceId, box){
  try {
    const data = await api("/api/observer/read/live-devices/events?limit=25&deviceId="+encodeURIComponent(deviceId));
    box.innerHTML = (data.items||[]).map(e=>`<div class="ev ${esc(e.level)}"><b>${esc(e.type)}</b> ${esc(e.reasonText||e.reasonCode||'')} <span class="muted">· ${fmtAgo(e.occurredAt)}</span></div>`).join("") || '<div class="muted">Không có sự cố.</div>';
  } catch(e){ box.innerHTML='<div class="muted">Lỗi tải sự cố: '+esc(e.message)+'</div>'; }
}

gridEl.addEventListener("click", (ev)=>{
  const t = ev.target.closest("[data-toggle]");
  if(t){ const id=t.getAttribute("data-toggle"); const det=gridEl.querySelector(`[data-detail="${id}"]`);
    if(det){ det.classList.toggle("open"); if(det.classList.contains("open")) openIds.add(id); else openIds.delete(id); } return; }
  const evb = ev.target.closest("[data-events]");
  if(evb){ const did=evb.getAttribute("data-events"); loadEvents(did, gridEl.querySelector(`[data-eventbox="${did}"]`)); }
});

function schedule(){ if(timer) clearInterval(timer); const ms=Number($("#interval").value); if(ms>0) timer=setInterval(load, ms); }
$("#refresh").onclick = load;
["platform","onlineOnly"].forEach(id=>$("#"+id).onchange=load);
$("#interval").onchange = schedule;
keyEl.onchange = load;
schedule(); load();
