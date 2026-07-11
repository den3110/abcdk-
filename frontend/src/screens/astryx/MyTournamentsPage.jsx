/**
 * MyTournamentsPage — trang "GIẢI CỦA TÔI" phong cách Astryx (/my-tournaments, trong ShadowFrame, dark).
 * Cấu trúc: SiteNav → hero gọn (tiêu đề typographic + pill live + dãy đếm số) →
 * toolbar sticky (tab trạng thái + search + toggle thẻ/danh sách + nút làm mới) →
 * grid card giải (ảnh + badge + chip thanh toán/check-in + danh sách TRẬN CỦA TÔI có
 * search/filter/expand, cập nhật tỷ số realtime qua socket) hoặc chế độ danh sách gọn →
 * SiteFooter. Bấm trận -> mở ResponsiveMatchViewer (render NGOÀI ShadowFrame vì là MUI portal).
 * Data thật: useListMyTournamentsQuery (giữ nguyên logic ẩn trận KO chờ vòng bảng +
 * merge payload socket như trang cũ screens/MyTournaments.jsx).
 * ?ui=v1 tại route này sẽ ra trang cũ (gate ở MyTournamentsGate.jsx).
 */
import "@fontsource-variable/figtree";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { skipToken } from "@reduxjs/toolkit/query";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import {
  ArrowUpRight,
  CalendarDays,
  CalendarRange,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  Clock3,
  LayoutGrid,
  Lock,
  MapPin,
  Network,
  RefreshCw,
  Rows3,
  Search,
  Swords,
  Ticket,
} from "lucide-react";

import SEOHead from "../../components/SEOHead.jsx";
import ShadowFrame from "./ShadowFrame.jsx";
import SiteNav from "./SiteNav.jsx";
import SiteFooter from "./SiteFooter.jsx";
import PickleMark from "./PickleMark.jsx";
import { A, WhitePill, GrayPill, Lightbox, imgSrc } from "./ui.jsx";
import { useListMyTournamentsQuery } from "../../slices/tournamentsApiSlice.js";
import ResponsiveMatchViewer from "../PickleBall/match/ResponsiveMatchViewer.jsx";
import { useSocket } from "../../context/SocketContext.jsx";
import { useSocketRoomSet } from "../../hook/useSocketRoomSet.js";
import {
  isNewerOrEqualMatchPayload,
  mergeMatchPayload,
  normalizeMatchDisplay,
} from "../../utils/matchDisplay.js";

/* ----------------------------- token màu theme -----------------------------
   Site sắp có light/dark: mọi màu chữ/nền/viền tùy chỉnh đi qua CSS var,
   fallback là giá trị dark hiện tại. Màu accent/trạng thái được phép giữ hex. */
const C = {
  strong: "var(--pk-text-strong, #F0F1F3)",
  text: "var(--pk-text, #C9CDD2)",
  mute: "var(--pk-text-mute, #8F959C)",
  faint: "var(--pk-text-faint, #6E747B)",
  surface2: "var(--pk-surface-2, rgba(255,255,255,.05))",
  border2: "var(--pk-border-2, rgba(255,255,255,.12))",
  chipBg: "var(--pk-chip-bg, rgba(255,255,255,.06))",
};

/* ------------------------------- helpers ------------------------------- */
const Container = ({ children, style }) => (
  <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px", ...style }}>
    {children}
  </div>
);

/* tìm kiếm không dấu */
const fold = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");

const fmtD = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
};
const fmtRange = (a, b) => {
  const s = fmtD(a);
  const e = fmtD(b);
  if (s && e && s !== e) return `${s} – ${e}`;
  return s || e || "";
};
/* giờ trận: "dd/MM • HH:mm" — thiếu giờ thì báo chưa xếp lịch */
const fmtDT = (s) => {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return `${date} • ${time}`;
};

/* A=1, B=2… — đồng bộ key groupCompletionStatus với backend (giữ nguyên trang cũ) */
function normalizeGroupCode(code) {
  const s = String(code || "").trim().toUpperCase();
  if (!s) return "";
  if (/^\d+$/.test(s)) return s;
  if (/^[A-Z]$/.test(s)) return String(s.charCodeAt(0) - 64);
  return s;
}

/* tên VĐV: ưu tiên nickname (như trang cũ) */
const nameWithNick = (p) => {
  if (!p) return "—";
  const nick = p.nickName || p.nickname || p.nick || p.alias;
  return nick?.trim() || p.fullName || p.name || "—";
};
const teamLabel = (team, eventType) => {
  if (!team) return "—";
  if (team.name) return team.name;
  const players =
    team.players || team.members || [team.player1, team.player2].filter(Boolean) || [];
  if (!players.length) return "—";
  if (eventType === "single") return nameWithNick(players[0]);
  if (players.length === 1) return nameWithNick(players[0]);
  return `${nameWithNick(players[0])} & ${nameWithNick(players[1])}`;
};

/* nhãn vòng đấu (chuỗi tiếng Việt như i18n trang cũ) */
function roundText(m) {
  if (m.roundName) return m.roundName;
  if (m.phase) return m.phase;
  if (m.format === "group") {
    const poolName = m.pool?.name || m.groupCode;
    if (poolName) return `Bảng ${String(poolName).toUpperCase()}`;
    if (Number.isFinite(m.rrRound)) return `Vòng bảng - Lượt ${m.rrRound + 1}`;
    return "Vòng bảng";
  }
  if (Number.isFinite(m.swissRound)) return `Swiss - Vòng ${m.swissRound + 1}`;
  if (Number.isFinite(m.round)) {
    if (m.format === "knockout" || m.format === "roundElim") {
      const names = { 1: "Vòng 1/16", 2: "Vòng 1/8", 3: "Tứ kết", 4: "Bán kết", 5: "Chung kết" };
      return names[m.round] || `Vòng ${m.round}`;
    }
    return `Vòng ${m.round}`;
  }
  return "—";
}

/* tỷ số: ưu tiên scoreText, fallback gameScores/sets */
function formatScore(m) {
  if (typeof m?.scoreText === "string" && m.scoreText.trim()) return m.scoreText.trim();
  const arr =
    (Array.isArray(m?.gameScores) && m.gameScores.length && m.gameScores) ||
    (Array.isArray(m?.sets) && m.sets) ||
    [];
  if (!arr.length) return "";
  return arr.map((s) => `${s.a ?? s.home ?? 0}–${s.b ?? s.away ?? 0}`).join("  ");
}

/* gom status trận về 3 nhóm hiển thị (queued/assigned tính là sắp diễn ra —
   trang cũ vô tình ẨN các trận này khỏi bộ lọc, bản mới giữ cho hiện) */
const matchBucket = (m) => {
  const s = String(m?.status || "").toLowerCase();
  if (s === "live") return "live";
  if (s === "finished" || (!s && m?.winner)) return "finished";
  return "scheduled";
};

const MSTATUS = {
  live: { label: "Live", color: "#FF8A8E", bg: "rgba(229,72,77,.12)", border: "rgba(242,85,90,.35)", bar: "#F2555A" },
  scheduled: { label: "Sắp diễn ra", color: "#9CC1FF", bg: "rgba(61,135,255,.14)", border: "rgba(61,135,255,.32)", bar: "#3D87FF" },
  finished: { label: "Đã kết thúc", color: "#7CC7A2", bg: "rgba(59,165,93,.12)", border: "rgba(59,165,93,.3)", bar: "#3BA55D" },
};

const STATUS_META = {
  ongoing: { label: "Đang diễn ra", variant: "success" },
  upcoming: { label: "Sắp diễn ra", variant: "info" },
  finished: { label: "Đã kết thúc", variant: "neutral" },
};
const statusOf = (t) => {
  const s = String(t?.status || "").toLowerCase();
  if (STATUS_META[s]) return s;
  const now = Date.now();
  const st = new Date(t?.startDate || t?.startAt || 0).getTime() || 0;
  const en = new Date(t?.endDate || t?.endAt || 0).getTime() || 0;
  if (st && now < st) return "upcoming";
  if (en && now > en) return "finished";
  return "ongoing";
};
const startOf = (t) => new Date(t?.startDate || t?.startAt || 0).getTime() || 0;

/* theo dõi bề rộng — chế độ danh sách chỉ có trên desktop (như trang cũ) */
function useIsWide(bp = 900) {
  const [wide, setWide] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= bp,
  );
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= bp);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [bp]);
  return wide;
}

/* ------------------------------ style dùng lại ------------------------------ */
const chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 9px",
  borderRadius: 999,
  fontSize: 11.5,
  fontWeight: 650,
  background: C.chipBg,
  color: C.text,
  border: `1px solid ${C.border2}`,
  whiteSpace: "nowrap",
};
const chipOk = { ...chip, background: "rgba(59,165,93,.12)", color: "#7CC7A2", border: "1px solid rgba(59,165,93,.3)" };
const chipBlue = { ...chip, background: "rgba(61,135,255,.14)", color: "#9CC1FF", border: "1px solid rgba(61,135,255,.3)" };

const miniBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "7px 14px",
  borderRadius: 999,
  fontSize: 12.5,
  fontWeight: 700,
  textDecoration: "none",
  whiteSpace: "nowrap",
  cursor: "pointer",
};
/* pill trắng = CTA chuẩn Astryx (đồng bộ WhitePill trong ui.jsx) */
const miniPrimary = { ...miniBase, background: "#F2F3F5", color: "#101114" };
const miniGhost = { ...miniBase, background: C.surface2, color: C.text, border: `1px solid ${C.border2}` };

/* ------------------------------ tiểu phần UI ------------------------------ */

/* pill trạng thái trận nhỏ (LIVE có nhịp đập) */
function MatchStatusPill({ bucket }) {
  const ms = MSTATUS[bucket] || MSTATUS.scheduled;
  return (
    <span
      className={bucket === "live" ? "pk-live" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 750,
        letterSpacing: ".02em",
        background: ms.bg,
        color: ms.color,
        border: `1px solid ${ms.border}`,
        flexShrink: 0,
      }}
    >
      {bucket === "live" && <span style={{ width: 5, height: 5, borderRadius: 99, background: "#F2555A" }} />}
      {ms.label}
    </span>
  );
}

/* 1 trận của tôi — dense=false: khối 2 dòng đội + tỷ số; dense=true: 1 dòng gọn */
function MatchItem({ m, eventType, onOpen, dense = false }) {
  const bucket = matchBucket(m);
  const ms = MSTATUS[bucket] || MSTATUS.scheduled;
  const a = m.teamA || m.home || m.teams?.[0] || m.pairA;
  const b = m.teamB || m.away || m.teams?.[1] || m.pairB;
  const when = m.scheduledAt || m.startTime || m.time;
  const court = m.courtName || m.court || "";
  const score = formatScore(m);
  const open = () => onOpen?.(m);
  const onKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };

  if (dense) {
    return (
      <div
        className="pk-trow"
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={onKey}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "7px 10px",
          borderRadius: 10,
          border: `1px solid ${C.border2}`,
          background: C.surface2,
          cursor: "pointer",
          minWidth: 0,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 99, background: ms.bar, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 650, color: C.strong }}>
          {teamLabel(a, eventType)} <span style={{ color: C.faint, fontWeight: 500 }}>vs</span> {teamLabel(b, eventType)}
        </span>
        {score && (
          <span style={{ fontSize: 12, fontWeight: 750, color: C.text, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {score}
          </span>
        )}
        <span style={{ fontSize: 11.5, color: C.mute, whiteSpace: "nowrap", flexShrink: 0 }}>
          {bucket === "live" ? roundText(m) : fmtDT(when) || roundText(m)}
        </span>
      </div>
    );
  }

  return (
    <div
      className="pk-trow"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKey}
      style={{
        display: "flex",
        gap: 11,
        padding: "10px 12px",
        borderRadius: 12,
        border: `1px solid ${C.border2}`,
        background: C.surface2,
        cursor: "pointer",
        alignItems: "stretch",
      }}
    >
      <span aria-hidden style={{ width: 3, borderRadius: 99, background: ms.bar, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, minWidth: 0 }}>
          <MatchStatusPill bucket={bucket} />
          <span style={{ fontSize: 11.5, fontWeight: 650, color: C.mute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {roundText(m)}
          </span>
          <span style={{ flex: 1 }} />
          {score && (
            <span
              style={{
                padding: "2px 9px",
                borderRadius: 8,
                background: C.chipBg,
                border: `1px solid ${C.border2}`,
                fontSize: 12.5,
                fontWeight: 750,
                color: C.strong,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {score}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.strong, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {teamLabel(a, eventType)}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.strong, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
          {teamLabel(b, eventType)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 7, fontSize: 11.5, color: C.mute, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Clock3 size={11} />
            {fmtDT(when) || "Chưa xếp lịch"}
          </span>
          {!!court && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Swords size={11} />
              Sân {court}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* toggle lọc trạng thái trận trong card (giữ tối thiểu 1 lựa chọn như trang cũ) */
function StatusToggle({ label, dot, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pk-pill"
      style={{
        all: "unset",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 11px",
        borderRadius: 999,
        cursor: "pointer",
        fontSize: 11.5,
        fontWeight: 700,
        background: active ? "#F2F3F5" : C.chipBg,
        color: active ? "#101114" : C.mute,
        border: active ? "1px solid transparent" : `1px solid ${C.border2}`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 99, background: dot, opacity: active ? 1 : 0.55 }} />
      {label}
    </button>
  );
}

/* nút hành động nhanh theo trạng thái giải (check-in / lịch đấu / sơ đồ / chi tiết) */
function QuickActions({ t, st }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {st === "upcoming" && (
        <A href={`/tournament/${t._id}/checkin`} className="pk-pill" style={miniPrimary}>
          <CheckCheck size={13} strokeWidth={2.4} />
          Check-in
        </A>
      )}
      {st === "ongoing" && (
        <A href={`/tournament/${t._id}/schedule`} className="pk-pill" style={miniPrimary}>
          <CalendarRange size={13} strokeWidth={2.2} />
          Lịch đấu
        </A>
      )}
      <A href={`/tournament/${t._id}/bracket`} className="pk-pill" style={miniGhost}>
        <Network size={13} strokeWidth={2.2} />
        Sơ đồ
      </A>
      <A
        href={`/tournament/${t._id}`}
        className="pk-link"
        style={{
          marginLeft: "auto",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          color: "var(--color-text-accent, #3E9EFB)",
          fontSize: 13,
          fontWeight: 650,
          textDecoration: "none",
        }}
      >
        Chi tiết
        <ArrowUpRight size={14} />
      </A>
    </div>
  );
}

/* chip phụ của giải: loại nội dung + số trận + thanh toán + check-in */
function TourChips({ t }) {
  const regs = Array.isArray(t.myRegistrationIds) ? t.myRegistrationIds.length : 0;
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      <span style={chip}>
        <Swords size={11} />
        {String(t.eventType || "").toLowerCase() === "single" ? "Đấu đơn" : "Đấu đôi"}
      </span>
      {regs > 1 && (
        <span style={chip}>
          <Ticket size={11} />
          {regs} đăng ký
        </span>
      )}
      {t.paidAny && (
        <span style={chipOk}>
          <CheckCheck size={11} />
          Đã thanh toán
        </span>
      )}
      {t.checkedAny && (
        <span style={chipBlue}>
          <CheckCheck size={11} />
          Đã check-in
        </span>
      )}
    </div>
  );
}

/* --------------------------- CARD chế độ thẻ --------------------------- */
function TourCard({ t, index, onOpenMatch, onZoom }) {
  const st = statusOf(t);
  const meta = STATUS_META[st];
  const img = imgSrc(t.image || t.cover || t.bannerUrl);
  const matches = Array.isArray(t.matches) ? t.matches : [];

  // giải đã kết thúc: mặc định thu gọn danh sách trận (như trang cũ)
  const [open, setOpen] = useState(st !== "finished");
  const [expanded, setExpanded] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(() => new Set(["scheduled", "live", "finished"]));

  const toggleFilter = (key) =>
    setFilter((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      if (n.size === 0) n.add(key); // luôn giữ ít nhất 1
      return n;
    });

  const filtered = useMemo(() => {
    const needle = fold(q.trim());
    return matches.filter((m) => {
      if (!filter.has(matchBucket(m))) return false;
      if (!needle) return true;
      const a = m.teamA || m.home || m.teams?.[0] || m.pairA;
      const b = m.teamB || m.away || m.teams?.[1] || m.pairB;
      const hay = fold(
        [teamLabel(a, t.eventType), teamLabel(b, t.eventType), roundText(m), m.courtName || m.court || ""].join(" | "),
      );
      return hay.includes(needle);
    });
  }, [matches, q, filter, t.eventType]);

  const shown = expanded ? filtered : filtered.slice(0, 5);
  const hasMore = filtered.length > shown.length;
  const liveCount = useMemo(() => matches.filter((m) => matchBucket(m) === "live").length, [matches]);
  const filterDirty = !!q || filter.size !== 3;

  return (
    <article
      className="pk-tcard pk-reveal-card"
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 18,
        overflow: "hidden",
        background: "var(--color-background-surface)",
        border: "1px solid var(--color-border)",
        animationDelay: `${Math.min(index, 8) * 0.05}s`,
      }}
    >
      {/* ảnh bìa + badge trạng thái + khoảng ngày */}
      <div
        style={{ position: "relative", height: 148, overflow: "hidden", background: "var(--color-background-body)", cursor: img ? "zoom-in" : undefined }}
        onClick={img ? () => onZoom?.(img) : undefined}
      >
        {img ? (
          <div
            className="pk-tcard-img"
            style={{ position: "absolute", inset: 0, backgroundImage: `url("${img}")`, backgroundSize: "cover", backgroundPosition: "center" }}
          />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "radial-gradient(70% 90% at 50% 0%, rgba(61,135,255,.18), transparent 70%)" }}>
            <PickleMark size={40} />
          </div>
        )}
        {/* scrim trên ảnh — cố định dark vì nằm đè lên ảnh */}
        <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(10,11,13,.2) 0%, transparent 40%, rgba(10,11,13,.72) 100%)" }} />
        <div style={{ position: "absolute", top: 12, left: 12 }}>
          {st === "ongoing" ? (
            <span className="pk-live" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 750, background: "rgba(20,21,24,.72)", color: "#FF8A8E", border: "1px solid rgba(242,85,90,.4)", backdropFilter: "blur(6px)" }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: "#F2555A" }} />
              LIVE
            </span>
          ) : (
            meta && <Badge variant={meta.variant} label={meta.label} />
          )}
        </div>
        {!!fmtRange(t.startDate || t.startAt, t.endDate || t.endAt) && (
          <span style={{ position: "absolute", top: 12, right: 12, display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 650, background: "rgba(20,21,24,.72)", color: "#DFE2E5", border: "1px solid rgba(255,255,255,.12)", backdropFilter: "blur(6px)" }}>
            <CalendarDays size={11} />
            {fmtRange(t.startDate || t.startAt, t.endDate || t.endAt)}
          </span>
        )}
        {liveCount > 0 && (
          <span style={{ position: "absolute", bottom: 12, left: 12, display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "rgba(229,72,77,.2)", color: "#FF8A8E", border: "1px solid rgba(242,85,90,.4)", backdropFilter: "blur(6px)" }}>
            <span style={{ width: 5, height: 5, borderRadius: 99, background: "#F2555A" }} />
            {liveCount} trận của bạn đang live
          </span>
        )}
      </div>

      {/* thân card */}
      <div style={{ padding: "15px 16px 15px", display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <A
          href={`/tournament/${t._id}`}
          style={{
            color: C.strong,
            textDecoration: "none",
            fontWeight: 700,
            fontSize: 16.5,
            lineHeight: 1.32,
            letterSpacing: "-0.01em",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {t.name || "Giải đấu"}
        </A>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, color: C.mute, fontSize: 13 }}>
          <MapPin size={13} style={{ flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t.location || "Chưa xác định địa điểm"}
          </span>
        </div>

        <div style={{ marginTop: 11 }}>
          <TourChips t={t} />
        </div>

        {/* khu TRẬN CỦA TÔI */}
        {matches.length > 0 ? (
          <div style={{ marginTop: 13, borderTop: `1px solid ${C.border2}`, paddingTop: 11 }}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, width: "100%" }}
            >
              <span style={{ fontSize: 11.5, fontWeight: 750, letterSpacing: ".07em", textTransform: "uppercase", color: C.mute }}>
                Trận của tôi
              </span>
              <span style={{ fontSize: 11, fontWeight: 750, padding: "1px 7px", borderRadius: 99, background: C.chipBg, color: C.text }}>
                {matches.length}
              </span>
              <span style={{ flex: 1 }} />
              <ChevronDown size={15} color="currentColor" style={{ color: C.mute, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
            </button>

            {open && (
              <div className="pk-fade" style={{ marginTop: 11 }}>
                {/* tìm trận — chỉ hiện khi danh sách đủ dài */}
                {matches.length > 5 && (
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      height: 34,
                      padding: "0 12px",
                      borderRadius: 999,
                      background: C.chipBg,
                      border: `1px solid ${C.border2}`,
                      marginBottom: 9,
                    }}
                  >
                    <Search size={13} style={{ color: C.mute, flexShrink: 0 }} />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Tìm trận (VĐV, vòng, sân…)"
                      style={{ all: "unset", width: "100%", color: C.strong, fontSize: 13, fontFamily: "inherit" }}
                    />
                    {q && (
                      <button type="button" onClick={() => setQ("")} style={{ all: "unset", cursor: "pointer", color: C.mute, fontSize: 11.5, fontWeight: 700 }}>
                        Xoá
                      </button>
                    )}
                  </label>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  <StatusToggle label="Sắp diễn ra" dot="#3D87FF" active={filter.has("scheduled")} onClick={() => toggleFilter("scheduled")} />
                  <StatusToggle label="Live" dot="#F2555A" active={filter.has("live")} onClick={() => toggleFilter("live")} />
                  <StatusToggle label="Kết thúc" dot="#3BA55D" active={filter.has("finished")} onClick={() => toggleFilter("finished")} />
                  {filterDirty && (
                    <button
                      type="button"
                      onClick={() => {
                        setQ("");
                        setFilter(new Set(["scheduled", "live", "finished"]));
                      }}
                      style={{ all: "unset", cursor: "pointer", color: "var(--color-text-accent, #3E9EFB)", fontSize: 11.5, fontWeight: 700, padding: "4px 6px" }}
                    >
                      Reset
                    </button>
                  )}
                </div>

                {filtered.length === 0 ? (
                  <div style={{ border: `1px dashed ${C.border2}`, borderRadius: 12, padding: "16px 12px", textAlign: "center", color: C.mute, fontSize: 13 }}>
                    Không có trận phù hợp bộ lọc.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {shown.map((m) => (
                      <MatchItem key={m._id} m={m} eventType={t.eventType} onOpen={onOpenMatch} />
                    ))}
                    {(hasMore || expanded) && (
                      <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        className="pk-pill"
                        style={{ ...miniGhost, alignSelf: "center", marginTop: 2 }}
                      >
                        {expanded ? "Thu gọn" : `Xem tất cả ${filtered.length} trận`}
                        <ChevronDown size={13} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 13, border: `1px dashed ${C.border2}`, borderRadius: 12, padding: "13px 12px", display: "flex", alignItems: "center", gap: 8, color: C.mute, fontSize: 12.5 }}>
            <Clock3 size={13} style={{ flexShrink: 0 }} />
            Chưa có trận đấu nào được lên lịch.
          </div>
        )}

        <div style={{ marginTop: "auto", paddingTop: 14 }}>
          <QuickActions t={t} st={st} />
        </div>
      </div>
    </article>
  );
}

/* --------------------------- ROW chế độ danh sách --------------------------- */
function TourRow({ t, index, onOpenMatch }) {
  const st = statusOf(t);
  const meta = STATUS_META[st];
  const img = imgSrc(t.image || t.cover || t.bannerUrl);
  const matches = Array.isArray(t.matches) ? t.matches : [];
  const [expanded, setExpanded] = useState(false);

  // như trang cũ: chế độ danh sách chỉ tập trung trận live/sắp diễn ra
  const active = useMemo(() => matches.filter((m) => matchBucket(m) !== "finished"), [matches]);
  const summary = active.slice(0, 2);
  const remaining = active.slice(2);

  return (
    <article
      className="pk-tcard pk-reveal-card"
      style={{
        borderRadius: 16,
        overflow: "hidden",
        background: "var(--color-background-surface)",
        border: "1px solid var(--color-border)",
        padding: "14px 16px",
        animationDelay: `${Math.min(index, 10) * 0.04}s`,
      }}
    >
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* thumb */}
        <A href={`/tournament/${t._id}`} style={{ flexShrink: 0, display: "block", width: 104, height: 72, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border2}`, position: "relative", background: "var(--color-background-body)" }}>
          {img ? (
            <div style={{ position: "absolute", inset: 0, backgroundImage: `url("${img}")`, backgroundSize: "cover", backgroundPosition: "center" }} />
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <PickleMark size={26} />
            </div>
          )}
        </A>

        {/* thông tin giải */}
        <div style={{ flex: "1.1 1 260px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {st === "ongoing" ? (
              <span className="pk-live" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 999, fontSize: 10.5, fontWeight: 750, background: "rgba(229,72,77,.12)", color: "#FF8A8E", border: "1px solid rgba(242,85,90,.35)" }}>
                <span style={{ width: 5, height: 5, borderRadius: 99, background: "#F2555A" }} />
                LIVE
              </span>
            ) : (
              meta && <Badge variant={meta.variant} label={meta.label} />
            )}
            <TourChips t={t} />
          </div>
          <A
            href={`/tournament/${t._id}`}
            style={{ display: "block", marginTop: 7, color: C.strong, textDecoration: "none", fontWeight: 700, fontSize: 15.5, lineHeight: 1.3, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {t.name || "Giải đấu"}
          </A>
          <div style={{ display: "flex", gap: 14, marginTop: 6, color: C.mute, fontSize: 12.5, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              <MapPin size={12} style={{ flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.location || "Chưa xác định địa điểm"}</span>
            </span>
            {!!fmtRange(t.startDate || t.startAt, t.endDate || t.endAt) && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <CalendarDays size={12} />
                {fmtRange(t.startDate || t.startAt, t.endDate || t.endAt)}
              </span>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <QuickActions t={t} st={st} />
          </div>
        </div>

        {/* trận nổi bật */}
        <div style={{ flex: "1.4 1 320px", minWidth: 0 }}>
          {summary.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {summary.map((m) => (
                <MatchItem key={m._id} m={m} eventType={t.eventType} onOpen={onOpenMatch} dense />
              ))}
              {remaining.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  style={{ all: "unset", cursor: "pointer", alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, color: "var(--color-text-accent, #3E9EFB)", fontSize: 12.5, fontWeight: 650, padding: "3px 2px" }}
                >
                  {expanded ? "Thu gọn danh sách" : `Xem tất cả ${active.length} trận`}
                  <ChevronDown size={13} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                </button>
              )}
            </div>
          ) : (
            <div style={{ border: `1px dashed ${C.border2}`, borderRadius: 12, padding: "13px 12px", display: "flex", alignItems: "center", gap: 8, color: C.mute, fontSize: 12.5 }}>
              <Clock3 size={13} style={{ flexShrink: 0 }} />
              {matches.length > 0 ? "Các trận của bạn đã thi đấu xong." : "Chưa có trận đấu nào được lên lịch."}
            </div>
          )}
        </div>
      </div>

      {expanded && remaining.length > 0 && (
        <div className="pk-fade" style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border2}`, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))", gap: 8 }}>
          {remaining.map((m) => (
            <MatchItem key={m._id} m={m} eventType={t.eventType} onOpen={onOpenMatch} dense />
          ))}
        </div>
      )}
    </article>
  );
}

/* ------------------------------- skeleton ------------------------------- */
function CardSkeleton() {
  return (
    <div style={{ borderRadius: 18, overflow: "hidden", border: "1px solid var(--color-border)", background: "var(--color-background-surface)" }}>
      <Skeleton width="100%" height="148px" />
      <div style={{ padding: 16 }}>
        <Skeleton width="88%" height="20px" />
        <div style={{ height: 10 }} />
        <Skeleton width="55%" height="14px" />
        <div style={{ height: 14 }} />
        <Skeleton width="100%" height="52px" />
        <div style={{ height: 12 }} />
        <Skeleton width="70%" height="30px" />
      </div>
    </div>
  );
}

/* ------------------------------- hero gọn ------------------------------- */
function PageHead({ counts, matchStats, loading }) {
  const stats = [
    ["Tất cả giải", counts.all, C.strong],
    ["Đang diễn ra", counts.ongoing, counts.ongoing > 0 ? "#FF8A8E" : C.strong],
    ["Sắp diễn ra", counts.upcoming, C.strong],
    ["Trận của tôi", matchStats.total, C.strong],
  ];
  return (
    <div style={{ position: "relative", overflow: "hidden", borderBottom: "1px solid var(--color-border)" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(46% 62% at 80% 4%, rgba(61,135,255,.13), transparent 62%)" }} />
      <div
        aria-hidden
        className="pk-spin-slow"
        style={{ position: "absolute", right: -150, top: -140, opacity: 0.06, color: "var(--color-brand, #3D87FF)", pointerEvents: "none" }}
      >
        <PickleMark size={430} />
      </div>
      <Container style={{ position: "relative", zIndex: 2 }}>
        <div style={{ padding: "58px 0 40px" }}>
          <div style={{ minHeight: 30 }}>
            {!loading && matchStats.live > 0 ? (
              <span className="pk-rise pk-live" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: "rgba(229,72,77,.12)", color: "#FF8A8E", border: "1px solid rgba(242,85,90,.32)" }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: "#F2555A" }} />
                {matchStats.live} trận của bạn đang live
              </span>
            ) : !loading && counts.ongoing > 0 ? (
              <span className="pk-rise pk-live" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: "rgba(229,72,77,.12)", color: "#FF8A8E", border: "1px solid rgba(242,85,90,.32)" }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: "#F2555A" }} />
                {counts.ongoing} giải của bạn đang diễn ra
              </span>
            ) : null}
          </div>
          <h1
            className="pk-rise"
            style={{ margin: "12px 0 0", fontWeight: 750, fontSize: "clamp(36px, 5.4vw, 64px)", lineHeight: 1.04, letterSpacing: "-0.027em", color: C.strong, animationDelay: ".07s" }}
          >
            Giải của tôi.
            <br />
            <span style={{ color: "var(--color-brand, #3D87FF)" }}>Theo nhịp từng trận.</span>
          </h1>
          <div className="pk-rise" style={{ maxWidth: 600, marginTop: 18, animationDelay: ".15s" }}>
            <Text type="large" color="secondary">
              Mọi giải bạn tham gia — lịch thi đấu, tỷ số trực tiếp và kết quả cá nhân, cập nhật theo thời gian thực.
            </Text>
          </div>
          <div className="pk-rise" style={{ display: "flex", gap: 0, marginTop: 26, flexWrap: "wrap", animationDelay: ".22s", minHeight: 58 }}>
            {!loading &&
              stats.map(([label, value, color], i) => (
                <div
                  key={label}
                  style={{ padding: i === 0 ? "0 26px 0 0" : "0 26px", borderLeft: i === 0 ? "none" : `1px solid ${C.border2}`, marginBottom: 8 }}
                >
                  <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.1, color, fontVariantNumeric: "tabular-nums" }}>
                    {value}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: C.mute }}>
                    {label}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </Container>
    </div>
  );
}

/* ------------------------------- toolbar ------------------------------- */
const TABS = [
  ["all", "Tất cả"],
  ["ongoing", "Đang diễn ra"],
  ["upcoming", "Sắp diễn ra"],
  ["finished", "Đã kết thúc"],
];

function Toolbar({ tab, setTab, q, setQ, counts, viewMode, setViewMode, wide, onRefresh, refreshing }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 64,
        zIndex: 15,
        background: "color-mix(in srgb, var(--color-background-body, #111112) 80%, transparent)",
        backdropFilter: "saturate(160%) blur(12px)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <Container>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {TABS.map(([key, label]) => {
              const active = tab === key;
              const n = counts[key] || 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className="pk-pill"
                  style={{
                    all: "unset",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    height: 36,
                    padding: "0 14px",
                    borderRadius: 999,
                    cursor: "pointer",
                    fontSize: 13.5,
                    fontWeight: 650,
                    background: active ? "#F2F3F5" : C.chipBg,
                    color: active ? "#101114" : C.text,
                    border: active ? "1px solid transparent" : `1px solid ${C.border2}`,
                  }}
                >
                  {label}
                  <span style={{ fontSize: 11.5, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: active ? "rgba(16,17,20,.10)" : C.chipBg, color: active ? "#3A3D44" : C.mute }}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              height: 38,
              padding: "0 14px",
              borderRadius: 999,
              background: C.chipBg,
              border: `1px solid ${C.border2}`,
              minWidth: 200,
              flex: "0 1 320px",
            }}
          >
            <Search size={15} style={{ color: C.mute, flexShrink: 0 }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm giải (tên, địa điểm)…"
              style={{ all: "unset", width: "100%", color: C.strong, fontSize: 14, fontFamily: "inherit" }}
            />
            {q && (
              <button type="button" onClick={() => setQ("")} style={{ all: "unset", cursor: "pointer", color: C.mute, fontSize: 12.5, fontWeight: 700 }}>
                Xoá
              </button>
            )}
          </label>

          {/* toggle thẻ/danh sách — chỉ desktop (mobile luôn dạng thẻ, như trang cũ) */}
          {wide && (
            <div style={{ display: "inline-flex", padding: 3, borderRadius: 999, background: C.chipBg, border: `1px solid ${C.border2}` }}>
              {[
                ["card", "Chế độ thẻ", LayoutGrid],
                ["list", "Chế độ danh sách", Rows3],
              ].map(([key, title, Ico]) => {
                const active = viewMode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    title={title}
                    aria-label={title}
                    aria-pressed={active}
                    onClick={() => setViewMode(key)}
                    style={{ all: "unset", display: "grid", placeItems: "center", width: 32, height: 30, borderRadius: 999, cursor: "pointer", background: active ? "#F2F3F5" : "transparent", color: active ? "#101114" : C.mute }}
                  >
                    <Ico size={15} />
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title={refreshing ? "Đang làm mới…" : "Làm mới"}
            aria-label="Làm mới danh sách"
            className="pk-pill"
            style={{ all: "unset", display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 999, cursor: refreshing ? "default" : "pointer", background: C.chipBg, border: `1px solid ${C.border2}`, color: refreshing ? C.faint : C.text, opacity: refreshing ? 0.7 : 1 }}
          >
            <RefreshCw size={15} className={refreshing ? "pk-spinning" : undefined} />
          </button>
        </div>
      </Container>
    </div>
  );
}

/* --------------------------- panel yêu cầu đăng nhập --------------------------- */
function LoginPanel() {
  return (
    <Container>
      <div style={{ minHeight: "56vh", display: "grid", placeItems: "center", padding: "70px 0" }}>
        <div className="pk-fade" style={{ maxWidth: 460, width: "100%", textAlign: "center", borderRadius: 18, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", padding: "38px 30px" }}>
          <span style={{ width: 52, height: 52, borderRadius: 999, display: "inline-grid", placeItems: "center", background: "rgba(61,135,255,.13)", color: "#7FB3FF" }}>
            <Lock size={22} />
          </span>
          <div style={{ marginTop: 16, color: C.strong, fontSize: 19, fontWeight: 750 }}>
            Hãy đăng nhập để xem Giải của tôi
          </div>
          <div style={{ marginTop: 9 }}>
            <Text type="body" color="secondary">
              Sau khi đăng nhập, bạn sẽ thấy danh sách các giải mình đã tham gia, lịch thi đấu và kết quả cá nhân.
            </Text>
          </div>
          <div style={{ marginTop: 22, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
            <WhitePill label="Đăng nhập" href="/login" />
            <GrayPill label="Tạo tài khoản" href="/register" />
          </div>
        </div>
      </div>
    </Container>
  );
}

/* ================================= PAGE ================================= */
const LS_VIEW_MODE_KEY = "myTournamentsViewMode"; // giữ nguyên key trang cũ

export default function MyTournamentsPage() {
  const { userInfo } = useSelector((s) => s?.auth || {});
  const isAuthed = !!(userInfo?.token || userInfo?._id || userInfo?.email);

  const queryArg = isAuthed
    ? { withMatches: 1, matchLimit: 200, page: 1, limit: 50 }
    : skipToken;
  const { data, isLoading, isError, refetch, isFetching } = useListMyTournamentsQuery(queryArg);

  const tournamentsRaw = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }, [data]);

  /* ---------------- realtime qua socket (giữ nguyên logic trang cũ) ---------------- */
  const socket = useSocket();
  const liveMapRef = useRef(new Map());
  const [liveBump, setLiveBump] = useState(0);
  const pendingRef = useRef(new Map());
  const rafRef = useRef(null);

  const allMatchesInitial = useMemo(() => {
    const arr = [];
    for (const t of tournamentsRaw) {
      if (Array.isArray(t.matches)) arr.push(...t.matches);
    }
    return arr;
  }, [tournamentsRaw]);

  const flushPending = useCallback(() => {
    if (!pendingRef.current.size) return;
    const mp = liveMapRef.current;
    let changed = false;
    for (const [mid, inc] of pendingRef.current) {
      const cur = mp.get(mid);
      if (cur && !isNewerOrEqualMatchPayload(cur, inc)) continue;
      const merged = mergeMatchPayload(cur, inc, cur) || normalizeMatchDisplay(inc, cur);
      if (!merged) continue;
      mp.set(mid, merged);
      changed = true;
    }
    pendingRef.current.clear();
    if (changed) setLiveBump((x) => x + 1);
  }, []);

  const queueUpsert = useCallback(
    (incRaw) => {
      const inc = incRaw?.data ?? incRaw?.match ?? incRaw;
      if (!inc?._id) return;
      // chuẩn hóa court/venue/location về {_id, name} để render an toàn
      const normalizeEntity = (v) => {
        if (v == null) return v;
        if (typeof v === "string" || typeof v === "number") return v;
        if (typeof v === "object") {
          return {
            _id: v._id ?? (typeof v.id === "string" ? v.id : undefined),
            name:
              (typeof v.name === "string" && v.name) ||
              (typeof v.label === "string" && v.label) ||
              (typeof v.title === "string" && v.title) ||
              "",
          };
        }
        return v;
      };
      if (inc.court) inc.court = normalizeEntity(inc.court);
      if (inc.venue) inc.venue = normalizeEntity(inc.venue);
      if (inc.location) inc.location = normalizeEntity(inc.location);

      const id = String(inc._id);
      const base = pendingRef.current.get(id) || liveMapRef.current.get(id);
      if (base && !isNewerOrEqualMatchPayload(base, inc)) return;
      pendingRef.current.set(
        id,
        mergeMatchPayload(base, inc, base) || normalizeMatchDisplay(inc, base),
      );
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        flushPending();
      });
    },
    [flushPending],
  );

  // seed map hiển thị từ data fetch
  useEffect(() => {
    const mp = new Map(liveMapRef.current);
    let changed = false;
    for (const m of allMatchesInitial) {
      if (!m?._id) continue;
      const id = String(m._id);
      const cur = mp.get(id);
      if (cur && !isNewerOrEqualMatchPayload(cur, m)) continue;
      const merged = mergeMatchPayload(cur, m, cur) || normalizeMatchDisplay(m, cur);
      if (!merged) continue;
      mp.set(id, merged);
      changed = true;
    }
    if (!changed && mp.size === liveMapRef.current.size) return;
    liveMapRef.current = mp;
    setLiveBump((x) => x + 1);
  }, [allMatchesInitial]);

  const tournamentRoomIds = useMemo(
    () => (tournamentsRaw || []).map((t) => String(t?._id)).filter(Boolean),
    [tournamentsRaw],
  );
  const tournamentRoomIdsRef = useRef(new Set());
  useEffect(() => {
    tournamentRoomIdsRef.current = new Set(tournamentRoomIds);
  }, [tournamentRoomIds]);

  useSocketRoomSet(socket, tournamentRoomIds, {
    subscribeEvent: "tournament:subscribe",
    unsubscribeEvent: "tournament:unsubscribe",
    payloadKey: "tournamentId",
    onResync: () => {
      refetch?.();
    },
  });

  useEffect(() => {
    if (!socket) return;
    const onUpsert = (payload) => queueUpsert(payload);
    const onInvalidate = (payload) => {
      const tournamentId = String(payload?.tournamentId || "").trim();
      if (tournamentId && !tournamentRoomIdsRef.current.has(tournamentId)) return;
      refetch?.();
    };
    const onRemove = (payload) => {
      const id = String(payload?.id ?? payload?._id ?? "");
      if (!id) return;
      if (liveMapRef.current.has(id)) {
        liveMapRef.current.delete(id);
        setLiveBump((x) => x + 1);
      }
    };

    socket.on("tournament:match:update", onUpsert);
    socket.on("tournament:invalidate", onInvalidate);
    socket.on("match:deleted", onRemove);
    return () => {
      socket.off("tournament:match:update", onUpsert);
      socket.off("tournament:invalidate", onInvalidate);
      socket.off("match:deleted", onRemove);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [socket, queueUpsert, refetch]);

  /* ---- áp payload live + ẨN trận KO khi bảng nguồn chưa hoàn thành (như trang cũ) ---- */
  const tournamentsLive = useMemo(() => {
    void liveBump;
    const getLive = (m) => liveMapRef.current.get(String(m?._id)) || m;

    return tournamentsRaw.map((t) => {
      const groupStatusMap = t.groupCompletionStatus || {};
      const allMatches = Array.isArray(t.matches) ? t.matches : [];

      const filteredMatches = allMatches.filter((m) => {
        if (m.format !== "knockout") return true;
        for (const side of ["seedA", "seedB"]) {
          const seed = m[side];
          if (seed?.type === "groupRank") {
            const stage = seed.ref?.stage || m.stageIndex || 1;
            const rawCode = String(seed.ref?.groupCode || "").trim();
            if (rawCode) {
              const key = `${stage}_${normalizeGroupCode(rawCode)}`;
              if (groupStatusMap[key] !== true) return false; // bảng chưa xong -> ẩn
            }
          }
        }
        return true;
      });

      return { ...t, matches: filteredMatches.map(getLive) };
    });
  }, [tournamentsRaw, liveBump]);

  /* ---------------- filter/sort/đếm ---------------- */
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const wide = useIsWide(900);
  const [viewMode, setViewModeState] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_VIEW_MODE_KEY);
      return saved === "list" || saved === "card" ? saved : "card";
    } catch {
      return "card";
    }
  });
  const setViewMode = useCallback((mode) => {
    if (mode !== "list" && mode !== "card") return;
    setViewModeState(mode);
    try {
      localStorage.setItem(LS_VIEW_MODE_KEY, mode);
    } catch {
      /* bỏ qua khi storage bị chặn */
    }
  }, []);
  const effectiveMode = wide && viewMode === "list" ? "list" : "card";

  const counts = useMemo(() => {
    const c = { all: tournamentsLive.length, ongoing: 0, upcoming: 0, finished: 0 };
    for (const t of tournamentsLive) c[statusOf(t)] += 1;
    return c;
  }, [tournamentsLive]);

  const matchStats = useMemo(() => {
    let total = 0;
    let live = 0;
    for (const t of tournamentsLive) {
      const ms = Array.isArray(t.matches) ? t.matches : [];
      total += ms.length;
      for (const m of ms) if (matchBucket(m) === "live") live += 1;
    }
    return { total, live };
  }, [tournamentsLive]);

  const shown = useMemo(() => {
    const rank = { ongoing: 0, upcoming: 1, finished: 2 };
    let pool = tournamentsLive.filter((t) => tab === "all" || statusOf(t) === tab);
    const needle = fold(q.trim());
    if (needle) pool = pool.filter((t) => fold(`${t.name} ${t.location}`).includes(needle));
    return pool.slice().sort((a, b) => {
      const ra = rank[statusOf(a)] ?? 99;
      const rb = rank[statusOf(b)] ?? 99;
      if (ra !== rb) return ra - rb;
      return startOf(a) - startOf(b);
    });
  }, [tournamentsLive, tab, q]);

  /* ---------------- viewer trận + lightbox ---------------- */
  const [viewerOpen, setViewerOpen] = useState(false);
  const [matchId, setMatchId] = useState(null);
  const [zoomSrc, setZoomSrc] = useState(null);
  const handleOpenMatch = useCallback((m) => {
    setMatchId(m?._id);
    setViewerOpen(true);
  }, []);

  const filterDirty = tab !== "all" || !!q.trim();

  return (
    <>
      <SEOHead title="Giải của tôi — PickleTour" noIndex={true} />
      <ShadowFrame style={{ minHeight: "100vh" }}>
        <Theme theme={neutralTheme}>
          <div style={{ minHeight: "100vh", background: "var(--color-background-body)" }}>
            <SiteNav />

            {!isAuthed ? (
              <LoginPanel />
            ) : (
              <>
                <PageHead counts={counts} matchStats={matchStats} loading={isLoading} />
                <Toolbar
                  tab={tab}
                  setTab={setTab}
                  q={q}
                  setQ={setQ}
                  counts={counts}
                  viewMode={viewMode}
                  setViewMode={setViewMode}
                  wide={wide}
                  onRefresh={() => refetch()}
                  refreshing={isFetching}
                />

                <Container>
                  <div style={{ padding: "30px 0 84px", opacity: isFetching && !isLoading ? 0.72 : 1, transition: "opacity .2s" }}>
                    {isLoading ? (
                      <div style={gridStyle}>
                        {[...Array(6)].map((_, i) => (
                          <CardSkeleton key={i} />
                        ))}
                      </div>
                    ) : isError ? (
                      <div style={{ textAlign: "center", padding: "80px 0 60px" }}>
                        <span style={{ width: 52, height: 52, borderRadius: 999, display: "inline-grid", placeItems: "center", background: "rgba(229,72,77,.12)", color: "#FF8A8E" }}>
                          <CircleAlert size={22} />
                        </span>
                        <div style={{ marginTop: 16, color: C.strong, fontSize: 19, fontWeight: 700 }}>
                          Có lỗi khi tải dữ liệu
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <Text type="body" color="secondary">
                            Vui lòng thử lại — nếu vẫn lỗi, chờ vài phút rồi tải lại trang.
                          </Text>
                        </div>
                        <div style={{ marginTop: 22, display: "flex", justifyContent: "center" }}>
                          <GrayPill label={isFetching ? "Đang làm mới…" : "Thử lại"} onClick={() => refetch()} disabled={isFetching} />
                        </div>
                      </div>
                    ) : shown.length ? (
                      <>
                        {filterDirty && (
                          <div style={{ marginBottom: 14, color: C.mute, fontSize: 13 }}>
                            {shown.length} giải phù hợp
                          </div>
                        )}
                        {effectiveMode === "list" ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {shown.map((t, i) => (
                              <TourRow key={t._id || i} t={t} index={i} onOpenMatch={handleOpenMatch} />
                            ))}
                          </div>
                        ) : (
                          <div style={gridStyle}>
                            {shown.map((t, i) => (
                              <TourCard key={t._id || i} t={t} index={i} onOpenMatch={handleOpenMatch} onZoom={setZoomSrc} />
                            ))}
                          </div>
                        )}
                      </>
                    ) : filterDirty ? (
                      <div style={{ textAlign: "center", padding: "90px 0 70px" }}>
                        <div style={{ display: "flex", justifyContent: "center", opacity: 0.6 }}>
                          <PickleMark size={44} />
                        </div>
                        <div style={{ marginTop: 18, color: C.strong, fontSize: 19, fontWeight: 700 }}>
                          Không tìm thấy giải nào
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <Text type="body" color="secondary">
                            Thử đổi bộ lọc hoặc từ khoá khác xem sao.
                          </Text>
                        </div>
                        <div style={{ marginTop: 22, display: "flex", justifyContent: "center" }}>
                          <GrayPill
                            label="Xoá bộ lọc"
                            onClick={() => {
                              setTab("all");
                              setQ("");
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div style={{ textAlign: "center", padding: "90px 0 70px" }}>
                        <div style={{ display: "flex", justifyContent: "center", opacity: 0.6 }}>
                          <PickleMark size={48} />
                        </div>
                        <div style={{ marginTop: 18, color: C.strong, fontSize: 20, fontWeight: 750 }}>
                          Chưa có giải nào
                        </div>
                        <div style={{ marginTop: 8, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
                          <Text type="body" color="secondary">
                            Tham gia giải để theo dõi lịch đấu và kết quả của bạn tại đây.
                          </Text>
                        </div>
                        <div style={{ marginTop: 24, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                          <WhitePill label="Khám phá giải đấu" href="/pickle-ball/tournaments" />
                          <GrayPill label="Xem bảng xếp hạng" href="/pickle-ball/rankings" />
                        </div>
                      </div>
                    )}
                  </div>
                </Container>
              </>
            )}

            <SiteFooter />
            {zoomSrc && <Lightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />}
          </div>
        </Theme>
      </ShadowFrame>

      {/* viewer trận (MUI Dialog/Drawer) — portal về document.body nên đặt NGOÀI ShadowFrame */}
      <ResponsiveMatchViewer open={viewerOpen} matchId={matchId} onClose={() => setViewerOpen(false)} />
    </>
  );
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(min(340px, 100%), 1fr))",
  gap: 18,
};
