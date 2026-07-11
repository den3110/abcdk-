/**
 * HomeScreenAstryx — trang chủ THỬ NGHIỆM (?ui=v2) dựng bằng LIB ASTRYX THẬT (@astryxdesign/core).
 * Cô lập khỏi CSS toàn cục (Bootstrap/MUI) bằng Shadow DOM (ShadowFrame).
 * Lazy-load qua HomeScreen.jsx nên CSS/JS Astryx CHỈ tải khi ?ui=v2 — v1/production không đổi.
 *
 * Quy ước: dùng component Astryx cho typography/nút/thẻ/icon/token; div+inline-style chỉ cho
 * khung layout (container, padding, sticky) — inline-style an toàn trong shadow, không nhiễm.
 */
import "@fontsource-variable/figtree"; // font đẹp (chỉ tải ở v2; @font-face vô hại v1)

import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Stack } from "@astryxdesign/core/Stack";
import { Grid } from "@astryxdesign/core/Grid";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Badge } from "@astryxdesign/core/Badge";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Divider } from "@astryxdesign/core/Divider";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import {
  Trophy,
  Radio,
  TrendingUp,
  Users,
  CalendarDays,
  MapPin,
  ArrowUpRight,
  ArrowUp,
  Plus,
  Target,
  Swords,
  Tv,
  Sparkles,
  Check,
  Zap,
  ShieldCheck,
  Radar,
  Pause,
  Eye,
  Maximize2,
} from "lucide-react";

import SEOHead from "../components/SEOHead.jsx";
import ShadowFrame from "./astryx/ShadowFrame.jsx";
import PickleMark from "./astryx/PickleMark.jsx";
import PickleWordmark from "./astryx/PickleWordmark.jsx";
import SiteNav from "./astryx/SiteNav.jsx";
import SiteFooter from "./astryx/SiteFooter.jsx";
import { A, WhitePill, GrayPill } from "./astryx/ui.jsx";
import {
  useGetHomeSummaryQuery,
  useGetHomePulseQuery,
} from "../slices/homeApiSlice.js";
import { useListTournamentsQuery } from "../slices/tournamentsApiSlice.js";
import { useGetRankingsListQuery } from "../slices/rankingsApiSlice.js";
import { useGetLiveFeedQuery } from "../slices/liveApiSlice.js";

/* ------------------------------- helpers ------------------------------- */
const imgUrl = (u) => {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^(https?:)?\/\//i.test(s) || s.startsWith("data:")) return s;
  return s.startsWith("/") ? s : `/${s}`;
};
const asArray = (d) =>
  Array.isArray(d) ? d : d?.docs || d?.items || d?.list || d?.rows || d?.data || d?.matches || [];
const fmtInt = (n) => Number(n || 0).toLocaleString("vi-VN");
const firstText = (...xs) =>
  xs.map((x) => (x == null ? "" : String(x).trim())).find(Boolean) || "";
const fmtDate = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "";
  }
};

/* layout scaffolding (inline-style, an toàn trong shadow) */
const Container = ({ children, style }) => (
  <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 24px", ...style }}>
    {children}
  </div>
);
const Region = ({ children, style }) => (
  <div style={{ padding: "72px 0", ...style }}>{children}</div>
);

const GRADIENT = "linear-gradient(92deg, #22D3EE 0%, #3B82F6 45%, #7C3AED 100%)";

/* wordmark nhỏ cho nav/footer — cùng chữ SVG blob với hero */
const Wordmark = ({ width = 112, id = "ft" }) => (
  <span style={{ display: "inline-block", width, color: "var(--color-brand, #3D87FF)" }}>
    <PickleWordmark id={id} />
  </span>
);

const STATUS_META = {
  ongoing: { label: "Đang diễn ra", variant: "success" },
  upcoming: { label: "Sắp diễn ra", variant: "info" },
  finished: { label: "Đã kết thúc", variant: "neutral" },
};

/* ------------------------------- sections ------------------------------- */
/* Header dùng chung: SiteNav (./astryx/SiteNav.jsx) — có trạng thái đăng nhập */

/* ===== thẻ nổi quanh hero — bố cục theo trang chủ Astryx, nội dung PickleTour ===== */

/** Cảnh sân pickleball PHỐI CẢNH (tự vẽ): nền tối + glow, mặt sân trapezoid, lưới có chiều sâu,
 *  bóng bay có vệt, vignette — màu theo theme slide. */
function CourtScene({ height = 190, ground = "#0E6F63", court = "#1D5FD1", accent = "#3D87FF", uid = "cs" }) {
  const gid = (s) => `${uid}-${s}`;
  return (
    <svg width="100%" height={height} viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" style={{ display: "block", transition: "all .6s" }}>
      <defs>
        <linearGradient id={gid("bg")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0A0E15" />
          <stop offset="0.55" stopColor={ground} stopOpacity="0.5" />
          <stop offset="1" stopColor={ground} />
        </linearGradient>
        <linearGradient id={gid("ct")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.14" />
          <stop offset="0.12" stopColor={court} stopOpacity="0.92" />
          <stop offset="1" stopColor={court} />
        </linearGradient>
        <radialGradient id={gid("glow")} cx="0.5" cy="0.3" r="0.62">
          <stop offset="0" stopColor={accent} stopOpacity="0.38" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={gid("ball")} cx="0.35" cy="0.3" r="0.95">
          <stop offset="0" stopColor="#FFF4B8" />
          <stop offset="0.55" stopColor="#F5C518" />
          <stop offset="1" stopColor="#B98A10" />
        </radialGradient>
        <radialGradient id={gid("vig")} cx="0.5" cy="0.45" r="0.78">
          <stop offset="0.58" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </radialGradient>
      </defs>

      <rect width="320" height="200" fill={`url(#${gid("bg")})`} />
      <ellipse cx="160" cy="72" rx="155" ry="74" fill={`url(#${gid("glow")})`} />

      {/* mặt sân phối cảnh */}
      <polygon points="96,62 224,62 312,192 8,192" fill={`url(#${gid("ct")})`} />

      {/* vạch sân (xa mảnh, gần dày) */}
      <g stroke="#F2F6FF" fill="none" strokeLinecap="round">
        <polygon points="96,62 224,62 312,192 8,192" strokeWidth="2.2" opacity="0.9" />
        <line x1="70.3" y1="100" x2="249.7" y2="100" strokeWidth="1.8" opacity="0.85" />
        <line x1="44.6" y1="138" x2="275.4" y2="138" strokeWidth="2.4" opacity="0.85" />
        <line x1="160" y1="62" x2="160" y2="100" strokeWidth="1.8" opacity="0.85" />
        <line x1="160" y1="138" x2="160" y2="192" strokeWidth="2.4" opacity="0.85" />
      </g>

      {/* bóng đổ của lưới xuống mặt sân */}
      <polygon points="58,119 262,119 270,128 50,128" fill="#000" opacity="0.24" />

      {/* lưới: cột + băng trên + lưới mắt cáo */}
      <rect x="53" y="88" width="4.5" height="34" rx="2.2" fill="#E8ECF2" />
      <rect x="262.5" y="88" width="4.5" height="34" rx="2.2" fill="#E8ECF2" />
      <rect x="56" y="88" width="208" height="5.5" rx="2.7" fill="#F7FAFD" />
      <rect x="56" y="93" width="208" height="26" fill="#fff" opacity="0.05" />
      <g stroke="#D9E0EA" strokeWidth="0.7" opacity="0.45">
        {Array.from({ length: 26 }, (_, i) => 60 + i * 8).map((x) => (
          <line key={x} x1={x} y1="93" x2={x} y2="119" />
        ))}
        <line x1="56" y1="102" x2="264" y2="102" />
        <line x1="56" y1="111" x2="264" y2="111" />
      </g>

      {/* bóng + vệt bay (nhấp nhô nhẹ) */}
      <g className="pk-bob">
        <path d="M 182 48 Q 206 42 224 60" stroke={accent} strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.6" />
        <circle cx="229" cy="65" r="9.5" fill={`url(#${gid("ball")})`} />
        <circle cx="226" cy="62.5" r="1.7" fill="#8F6B0D" opacity="0.85" />
        <circle cx="231.5" cy="67" r="1.7" fill="#8F6B0D" opacity="0.85" />
      </g>

      <rect width="320" height="200" fill={`url(#${gid("vig")})`} />
    </svg>
  );
}

/** Sân mini phẳng cho thumbnail nhỏ (44px) */
function MiniCourt({ court = "#1D5FD1", ground = "#0E6F63" }) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 44 44" style={{ display: "block" }}>
      <rect width="44" height="44" fill={ground} />
      <rect x="7" y="5" width="30" height="34" rx="2.5" fill={court} stroke="#EAF2FF" strokeWidth="1.6" />
      <line x1="7" y1="22" x2="37" y2="22" stroke="#0B1220" strokeWidth="2.4" />
      <circle cx="28" cy="13" r="3" fill="#FDE047" />
    </svg>
  );
}

const floatTitle = { color: "#ECEDEF", fontWeight: 700, fontSize: 16.5, lineHeight: 1.25 };
const floatSub = { color: "#9BA1A8", fontWeight: 500, fontSize: 13.5, lineHeight: 1.35 };

function TournamentFloatCard({ court, accent, title = "Giải Mùa Xuân PickleTour", sub = "Đà Nẵng · 32 đội · Vòng bảng" }) {
  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={floatTitle}>{title}</div>
        <div style={{ ...floatSub, marginTop: 3 }}>{sub}</div>
      </div>
      <div style={{ borderRadius: 12, overflow: "hidden" }}>
        <CourtScene height={182} uid="tc" accent={accent} {...(court || {})} />
      </div>
    </div>
  );
}

function ChatFloatCard() {
  const circle = (bg, color) => ({
    width: 38,
    height: 38,
    borderRadius: 999,
    background: bg,
    color,
    display: "grid",
    placeItems: "center",
    flex: "none",
  });
  return (
    <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={circle("#2A2B2F", "#C9CDD2")}><Plus size={18} /></div>
      <div style={{ flex: 1, color: "#AEB4BB", fontSize: 15, fontWeight: 500 }}>PickleTour giúp gì cho bạn?</div>
      <div style={circle("#E9EAEC", "#101114")}><ArrowUp size={18} /></div>
    </div>
  );
}

function LiveFloatCard({ court, accent }) {
  return (
    <div style={{ position: "relative" }}>
      {/* player livestream: cảnh sân + overlay tỉ số + thanh điều khiển */}
      <div style={{ borderRadius: 20, overflow: "hidden", position: "relative", border: "1px solid rgba(255,255,255,0.07)" }}>
        <CourtScene height={318} uid="lv" accent={accent} {...(court || {})} />
        {/* overlay tỉ số (đúng sản phẩm overlay của app) */}
        <div style={{ position: "absolute", top: 12, left: 12, background: "rgba(8,10,14,0.78)", borderRadius: 10, padding: "8px 10px", minWidth: 128, backdropFilter: "blur(4px)" }}>
          {[["Minh / Phong", "11", true], ["Hùng / Nam", "9", false]].map(([n, s, serve]) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 0" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: serve ? "#22C55E" : "transparent", flex: "none" }} />
              <span style={{ color: "#E8EBEF", fontSize: 11.5, fontWeight: 650, flex: 1, whiteSpace: "nowrap" }}>{n}</span>
              <span style={{ color: "#fff", fontSize: 12.5, fontWeight: 800 }}>{s}</span>
            </div>
          ))}
        </div>
        <span className="pk-live" style={{ position: "absolute", top: 12, right: 12, background: "#E5484D", color: "#fff", fontWeight: 700, fontSize: 11, borderRadius: 999, padding: "4px 10px" }}>● LIVE</span>
        {/* thanh điều khiển player */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "30px 14px 10px", background: "linear-gradient(transparent, rgba(4,6,10,0.88))", display: "flex", alignItems: "center", gap: 12, color: "#E8EBEF" }}>
          <Pause size={15} />
          <span style={{ width: 7, height: 7, borderRadius: 999, background: "#FF5C5C" }} />
          <span style={{ fontSize: 12, fontWeight: 650 }}>42:18</span>
          <div style={{ flex: 1, height: 3, borderRadius: 999, background: "rgba(255,255,255,0.22)" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 999, background: "#FF5C5C" }} />
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 650 }}><Eye size={14} /> 1.2k</span>
          <Maximize2 size={14} />
        </div>
      </div>
      {/* thẻ trận treo đè lên góc dưới-trái (kiểu thẻ sản phẩm Astryx) */}
      <div
        style={{
          position: "absolute",
          left: -74,
          bottom: -26,
          width: 262,
          borderRadius: 16,
          background: "#232427",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 26px 60px -24px rgba(0,0,0,.7)",
          padding: 12,
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, overflow: "hidden", flex: "none" }}>
            <MiniCourt {...(court || {})} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...floatTitle, fontSize: 15 }}>Chung kết đôi nam</div>
            <div style={{ ...floatSub, fontSize: 12.5 }}>Sân trung tâm · 18:00</div>
          </div>
        </div>
        <A href="/live" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 34, borderRadius: 999, background: "#E9EAEC", color: "#101114", fontWeight: 650, fontSize: 13.5, textDecoration: "none" }}>
          Xem trực tiếp
        </A>
      </div>
    </div>
  );
}

function PointsFloatCard({ accent = "#E9EAEC" }) {
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={floatSub}>Điểm trình</span>
        <span style={{ color: "#ECEDEF", fontWeight: 700, fontSize: 14 }}>4.5 / 8.0</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "#3A3B40", overflow: "hidden", marginBottom: 12 }}>
        <div style={{ width: "56%", height: "100%", borderRadius: 999, background: accent, transition: "background .6s" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Avatar size="xsmall" name="Trần Bảo" />
        <span style={{ ...floatSub, color: "#C6CACF" }}>Trần Bảo</span>
      </div>
    </div>
  );
}

/* ===== các thẻ cho slide 2 & 3 của carousel ===== */
function RefereeFloatCard({ accent = "#3D87FF" }) {
  const Row = ({ name, score, serving }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: serving ? "#4ADE80" : "#33343A", flex: "none" }} />
      <span style={{ ...floatSub, color: "#D5D9DD", flex: 1 }}>{name}</span>
      <span style={{ color: "#ECEDEF", fontWeight: 800, fontSize: 26, lineHeight: 1 }}>{score}</span>
    </div>
  );
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={floatTitle}>Chấm điểm trực tiếp</div>
        <span className="pk-live" style={{ background: "#E5484D", color: "#fff", fontWeight: 700, fontSize: 11, borderRadius: 999, padding: "3px 9px", alignSelf: "flex-start" }}>LIVE</span>
      </div>
      <Row name="Minh / Phong" score="11" serving />
      <div style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />
      <Row name="Hùng / Nam" score="9" />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <span style={{ flex: 1, textAlign: "center", padding: "9px 0", borderRadius: 999, background: accent, color: "#101114", fontWeight: 700, fontSize: 13.5, transition: "background .6s" }}>+1 điểm</span>
        <span style={{ flex: 1, textAlign: "center", padding: "9px 0", borderRadius: 999, background: "#2A2B2F", color: "#C9CDD2", fontWeight: 650, fontSize: 13.5 }}>Đổi giao</span>
      </div>
    </div>
  );
}

function BracketFloatCard({ accent = "#3D87FF" }) {
  const box = (x, y, w, label, hot) => (
    <g>
      <rect x={x} y={y} width={w} height="22" rx="6" fill={hot ? `${accent}30` : "#26272B"} stroke={hot ? accent : "rgba(255,255,255,0.09)"} strokeWidth="1" />
      <text x={x + 9} y={y + 15} fill={hot ? "#F2F5F9" : "#B9BEC5"} fontSize="10.5" fontWeight="600" fontFamily="inherit">{label}</text>
    </g>
  );
  return (
    <div style={{ padding: 16 }}>
      <div style={{ ...floatTitle, marginBottom: 4 }}>Sơ đồ loại trực tiếp</div>
      <div style={{ ...floatSub, marginBottom: 10 }}>Cập nhật realtime theo tỉ số</div>
      <svg width="100%" height="150" viewBox="0 0 280 150" style={{ display: "block" }}>
        {box(6, 8, 88, "Minh/Phong", true)}
        {box(6, 44, 88, "Tú/Đạt")}
        {box(6, 84, 88, "Hải/Long")}
        {box(6, 120, 88, "Sơn/Vũ")}
        <path d="M94 19 h16 v18 h14 M94 55 h16 v-18 M94 95 h16 v18 h14 M94 131 h16 v-18" stroke="rgba(255,255,255,0.22)" strokeWidth="1.4" fill="none" />
        {box(124, 28, 88, "Minh/Phong", true)}
        {box(124, 104, 88, "Hải/Long")}
        <path d="M212 39 h16 v27 h14 M212 115 h16 v-27" stroke="rgba(255,255,255,0.22)" strokeWidth="1.4" fill="none" />
        {box(242, 55, 34, "CK", true)}
      </svg>
    </div>
  );
}

function LeaderboardFloatCard() {
  const rows = [
    ["1", "Đặng V. An", "5.213", "#F0B03A"],
    ["2", "Lê Quân", "5.104", "#B9BEC5"],
    ["3", "Trần Bảo", "4.987", "#C77B42"],
  ];
  return (
    <div style={{ padding: 16 }}>
      <div style={{ ...floatTitle, marginBottom: 4 }}>Bảng xếp hạng</div>
      <div style={{ ...floatSub, marginBottom: 8 }}>Điểm trình chuẩn hoá toàn quốc</div>
      {rows.map(([rank, name, pts, c], i) => (
        <div key={rank} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: i ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
          <span style={{ color: c, fontWeight: 800, fontSize: 14, width: 14 }}>{rank}</span>
          <Avatar size="xsmall" name={name} />
          <span style={{ ...floatSub, color: "#D5D9DD", flex: 1 }}>{name}</span>
          <span style={{ color: "#ECEDEF", fontWeight: 750, fontSize: 14 }}>{pts}</span>
        </div>
      ))}
    </div>
  );
}

function ProfileFloatCard({ accent = "#3D87FF" }) {
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <Avatar size="medium" name="Đặng V. An" />
        <div>
          <div style={floatTitle}>Đặng V. An</div>
          <div style={floatSub}>Đà Nẵng · 42 trận</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <span style={{ background: "#17251B", color: "#4ADE80", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 650 }}>Top 3 tuần</span>
        <span style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent, border: `1px solid color-mix(in srgb, ${accent} 34%, transparent)`, borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 650, transition: "all .6s" }}>Đôi nam 5.2</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={floatSub}>Thắng gần đây</span>
        <span style={{ color: "#4ADE80", fontWeight: 750, fontSize: 13.5 }}>W · W · L · W · W</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "#3A3B40", overflow: "hidden" }}>
        <div style={{ width: "72%", height: "100%", borderRadius: 999, background: accent, transition: "background .6s" }} />
      </div>
    </div>
  );
}

const HeroPill = ({ children, style }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      borderRadius: 999,
      padding: "6px 13px",
      fontSize: 13,
      fontWeight: 600,
      ...style,
    }}
  >
    {children}
  </div>
);

/* ===== 3 slide = 3 THEME màu: đổi wordmark + nền + glow + sân + accent (như carousel Astryx) ===== */
const HERO_SLIDES = [
  {
    key: "blue",
    accent: "#3D87FF",
    bg: "#111112",
    glow:
      "radial-gradient(42% 36% at 30% 100%, rgba(168,85,150,.14), transparent 62%)," +
      "radial-gradient(40% 34% at 72% 96%, rgba(217,119,66,.10), transparent 60%)," +
      "radial-gradient(50% 40% at 50% 0%, rgba(61,135,255,.08), transparent 60%)",
    court: { ground: "#0E6F63", court: "#1D5FD1" },
    rightBare: false,
    renderLeft: (t) => <RefereeFloatCard accent={t.accent} />,
    renderRight: (t) => <BracketFloatCard accent={t.accent} />,
  },
  {
    key: "matcha",
    accent: "#C3D2A0",
    bg: "#171A12",
    glow:
      "radial-gradient(42% 36% at 28% 100%, rgba(140,180,100,.16), transparent 62%)," +
      "radial-gradient(40% 34% at 74% 96%, rgba(90,140,70,.12), transparent 60%)," +
      "radial-gradient(50% 40% at 50% 0%, rgba(150,190,120,.07), transparent 60%)",
    court: { ground: "#31492C", court: "#63884D" },
    rightBare: true,
    renderLeft: (t) => <TournamentFloatCard court={t.court} accent={t.accent} />,
    renderRight: (t) => <LiveFloatCard court={t.court} accent={t.accent} />,
  },
  {
    key: "butter",
    accent: "#F2D468",
    bg: "#211A0F",
    glow:
      "radial-gradient(42% 36% at 30% 100%, rgba(228,180,60,.18), transparent 62%)," +
      "radial-gradient(40% 34% at 72% 96%, rgba(200,140,50,.12), transparent 60%)," +
      "radial-gradient(50% 40% at 50% 0%, rgba(240,210,110,.07), transparent 60%)",
    court: { ground: "#6E5320", court: "#D9B23F" },
    rightBare: false,
    renderLeft: () => <LeaderboardFloatCard />,
    renderRight: (t) => <ProfileFloatCard accent={t.accent} />,
  },
  {
    key: "gothic",
    accent: "#CFC8EE",
    bg: "#16131D",
    glow:
      "radial-gradient(42% 36% at 30% 100%, rgba(140,110,220,.16), transparent 62%)," +
      "radial-gradient(40% 34% at 72% 96%, rgba(90,70,160,.13), transparent 60%)," +
      "radial-gradient(50% 40% at 50% 0%, rgba(180,160,240,.07), transparent 60%)",
    court: { ground: "#373152", court: "#6E64B0" },
    rightBare: false,
    renderLeft: (t) => (
      <TournamentFloatCard court={t.court} accent={t.accent} title="Giải Đêm PickleTour" sub="TP.HCM · 16 đội · Loại kép" />
    ),
    renderRight: (t) => <BracketFloatCard accent={t.accent} />,
  },
  {
    key: "y2k",
    accent: "#F2A7D8",
    bg: "#1D1218",
    glow:
      "radial-gradient(42% 36% at 30% 100%, rgba(240,120,190,.17), transparent 62%)," +
      "radial-gradient(40% 34% at 72% 96%, rgba(180,60,140,.12), transparent 60%)," +
      "radial-gradient(50% 40% at 50% 0%, rgba(250,160,210,.07), transparent 60%)",
    court: { ground: "#6E2B4E", court: "#C9539A" },
    rightBare: true,
    renderLeft: (t) => <ProfileFloatCard accent={t.accent} />,
    renderRight: (t) => <LiveFloatCard court={t.court} accent={t.accent} />,
  },
];
const SLIDE_MS = 5000;

function Hero({ pulse }) {
  const liveNow = Number(pulse?.liveNow || 0);
  const isAuthed = Boolean(useSelector((s) => s.auth?.userInfo));
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    // phụ thuộc `slide` để mỗi lần bấm dot là timer đếm lại từ đầu
    const timer = setInterval(() => setSlide((s) => (s + 1) % HERO_SLIDES.length), SLIDE_MS);
    return () => clearInterval(timer);
  }, [slide]);
  const t = HERO_SLIDES[slide];
  const { key, rightBare } = t;

  return (
    <div className="pk-hero" style={{ background: t.bg, transition: "background .8s ease" }}>
      {/* glow đổi màu theo theme slide */}
      <div
        aria-hidden
        key={`glow-${key}`}
        className="pk-fade"
        style={{
          position: "absolute",
          inset: 0,
          background: t.glow,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* ===== cụm thẻ nổi TRÁI (đối xứng với PHẢI) ===== */}
      <div
        className="pk-float"
        style={{
          top: 292,
          left: 44,
          borderRadius: 999,
          background: `color-mix(in srgb, ${t.accent} 13%, #121316)`,
          border: `1px solid color-mix(in srgb, ${t.accent} 32%, transparent)`,
          boxShadow: "none",
          transition: "background .6s, border-color .6s",
        }}
      >
        <HeroPill style={{ color: t.accent, transition: "color .6s" }}>
          <Sparkles size={13} />
          {liveNow > 0 ? `${liveNow} trận đang live` : "Đang mở đăng ký"}
        </HeroPill>
      </div>
      <div className="pk-float pk-fade" key={`L-${key}`} style={{ top: 340, left: 24, width: 312, borderRadius: 20 }}>
        <div className="pk-drift" style={{ animationDuration: "9s" }}>{t.renderLeft(t)}</div>
      </div>
      <div className="pk-float" style={{ top: 700, left: 44, width: 324, borderRadius: 999 }}>
        <div className="pk-drift" style={{ animationDuration: "11s", animationDelay: "1.4s" }}><ChatFloatCard /></div>
      </div>

      {/* ===== cụm thẻ nổi PHẢI ===== */}
      <div className="pk-float" style={{ top: 292, right: 44, borderRadius: 999, boxShadow: "none", background: "#1C1D20" }}>
        <HeroPill style={{ color: "#C9CDD2" }}>
          <Target size={13} />
          Miễn phí tạo giải
        </HeroPill>
      </div>
      <div
        className="pk-float pk-fade"
        key={`R-${key}`}
        style={
          rightBare
            ? { top: 340, right: 24, width: 312, overflow: "visible", background: "transparent", border: "none", borderRadius: 20 }
            : { top: 340, right: 24, width: 312, borderRadius: 20 }
        }
      >
        <div className="pk-drift" style={{ animationDuration: "10s", animationDelay: ".8s" }}>{t.renderRight(t)}</div>
      </div>
      <div className="pk-float" style={{ top: 700, right: 44, width: 280, borderRadius: 20 }}>
        <div className="pk-drift" style={{ animationDuration: "12s", animationDelay: "2s" }}><PointsFloatCard accent={t.accent} /></div>
      </div>

      {/* ===== cột giữa: wordmark khổng lồ + tagline + nút ===== */}
      <div className="pk-hero-inner">
        <Container>
          <div style={{ padding: "108px 0 120px", textAlign: "center" }}>
            <h1
              className="pk-rise"
              style={{
                margin: "0 auto",
                width: "clamp(300px, 52vw, 680px)",
                color: t.accent,
                transition: "color .8s ease",
                animationDelay: ".05s",
              }}
            >
              <PickleWordmark id="hero" />
            </h1>
            <div className="pk-rise" style={{ maxWidth: 820, margin: "26px auto 0", animationDelay: ".18s" }}>
              <div style={{ color: "#DFE2E5", fontWeight: 650, fontSize: "clamp(25px, 3.3vw, 42px)", lineHeight: 1.22, letterSpacing: "-0.015em" }}>
                Nền tảng giải đấu pickleball tuỳ biến trọn vẹn và sẵn sàng lên sóng
              </div>
            </div>
            <div className="pk-rise" style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 34, flexWrap: "wrap", animationDelay: ".3s" }}>
              {isAuthed ? (
                <WhitePill label="Giải của tôi" href="/my-tournaments" size="lg" />
              ) : (
                <WhitePill label="Bắt đầu ngay" href="/register" size="lg" />
              )}
              <GrayPill label="Khám phá giải đấu" href="/pickle-ball/tournaments" size="lg" />
            </div>
            <div className="pk-rise" style={{ marginTop: 22, color: "#8F959C", fontSize: 14.5, animationDelay: ".42s" }}>
              Đang thử nghiệm Beta · Chạy trên <span style={{ textDecoration: "underline" }}>React</span> và <span style={{ textDecoration: "underline" }}>Astryx</span>
            </div>
          </div>
        </Container>
      </div>

      {/* dots carousel — bấm để đổi bộ thẻ showcase */}
      <div style={{ position: "absolute", bottom: 26, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 8, zIndex: 4 }}>
        {HERO_SLIDES.map((s, i) => (
          <button
            key={s.key}
            type="button"
            aria-label={`Slide ${i + 1}`}
            onClick={() => setSlide(i)}
            style={{
              width: i === slide ? 22 : 8,
              height: 8,
              borderRadius: 999,
              background: i === slide ? "#E9EAEC" : "#3A3B40",
              border: "none",
              padding: 0,
              cursor: "pointer",
              transition: "width .25s ease, background .25s ease",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ============ helper chung cho các section dưới-fold (chất Astryx) ============ */
const bigHeadStyle = {
  fontFamily: '"Figtree Variable", sans-serif',
  fontWeight: 750,
  letterSpacing: "-0.03em",
  lineHeight: 1.03,
  color: "var(--color-text-primary)",
  fontSize: "clamp(30px, 4.4vw, 54px)",
  margin: 0,
};
const surfPanel = {
  borderRadius: 20,
  border: "1px solid var(--color-border)",
  background: "var(--color-background-surface)",
  overflow: "hidden",
};
/* hiện dần khi cuộn tới (một lần) */
function Reveal({ children }) {
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // fallback: đã trong viewport lúc mount (hoặc môi trường không có IO) -> hiện luôn
    const vh = window.innerHeight || 800;
    if (el.getBoundingClientRect().top < vh * 0.95 || typeof IntersectionObserver === "undefined") {
      setOn(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={on ? "pk-reveal pk-reveal-in" : "pk-reveal"}>
      {children}
    </div>
  );
}

const Band = ({ children, surface, pad = "104px 0", style }) => (
  <div style={{ background: surface ? "var(--color-background-surface)" : "transparent", borderTop: "1px solid var(--color-border)", ...style }}>
    <Container>
      <div style={{ padding: pad }}>
        <Reveal>{children}</Reveal>
      </div>
    </Container>
  </div>
);
const ExploreLink = ({ href, label = "Khám phá" }) => (
  <A href={href} className="pk-link" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-text-accent)", fontWeight: 650, fontSize: 15.5, textDecoration: "none", whiteSpace: "nowrap" }}>
    {label} <ArrowUpRight size={17} />
  </A>
);
const SectionHead = ({ title, sub, href, linkLabel, align = "left", max = 620 }) => (
  <div style={{ textAlign: align, maxWidth: align === "center" ? 760 : "none", margin: align === "center" ? "0 auto" : 0 }}>
    <h2 style={bigHeadStyle}>{title}</h2>
    {sub ? (
      <div style={{ maxWidth: max, margin: align === "center" ? "16px auto 0" : "16px 0 0" }}>
        <Text type="large" color="secondary">{sub}</Text>
      </div>
    ) : null}
    {href ? <div style={{ marginTop: 20 }}><ExploreLink href={href} label={linkLabel} /></div> : null}
  </div>
);

/* ===== Section: điểm trình — số liệu KHỔNG LỒ + feed leo hạng (kiểu revenue band) ===== */
function MetricCard({ value, label, note }) {
  return (
    <div style={{ ...surfPanel, padding: "28px 28px" }}>
      <div style={{ fontFamily: '"Figtree Variable", sans-serif', fontWeight: 800, letterSpacing: "-0.04em", fontSize: "clamp(40px, 5vw, 60px)", lineHeight: 1, color: "var(--color-text-primary)" }}>
        {value}
        <span style={{ color: "var(--color-text-accent)" }}>+</span>
      </div>
      <div style={{ marginTop: 12 }}><Text type="body" weight="semibold">{label}</Text></div>
      {note ? <div style={{ marginTop: 4 }}><Text type="supporting" color="secondary">{note}</Text></div> : null}
    </div>
  );
}

function RatingBand({ stats, climbers }) {
  return (
    <Band surface>
      <SectionHead
        title="Điểm trình chuẩn hoá sau mỗi trận"
        sub="Cộng/trừ minh bạch theo vòng bảng và playoff. Mỗi kết quả đồng bộ tức thì vào hồ sơ và bảng xếp hạng toàn quốc."
        href="/pickle-ball/rankings"
        linkLabel="Xem bảng xếp hạng"
      />
      <div style={{ height: 40 }} />
      <div className="pk-2col" style={{ display: "grid", gridTemplateColumns: "minmax(0,0.85fr) minmax(0,1.15fr)", gap: 22 }}>
        <div style={{ display: "grid", gap: 20 }}>
          <MetricCard value={fmtInt(stats?.matches)} label="Trận đã chấm điểm" note="Đồng bộ realtime khi trọng tài bấm" />
          <MetricCard value={fmtInt(stats?.players)} label="Vận động viên có điểm trình" note="Tăng đều mỗi tuần" />
        </div>
        <div style={surfPanel}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid var(--color-border)" }}>
            <Icon icon={TrendingUp} color="success" size="sm" />
            <Text type="body" weight="bold">Leo hạng tuần này</Text>
          </div>
          {!climbers?.length ? (
            <div style={{ padding: 28, textAlign: "center" }}><Text type="supporting" color="secondary">Chưa có dữ liệu tuần này.</Text></div>
          ) : (
            climbers.slice(0, 6).map((c, i) => (
              <div key={c?.userId || i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderTop: i ? "1px solid var(--color-border)" : "none" }}>
                <Avatar size="small" src={imgUrl(c?.avatar)} name={firstText(c?.nickname, "VĐV")} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text type="body" weight="semibold">{firstText(c?.nickname, "VĐV")}</Text>
                  <Text type="supporting" color="secondary">{c?.matches || 0} trận · {firstText(c?.province, "—")}</Text>
                </div>
                <Badge variant="success" label={`+${Number(c?.delta || 0).toFixed(3)}`} />
              </div>
            ))
          )}
        </div>
      </div>
    </Band>
  );
}

/* ===== Bảng điều khiển trọng tài (UI thật của sản phẩm — showcase) ===== */
function ConsoleBtn({ label, primary }) {
  return (
    <span style={{ flex: 1, textAlign: "center", padding: "12px 0", borderRadius: 12, fontWeight: 700, fontSize: 14, background: primary ? "var(--color-accent)" : "#2A2B2F", color: primary ? "var(--color-on-accent)" : "#C9CDD2", transition: "background .6s" }}>
      {label}
    </span>
  );
}
function ScoringConsole() {
  const Row = ({ name, score, serving }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: serving ? "#22C55E" : "#33343A", flex: "none" }} />
        <Text type="large" weight="semibold">{name}</Text>
      </div>
      <span style={{ fontFamily: '"Figtree Variable", sans-serif', fontWeight: 800, fontSize: 46, lineHeight: 1, letterSpacing: "-0.03em", color: "var(--color-text-primary)" }}>{score}</span>
    </div>
  );
  return (
    <div style={{ ...surfPanel, boxShadow: "0 40px 80px -40px rgba(0,0,0,.7)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", borderBottom: "1px solid var(--color-border)" }}>
        <div>
          <Text type="body" weight="bold">Chung kết đôi nam</Text>
          <Text type="supporting" color="secondary">Sân trung tâm · Ván 3</Text>
        </div>
        <span className="pk-live" style={{ background: "#E5484D", color: "#fff", fontWeight: 700, fontSize: 12, borderRadius: 999, padding: "5px 11px" }}>● LIVE</span>
      </div>
      <Row name="Minh / Phong" score="11" serving />
      <div style={{ height: 1, background: "var(--color-border)" }} />
      <Row name="Hùng / Nam" score="9" />
      <div style={{ display: "flex", gap: 10, padding: "16px 22px", borderTop: "1px solid var(--color-border)" }}>
        <ConsoleBtn label="＋ Điểm A" primary />
        <ConsoleBtn label="Đổi giao" />
        <ConsoleBtn label="Kết thúc ván" />
      </div>
    </div>
  );
}

/* ===== Section: chấm điểm & phát sóng (2 cột split) ===== */
function ScoringShowcase() {
  const bullets = [
    "Trọng tài chấm trên điện thoại — khán giả thấy tỉ số tức thì",
    "Phát sóng có overlay: scoreboard, logo, nhà tài trợ",
    "Sơ đồ nhánh tự cập nhật theo từng điểm số",
  ];
  return (
    <Band>
      <div className="pk-2col" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 56, alignItems: "center" }}>
        <div>
          <SectionHead
            title="Chấm điểm trực tiếp, lên sóng tức thì"
            sub="Từ bàn trọng tài tới màn hình khán giả chỉ trong một nhịp bấm — không thiết bị đắt tiền, chỉ cần điện thoại."
            href="/live"
            linkLabel="Xem trực tiếp"
          />
          <div style={{ marginTop: 30, display: "grid", gap: 16 }}>
            {bullets.map((b) => (
              <div key={b} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ width: 26, height: 26, borderRadius: 9, background: "color-mix(in srgb, var(--color-accent) 18%, transparent)", color: "var(--color-text-accent)", display: "grid", placeItems: "center", flex: "none", transition: "all .6s" }}>
                  <Check size={16} />
                </span>
                <Text type="body">{b}</Text>
              </div>
            ))}
          </div>
        </div>
        <ScoringConsole />
      </div>
    </Band>
  );
}

/* ===== Social proof band (số khổng lồ, center) ===== */
function SocialProof({ stats }) {
  const mini = [
    [fmtInt(stats?.players), "vận động viên"],
    [fmtInt(stats?.matches), "trận đã đấu"],
    [fmtInt(stats?.clubs), "câu lạc bộ"],
  ];
  return (
    <Band surface pad="120px 0">
      <div style={{ textAlign: "center", maxWidth: 860, margin: "0 auto" }}>
        <h2 style={{ ...bigHeadStyle, fontSize: "clamp(34px, 5.6vw, 70px)" }}>
          PickleTour đang phục vụ {fmtInt(stats?.tournaments)}+ giải đấu
        </h2>
        <div style={{ maxWidth: 620, margin: "18px auto 0" }}>
          <Text type="large" color="secondary">
            Từ giải phong trào tới hệ thống chuyên nghiệp — hàng nghìn trận được chấm điểm, phát sóng và xếp hạng minh bạch.
          </Text>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 48, flexWrap: "wrap", marginTop: 48 }}>
          {mini.map(([v, l]) => (
            <div key={l} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: '"Figtree Variable", sans-serif', fontWeight: 800, fontSize: 34, letterSpacing: "-0.03em", color: "var(--color-text-primary)" }}>{v}</div>
              <div style={{ marginTop: 4 }}><Text type="supporting" color="secondary">{l}</Text></div>
            </div>
          ))}
        </div>
      </div>
    </Band>
  );
}

function TournamentBand({ items, loading }) {
  const list = asArray(items)
    .filter((t) => !t?.isTest)
    .sort((a, b) => ({ ongoing: 0, upcoming: 1, finished: 2 }[a?.status] ?? 3) - ({ ongoing: 0, upcoming: 1, finished: 2 }[b?.status] ?? 3))
    .slice(0, 3);
  return (
    <Band>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 620 }}>
          <h2 style={bigHeadStyle}>Giải đấu đang mở khắp cả nước</h2>
          <div style={{ marginTop: 16 }}><Text type="large" color="secondary">Tham gia thi đấu hoặc theo dõi trực tiếp — mọi giải đều có sơ đồ, lịch và bảng điểm realtime.</Text></div>
        </div>
        <ExploreLink href="/pickle-ball/tournaments" label="Tất cả giải đấu" />
      </div>
      <div style={{ height: 36 }} />
      <div className="pk-3col" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 22 }}>
        {loading && !list.length
          ? [0, 1, 2].map((i) => <div key={i} style={{ ...surfPanel, height: 280 }} />)
          : list.map((t, i) => {
              const st = STATUS_META[t?.status] || STATUS_META.upcoming;
              const cover = imgUrl(firstText(t?.image, t?.coverUrl, t?.banner));
              return (
                <A key={t?._id || t?.id || i} href={`/tournament/${t?._id || t?.id}`} style={{ ...surfPanel, textDecoration: "none", display: "block" }}>
                  <div style={{ position: "relative", aspectRatio: "16 / 10", background: "var(--color-background-body)" }}>
                    {cover ? (
                      <img src={cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#22D3EE,#3B82F6,#7C3AED)", display: "grid", placeItems: "center", fontSize: 40 }}>🏆</div>
                    )}
                    <div style={{ position: "absolute", top: 12, left: 12 }}>
                      <span style={{ background: "rgba(10,12,16,0.72)", color: "#EDEEF0", fontWeight: 700, fontSize: 11.5, borderRadius: 999, padding: "4px 10px" }}>{st.label}</span>
                    </div>
                  </div>
                  <div style={{ padding: 18 }}>
                    <Text type="body" weight="bold">{firstText(t?.name, "Giải đấu")}</Text>
                    <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><Icon icon={MapPin} color="tertiary" size="xsm" /><Text type="supporting" color="secondary">{firstText(t?.location, t?.province, "—")}</Text></span>
                      <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><Icon icon={CalendarDays} color="tertiary" size="xsm" /><Text type="supporting" color="secondary">{fmtDate(t?.startDate || t?.startAt)}</Text></span>
                    </div>
                  </div>
                </A>
              );
            })}
      </div>
    </Band>
  );
}

function rankName(r) {
  return firstText(r?.nickname, r?.nickName, r?.user?.nickname, r?.fullName, r?.name, "VĐV");
}
function rankScore(r) {
  const v = Number(firstText(r?.double, r?.points, r?.single) || 0);
  return v ? v.toFixed(3) : "—";
}

function RankTable({ ranks, ranksLoading, climbers }) {
  const top = asArray(ranks).slice(0, 8);
  const cmap = {};
  (climbers || []).forEach((c) => { if (c?.userId) cmap[String(c.userId)] = c.delta; });
  const GRID = "44px minmax(0,1fr) 130px 96px 84px";
  const medal = ["#F0B03A", "#B9BEC5", "#C77B42"];
  const cell = { padding: "0 16px", display: "flex", alignItems: "center", minWidth: 0 };
  return (
    <Band>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 620 }}>
          <h2 style={bigHeadStyle}>Bảng xếp hạng toàn quốc</h2>
          <div style={{ marginTop: 16 }}><Text type="large" color="secondary">Điểm trình chuẩn hoá, cập nhật sau mỗi trận. Ai thắng ai — rõ ràng, không cảm tính.</Text></div>
        </div>
        <ExploreLink href="/pickle-ball/rankings" label="Xem đầy đủ" />
      </div>
      <div style={{ height: 32 }} />
      <div style={surfPanel}>
        <div style={{ display: "grid", gridTemplateColumns: GRID, height: 46, borderBottom: "1px solid var(--color-border)", background: "color-mix(in srgb, var(--color-text-primary) 4%, transparent)" }}>
          {["#", "Vận động viên", "Tỉnh / Thành", "Điểm trình", "Tuần"].map((h, i) => (
            <div key={h} style={{ ...cell, justifyContent: i >= 3 ? "flex-end" : "flex-start" }}><Text type="supporting" color="secondary" weight="semibold">{h}</Text></div>
          ))}
        </div>
        {ranksLoading && !top.length
          ? [0, 1, 2, 3, 4, 5].map((i) => <div key={i} style={{ height: 60, borderTop: i ? "1px solid var(--color-border)" : "none" }} />)
          : top.map((r, i) => {
              const uid = String(firstText(r?.user?._id, r?.user, r?._id));
              const delta = cmap[uid];
              return (
                <div key={uid || i} className="pk-trow" style={{ display: "grid", gridTemplateColumns: GRID, height: 62, borderTop: i ? "1px solid var(--color-border)" : "none", transition: "background .15s" }}>
                  <div style={{ ...cell }}><span style={{ fontWeight: 800, fontSize: 15, color: i < 3 ? medal[i] : "var(--color-text-secondary)" }}>{i + 1}</span></div>
                  <div style={{ ...cell, gap: 12 }}>
                    <Avatar size="small" src={imgUrl(firstText(r?.avatar, r?.user?.avatar))} name={rankName(r)} />
                    <Text type="body" weight="semibold">{rankName(r)}</Text>
                  </div>
                  <div style={{ ...cell }}><Text type="supporting" color="secondary">{firstText(r?.province, r?.user?.province, "—")}</Text></div>
                  <div style={{ ...cell, justifyContent: "flex-end" }}><Text type="body" weight="bold">{rankScore(r)}</Text></div>
                  <div style={{ ...cell, justifyContent: "flex-end" }}>
                    {delta ? <Badge variant="success" label={`+${Number(delta).toFixed(2)}`} /> : <Text type="supporting" color="tertiary">—</Text>}
                  </div>
                </div>
              );
            })}
      </div>
    </Band>
  );
}

function ValueAndCTA() {
  const ctaAuthed = Boolean(useSelector((s) => s.auth?.userInfo));
  const cols = [
    [Zap, "Tổ chức trong vài phút", "Bốc thăm, tạo sơ đồ và xếp lịch tự động — không cần bảng tính hay giấy bút.", "/pickle-ball/tournaments", "Tạo giải"],
    [ShieldCheck, "Minh bạch tuyệt đối", "Điểm trình cộng/trừ rõ ràng theo từng vòng, ai cũng kiểm chứng được.", "/pickle-ball/rankings", "Cách tính điểm"],
    [Radar, "Sẵn sàng lên sóng", "Live/record ngay trên điện thoại với overlay chuyên nghiệp.", "/live", "Xem trực tiếp"],
  ];
  return (
    <>
      <Band>
        <div className="pk-3col" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 28 }}>
          {cols.map(([IconComp, title, body, href, link]) => (
            <div key={title} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: "color-mix(in srgb, var(--color-accent) 16%, transparent)", color: "var(--color-text-accent)", display: "grid", placeItems: "center", transition: "all .6s" }}><IconComp size={22} /></span>
              <Text type="large" weight="bold">{title}</Text>
              <Text type="body" color="secondary">{body}</Text>
              <div style={{ marginTop: 2 }}><ExploreLink href={href} label={link} /></div>
            </div>
          ))}
        </div>
      </Band>

      {/* CTA cuối: KHÔNG đóng hộp — chữ khổng lồ giữa nền trang, một nguồn sáng duy nhất (sạch kiểu Astryx) */}
      <div style={{ borderTop: "1px solid var(--color-border)" }}>
        <Container>
          <div style={{ position: "relative", padding: "150px 0 160px", textAlign: "center" }}>
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                background: "radial-gradient(46% 58% at 50% 40%, color-mix(in srgb, var(--color-brand, #3D87FF) 15%, transparent), transparent 72%)",
              }}
            />
            <div style={{ position: "relative" }}>
              <Reveal>
                <div style={{ display: "flex", justifyContent: "center" }}><PickleMark size={46} /></div>
                <h2 style={{ ...bigHeadStyle, fontSize: "clamp(38px, 6vw, 76px)", marginTop: 26 }}>
                  Sẵn sàng tổ chức{" "}
                  <span style={{ color: "var(--color-brand, #3D87FF)" }}>giải của bạn?</span>
                </h2>
                <div style={{ maxWidth: 540, margin: "20px auto 0" }}>
                  <Text type="large" color="secondary">Tạo giải miễn phí, mời vận động viên và lên sóng ngay hôm nay.</Text>
                </div>
                <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 38, flexWrap: "wrap" }}>
                  <WhitePill label="Tạo giải miễn phí" href={ctaAuthed ? "/my-tournaments" : "/register"} size="lg" />
                  <GrayPill label="Xem giải đang mở" href="/pickle-ball/tournaments" size="lg" />
                </div>
                <div style={{ marginTop: 20 }}>
                  <Text type="supporting" color="tertiary">Miễn phí tạo giải · Không cần thẻ · Chấm điểm realtime</Text>
                </div>
              </Reveal>
            </div>
          </div>
        </Container>
      </div>
    </>
  );
}

/* ================================= PAGE ================================= */
export default function HomeScreenAstryx() {
  const { data: summary, isLoading: summaryLoading } = useGetHomeSummaryQuery({ clubsLimit: 6 });
  const { data: pulse } = useGetHomePulseQuery();
  const { data: tournaments, isLoading: tourLoading } = useListTournamentsQuery({ limit: 24, sort: "-startDate" });
  const { data: ranks, isLoading: ranksLoading } = useGetRankingsListQuery({ limit: 8 });
  const { data: liveFeed, isLoading: liveLoading } = useGetLiveFeedQuery({ limit: 6, sort: "smart" });

  return (
    <>
      <SEOHead
        title="PickleTour — Nền tảng giải đấu pickleball chuyên nghiệp"
        description="Tổ chức, chấm điểm trực tiếp và phát sóng giải đấu pickleball. Bảng xếp hạng và điểm trình chuẩn hoá."
      />
      <ShadowFrame style={{ minHeight: "100vh" }}>
        <Theme theme={neutralTheme}>
          <div style={{ minHeight: "100vh", background: "var(--color-background-body)" }}>
            <SiteNav />
            <Hero pulse={pulse} />
            <ScoringShowcase />
            <RatingBand stats={summary?.stats} climbers={pulse?.weekClimbers} />
            <RankTable ranks={ranks} ranksLoading={ranksLoading} climbers={pulse?.weekClimbers} />
            <TournamentBand items={tournaments} loading={tourLoading} />
            <SocialProof stats={summary?.stats} />
            <ValueAndCTA />
            <SiteFooter />
          </div>
        </Theme>
      </ShadowFrame>
    </>
  );
}
