/**
 * TournamentsPage — trang Giải đấu phong cách Astryx (trong ShadowFrame, dark).
 * Cấu trúc: SiteNav → Hero cinematic (giải nổi bật, ảnh thật + overlay) →
 * toolbar sticky (search + filter status) → grid card (ảnh, progress đăng ký,
 * countdown, live pulse) → SiteFooter. Data thật: useListTournamentsQuery.
 * ?ui=v1 tại route này sẽ ra trang cũ (gate ở TournamentsScreen.jsx).
 */
import "@fontsource-variable/figtree";

import { useMemo, useState } from "react";
import { useSelector } from "react-redux";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import {
  CalendarDays,
  CalendarRange,
  MapPin,
  Network,
  Search,
  ArrowUpRight,
  Ticket,
  Swords,
  Clock3,
  UserPlus,
} from "lucide-react";

import SEOHead from "../../components/SEOHead.jsx";
import ShadowFrame from "./ShadowFrame.jsx";
import SiteNav from "./SiteNav.jsx";
import SiteFooter from "./SiteFooter.jsx";
import PickleMark from "./PickleMark.jsx";
import { A, WhitePill, GrayPill, Lightbox } from "./ui.jsx";
import { useListTournamentsQuery } from "../../slices/tournamentsApiSlice.js";

/* ------------------------------- helpers ------------------------------- */
const Container = ({ children, style }) => (
  <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px", ...style }}>
    {children}
  </div>
);

const imgUrl = (u) => {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^(https?:)?\/\//i.test(s) || s.startsWith("data:")) return s;
  return s.startsWith("/") ? s : `/${s}`;
};

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
const fmtMoney = (n) => {
  const v = Number(n || 0);
  if (!v) return "";
  return `${v.toLocaleString("vi-VN")}₫`;
};
const daysUntil = (d) => {
  if (!d) return null;
  const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  return Number.isFinite(diff) ? diff : null;
};
/* tìm kiếm không dấu */
const fold = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");

const STATUS_META = {
  ongoing: { label: "Đang diễn ra", variant: "success" },
  upcoming: { label: "Sắp diễn ra", variant: "info" },
  finished: { label: "Đã kết thúc", variant: "neutral" },
};
const statusOf = (t) => {
  const s = String(t?.status || "").toLowerCase();
  if (STATUS_META[s]) return s;
  const now = Date.now();
  const st = t?.startDate ? new Date(t.startDate).getTime() : 0;
  const en = t?.endDate ? new Date(t.endDate).getTime() : 0;
  if (st && now < st) return "upcoming";
  if (en && now > en) return "finished";
  return "ongoing";
};
const regCount = (t) => {
  if (Array.isArray(t?.registered)) return t.registered.length;
  const n = Number(t?.registered ?? t?.registeredCount ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/* ------------------------------ page head ------------------------------ */
function PageHead({ counts, loading }) {
  return (
    <div style={{ position: "relative", overflow: "hidden", borderBottom: "1px solid var(--color-border)" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(46% 62% at 78% 6%, rgba(61,135,255,.13), transparent 62%)" }} />
      <div
        aria-hidden
        className="pk-spin-slow"
        style={{ position: "absolute", right: -140, top: -130, opacity: 0.06, color: "var(--color-brand, #3D87FF)", pointerEvents: "none" }}
      >
        <PickleMark size={440} />
      </div>
      <Container style={{ position: "relative", zIndex: 2 }}>
        <div style={{ padding: "76px 0 54px" }}>
          <div style={{ minHeight: 32 }}>
            {!loading && counts.ongoing > 0 && (
              <span
                className="pk-rise pk-live"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 13px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 700,
                  background: "rgba(229,72,77,.12)",
                  color: "light-dark(#D6474F, #FF8A8E)",
                  border: "1px solid rgba(242,85,90,.32)",
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 99, background: "#F2555A" }} />
                {counts.ongoing} giải đang diễn ra
              </span>
            )}
          </div>
          <h1
            className="pk-rise"
            style={{
              margin: "14px 0 0",
              fontWeight: 750,
              fontSize: "clamp(42px, 6.4vw, 84px)",
              lineHeight: 1.02,
              letterSpacing: "-0.028em",
              color: "light-dark(#16181B, #F5F6F7)",
              animationDelay: ".07s",
            }}
          >
            Chọn giải đấu.
            <br />
            <span style={{ color: "var(--color-brand, #3D87FF)" }}>Vào trận.</span>
          </h1>
          <div className="pk-rise" style={{ maxWidth: 640, marginTop: 22, animationDelay: ".16s" }}>
            <Text type="large" color="secondary">
              Đăng ký một chạm, sơ đồ tự động, tỷ số trực tiếp — mọi giải pickleball trên toàn quốc, trong một đấu trường.
            </Text>
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

function Toolbar({ tab, setTab, q, setQ, counts }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 64,
        zIndex: 15,
        background: "light-dark(rgba(255,255,255,.78), rgba(17,17,18,.78))",
        backdropFilter: "saturate(160%) blur(12px)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <Container>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", flexWrap: "wrap" }}>
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
                    padding: "0 15px",
                    borderRadius: 999,
                    cursor: "pointer",
                    fontSize: 13.5,
                    fontWeight: 650,
                    background: active ? "var(--pk-pill-bg, #F2F3F5)" : "var(--pk-chip-bg)",
                    color: active ? "var(--pk-pill-fg, #101114)" : "var(--pk-text)",
                    border: active ? "1px solid transparent" : "1px solid light-dark(rgba(0,0,0,.10), rgba(255,255,255,.09))",
                  }}
                >
                  {label}
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      padding: "1px 7px",
                      borderRadius: 99,
                      // pill active đảo màu theo theme -> badge đếm bên trong cũng đảo theo
                      background: active ? "light-dark(rgba(255,255,255,.16), rgba(16,17,20,.10))" : "light-dark(rgba(0,0,0,.07), rgba(255,255,255,.09))",
                      color: active ? "light-dark(#D8DBDF, #3A3D44)" : "light-dark(#6B7075, #9AA0A6)",
                    }}
                  >
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
              background: "var(--pk-chip-bg)",
              border: "1px solid light-dark(rgba(0,0,0,.10), rgba(255,255,255,.10))",
              minWidth: 220,
              flex: "0 1 340px",
            }}
          >
            <Search size={15} style={{ color: "light-dark(#6B7075, #9AA0A6)", flexShrink: 0 }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm giải, địa điểm…"
              style={{
                all: "unset",
                width: "100%",
                color: "light-dark(#26282B, #E6E8EA)",
                fontSize: 14,
                fontFamily: "inherit",
              }}
            />
            {q && (
              <button type="button" onClick={() => setQ("")} style={{ all: "unset", cursor: "pointer", color: "light-dark(#6B7075, #9AA0A6)", fontSize: 12.5, fontWeight: 700 }}>
                Xoá
              </button>
            )}
          </label>
        </div>
      </Container>
    </div>
  );
}

/* --------------------------------- card -------------------------------- */
function TournamentCard({ t, index, big = false, onZoom, manage = false }) {
  const st = statusOf(t);
  const meta = STATUS_META[st];
  const img = imgUrl(t.image);
  const reg = regCount(t);
  const cap = Number(t.maxPairs || 0);
  const pct = cap ? Math.min(100, Math.round((reg / cap) * 100)) : 0;
  const dLeft = st === "upcoming" ? daysUntil(t.registrationDeadline || t.startDate) : null;
  const fee = t.isFreeRegistration ? "Miễn phí" : fmtMoney(t.registrationFee);

  return (
    <div
      className={`pk-tcard pk-reveal-card${big ? " pk-span2" : ""}`}
      style={{
        display: "block",
        borderRadius: 18,
        overflow: "hidden",
        background: "var(--color-background-surface)",
        border: "1px solid var(--color-border)",
        animationDelay: `${Math.min(index, 8) * 0.05}s`,
      }}
    >
      <div
        style={{ position: "relative", height: big ? 254 : 168, overflow: "hidden", background: "light-dark(#ECEEF1, #191A1D)", cursor: img ? "zoom-in" : undefined }}
        onClick={
          img
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onZoom?.(img);
              }
            : undefined
        }
      >
        {img ? (
          <div
            className="pk-tcard-img"
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `url("${img}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "radial-gradient(70% 90% at 50% 0%, rgba(61,135,255,.18), transparent 70%)" }}>
            <PickleMark size={44} />
          </div>
        )}
        <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(10,11,13,.22) 0%, transparent 38%, rgba(10,11,13,.78) 100%)" }} />
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
        <span style={{ position: "absolute", top: 12, right: 12, display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 650, background: "rgba(20,21,24,.72)", color: "#DFE2E5", border: "1px solid rgba(255,255,255,.12)", backdropFilter: "blur(6px)" }}>
          <CalendarDays size={11} />
          {fmtRange(t.startDate, t.endDate)}
        </span>
        {dLeft != null && dLeft >= 0 && dLeft <= 14 && (
          <span style={{ position: "absolute", bottom: 12, left: 12, display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "rgba(61,135,255,.18)", color: "#9CC1FF", border: "1px solid rgba(61,135,255,.35)", backdropFilter: "blur(6px)" }}>
            <Clock3 size={11} />
            {dLeft === 0 ? "Chốt ĐK hôm nay" : `Chốt ĐK sau ${dLeft} ngày`}
          </span>
        )}
      </div>

      <div style={{ padding: "16px 16px 15px" }}>
        <A
          href={`/tournament/${t._id}`}
          style={{
            color: "var(--pk-text-strong)",
            textDecoration: "none",
            fontWeight: 700,
            fontSize: big ? 21 : 16.5,
            lineHeight: 1.32,
            letterSpacing: "-0.01em",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: big ? 0 : 44,
          }}
        >
          {t.name}
        </A>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9, color: "light-dark(#6B7075, #9AA0A6)", fontSize: 13 }}>
          <MapPin size={13} style={{ flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.location || "—"}</span>
        </div>

        <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
          <span style={chip}>
            <Swords size={11} />
            {String(t.eventType || "").toLowerCase() === "single" ? "Đấu đơn" : "Đấu đôi"}
          </span>
          {fee && (
            <span style={chip}>
              <Ticket size={11} />
              {fee}
            </span>
          )}
          {t.code && <span style={chip}>{t.code}</span>}
          {Number(t.matchesCount || 0) > 0 && <span style={chip}>{t.matchesCount} trận</span>}
        </div>

        {cap > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <Text type="supporting" color="secondary">Đăng ký</Text>
              <Text type="supporting" color={t.isFull ? "primary" : "secondary"} weight="semibold">
                {t.isFull ? "Đã đầy" : `${reg}/${cap} đội`}
              </Text>
            </div>
            <div style={{ height: 5, borderRadius: 99, background: "light-dark(rgba(0,0,0,.08), rgba(255,255,255,.08))", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  borderRadius: 99,
                  background: t.isFull
                    ? "linear-gradient(90deg, #F2555A, #FF8A5C)"
                    : "linear-gradient(90deg, #2694FE, #3D87FF)",
                  transition: "width .6s cubic-bezier(.2,.7,.2,1)",
                }}
              />
            </div>
          </div>
        )}

        {/* hàng nút nhanh — GIỮ logic trang cũ theo trạng thái:
            upcoming: Đăng ký + Sơ đồ | ongoing: Lịch đấu + Sơ đồ | finished: Sơ đồ
            admin/manager (manage): đủ cả Đăng ký + Lịch đấu + Sơ đồ như trước */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {(manage || st === "upcoming") && (
            <A href={`/tournament/${t._id}/register`} style={miniPrimary}>
              <UserPlus size={13} strokeWidth={2.4} />
              Đăng ký
            </A>
          )}
          {(manage || st === "ongoing") && (
            <A href={`/tournament/${t._id}/schedule`} style={manage ? miniGhost : miniPrimary}>
              <CalendarRange size={13} strokeWidth={2.2} />
              Lịch đấu
            </A>
          )}
          <A href={`/tournament/${t._id}/bracket`} style={miniGhost}>
            <Network size={13} strokeWidth={2.2} />
            Sơ đồ
          </A>
          <A
            href={`/tournament/${t._id}`}
            className="pk-link"
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, color: "var(--color-text-accent, #3E9EFB)", fontSize: 13, fontWeight: 650, textDecoration: "none" }}
          >
            Chi tiết
            <ArrowUpRight size={14} />
          </A>
        </div>
      </div>
    </div>
  );
}

/* pill hành động nhỏ trên card */
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
};
/* primary trên nền tối = trắng; ở light ĐẢO thành nền tối chữ trắng (như WhitePill) */
const miniPrimary = {
  ...miniBase,
  background: "light-dark(#1A1B1E, #FFFFFF)",
  color: "light-dark(#FFFFFF, #0B0C0E)",
};
const miniGhost = {
  ...miniBase,
  background: "var(--pk-surface-2)",
  color: "light-dark(#33373B, #DFE2E5)",
  border: "1px solid light-dark(rgba(0,0,0,.14), rgba(255,255,255,.14))",
};

const chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 9px",
  borderRadius: 999,
  fontSize: 11.5,
  fontWeight: 650,
  background: "var(--pk-chip-bg)",
  color: "var(--pk-text)",
  border: "1px solid light-dark(rgba(0,0,0,.08), rgba(255,255,255,.08))",
};

function CardSkeleton() {
  return (
    <div style={{ borderRadius: 18, overflow: "hidden", border: "1px solid var(--color-border)", background: "var(--color-background-surface)" }}>
      <Skeleton width="100%" height="168px" />
      <div style={{ padding: 16 }}>
        <Skeleton width="90%" height="20px" />
        <div style={{ height: 10 }} />
        <Skeleton width="60%" height="14px" />
        <div style={{ height: 14 }} />
        <Skeleton width="100%" height="6px" />
      </div>
    </div>
  );
}

/* ================================= PAGE ================================= */
export default function TournamentsPage() {
  const { data, isLoading } = useListTournamentsQuery({ limit: 100, sort: "-startDate" });
  const [tab, setTab] = useState("all");

  // Quyền như trang cũ: admin thấy đủ nút trên MỌI card; manager chỉ với giải của mình
  const me = useSelector((s) => s?.auth?.userInfo);
  const isAdmin = !!(
    me?.isAdmin ||
    me?.role === "admin" ||
    (Array.isArray(me?.roles) && me.roles.includes("admin"))
  );
  const canManage = (t) => {
    if (isAdmin) return true;
    if (!me?._id) return false;
    if (String(t?.createdBy) === String(me._id)) return true;
    if (Array.isArray(t?.managers))
      return t.managers.some((m) => String(m?.user ?? m) === String(me._id));
    return !!t?.isManager;
  };
  const [q, setQ] = useState("");
  const [zoomSrc, setZoomSrc] = useState(null);

  const list = useMemo(() => (Array.isArray(data) ? data : []), [data]);


  const { counts, shown } = useMemo(() => {
    const byStatus = { ongoing: [], upcoming: [], finished: [] };
    for (const t of list) byStatus[statusOf(t)].push(t);
    byStatus.upcoming.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    byStatus.ongoing.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    byStatus.finished.sort((a, b) => new Date(b.endDate || b.startDate) - new Date(a.endDate || a.startDate));

    const counts = {
      all: list.length,
      ongoing: byStatus.ongoing.length,
      upcoming: byStatus.upcoming.length,
      finished: byStatus.finished.length,
    };

    let pool =
      tab === "all"
        ? [...byStatus.ongoing, ...byStatus.upcoming, ...byStatus.finished]
        : byStatus[tab] || [];
    const needle = fold(q.trim());
    if (needle) {
      pool = pool.filter((t) => fold(`${t.name} ${t.location} ${t.code}`).includes(needle));
    }
    return { counts, shown: pool };
  }, [list, tab, q]);

  const spotlightOk =
    tab === "all" && !q.trim() && shown.length > 0 && statusOf(shown[0]) === "ongoing";

  return (
    <>
      <SEOHead
        title="Giải đấu pickleball — PickleTour"
        description="Khám phá các giải đấu pickleball đang diễn ra, sắp khởi tranh và đã kết thúc trên PickleTour. Đăng ký thi đấu và theo dõi trực tiếp."
      />
      <ShadowFrame style={{ minHeight: "100vh" }}>
        <Theme theme={neutralTheme}>
          <div style={{ minHeight: "100vh", background: "var(--color-background-body)" }}>
            <SiteNav />
            <PageHead counts={counts} loading={isLoading} />
            <Toolbar tab={tab} setTab={setTab} q={q} setQ={setQ} counts={counts} />

            <Container>
              <div style={{ padding: "34px 0 84px" }}>
                {isLoading ? (
                  <div className="pk-tgrid" style={gridStyle}>
                    {[...Array(8)].map((_, i) => (
                      <CardSkeleton key={i} />
                    ))}
                  </div>
                ) : shown.length ? (
                  <div className="pk-tgrid" style={gridStyle}>
                    {shown.map((t, i) => (
                      <TournamentCard key={t._id || i} t={t} index={i} big={i === 0 && spotlightOk} onZoom={setZoomSrc} manage={canManage(t)} />
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "90px 0 70px" }}>
                    <div style={{ display: "flex", justifyContent: "center", opacity: 0.6 }}>
                      <PickleMark size={44} />
                    </div>
                    <div style={{ marginTop: 18, color: "light-dark(#33373B, #DFE2E5)", fontSize: 19, fontWeight: 700 }}>
                      Không tìm thấy giải nào
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Text type="body" color="secondary">
                        Thử đổi bộ lọc hoặc từ khoá khác xem sao.
                      </Text>
                    </div>
                    <div style={{ marginTop: 22, display: "flex", justifyContent: "center", gap: 10 }}>
                      <GrayPill
                        label="Xoá bộ lọc"
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setTab("all");
                          setQ("");
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </Container>

            <SiteFooter />
            {zoomSrc && <Lightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />}
          </div>
        </Theme>
      </ShadowFrame>
    </>
  );
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(292px, 1fr))",
  gap: 20,
};
