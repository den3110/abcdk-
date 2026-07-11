/**
 * LivePage — Trực tiếp kiểu FEED DỌC (TikTok-style) trên nền Astryx.
 * - Mỗi trận = 1 slide full màn, scroll-snap; video mp4 tự phát khi vào tâm màn.
 * - Video né header (media bắt đầu dưới nav 64px), có THANH TUA kéo được,
 *   NHẤN GIỮ để tua x2 (nhả ra về tốc độ thường), tap để pause/play.
 * - SEARCH thông minh: gõ là gợi ý trận từ server (q= tìm cả tên đội/giải/mã),
 *   chọn gợi ý -> feed chuyển sang kết quả và nhảy thẳng tới trận đó.
 * - Nút "Các trận trong giải" trên rail -> panel phải liệt kê trận cùng giải
 *   (tournamentId=), bấm trận nào xem ngay trận đó.
 * - Filter Tất cả/Đang live/Xem lại + cuộn vô tận. ?ui=v1 ra trang cũ.
 */
import "@fontsource-variable/figtree";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import {
  Check,
  ExternalLink,
  FastForward,
  Film,
  Link2,
  ListVideo,
  Loader2,
  Play,
  Search,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import SEOHead from "../../components/SEOHead.jsx";
import ShadowFrame from "./ShadowFrame.jsx";
import SiteNav from "./SiteNav.jsx";
import PickleMark from "./PickleMark.jsx";
import { useGetLiveFeedQuery } from "../../slices/liveApiSlice.js";

const NAV_H = 64;

/* ------------------------------- helpers ------------------------------- */
const isLive = (m) => String(m?.status || "").toLowerCase() === "live";
const hasReplay = (m) =>
  String(m?.publicReplayStateHint || m?.replayState || "").toLowerCase() === "complete" ||
  Boolean(m?.video);

/* URL video file phát được bằng <video> (mp4 qua proxy PickleTour) */
const fileUrlOf = (m) => {
  const s = (Array.isArray(m?.streams) ? m.streams : []).find(
    (x) => x?.kind === "file" && x?.ready && x?.playUrl
  );
  if (s?.playUrl) return s.playUrl;
  const v = String(m?.video || "").trim();
  return v || null;
};
const openUrlOf = (m) =>
  String(m?.primaryOpenUrl || m?.liveUrl || m?.video || "").trim() || null;

const scoreOf = (m) => {
  const a = Number(m?.score?.a ?? 0);
  const b = Number(m?.score?.b ?? 0);
  return { a, b, show: isLive(m) || a > 0 || b > 0 };
};

const fmtTime = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
};

const MODES = [
  ["all", "Tất cả"],
  ["live", "Đang live"],
  ["replay", "Xem lại"],
];

function StatusBadge({ m }) {
  if (isLive(m)) {
    return (
      <span
        className="pk-live"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, fontSize: 12, fontWeight: 750, background: "rgba(229,72,77,.16)", color: "#FF8A8E", border: "1px solid rgba(242,85,90,.4)" }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 99, background: "#F2555A" }} />
        LIVE
      </span>
    );
  }
  if (hasReplay(m)) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.10)", color: "#DFE2E5", border: "1px solid rgba(255,255,255,.16)" }}>
        <Film size={11} />
        XEM LẠI
      </span>
    );
  }
  return null;
}

function RailBtn({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{ all: "unset", width: 46, height: 46, borderRadius: 999, display: "grid", placeItems: "center", cursor: "pointer", background: "rgba(24,25,28,.62)", color: "#F0F1F3", border: "1px solid rgba(255,255,255,.14)", backdropFilter: "blur(8px)" }}
    >
      {children}
    </button>
  );
}

/* -------------------------------- slide -------------------------------- */
function Slide({ m, index, active, muted, onToggleMute, onCopied, onOpenTournament }) {
  const videoRef = useRef(null);
  const userPausedRef = useRef(false);
  const pressTimerRef = useRef(null);
  const suppressTapRef = useRef(false);
  const seekRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [boost, setBoost] = useState(false);
  const [prog, setProg] = useState(0);
  const [dur, setDur] = useState(0);
  const [scrub, setScrub] = useState(null); // 0..1 khi đang kéo thanh tua

  const fileUrl = fileUrlOf(m);
  const poster = String(m?.posterUrl || m?.tournament?.image || "").trim() || undefined;
  const sc = scoreOf(m);
  const openUrl = openUrlOf(m);

  // slide vào tâm màn -> phát; rời đi -> dừng (giữ vị trí xem)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active && fileUrl) {
      userPausedRef.current = false;
      setPaused(false);
      const p = v.play();
      if (p?.catch) p.catch(() => setPaused(true));
    } else {
      v.pause();
    }
  }, [active, fileUrl]);

  // autoplay bị chặn khi tab ẩn — tab hiện lại thì phát tiếp (trừ khi user tự pause)
  useEffect(() => {
    const onVis = () => {
      const v = videoRef.current;
      if (!v || document.visibilityState !== "visible") return;
      if (active && fileUrl && v.paused && !userPausedRef.current) {
        v.play().then(() => setPaused(false)).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [active, fileUrl]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      userPausedRef.current = false;
      v.play().catch(() => {});
      setPaused(false);
    } else {
      userPausedRef.current = true;
      v.pause();
      setPaused(true);
    }
  };

  /* --- nhấn giữ = tua x2 (kiểu TikTok), nhả ra về bình thường; gõ nhẹ = pause/play --- */
  const pressStart = () => {
    clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      const v = videoRef.current;
      if (!v) return;
      suppressTapRef.current = true;
      v.playbackRate = 2;
      if (v.paused) {
        userPausedRef.current = false;
        v.play().catch(() => {});
        setPaused(false);
      }
      setBoost(true);
    }, 300);
  };
  const pressEnd = () => {
    clearTimeout(pressTimerRef.current);
    const v = videoRef.current;
    if (v) v.playbackRate = 1;
    setBoost(false);
  };
  const onTap = () => {
    if (suppressTapRef.current) {
      suppressTapRef.current = false;
      return;
    }
    togglePlay();
  };

  /* --- thanh tua: bấm/kéo để seek --- */
  const ratioFromEvent = (e) => {
    const el = seekRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };
  const scrubbingRef = useRef(false);
  const scrubStart = (e) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer không hợp lệ (test/synthetic) — kéo vẫn chạy nhờ pointermove trên track */
    }
    scrubbingRef.current = true;
    setScrub(ratioFromEvent(e));
  };
  const scrubMove = (e) => {
    if (!scrubbingRef.current) return;
    setScrub(ratioFromEvent(e));
  };
  const scrubEnd = (e) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    const v = videoRef.current;
    const r = ratioFromEvent(e);
    if (v && Number.isFinite(v.duration)) v.currentTime = r * v.duration;
    setScrub(null);
  };

  const shown = scrub != null ? scrub : prog;

  return (
    <div
      data-slide={index}
      style={{ height: "100dvh", scrollSnapAlign: "start", scrollSnapStop: "always", position: "relative", background: "#000", overflow: "hidden" }}
    >
      {/* lớp media nằm DƯỚI header (né nav 64px) để không bị che hình */}
      <div style={{ position: "absolute", top: NAV_H, left: 0, right: 0, bottom: 0 }}>
        {fileUrl ? (
          <div
            style={{ position: "absolute", inset: 0 }}
            onPointerDown={pressStart}
            onPointerUp={pressEnd}
            onPointerLeave={pressEnd}
            onPointerCancel={pressEnd}
            onClick={onTap}
            onContextMenu={(e) => e.preventDefault()}
          >
            <video
              ref={videoRef}
              src={fileUrl}
              poster={poster}
              muted={muted}
              playsInline
              preload={index < 2 ? "auto" : "metadata"}
              onWaiting={() => setLoading(true)}
              onPlaying={() => setLoading(false)}
              onCanPlay={() => setLoading(false)}
              onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.duration) setProg(v.currentTime / v.duration);
              }}
              style={{ width: "100%", height: "100%", objectFit: String(m?.preferredObjectFit || "contain") === "cover" ? "cover" : "contain", cursor: "pointer", background: "#000" }}
            />
          </div>
        ) : (
          <a href={openUrl || "#"} target="_blank" rel="noopener noreferrer" style={{ position: "absolute", inset: 0, display: "block" }}>
            {poster && (
              <div style={{ position: "absolute", inset: 0, backgroundImage: `url("${poster}")`, backgroundSize: "cover", backgroundPosition: "center", filter: "brightness(.72)" }} />
            )}
            <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <span style={{ width: 82, height: 82, borderRadius: 999, display: "grid", placeItems: "center", background: "rgba(242,243,245,.94)", color: "#101114", boxShadow: "0 22px 60px -18px rgba(0,0,0,.7)" }}>
                <Play size={32} style={{ marginLeft: 4 }} fill="currentColor" />
              </span>
            </span>
          </a>
        )}
      </div>

      {/* chip 2x khi đang giữ */}
      {boost && (
        <div className="pk-fade" style={{ position: "absolute", top: "18%", left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 999, background: "rgba(24,25,28,.78)", color: "#F5F6F7", fontSize: 14, fontWeight: 750, border: "1px solid rgba(255,255,255,.16)", backdropFilter: "blur(8px)", pointerEvents: "none" }}>
          <FastForward size={15} />
          2x
        </div>
      )}

      {/* icon play khi pause */}
      {fileUrl && paused && (
        <div onClick={onTap} style={{ position: "absolute", inset: `${NAV_H}px 0 0 0`, display: "grid", placeItems: "center", cursor: "pointer", background: "rgba(0,0,0,.18)" }}>
          <span style={{ width: 78, height: 78, borderRadius: 999, display: "grid", placeItems: "center", background: "rgba(24,25,28,.6)", color: "#fff", border: "1px solid rgba(255,255,255,.2)", backdropFilter: "blur(6px)" }}>
            <Play size={30} style={{ marginLeft: 3 }} fill="currentColor" />
          </span>
        </div>
      )}
      {fileUrl && loading && active && !paused && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none" }}>
          <Loader2 size={34} color="#E6E8EA" className="pk-spinning" />
        </div>
      )}

      {/* phủ tối đáy */}
      <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 210, background: "linear-gradient(180deg, transparent, rgba(5,6,8,.88))", pointerEvents: "none" }} />

      {/* thông tin trận */}
      <div style={{ position: "absolute", left: 18, right: 92, bottom: 30, pointerEvents: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <StatusBadge m={m} />
          {m?.displayCode && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#B9BEC5", letterSpacing: ".03em" }}>{m.displayCode}</span>}
        </div>
        <div style={{ marginTop: 9, color: "#C9CDD2", fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {m?.tournament?.name || "PickleTour"}
          {m?.stageLabel ? ` · ${m.stageLabel}` : ""}
          {m?.courtLabel ? ` · Sân ${m.courtLabel}` : ""}
        </div>
        <div style={{ marginTop: 7, display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ color: "#F5F6F7", fontWeight: 750, fontSize: "clamp(17px, 2.2vw, 24px)", letterSpacing: "-0.01em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
            {m?.teamAName || "Đội A"}
            <span style={{ color: "#9AA0A6", fontWeight: 600, fontSize: "0.75em", margin: "0 9px" }}>vs</span>
            {m?.teamBName || "Đội B"}
          </span>
          {sc.show && (
            <span style={{ color: "#F5F6F7", fontWeight: 800, fontSize: "clamp(20px, 2.6vw, 30px)", lineHeight: 1 }}>
              {sc.a}
              <span style={{ color: "#8F959C", margin: "0 7px" }}>–</span>
              {sc.b}
            </span>
          )}
        </div>
      </div>

      {/* rail hành động */}
      <div style={{ position: "absolute", right: 16, bottom: 36, display: "flex", flexDirection: "column", gap: 12 }}>
        {fileUrl && (
          <RailBtn onClick={onToggleMute} title={muted ? "Bật tiếng" : "Tắt tiếng"}>
            {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
          </RailBtn>
        )}
        {m?.tournament?._id && (
          <RailBtn onClick={() => onOpenTournament(m)} title="Các trận trong giải này">
            <ListVideo size={19} />
          </RailBtn>
        )}
        <RailBtn
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(openUrl || window.location.href);
              onCopied();
            } catch {
              /* clipboard bị chặn thì thôi */
            }
          }}
          title="Sao chép liên kết"
        >
          <Link2 size={19} />
        </RailBtn>
        {openUrl && (
          <RailBtn onClick={() => window.open(openUrl, "_blank", "noopener,noreferrer")} title="Mở trong tab mới">
            <ExternalLink size={18} />
          </RailBtn>
        )}
      </div>

      {/* thanh tua (chỉ khi có video) */}
      {fileUrl && (
        <>
          {scrub != null && (
            <div style={{ position: "absolute", bottom: 34, left: "50%", transform: "translateX(-50%)", padding: "6px 13px", borderRadius: 999, background: "rgba(24,25,28,.85)", color: "#F0F1F3", fontSize: 13.5, fontWeight: 700, border: "1px solid rgba(255,255,255,.14)", pointerEvents: "none", zIndex: 5 }}>
              {fmtTime(shown * dur)} <span style={{ color: "#8F959C", fontWeight: 500 }}>/ {fmtTime(dur)}</span>
            </div>
          )}
          <div
            ref={seekRef}
            className="pk-seek"
            onPointerDown={scrubStart}
            onPointerMove={scrubMove}
            onPointerUp={scrubEnd}
            onPointerCancel={() => setScrub(null)}
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 24, display: "flex", alignItems: "flex-end", zIndex: 4, touchAction: "none" }}
          >
            <div className="pk-seek-bar" style={{ position: "relative", width: "100%", height: scrub != null ? 6 : 3, background: "rgba(255,255,255,.22)" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${shown * 100}%`, background: "var(--color-brand, #3D87FF)" }} />
              <div style={{ position: "absolute", left: `calc(${shown * 100}% - 6px)`, top: "50%", transform: "translateY(-50%)", width: 12, height: 12, borderRadius: 99, background: "#F5F6F7", opacity: scrub != null ? 1 : 0, transition: "opacity .15s" }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------- panel "các trận trong giải" ---------------------- */
function TournamentDrawer({ tournament, currentId, onPick, onClose }) {
  const { data, isFetching } = useGetLiveFeedQuery({
    tournamentId: tournament._id,
    page: 1,
    limit: 50,
    mode: "all",
    source: "all",
    replayState: "all",
    sort: "smart",
  });
  const items = Array.isArray(data?.items) ? data.items : [];

  return (
    <>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 44, background: "rgba(0,0,0,.45)" }} />
      <div className="pk-slidein" style={{ position: "absolute", top: 0, right: 0, bottom: 0, zIndex: 45, width: "min(420px, 92vw)", display: "flex", flexDirection: "column", background: "rgba(17,18,20,.97)", borderLeft: "1px solid rgba(255,255,255,.09)", backdropFilter: "blur(14px)" }}>
        <div style={{ padding: "16px 18px 13px", borderBottom: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: "#8F959C", fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em" }}>CÁC TRẬN TRONG GIẢI</div>
            <div style={{ marginTop: 5, color: "#F0F1F3", fontWeight: 700, fontSize: 15, lineHeight: 1.35 }}>{tournament.name}</div>
            {Number(data?.count) > 0 && (
              <div style={{ marginTop: 3, color: "#8F959C", fontSize: 12.5 }}>{data.count} trận</div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" style={{ all: "unset", width: 34, height: 34, borderRadius: 999, display: "grid", placeItems: "center", cursor: "pointer", background: "rgba(255,255,255,.08)", color: "#DFE2E5", flexShrink: 0 }}>
            <X size={17} />
          </button>
        </div>
        <div className="pk-feed" style={{ flex: 1, overflowY: "auto", padding: "8px 10px 16px" }}>
          {isFetching && !items.length ? (
            <div style={{ display: "grid", placeItems: "center", padding: "60px 0" }}>
              <Loader2 size={26} color="#8F959C" className="pk-spinning" />
            </div>
          ) : (
            items.map((it) => {
              const cur = it._id === currentId;
              const s = scoreOf(it);
              const p = String(it?.posterUrl || "").trim();
              return (
                <button
                  key={it._id}
                  type="button"
                  onClick={() => onPick(it)}
                  className="pk-menuitem"
                  style={{ all: "unset", display: "flex", gap: 11, alignItems: "center", width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 12, cursor: "pointer", background: cur ? "rgba(61,135,255,.12)" : "transparent", border: cur ? "1px solid rgba(61,135,255,.3)" : "1px solid transparent" }}
                >
                  <div style={{ width: 74, height: 44, borderRadius: 8, overflow: "hidden", background: "#1B1C1F", flexShrink: 0, position: "relative" }}>
                    {p ? (
                      <div style={{ position: "absolute", inset: 0, backgroundImage: `url("${p}")`, backgroundSize: "cover", backgroundPosition: "center" }} />
                    ) : (
                      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}><PickleMark size={18} /></div>
                    )}
                    {isLive(it) && <span style={{ position: "absolute", top: 4, left: 4, width: 7, height: 7, borderRadius: 99, background: "#F2555A" }} />}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: "#F0F1F3", fontWeight: 650, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {it.teamAName} <span style={{ color: "#8F959C" }}>vs</span> {it.teamBName}
                    </div>
                    <div style={{ marginTop: 3, color: "#8F959C", fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
                      {s.show && <span style={{ color: "#C9CDD2", fontWeight: 700 }}>{s.a}–{s.b}</span>}
                      {it.stageLabel && <span>{it.stageLabel}</span>}
                      {it.displayCode && <span>{it.displayCode}</span>}
                      {cur && <span style={{ color: "#9CC1FF", fontWeight: 700 }}>ĐANG XEM</span>}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------ search bar ------------------------------ */
function SearchBar({ onPick, onClose }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(timer.current);
  }, [q]);

  const { data, isFetching } = useGetLiveFeedQuery(
    { q: debounced, page: 1, limit: 8, mode: "all", source: "all", replayState: "all", sort: "smart" },
    { skip: !debounced }
  );
  const sugs = debounced && Array.isArray(data?.items) ? data.items : [];

  return (
    <div style={{ width: "min(560px, 92vw)", pointerEvents: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, height: 42, padding: "0 15px", borderRadius: 999, background: "rgba(24,25,28,.85)", border: "1px solid rgba(255,255,255,.16)", backdropFilter: "blur(10px)" }}>
        <Search size={16} color="#9AA0A6" style={{ flexShrink: 0 }} />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && sugs[0]) onPick(sugs[0], debounced);
          }}
          placeholder="Tìm đội, giải đấu, mã trận…"
          style={{ all: "unset", flex: 1, color: "#F0F1F3", fontSize: 14.5, fontFamily: "inherit" }}
        />
        {isFetching && <Loader2 size={15} color="#8F959C" className="pk-spinning" />}
        <button type="button" onClick={onClose} aria-label="Đóng tìm kiếm" style={{ all: "unset", cursor: "pointer", color: "#9AA0A6", display: "grid", placeItems: "center" }}>
          <X size={16} />
        </button>
      </div>

      {sugs.length > 0 && (
        <div className="pk-fade" style={{ marginTop: 8, borderRadius: 16, overflow: "hidden", background: "rgba(17,18,20,.97)", border: "1px solid rgba(255,255,255,.10)", backdropFilter: "blur(14px)", maxHeight: "52dvh", overflowY: "auto" }}>
          {sugs.map((it) => {
            const s = scoreOf(it);
            return (
              <button
                key={it._id}
                type="button"
                onClick={() => onPick(it, debounced)}
                className="pk-menuitem"
                style={{ all: "unset", display: "flex", gap: 11, alignItems: "center", width: "100%", boxSizing: "border-box", padding: "10px 13px", cursor: "pointer" }}
              >
                <div style={{ width: 64, height: 38, borderRadius: 7, overflow: "hidden", background: "#1B1C1F", flexShrink: 0, position: "relative" }}>
                  {it.posterUrl ? (
                    <div style={{ position: "absolute", inset: 0, backgroundImage: `url("${it.posterUrl}")`, backgroundSize: "cover", backgroundPosition: "center" }} />
                  ) : (
                    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}><PickleMark size={16} /></div>
                  )}
                  {isLive(it) && <span style={{ position: "absolute", top: 3, left: 3, width: 6, height: 6, borderRadius: 99, background: "#F2555A" }} />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: "#F0F1F3", fontWeight: 650, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {it.teamAName} <span style={{ color: "#8F959C" }}>vs</span> {it.teamBName}
                    {s.show && <span style={{ color: "#C9CDD2", fontWeight: 700, marginLeft: 8 }}>{s.a}–{s.b}</span>}
                  </div>
                  <div style={{ marginTop: 3, color: "#8F959C", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {(it.tournament?.name || "PickleTour")}
                    {it.stageLabel ? ` · ${it.stageLabel}` : ""}
                  </div>
                </div>
                {isLive(it) && <span style={{ color: "#FF8A8E", fontSize: 11, fontWeight: 750, flexShrink: 0 }}>LIVE</span>}
              </button>
            );
          })}
        </div>
      )}
      {debounced && !isFetching && !sugs.length && (
        <div className="pk-fade" style={{ marginTop: 8, padding: "14px 16px", borderRadius: 14, background: "rgba(17,18,20,.95)", border: "1px solid rgba(255,255,255,.10)", color: "#8F959C", fontSize: 13.5 }}>
          Không thấy trận nào khớp "{debounced}"
        </div>
      )}
    </div>
  );
}

/* ================================= PAGE ================================= */
export default function LivePage() {
  const [mode, setMode] = useState("all");
  // ngữ cảnh feed: mode thường / kết quả tìm kiếm / các trận trong 1 giải
  const [ctx, setCtx] = useState({ type: "mode" });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerFor, setDrawerFor] = useState(null); // {._id, .name} của giải đang mở panel
  const feedRef = useRef(null);
  const copiedTimer = useRef(null);
  const jumpRef = useRef(null); // _id trận cần nhảy tới sau khi rows nạp

  const queryArgs = useMemo(
    () => ({
      page,
      limit: 10,
      mode: ctx.type === "mode" ? mode : "all",
      source: "all",
      replayState: "all",
      sort: "smart",
      ...(ctx.type === "search" ? { q: ctx.q } : {}),
      ...(ctx.type === "tournament" ? { tournamentId: ctx.id } : {}),
    }),
    [page, mode, ctx]
  );
  const { data, isFetching } = useGetLiveFeedQuery(queryArgs);

  useEffect(() => {
    const items = Array.isArray(data?.items) ? data.items : null;
    if (!items) return;
    setRows((prev) => {
      if (page === 1) return items;
      const seen = new Set(prev.map((x) => x._id));
      return [...prev, ...items.filter((d) => !seen.has(d._id))];
    });
  }, [data, page]);

  // nhảy tới trận đã chọn (từ search / panel giải) ngay khi nó có trong feed
  useEffect(() => {
    if (!jumpRef.current || !rows.length) return;
    const idx = rows.findIndex((r) => r._id === jumpRef.current);
    if (idx < 0) return;
    jumpRef.current = null;
    requestAnimationFrame(() => {
      const root = feedRef.current;
      if (root) root.scrollTo({ top: idx * root.clientHeight, behavior: "instant" });
      setActive(idx);
    });
  }, [rows]);

  const resetFeed = () => {
    setPage(1);
    setRows([]);
    setActive(0);
    feedRef.current?.scrollTo({ top: 0, behavior: "instant" });
  };
  const changeMode = (next) => {
    setMode(next);
    setCtx({ type: "mode" });
    resetFeed();
  };
  const exitCtx = () => {
    setCtx({ type: "mode" });
    resetFeed();
  };

  // chọn trận từ gợi ý search
  const pickFromSearch = (match, q) => {
    setSearchOpen(false);
    jumpRef.current = match._id;
    setCtx({ type: "search", q });
    resetFeed();
  };
  // chọn trận từ panel "các trận trong giải"
  const pickFromTournament = (match) => {
    const t = drawerFor;
    setDrawerFor(null);
    const idx = rows.findIndex((r) => r._id === match._id);
    if (idx >= 0 && (ctx.type !== "tournament" || ctx.id === t._id)) {
      const root = feedRef.current;
      if (root) root.scrollTo({ top: idx * root.clientHeight, behavior: "instant" });
      setActive(idx);
      return;
    }
    jumpRef.current = match._id;
    setCtx({ type: "tournament", id: t._id, name: t.name });
    resetFeed();
  };

  // slide nào chiếm tâm màn -> active
  useEffect(() => {
    const root = feedRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const idx = Number(e.target.getAttribute("data-slide"));
            if (Number.isFinite(idx)) setActive(idx);
          }
        }
      },
      { root, threshold: 0.6 }
    );
    root.querySelectorAll("[data-slide]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [rows.length]);

  // cuộn vô tận
  const hasMore = Number(data?.page || 1) < Number(data?.pages || 1);
  useEffect(() => {
    if (hasMore && !isFetching && rows.length && active >= rows.length - 3) {
      setPage((p) => p + 1);
    }
  }, [active, rows.length, hasMore, isFetching]);

  const onCopied = useCallback(() => {
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
  }, []);

  const initialLoading = isFetching && page === 1 && !rows.length;
  const liveCount = useMemo(() => rows.filter(isLive).length, [rows]);

  return (
    <>
      <SEOHead
        title="Trực tiếp pickleball — PickleTour"
        description="Lướt xem trực tiếp và xem lại các trận pickleball từ những giải đấu trên PickleTour."
      />
      <ShadowFrame style={{ height: "100dvh" }}>
        <Theme theme={neutralTheme}>
          <div style={{ height: "100dvh", background: "#000", position: "relative", overflow: "hidden" }}>
            {/* nav nổi trên feed */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 30 }}>
              <SiteNav />
            </div>

            {/* hàng điều khiển nổi dưới nav: pills + search (hoặc ô search mở rộng) */}
            <div style={{ position: "absolute", top: NAV_H + 12, left: 0, right: 0, zIndex: 25, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
              {searchOpen ? (
                <SearchBar onPick={pickFromSearch} onClose={() => setSearchOpen(false)} />
              ) : (
                <div style={{ display: "flex", gap: 8, pointerEvents: "auto", alignItems: "center" }}>
                  {MODES.map(([key, label]) => {
                    const activeTab = ctx.type === "mode" && mode === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => changeMode(key)}
                        className="pk-pill"
                        style={{ all: "unset", display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 15px", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 650, background: activeTab ? "#F2F3F5" : "rgba(24,25,28,.6)", color: activeTab ? "#101114" : "#D8DBDF", border: activeTab ? "1px solid transparent" : "1px solid rgba(255,255,255,.14)", backdropFilter: "blur(8px)" }}
                      >
                        {key === "live" && liveCount > 0 && !activeTab && (
                          <span style={{ width: 6, height: 6, borderRadius: 99, background: "#F2555A" }} />
                        )}
                        {label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setSearchOpen(true)}
                    aria-label="Tìm kiếm trận"
                    className="pk-pill"
                    style={{ all: "unset", width: 34, height: 34, borderRadius: 999, display: "grid", placeItems: "center", cursor: "pointer", background: "rgba(24,25,28,.6)", color: "#D8DBDF", border: "1px solid rgba(255,255,255,.14)", backdropFilter: "blur(8px)" }}
                  >
                    <Search size={15} />
                  </button>
                </div>
              )}
            </div>

            {/* chip ngữ cảnh khi đang xem kết quả search / trận trong giải */}
            {ctx.type !== "mode" && !searchOpen && (
              <div style={{ position: "absolute", top: NAV_H + 58, left: 0, right: 0, zIndex: 24, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
                <button
                  type="button"
                  onClick={exitCtx}
                  style={{ all: "unset", pointerEvents: "auto", display: "inline-flex", alignItems: "center", gap: 8, maxWidth: "86vw", padding: "6px 13px", borderRadius: 999, cursor: "pointer", background: "rgba(61,135,255,.14)", color: "#9CC1FF", fontSize: 12.5, fontWeight: 650, border: "1px solid rgba(61,135,255,.32)", backdropFilter: "blur(8px)" }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ctx.type === "search" ? `Kết quả cho "${ctx.q}"` : `Giải: ${ctx.name}`}
                  </span>
                  <X size={13} style={{ flexShrink: 0 }} />
                </button>
              </div>
            )}

            {/* toast sao chép */}
            {copied && (
              <div className="pk-fade" style={{ position: "absolute", top: NAV_H + 100, left: "50%", transform: "translateX(-50%)", zIndex: 40, display: "flex", alignItems: "center", gap: 7, padding: "8px 15px", borderRadius: 999, background: "rgba(24,25,28,.86)", color: "#E6E8EA", fontSize: 13, fontWeight: 650, border: "1px solid rgba(255,255,255,.14)", backdropFilter: "blur(8px)" }}>
                <Check size={14} color="#3BA55D" />
                Đã sao chép liên kết
              </div>
            )}

            {/* FEED dọc snap từng trận */}
            <div
              ref={feedRef}
              className="pk-feed"
              style={{ height: "100dvh", overflowY: "auto", scrollSnapType: "y mandatory", overscrollBehavior: "contain" }}
            >
              {initialLoading ? (
                <div style={{ height: "100dvh", display: "grid", placeItems: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <Loader2 size={34} color="#8F959C" className="pk-spinning" style={{ margin: "0 auto" }} />
                    <div style={{ marginTop: 14, color: "#8F959C", fontSize: 14 }}>Đang tải các trận…</div>
                  </div>
                </div>
              ) : rows.length ? (
                rows.map((m, i) => (
                  <Slide
                    key={m._id || i}
                    m={m}
                    index={i}
                    active={i === active}
                    muted={muted}
                    onToggleMute={() => setMuted((v) => !v)}
                    onCopied={onCopied}
                    onOpenTournament={(match) => setDrawerFor(match.tournament)}
                  />
                ))
              ) : (
                <div style={{ height: "100dvh", display: "grid", placeItems: "center" }}>
                  <div style={{ textAlign: "center", padding: "0 24px" }}>
                    <div style={{ display: "flex", justifyContent: "center", opacity: 0.55 }}>
                      <PickleMark size={44} />
                    </div>
                    <div style={{ marginTop: 16, color: "#DFE2E5", fontSize: 18, fontWeight: 700 }}>
                      {ctx.type === "search" ? "Không có kết quả" : mode === "live" ? "Chưa có trận nào đang phát" : "Chưa có video nào"}
                    </div>
                    <div style={{ marginTop: 8, color: "#8F959C", fontSize: 14.5 }}>
                      {ctx.type === "mode" ? "Quay lại sau nhé — trận mới lên sóng liên tục." : "Thử từ khoá khác xem sao."}
                    </div>
                  </div>
                </div>
              )}
              {isFetching && page > 1 && (
                <div style={{ height: 90, display: "grid", placeItems: "center" }}>
                  <Loader2 size={26} color="#8F959C" className="pk-spinning" />
                </div>
              )}
            </div>

            {/* panel các trận trong giải */}
            {drawerFor && (
              <TournamentDrawer
                tournament={drawerFor}
                currentId={rows[active]?._id}
                onPick={pickFromTournament}
                onClose={() => setDrawerFor(null)}
              />
            )}
          </div>
        </Theme>
      </ShadowFrame>
    </>
  );
}
