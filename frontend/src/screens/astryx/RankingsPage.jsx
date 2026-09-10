/**
 * RankingsPage — Bảng xếp hạng phong cách Astryx (trong ShadowFrame, dark).
 * Cấu trúc: SiteNav → PageHead typographic → PODIUM top 3 (vàng/bạc/đồng) →
 * toolbar sticky (search server-side + pill scoreStatus) → bảng xếp hạng →
 * "Xem thêm" (phân trang hasMore) → SiteFooter.
 * Data thật: useGetRankingsListQuery({ keyword, page, scoreStatus }).
 * ?ui=v1 tại route này ra trang cũ (gate ở RankingsScreen.jsx).
 */
import "@fontsource-variable/figtree";

import { useEffect, useRef, useState } from "react";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Text } from "@astryxdesign/core/Text";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { AlertCircle, BadgeCheck, Crown, Flag, Gauge, LayoutGrid, List, Lock, MapPin, Medal, Search, ShieldCheck, Sparkles, TrendingUp, Trophy } from "lucide-react";

import SEOHead from "../../components/SEOHead.jsx";
import ShadowFrame from "./ShadowFrame.jsx";
import SiteNav from "./SiteNav.jsx";
import SiteFooter from "./SiteFooter.jsx";
import PickleMark from "./PickleMark.jsx";
import { A, GrayPill } from "./ui.jsx";
import { useGetRankingsListQuery } from "../../slices/rankingsApiSlice.js";
import PlayerName from "../../components/PlayerName";
import { useOpenDmMutation } from "../../slices/messagesApiSlice.js";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";

/* ------------------------------- helpers ------------------------------- */
const Container = ({ children, style }) => (
  <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px", ...style }}>
    {children}
  </div>
);

const imgUrl = (u) => {
  const s = String(u || "").trim();
  if (!s) return undefined;
  return s;
};
const nameOf = (r) =>
  String(r?.user?.nickname || r?.user?.name || "Ẩn danh").trim();
const isVerified = (r) => String(r?.user?.verified || "") === "verified";
const fmtScore = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "—";
  return v.toFixed(v % 1 === 0 ? 1 : 3).replace(/0+$/, "").replace(/\.$/, ".0");
};

const MEDAL = [
  { color: "#F0B03A", soft: "rgba(240,176,58,.14)", ring: "rgba(240,176,58,.45)", label: "Hạng 1" },
  { color: "#C3C9D1", soft: "rgba(195,201,209,.12)", ring: "rgba(195,201,209,.4)", label: "Hạng 2" },
  { color: "#C77B42", soft: "rgba(199,123,66,.14)", ring: "rgba(199,123,66,.45)", label: "Hạng 3" },
];

const TIER_DOT = {
  yellow: "#F0B03A",
  green: "#3BA55D",
  blue: "#3D87FF",
  red: "#F2555A",
  grey: "#8F959C",
  gray: "#8F959C",
};

/* ---------------------- danh hiệu (achievements) ---------------------- */
// Đồng bộ với v1 (RankingList.jsx) và mobile: dữ liệu lấy từ r.achievements do
// backend gắn sẵn (getRankingOnlyV2 -> attachRankingAchievementsToDocs).
const ACHIEVEMENT_TONES = {
  yellow: { bg: "#facc15", fg: "#422006" },
  gold: { bg: "#facc15", fg: "#422006" },
  bronze: { bg: "#b45309", fg: "#fff7ed" },
  grey: { bg: "#5a636e", fg: "#f8fafc" },
  gray: { bg: "#5a636e", fg: "#f8fafc" },
  blue: { bg: "#2563eb", fg: "#eff6ff" },
  cyan: { bg: "#0891b2", fg: "#ecfeff" },
  green: { bg: "#16a34a", fg: "#f0fdf4" },
  red: { bg: "#dc2626", fg: "#fef2f2" },
  purple: { bg: "#7c3aed", fg: "#faf5ff" },
  navy: { bg: "#1e3a8a", fg: "#eff6ff" },
};
const ACHIEVEMENT_VISIBLE_LIMIT = 3;

const toneOfAchievement = (tone) =>
  ACHIEVEMENT_TONES[String(tone || "").toLowerCase()] || ACHIEVEMENT_TONES.grey;

const iconOfAchievement = (item = {}) => {
  const id = String(item.id || "").toLowerCase();
  const category = String(item.category || "").toLowerCase();
  const tone = String(item.tone || "").toLowerCase();
  if (id.includes("gold") || id.includes("champion") || tone === "yellow") return Trophy;
  if (id.includes("silver")) return Medal;
  if (id.includes("bronze") || tone === "bronze") return Medal;
  if (id.includes("kyc") || category.includes("xác thực")) return ShieldCheck;
  if (id.includes("tour") || category.includes("thi đấu")) return Flag;
  if (id.includes("score") || category.includes("điểm")) return Gauge;
  if (tone === "red") return AlertCircle;
  return Sparkles;
};

const normalizeRankingAchievements = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      id: String(item?.id || item?._id || `achievement-${index}`),
      label: String(item?.label || item?.title || "").trim(),
      category: String(item?.category || "Chip nổi bật").trim(),
      tone: String(item?.tone || item?.color || "grey").toLowerCase(),
    }))
    .filter((item) => item.label);

function AchievementChips({ achievements, size = "sm" }) {
  const list = normalizeRankingAchievements(achievements);
  if (!list.length) return null;
  const visible = list.slice(0, ACHIEVEMENT_VISIBLE_LIMIT);
  const hidden = Math.max(0, list.length - visible.length);
  const iconSize = size === "sm" ? 12 : 13;
  const fontSize = size === "sm" ? 11 : 11.5;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {visible.map((item) => {
        const tone = toneOfAchievement(item.tone);
        const Icon = iconOfAchievement(item);
        return (
          <span
            key={item.id}
            title={item.category}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              maxWidth: 150,
              height: 22,
              padding: "0 9px",
              borderRadius: 999,
              fontSize,
              fontWeight: 700,
              lineHeight: 1,
              color: tone.fg,
              background: tone.bg,
              border: "1px solid rgba(255,255,255,.22)",
              textShadow: "0 1px 1px rgba(0,0,0,.28)",
            }}
          >
            <Icon size={iconSize} style={{ flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
          </span>
        );
      })}
      {hidden > 0 && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 22,
            padding: "0 9px",
            borderRadius: 999,
            fontSize,
            fontWeight: 700,
            color: "#C9CDD2",
            background: "rgba(255,255,255,.08)",
            border: "1px solid rgba(255,255,255,.12)",
          }}
        >
          +{hidden}
        </span>
      )}
    </div>
  );
}

const SCORE_FILTERS = [
  ["three_tours", "Từ 3 giải"],
  ["staff", "Admin chấm"],
  ["needs_review", "Cần chấm lại"],
  ["no_score", "Chưa có điểm"],
];

/* ------------------------------ page head ------------------------------ */
function PageHead() {
  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(46% 62% at 22% 4%, rgba(61,135,255,.12), transparent 62%)" }} />
      <div
        aria-hidden
        className="pk-spin-slow"
        style={{ position: "absolute", right: -140, top: -130, opacity: 0.06, color: "var(--color-brand, #3D87FF)", pointerEvents: "none" }}
      >
        <PickleMark size={440} />
      </div>
      <Container style={{ position: "relative", zIndex: 2 }}>
        <div style={{ padding: "76px 0 30px" }}>
          <span
            className="pk-rise"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 13px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 700,
              background: "rgba(61,135,255,.12)",
              color: "#9CC1FF",
              border: "1px solid rgba(61,135,255,.3)",
            }}
          >
            <TrendingUp size={13} />
            Điểm trình cập nhật sau mỗi trận
          </span>
          <h1
            className="pk-rise"
            style={{
              margin: "14px 0 0",
              fontWeight: 750,
              fontSize: "clamp(42px, 6.4vw, 84px)",
              lineHeight: 1.02,
              letterSpacing: "-0.028em",
              color: "var(--pk-text-strong)",
              animationDelay: ".07s",
            }}
          >
            Bảng xếp hạng
            <br />
            <span style={{ color: "var(--color-brand, #3D87FF)" }}>toàn quốc.</span>
          </h1>
          <div className="pk-rise" style={{ maxWidth: 640, marginTop: 22, animationDelay: ".16s" }}>
            <Text type="large" color="secondary">
              Toàn bộ vận động viên trên PickleTour, xếp theo điểm trình từ kết quả thi đấu.
            </Text>
          </div>
        </div>
      </Container>
    </div>
  );
}

/* -------------------------------- podium ------------------------------- */
function PodiumCard({ r, place }) {
  const m = MEDAL[place];
  const top1 = place === 0;
  return (
    <A
      href={r?.user?._id ? `/user/${r.user._id}` : "#"}
      className="pk-tcard pk-reveal-card"
      style={{
        display: "block",
        textDecoration: "none",
        position: "relative",
        borderRadius: 20,
        border: `1px solid ${m.ring}`,
        background: "var(--color-background-surface)",
        padding: top1 ? "26px 22px 24px" : "22px 18px 20px",
        textAlign: "center",
        overflow: "hidden",
        animationDelay: `${place * 0.08}s`,
        boxShadow: top1
          ? `0 36px 84px -30px ${m.soft.replace(".14", ".6")}`
          : `0 24px 60px -30px ${m.soft.replace(".14", ".4")}`,
      }}
    >
      <div aria-hidden style={{ position: "absolute", inset: 0, background: `radial-gradient(78% 54% at 50% 0%, ${m.soft}, transparent 72%)` }} />
      {/* số hạng chìm ở đáy — biến chênh lệch chiều cao thành nhịp thiết kế */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: 8,
          bottom: -16,
          fontSize: top1 ? 96 : 84,
          fontWeight: 800,
          lineHeight: 1,
          color: m.color,
          opacity: 0.09,
          letterSpacing: "-.05em",
          pointerEvents: "none",
        }}
      >
        {place + 1}
      </span>

      {top1 && (
        <div style={{ position: "relative", display: "flex", justifyContent: "center", marginBottom: 8 }}>
          <Crown size={22} color={m.color} />
        </div>
      )}

      <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
        <div style={{ position: "relative" }}>
          <span
            style={{
              display: "inline-block",
              borderRadius: 999,
              padding: top1 ? 3.5 : 3,
              background: `conic-gradient(from 210deg, ${m.color}, transparent 52%, ${m.color})`,
            }}
          >
            <Avatar size="large" src={imgUrl(r?.user?.avatar)} name={nameOf(r)} />
          </span>
          <span
            style={{
              position: "absolute",
              bottom: -7,
              right: -7,
              width: 27,
              height: 27,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              fontSize: 13.5,
              fontWeight: 800,
              color: "#101114",
              background: m.color,
              border: "2px solid var(--color-background-surface)",
            }}
          >
            {place + 1}
          </span>
        </div>
      </div>

      <div style={{ position: "relative", marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <span style={{ color: "var(--pk-text-strong)", fontWeight: 750, fontSize: top1 ? 17.5 : 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "85%" }}>
          <PlayerName user={r?.user} name={nameOf(r)} />
        </span>
        {isVerified(r) && <BadgeCheck size={16} color="#3E9EFB" style={{ flexShrink: 0 }} />}
      </div>
      <div style={{ position: "relative", marginTop: 5, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, color: "#9AA0A6", fontSize: 13 }}>
        <MapPin size={12} />
        {r?.user?.province || "—"}
      </div>

      <div style={{ position: "relative", marginTop: top1 ? 15 : 13 }}>
        <div style={{ fontSize: top1 ? 32 : 28, fontWeight: 800, color: m.color, lineHeight: 1, letterSpacing: "-.02em" }}>
          {fmtScore(r?.double)}
        </div>
        <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 650, color: "#8F959C", letterSpacing: ".05em" }}>ĐIỂM ĐÔI</div>
        <div
          style={{
            marginTop: 11,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 650,
            background: "rgba(255,255,255,.06)",
            color: "var(--pk-text)",
            border: "1px solid rgba(255,255,255,.08)",
          }}
        >
          Đơn {fmtScore(r?.single)}
        </div>
      </div>
    </A>
  );
}

function Podium({ rows }) {
  if (rows.length < 3) return null;
  // bục 2-1-3: hạng 1 ở giữa tự cao hơn (nội dung lớn hơn), cả 3 chạm đáy chung — mobile xếp 1,2,3
  return (
    <Container>
      <div className="pk-podium" style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr 1fr", gap: 18, alignItems: "end", padding: "26px 0 8px" }}>
        <div className="pk-pod-2"><PodiumCard r={rows[1]} place={1} /></div>
        <div className="pk-pod-1"><PodiumCard r={rows[0]} place={0} /></div>
        <div className="pk-pod-3"><PodiumCard r={rows[2]} place={2} /></div>
      </div>
    </Container>
  );
}

/* ------------------------------- toolbar ------------------------------- */
function Toolbar({ qInput, setQInput, filter, setFilter }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 64,
        zIndex: 15,
        background: "rgba(17,17,18,.78)",
        backdropFilter: "saturate(160%) blur(12px)",
        borderBottom: "1px solid var(--color-border)",
        borderTop: "1px solid var(--color-border)",
        marginTop: 26,
      }}
    >
      <Container>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {SCORE_FILTERS.map(([key, label]) => {
              const active = filter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(active ? "" : key)}
                  className="pk-pill"
                  style={{
                    all: "unset",
                    display: "inline-flex",
                    alignItems: "center",
                    height: 36,
                    padding: "0 15px",
                    borderRadius: 999,
                    cursor: "pointer",
                    fontSize: 13.5,
                    fontWeight: 650,
                    background: active ? "#F2F3F5" : "rgba(255,255,255,.06)",
                    color: active ? "#101114" : "#C9CDD2",
                    border: active ? "1px solid transparent" : "1px solid rgba(255,255,255,.09)",
                  }}
                >
                  {label}
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
              background: "rgba(255,255,255,.06)",
              border: "1px solid rgba(255,255,255,.10)",
              minWidth: 220,
              flex: "0 1 340px",
            }}
          >
            <Search size={15} color="#9AA0A6" style={{ flexShrink: 0 }} />
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Tìm vận động viên…"
              style={{ all: "unset", width: "100%", color: "var(--pk-text-strong)", fontSize: 14, fontFamily: "inherit" }}
            />
            {qInput && (
              <button type="button" onClick={() => setQInput("")} style={{ all: "unset", cursor: "pointer", color: "#9AA0A6", fontSize: 12.5, fontWeight: 700 }}>
                Xoá
              </button>
            )}
          </label>
        </div>
      </Container>
    </div>
  );
}

/* -------------------------------- table -------------------------------- */
function MessageIconBtn({ userId }) {
  const me = useSelector((s) => s.auth?.userInfo);
  const navigate = useNavigate();
  const [openDm, { isLoading }] = useOpenDmMutation();
  if (!me || !userId || String(userId) === String(me._id)) return null;
  const onClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const conv = await openDm(userId).unwrap();
      navigate(`/messages?c=${conv._id}`);
    } catch {}
  };
  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      title="Nhắn tin"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(61,135,255,0.14)",
        color: "#3E9EFB",
        cursor: "pointer",
      }}
    >
      💬
    </button>
  );
}

function RankRow({ r, fallbackRank, showGlobal }) {
  // Bảng mặc định: số vị trí (liền mạch khi phân trang). Khi search/lọc: hạng chính thức.
  const rank = showGlobal ? Number(r?.globalRank) || null : fallbackRank;
  const medal = rank >= 1 && rank <= 3 ? MEDAL[rank - 1] : null;
  const tierDot = TIER_DOT[String(r?.tierColor || "").toLowerCase()];
  return (
    <A
      href={r?.user?._id ? `/user/${r.user._id}` : "#"}
      className="pk-trow pk-rankgrid"
      style={{
        height: 64,
        borderTop: "1px solid var(--color-border)",
        textDecoration: "none",
        transition: "background .15s",
      }}
    >
      <div style={{ padding: "0 16px" }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: medal ? medal.color : "var(--color-text-secondary)" }}>{rank || "—"}</span>
      </div>
      <div style={{ padding: "0 16px", display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <Avatar size="small" src={imgUrl(r?.user?.avatar)} name={nameOf(r)} />
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ color: "var(--pk-text-strong)", fontWeight: 650, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <PlayerName user={r?.user} name={nameOf(r)} />
          </span>
          {isVerified(r) && <BadgeCheck size={15} color="#3E9EFB" style={{ flexShrink: 0 }} />}
          {tierDot && <span title={r?.tierLabel || ""} style={{ width: 7, height: 7, borderRadius: 99, background: tierDot, flexShrink: 0 }} />}
        </span>
      </div>
      <div className="pk-col-hide" style={{ padding: "0 16px", color: "#9AA0A6", fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {r?.user?.province || "—"}
      </div>
      <div style={{ padding: "0 16px", textAlign: "right", color: "var(--pk-text-strong)", fontWeight: 750, fontSize: 15 }}>{fmtScore(r?.double)}</div>
      <div style={{ padding: "0 16px", textAlign: "right", color: "var(--pk-text)", fontWeight: 650, fontSize: 14.5 }}>{fmtScore(r?.single)}</div>
      <div className="pk-col-hide" style={{ padding: "0 16px", textAlign: "right", color: "#8F959C", fontSize: 13.5 }}>
        {Number(r?.totalTours || 0)}
      </div>
      <div style={{ padding: "0 12px", display: "flex", justifyContent: "flex-end" }}>
        <MessageIconBtn userId={r?.user?._id} />
      </div>
    </A>
  );
}

function TableSkeleton() {
  return (
    <>
      {[...Array(8)].map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, height: 64, borderTop: "1px solid var(--color-border)", padding: "0 16px" }}>
          <Skeleton width="26px" height="16px" />
          <Skeleton width="36px" height="36px" borderRadius="50%" />
          <Skeleton width="34%" height="16px" />
          <div style={{ flex: 1 }} />
          <Skeleton width="120px" height="16px" />
        </div>
      ))}
    </>
  );
}

/* ----------------------------- card (kiểu v1) ---------------------------- */
function RankCard({ r, rank }) {
  const medal = rank >= 1 && rank <= 3 ? MEDAL[rank - 1] : null;
  const tierDot = TIER_DOT[String(r?.tierColor || "").toLowerCase()];
  return (
    <A
      href={r?.user?._id ? `/user/${r.user._id}` : "#"}
      className="pk-tcard pk-reveal-card"
      style={{
        display: "block",
        textDecoration: "none",
        borderRadius: 18,
        border: "1px solid var(--color-border)",
        background: "var(--color-background-surface)",
        padding: 16,
        transition: "transform .15s, border-color .15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <Avatar size="medium" src={imgUrl(r?.user?.avatar)} name={nameOf(r)} />
          <span
            style={{
              position: "absolute",
              right: -4,
              bottom: -4,
              minWidth: 22,
              height: 22,
              padding: "0 6px",
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              fontWeight: 800,
              color: medal ? "#1b1300" : "#fff",
              background: medal ? medal.color : "rgba(120,130,140,.92)",
              border: "2px solid var(--color-background-surface)",
            }}
          >
            {rank || "—"}
          </span>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ color: "var(--pk-text-strong)", fontWeight: 750, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <PlayerName user={r?.user} name={nameOf(r)} />
            </span>
            {isVerified(r) && <BadgeCheck size={16} color="#3E9EFB" style={{ flexShrink: 0 }} />}
            {tierDot && <span title={r?.tierLabel || ""} style={{ width: 8, height: 8, borderRadius: 99, background: tierDot, flexShrink: 0 }} />}
          </div>
          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 5, color: "#9AA0A6", fontSize: 13 }}>
            <MapPin size={13} /> {r?.user?.province || "—"}
          </div>
        </div>
        <MessageIconBtn userId={r?.user?._id} />
      </div>
      {normalizeRankingAchievements(r?.achievements).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <AchievementChips achievements={r?.achievements} />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--color-border)" }}>
        {[
          ["Điểm đôi", fmtScore(r?.double), "var(--pk-text-strong)"],
          ["Điểm đơn", fmtScore(r?.single), "var(--pk-text)"],
          ["Giải", Number(r?.totalTours || 0), "#8F959C"],
        ].map(([label, val, col]) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ color: col, fontWeight: 800, fontSize: 17 }}>{val}</div>
            <div style={{ color: "#8F959C", fontSize: 11.5, fontWeight: 600, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>
    </A>
  );
}

function CardSkeleton() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} style={{ borderRadius: 18, border: "1px solid var(--color-border)", padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Skeleton width="48px" height="48px" borderRadius="50%" />
            <div style={{ flex: 1 }}><Skeleton width="60%" height="16px" /></div>
          </div>
          <div style={{ height: 14 }} />
          <Skeleton width="100%" height="36px" />
        </div>
      ))}
    </div>
  );
}

/* ================================= PAGE ================================= */
export default function RankingsPage() {
  const [view, setView] = useState("card"); // "card" (kiểu v1) | "table"
  const [qInput, setQInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const debounceRef = useRef(null);

  // debounce từ khoá 400ms -> query server
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setKeyword(qInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [qInput]);

  const { data, isFetching, error } = useGetRankingsListQuery({
    keyword: keyword || undefined,
    scoreStatus: filter || undefined,
    // server đếm page từ 0 (page = số trang BỎ QUA) — UI đếm từ 1 nên trừ 1
    page: page - 1,
    limit: 25,
  });
  // Server giới hạn lượt tìm kiếm/ngày: chặn cứng = 429, chặn mềm = docs rỗng + remainingTime 0.
  const softBlocked =
    Boolean(keyword) &&
    Array.isArray(data?.docs) &&
    data.docs.length === 0 &&
    Number(data?.remainingTime) === 0;
  const limitMsg =
    error?.status === 429
      ? String(error?.data?.message || "Bạn đã dùng hết lượt tìm kiếm hôm nay. Vui lòng thử lại sau.")
      : softBlocked
        ? "Bạn đã dùng hết lượt tra cứu hôm nay — lượt tìm kiếm sẽ được làm mới vào ngày mai."
        : null;

  // gom trang: page 1 thay mới, page sau nối thêm (khử trùng lặp theo _id)
  useEffect(() => {
    const docs = Array.isArray(data?.docs) ? data.docs : null;
    if (!docs) return;
    setRows((prev) => {
      if (page === 1) return docs;
      const seen = new Set(prev.map((x) => x._id));
      return [...prev, ...docs.filter((d) => !seen.has(d._id))];
    });
  }, [data, page]);

  const changeFilter = (next) => {
    setFilter(next);
    setPage(1);
  };

  const pureBoard = !keyword && !filter;
  const podiumRows = pureBoard ? rows.slice(0, 3) : [];
  const tableRows = pureBoard ? rows.slice(3) : rows;
  const hasMore = Boolean(data?.hasMore);
  const initialLoading = isFetching && page === 1 && !rows.length;

  return (
    <>
      <SEOHead
        title="Bảng xếp hạng pickleball — PickleTour"
        description="Bảng xếp hạng điểm trình pickleball toàn quốc, chuẩn hoá từ kết quả thi đấu thật trên PickleTour."
      />
      <ShadowFrame style={{ minHeight: "100vh" }}>
        <Theme theme={neutralTheme}>
          <div style={{ minHeight: "100vh", background: "var(--color-background-body)" }}>
            <SiteNav />
            <PageHead />

            {pureBoard && (initialLoading ? (
              <Container>
                <div className="pk-podium" style={{ display: "grid", gridTemplateColumns: "1fr 1.12fr 1fr", gap: 18, padding: "26px 0 8px" }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{ borderRadius: 20, border: "1px solid var(--color-border)", padding: 26, textAlign: "center" }}>
                      <Skeleton width="72px" height="72px" borderRadius="50%" style={{ margin: "0 auto" }} />
                      <div style={{ height: 14 }} />
                      <Skeleton width="60%" height="18px" style={{ margin: "0 auto" }} />
                    </div>
                  ))}
                </div>
              </Container>
            ) : (
              <Podium rows={podiumRows} />
            ))}

            <Toolbar qInput={qInput} setQInput={setQInput} filter={filter} setFilter={changeFilter} />

            <Container>
              <div style={{ padding: "26px 0 84px" }}>
                {/* Toggle hiển thị: Thẻ (kiểu v1) / Bảng */}
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
                  <div style={{ display: "inline-flex", padding: 3, borderRadius: 999, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", gap: 3 }}>
                    {[["card", LayoutGrid, "Thẻ"], ["table", List, "Bảng"]].map(([key, Icon, label]) => {
                      const active = view === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setView(key)}
                          style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 15px", borderRadius: 999, fontSize: 13, fontWeight: 700, color: active ? "#0b1220" : "var(--color-text-secondary)", background: active ? "#3E9EFB" : "transparent", transition: "background .15s" }}
                        >
                          <Icon size={15} /> {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {initialLoading ? (
                  view === "card" ? (
                    <CardSkeleton />
                  ) : (
                    <div style={{ borderRadius: 18, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", overflow: "hidden" }}>
                      <TableSkeleton />
                    </div>
                  )
                ) : limitMsg ? (
                  <div style={{ borderRadius: 18, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", padding: "58px 24px", textAlign: "center" }}>
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <span style={{ width: 44, height: 44, borderRadius: 999, display: "grid", placeItems: "center", background: "rgba(240,176,58,.12)", border: "1px solid rgba(240,176,58,.35)", color: "#F0B03A" }}>
                        <Lock size={19} />
                      </span>
                    </div>
                    <div style={{ marginTop: 14, color: "var(--pk-text)", fontSize: 16.5, fontWeight: 700 }}>Hết lượt tra cứu hôm nay</div>
                    <div style={{ marginTop: 8, maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}>
                      <Text type="supporting" color="secondary">{limitMsg}</Text>
                    </div>
                  </div>
                ) : tableRows.length ? (
                  view === "card" ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
                      {tableRows.map((r, i) => (
                        <RankCard key={r._id || i} r={r} rank={(pureBoard ? 4 : 1) + i} />
                      ))}
                    </div>
                  ) : (
                    <div style={{ borderRadius: 18, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", overflow: "hidden" }}>
                      <div className="pk-rankgrid" style={{ height: 46, background: "color-mix(in srgb, var(--color-text-primary) 4%, transparent)" }}>
                        {["#", "Vận động viên", "Tỉnh / Thành", "Điểm đôi", "Điểm đơn", "Giải", ""].map((h, i) => (
                          <div key={h + i} className={i === 2 || i === 5 ? "pk-col-hide" : undefined} style={{ padding: "0 16px", textAlign: i === 6 ? "right" : i >= 3 ? "right" : "left" }}>
                            <Text type="supporting" color="secondary" weight="semibold">{h}</Text>
                          </div>
                        ))}
                      </div>
                      {tableRows.map((r, i) => (
                        <RankRow key={r._id || i} r={r} fallbackRank={(pureBoard ? 4 : 1) + i} showGlobal={!pureBoard} />
                      ))}
                    </div>
                  )
                ) : (
                  <div style={{ borderRadius: 18, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", padding: "64px 0", textAlign: "center" }}>
                    <div style={{ display: "flex", justifyContent: "center", opacity: 0.55 }}>
                      <PickleMark size={40} />
                    </div>
                    <div style={{ marginTop: 14, color: "var(--pk-text)", fontSize: 17, fontWeight: 700 }}>Không tìm thấy vận động viên nào</div>
                    <div style={{ marginTop: 6 }}>
                      <Text type="supporting" color="secondary">Thử từ khoá khác hoặc bỏ bộ lọc.</Text>
                    </div>
                  </div>
                )}

                {hasMore && !initialLoading && (
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 26 }}>
                    <GrayPill
                      label={isFetching ? "Đang tải…" : "Xem thêm"}
                      href="#"
                      size="lg"
                      onClick={(e) => {
                        e.preventDefault();
                        if (!isFetching) setPage((p) => p + 1);
                      }}
                    />
                  </div>
                )}
              </div>
            </Container>

            <SiteFooter />
          </div>
        </Theme>
      </ShadowFrame>
    </>
  );
}
