/**
 * TournamentDetailPage — trang CHI TIẾT GIẢI phong cách Astryx (/tournament/:id).
 * Header 2 cột: trái = badge trạng thái + tên + meta + progress đăng ký + CTA
 * (Đăng ký / Sơ đồ / Check-in / Quản lý theo trạng thái & quyền amOwner|amManager);
 * phải = poster đóng khung, bấm phóng to (Lightbox dùng chung).
 * Dưới: band thống kê (đăng ký/thanh toán/check-in/số trận) → Điều lệ (contentHtml,
 * thu gọn được) + cột phải (Lệ phí & chuyển khoản có nút copy STK, Liên hệ BTC) →
 * lưới ĐỘI ĐĂNG KÝ (avatar đôi + badge thanh toán). ?ui=v1 ra trang cũ.
 */
import "@fontsource-variable/figtree";

import { useState } from "react";
import { useParams } from "react-router-dom";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import {
  CalendarDays,
  Check,
  ClipboardCheck,
  Copy,
  Landmark,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Swords,
  Ticket,
  Users,
} from "lucide-react";

import SEOHead from "../../components/SEOHead.jsx";
import ShadowFrame from "./ShadowFrame.jsx";
import SiteNav from "./SiteNav.jsx";
import SiteFooter from "./SiteFooter.jsx";
import PickleMark from "./PickleMark.jsx";
import { A, WhitePill, GrayPill, Lightbox } from "./ui.jsx";
import {
  useGetTournamentQuery,
  useGetRegistrationsQuery,
} from "../../slices/tournamentsApiSlice.js";
import {
  useListMySubscriptionsQuery,
  useSubscribeTopicMutation,
  useUnsubscribeTopicMutation,
} from "../../slices/subscriptionApiSlice.js";
import { useGetReviewSummaryQuery } from "../../slices/reviewApiSlice.js";
import { useListMlpTeamsQuery } from "../../slices/mlpApiSlice.js";
import { useSelector } from "react-redux";
import { Star, Bell } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext.jsx";

/* ------------------------------- helpers ------------------------------- */
const Container = ({ children, style }) => (
  <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px", ...style }}>
    {children}
  </div>
);

const fmtD = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return "";
  }
};
const fmtRange = (a, b) => {
  const s = fmtD(a);
  const e = fmtD(b);
  return s && e && s !== e ? `${s} – ${e}` : s || e || "";
};
const fmtMoney = (n) => {
  const v = Number(n || 0);
  return v ? `${v.toLocaleString("vi-VN")}₫` : "";
};
const daysUntil = (d) => {
  if (!d) return null;
  const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  return Number.isFinite(diff) ? diff : null;
};

// labelKey resolved via t() at render time.
const STATUS_META = {
  ongoing: { labelKey: "v3.tournamentDetail.statusOngoing", variant: "success" },
  upcoming: { labelKey: "v3.tournamentDetail.statusUpcoming", variant: "info" },
  finished: { labelKey: "v3.tournamentDetail.statusFinished", variant: "neutral" },
};
const statusOf = (t) => {
  const s = String(t?.status || "").toLowerCase();
  if (STATUS_META[s]) return s;
  const now = Date.now();
  if (t?.startDate && now < new Date(t.startDate)) return "upcoming";
  if (t?.endDate && now > new Date(t.endDate)) return "finished";
  return "ongoing";
};

const metaRow = { display: "flex", alignItems: "center", gap: 9, color: "var(--pk-text)", fontSize: 14.5 };

function StatCard({ label, value, accent }) {
  return (
    <div style={{ borderRadius: 16, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", padding: "16px 18px" }}>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", color: accent || "#F0F1F3", lineHeight: 1 }}>{value}</div>
      <div style={{ marginTop: 7, color: "#8F959C", fontSize: 12.5, fontWeight: 650 }}>{label}</div>
    </div>
  );
}

/* thẻ một ĐỘI đăng ký */
function TeamCard({ r, single }) {
  const { t } = useLanguage();
  const paid = String(r?.payment?.status || "").toLowerCase() === "paid";
  const p1 = r?.player1 || {};
  const p2 = r?.player2 || {};
  const nameOf = (p) => String(p?.nickName || p?.fullName || "—").trim();
  return (
    <div style={{ borderRadius: 16, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 13 }}>
      <div style={{ display: "flex", flexShrink: 0 }}>
        <Avatar size="medium" src={p1?.avatar || undefined} name={nameOf(p1)} />
        {!single && (
          <span style={{ marginLeft: -10, display: "inline-flex", borderRadius: 999, border: "2px solid var(--color-background-surface)" }}>
            <Avatar size="medium" src={p2?.avatar || undefined} name={nameOf(p2)} />
          </span>
        )}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: "var(--pk-text-strong)", fontWeight: 700, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {nameOf(p1)}
          {!single && <span style={{ color: "#8F959C", fontWeight: 600 }}> &amp; {nameOf(p2)}</span>}
        </div>
        <div style={{ marginTop: 3, color: "#8F959C", fontSize: 12.5, display: "flex", gap: 9, flexWrap: "wrap" }}>
          {r?.code && <span>#{r.code}</span>}
          {r?.createdAt && <span>{fmtD(r.createdAt)}</span>}
        </div>
      </div>
      <Badge variant={paid ? "success" : "neutral"} label={paid ? t("v3.tournamentDetail.paid") : t("v3.tournamentDetail.awaitingPayment")} />
    </div>
  );
}

/* thẻ một ĐỘI MLP đã đăng ký (team vs team) */
function MlpTeamCard({ tm }) {
  const players = Array.isArray(tm?.players) ? tm.players : [];
  const capId = tm?.captain?._id || tm?.captain;
  const nameOf = (p) => String(p?.nickname || p?.name || "—").trim();
  const color = tm?.color || "#7FB3FF";
  return (
    <div style={{ borderRadius: 16, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderTop: `3px solid ${color}` }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: color, flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: "var(--pk-text-strong)", fontWeight: 750, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tm?.name || "Đội"}</div>
          <div style={{ color: "#8F959C", fontSize: 12.5 }}>{players.length} VĐV</div>
        </div>
        <Badge variant="neutral" label={`${players.length} VĐV`} />
      </div>
      <div style={{ padding: "6px 14px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
        {players.map((p) => {
          const isCap = String(p?._id) === String(capId);
          return (
            <div key={p?._id || nameOf(p)} style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <Avatar size="small" src={p?.avatar || undefined} name={nameOf(p)} />
              <span style={{ color: "var(--pk-text)", fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {nameOf(p)}
                {p?.gender === "female" ? " ♀" : p?.gender === "male" ? " ♂" : ""}
              </span>
              {isCap && <Badge variant="warning" label="Đội trưởng" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================= PAGE ================================= */
export default function TournamentDetailPage() {
  // `t` = dữ liệu giải; hàm dịch dùng alias `tr` để tránh shadow.
  const { t: tr } = useLanguage();
  const { id } = useParams();
  const { data: t, isLoading } = useGetTournamentQuery(id);
  const { data: regsRaw } = useGetRegistrationsQuery(id);
  const [zoom, setZoom] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isMlp = String(t?.tournamentMode || "").toLowerCase() === "mlp";
  const { data: mlpResp } = useListMlpTeamsQuery(
    { tourId: id },
    { skip: !isMlp || !id }
  );
  const mlpTeams = Array.isArray(mlpResp?.items) ? mlpResp.items : [];

  const regs = Array.isArray(regsRaw) ? regsRaw : [];
  const st = statusOf(t);
  const meta = STATUS_META[st];
  const single = String(t?.eventType || "").toLowerCase() === "single";
  const cap = Number(t?.maxPairs || 0);
  const regCount = isMlp
    ? mlpTeams.length
    : Number(t?.stats?.registrationsCount ?? regs.length);
  const pct = cap ? Math.min(100, Math.round((regCount / cap) * 100)) : 0;
  const dLeft = st === "upcoming" ? daysUntil(t?.registrationDeadline || t?.startDate) : null;
  const fee = t?.isFreeRegistration ? tr("v3.tournamentDetail.free") : fmtMoney(t?.registrationFee ?? t?.entryFee);
  const canManage = Boolean(t?.amOwner || t?.amManager);

  // Theo dõi giải + tổng hợp đánh giá
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const { data: mySubs } = useListMySubscriptionsQuery(undefined, { skip: !userInfo });
  const [subscribeTopic] = useSubscribeTopicMutation();
  const [unsubscribeTopic] = useUnsubscribeTopicMutation();
  const isFollowing = Array.isArray(mySubs)
    && mySubs.some((s) => s.topicType === "tournament" && String(s.topicId) === String(id));
  const toggleFollow = async () => {
    if (!userInfo) { window.location.href = "/login"; return; }
    try {
      if (isFollowing) await unsubscribeTopic({ topicType: "tournament", topicId: id }).unwrap();
      else await subscribeTopic({ topicType: "tournament", topicId: id }).unwrap();
    } catch (_) { /* best effort */ }
  };
  const { data: reviewSum } = useGetReviewSummaryQuery(
    { targetType: "tournament", targetId: id },
    { skip: !id }
  );
  const reviewAvg = reviewSum?.summary?.avg;
  const reviewCount = reviewSum?.summary?.count || 0;

  const copyAccount = async () => {
    try {
      await navigator.clipboard.writeText(String(t?.bankAccountNumber || ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard bị chặn thì thôi */
    }
  };

  // ==== SEO: canonical + OG image thật + JSON-LD SportsEvent ====
  const seoTitle = t?.name
    ? tr("v3.tournamentDetail.seoTitleNamed", { name: t.name })
    : tr("v3.tournamentDetail.seoTitle");
  const seoDesc = t?.description
    ? String(t.description).replace(/\s+/g, " ").slice(0, 240)
    : t?.name
      ? tr("v3.tournamentDetail.seoDescNamed", { name: t.name })
      : tr("v3.tournamentDetail.seoDesc");
  const seoImage =
    t?.image || t?.coverUrl || t?.poster || "https://pickletour.vn/icon-512.png";
  const seoPath = `/tournament/${id}`;
  const eventStatusMap = {
    upcoming: "https://schema.org/EventScheduled",
    ongoing: "https://schema.org/EventScheduled",
    finished: "https://schema.org/EventCompleted",
  };
  const sportsEventLd = t
    ? {
        "@context": "https://schema.org",
        "@type": "SportsEvent",
        name: t.name,
        description: seoDesc,
        image: seoImage,
        url: `https://pickletour.vn${seoPath}`,
        sport: "Pickleball",
        eventStatus:
          eventStatusMap[t.status] || "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        ...(t.startDate ? { startDate: new Date(t.startDate).toISOString() } : {}),
        ...(t.endDate ? { endDate: new Date(t.endDate).toISOString() } : {}),
        ...(t.location
          ? {
              location: {
                "@type": "Place",
                name: t.location,
                ...(t.locationGeo?.lat && t.locationGeo?.lon
                  ? {
                      geo: {
                        "@type": "GeoCoordinates",
                        latitude: t.locationGeo.lat,
                        longitude: t.locationGeo.lon,
                      },
                    }
                  : {}),
                ...(t.location
                  ? {
                      address: {
                        "@type": "PostalAddress",
                        addressCountry: t.locationGeo?.countryCode || "VN",
                        addressLocality: t.location,
                      },
                    }
                  : {}),
              },
            }
          : {}),
        organizer: {
          "@type": "Organization",
          name: "Pickletour",
          url: "https://pickletour.vn",
        },
      }
    : null;

  return (
    <>
      <SEOHead
        title={seoTitle}
        description={seoDesc}
        path={seoPath}
        ogImage={seoImage}
        ogType="event"
        structuredData={sportsEventLd}
      />
      <ShadowFrame style={{ minHeight: "100vh" }}>
        <Theme theme={neutralTheme}>
          <div style={{ minHeight: "100vh", background: "var(--color-background-body)" }}>
            <SiteNav />

            {/* ======= header ======= */}
            <div style={{ position: "relative", overflow: "hidden", borderBottom: "1px solid var(--color-border)" }}>
              <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(46% 62% at 80% 0%, rgba(61,135,255,.10), transparent 62%)" }} />
              <Container style={{ position: "relative", zIndex: 2 }}>
                {isLoading && !t ? (
                  <div style={{ padding: "64px 0 46px" }}>
                    <Skeleton width="120px" height="24px" />
                    <div style={{ height: 16 }} />
                    <Skeleton width="min(680px, 90%)" height="44px" />
                    <div style={{ height: 12 }} />
                    <Skeleton width="min(420px, 60%)" height="18px" />
                  </div>
                ) : (
                  <div className="pk-2col" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.55fr) minmax(260px, 1fr)", gap: 36, alignItems: "center", padding: "56px 0 46px" }}>
                    {/* trái: thông tin */}
                    <div>
                      <div className="pk-rise" style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                        {st === "ongoing" ? (
                          <span className="pk-live" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 750, background: "rgba(229,72,77,.16)", color: "#FF8A8E", border: "1px solid rgba(242,85,90,.4)" }}>
                            <span style={{ width: 7, height: 7, borderRadius: 99, background: "#F2555A" }} />
                            {tr("v3.tournamentDetail.ongoingBadge")}
                          </span>
                        ) : (
                          meta && <Badge variant={meta.variant} label={tr(meta.labelKey)} />
                        )}
                        {t?.code && <span style={{ fontSize: 12, fontWeight: 700, color: "#9AA0A6", letterSpacing: ".03em" }}>{t.code}</span>}
                        {dLeft != null && dLeft >= 0 && (
                          <Badge variant="info" label={dLeft === 0 ? tr("v3.tournamentDetail.deadlineToday") : tr("v3.tournamentDetail.deadlineInDays", { days: dLeft })} />
                        )}
                      </div>

                      <h1 className="pk-rise" style={{ margin: "16px 0 0", fontWeight: 750, fontSize: "clamp(26px, 3.4vw, 44px)", lineHeight: 1.12, letterSpacing: "-0.02em", color: "var(--pk-text-strong)", animationDelay: ".07s" }}>
                        {t?.name}
                      </h1>

                      <div className="pk-rise" style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 20, animationDelay: ".14s" }}>
                        <span style={metaRow}>
                          <CalendarDays size={15} style={{ flexShrink: 0, opacity: 0.75 }} />
                          {fmtRange(t?.startDate, t?.endDate)}
                        </span>
                        {t?.location && (
                          <span style={metaRow}>
                            <MapPin size={15} style={{ flexShrink: 0, opacity: 0.75 }} />
                            {t.location}
                          </span>
                        )}
                        <span style={{ ...metaRow, gap: 16, flexWrap: "wrap" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                            <Swords size={14} style={{ opacity: 0.75 }} />
                            {single ? tr("v3.tournamentDetail.singles") : tr("v3.tournamentDetail.doubles")}
                          </span>
                          {fee && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                              <Ticket size={14} style={{ opacity: 0.75 }} />
                              {fee}
                            </span>
                          )}
                          {t?.requireKyc && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "#9CC1FF" }}>
                              <ShieldCheck size={14} />
                              {tr("v3.tournamentDetail.requireKyc")}
                            </span>
                          )}
                        </span>
                      </div>

                      {cap > 0 && (
                        <div className="pk-rise" style={{ marginTop: 20, maxWidth: 420, animationDelay: ".2s" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                            <Text type="supporting" color="secondary">{tr("v3.tournamentDetail.registered")}</Text>
                            <Text type="supporting" weight="semibold">{tr("v3.tournamentDetail.teamsCount", { count: regCount, cap })}</Text>
                          </div>
                          <div style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, background: pct >= 100 ? "linear-gradient(90deg,#F2555A,#FF8A5C)" : "linear-gradient(90deg,#2694FE,#3D87FF)" }} />
                          </div>
                        </div>
                      )}

                      <div className="pk-rise" style={{ display: "flex", gap: 11, marginTop: 26, flexWrap: "wrap", animationDelay: ".26s" }}>
                        {st === "upcoming" && (
                          <WhitePill label={pct >= 100 ? tr("v3.tournamentDetail.full") : tr("v3.tournamentDetail.register")} href={`/tournament/${id}/register`} size="lg" />
                        )}
                        <GrayPill label={st === "finished" ? tr("v3.tournamentDetail.resultsBracket") : tr("v3.tournamentDetail.bracket")} href={`/tournament/${id}/bracket`} size="lg" />
                        {st !== "finished" && <GrayPill label={tr("v3.tournamentDetail.checkin")} href={`/tournament/${id}/checkin`} size="lg" />}
                        {canManage && <GrayPill label={tr("v3.tournamentDetail.manage")} href={`/tournament/${id}/manage`} size="lg" />}
                        {t?.zaloGroupUrl && (
                          <a
                            href={t.zaloGroupUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "0 22px", height: 48, borderRadius: 999, background: "#0068FF", color: "#fff", fontWeight: 750, fontSize: 15, textDecoration: "none", whiteSpace: "nowrap" }}
                          >
                            <MessageCircle size={18} />
                            {tr("v3.tournamentDetail.zaloGroup")}
                          </a>
                        )}

                        <button
                          type="button"
                          onClick={toggleFollow}
                          style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 9, padding: "0 22px", height: 48, borderRadius: 999, background: isFollowing ? "#16a34a" : "rgba(255,255,255,.1)", color: "#fff", fontWeight: 750, fontSize: 15, whiteSpace: "nowrap", border: isFollowing ? "none" : "1px solid rgba(255,255,255,.16)" }}
                        >
                          <Bell size={18} />
                          {isFollowing ? tr("v3.tournamentDetail.following") : tr("v3.tournamentDetail.follow")}
                        </button>

                        <a
                          href={`/tournament/${id}/reviews`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "0 22px", height: 48, borderRadius: 999, background: "rgba(245,158,11,.16)", color: "#F0C24B", fontWeight: 750, fontSize: 15, textDecoration: "none", whiteSpace: "nowrap", border: "1px solid rgba(245,158,11,.3)" }}
                        >
                          <Star size={18} />
                          {reviewCount ? tr("v3.tournamentDetail.reviewsRated", { avg: reviewAvg?.toFixed(1), count: reviewCount }) : tr("v3.tournamentDetail.reviews")}
                        </a>
                      </div>
                    </div>

                    {/* phải: poster đóng khung, bấm phóng to */}
                    {t?.image && (
                      <div className="pk-rise" style={{ animationDelay: ".18s" }}>
                        <div
                          onClick={() => setZoom(true)}
                          className="pk-tcard"
                          style={{ borderRadius: 18, overflow: "hidden", border: "1px solid var(--color-border)", cursor: "zoom-in", background: "#141518" }}
                        >
                          <img src={t.image} alt={t?.name || tr("v3.tournamentDetail.posterAlt")} style={{ display: "block", width: "100%", maxHeight: 400, objectFit: "cover" }} />
                        </div>
                        <div style={{ marginTop: 8, textAlign: "center" }}>
                          <Text type="supporting" color="tertiary">{tr("v3.tournamentDetail.clickPoster")}</Text>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Container>
            </div>

            {/* ======= stats ======= */}
            {t && (
              <Container>
                <div className="pk-3col" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginTop: 26 }}>
                  <StatCard label={tr("v3.tournamentDetail.statTeams")} value={regCount} accent="#7FB3FF" />
                  <StatCard label={tr("v3.tournamentDetail.statPaid")} value={Number(t?.stats?.paidCount || 0)} accent="#7CC7A2" />
                  <StatCard label={tr("v3.tournamentDetail.statCheckedIn")} value={Number(t?.stats?.checkedInCount || 0)} />
                  <StatCard label={tr("v3.tournamentDetail.statMatches")} value={Number(t?.matchesCount || 0)} />
                </div>
              </Container>
            )}

            {/* ======= nội dung ======= */}
            <Container>
              <div className="pk-2col" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(280px, 1fr)", gap: 20, marginTop: 20, alignItems: "start" }}>
                {/* điều lệ */}
                <div style={{ borderRadius: 18, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", padding: "22px 24px" }}>
                  <div style={{ color: "var(--pk-text-strong)", fontWeight: 750, fontSize: 18 }}>{tr("v3.tournamentDetail.rulesHeading")}</div>
                  {t?.contentHtml ? (
                    <>
                      <div
                        className="pk-prose"
                        style={{ marginTop: 14, maxHeight: ruleOpen ? "none" : 420, overflow: "hidden", position: "relative" }}
                      >
                        <div dangerouslySetInnerHTML={{ __html: t.contentHtml }} />
                        {!ruleOpen && (
                          <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 90, background: "linear-gradient(180deg, transparent, var(--color-background-surface))" }} />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setRuleOpen((v) => !v)}
                        style={{ all: "unset", marginTop: 12, cursor: "pointer", color: "var(--color-text-accent, #3E9EFB)", fontSize: 13.5, fontWeight: 650 }}
                      >
                        {ruleOpen ? tr("v3.tournamentDetail.collapse") : tr("v3.tournamentDetail.viewAllRules")}
                      </button>
                    </>
                  ) : (
                    <div style={{ marginTop: 14 }}>
                      <Text type="body" color="secondary">{tr("v3.tournamentDetail.noRules")}</Text>
                    </div>
                  )}
                </div>

                {/* cột phải */}
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {(t?.bankAccountNumber || fee) && (
                    <div style={{ borderRadius: 18, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", padding: "20px 22px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--pk-text-strong)", fontWeight: 750, fontSize: 16 }}>
                        <Landmark size={17} style={{ opacity: 0.8 }} />
                        {tr("v3.tournamentDetail.feeTransfer")}
                      </div>
                      {fee && (
                        <div style={{ marginTop: 12, fontSize: 24, fontWeight: 800, color: "#F0C24B", letterSpacing: "-.01em" }}>{fee}</div>
                      )}
                      {t?.bankAccountNumber && (
                        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                          <div style={{ color: "var(--pk-text)", fontSize: 13.5 }}>{t?.bankShortName || t?.qrBank}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            <span style={{ color: "var(--pk-text-strong)", fontWeight: 750, fontSize: 16.5, letterSpacing: ".02em" }}>{t.bankAccountNumber}</span>
                            <button
                              type="button"
                              onClick={copyAccount}
                              aria-label={tr("v3.tournamentDetail.copyAccount")}
                              style={{ all: "unset", width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", cursor: "pointer", background: "rgba(255,255,255,.07)", color: copied ? "#3BA55D" : "#C9CDD2", border: "1px solid rgba(255,255,255,.1)" }}
                            >
                              {copied ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                          </div>
                          {t?.bankAccountName && <div style={{ color: "#9AA0A6", fontSize: 13 }}>{t.bankAccountName}</div>}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ borderRadius: 18, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", padding: "20px 22px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--pk-text-strong)", fontWeight: 750, fontSize: 16 }}>
                      <ClipboardCheck size={17} style={{ opacity: 0.8 }} />
                      {tr("v3.tournamentDetail.contactOrganizer")}
                    </div>
                    {t?.contactHtml ? (
                      <div className="pk-prose" style={{ marginTop: 12 }} dangerouslySetInnerHTML={{ __html: t.contactHtml }} />
                    ) : (
                      <div style={{ marginTop: 12 }}>
                        <Text type="supporting" color="secondary">{tr("v3.tournamentDetail.noContact")}</Text>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ======= đội đăng ký ======= */}
              <div style={{ margin: "44px 0 84px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Users size={18} color="#9AA0A6" />
                  <span style={{ color: "var(--pk-text-strong)", fontWeight: 750, fontSize: 20 }}>
                    {single ? tr("v3.tournamentDetail.playersHeading") : tr("v3.tournamentDetail.teamsHeading")}
                  </span>
                  {regCount > 0 && (
                    <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: "rgba(255,255,255,.07)", color: "var(--pk-text)" }}>{regCount}</span>
                  )}
                </div>
                {isMlp ? (
                  mlpTeams.length ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))", gap: 14, marginTop: 18 }}>
                      {mlpTeams.map((tm) => (
                        <MlpTeamCard key={tm._id} tm={tm} />
                      ))}
                    </div>
                  ) : (
                    <div style={{ marginTop: 18, borderRadius: 16, border: "1px dashed rgba(255,255,255,.14)", padding: "34px 0", textAlign: "center" }}>
                      <div style={{ display: "flex", justifyContent: "center", opacity: 0.5 }}><PickleMark size={34} /></div>
                      <div style={{ marginTop: 12 }}><Text type="body" color="secondary">{tr("v3.tournamentDetail.noTeams")}</Text></div>
                    </div>
                  )
                ) : regs.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))", gap: 14, marginTop: 18 }}>
                    {regs.map((r) => (
                      <TeamCard key={r._id} r={r} single={single} />
                    ))}
                  </div>
                ) : (
                  <div style={{ marginTop: 18, borderRadius: 16, border: "1px dashed rgba(255,255,255,.14)", padding: "34px 0", textAlign: "center" }}>
                    <div style={{ display: "flex", justifyContent: "center", opacity: 0.5 }}>
                      <PickleMark size={34} />
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <Text type="body" color="secondary">{st === "upcoming" ? tr("v3.tournamentDetail.noTeamsBeFirst") : tr("v3.tournamentDetail.noTeams")}</Text>
                    </div>
                  </div>
                )}
              </div>
            </Container>

            <SiteFooter />
            {zoom && t?.image && <Lightbox src={t.image} onClose={() => setZoom(false)} />}
          </div>
        </Theme>
      </ShadowFrame>
    </>
  );
}
