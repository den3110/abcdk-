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

const STATUS_META = {
  ongoing: { label: "Đang diễn ra", variant: "success" },
  upcoming: { label: "Sắp diễn ra", variant: "info" },
  finished: { label: "Đã kết thúc", variant: "neutral" },
};
const statusOf = (t) => {
  const s = String(t?.status || "").toLowerCase();
  if (STATUS_META[s]) return s;
  const now = Date.now();
  if (t?.startDate && now < new Date(t.startDate)) return "upcoming";
  if (t?.endDate && now > new Date(t.endDate)) return "finished";
  return "ongoing";
};

const metaRow = { display: "flex", alignItems: "center", gap: 9, color: "#C9CDD2", fontSize: 14.5 };

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
        <div style={{ color: "#F0F1F3", fontWeight: 700, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {nameOf(p1)}
          {!single && <span style={{ color: "#8F959C", fontWeight: 600 }}> &amp; {nameOf(p2)}</span>}
        </div>
        <div style={{ marginTop: 3, color: "#8F959C", fontSize: 12.5, display: "flex", gap: 9, flexWrap: "wrap" }}>
          {r?.code && <span>#{r.code}</span>}
          {r?.createdAt && <span>{fmtD(r.createdAt)}</span>}
        </div>
      </div>
      <Badge variant={paid ? "success" : "neutral"} label={paid ? "Đã thanh toán" : "Chờ thanh toán"} />
    </div>
  );
}

/* ================================= PAGE ================================= */
export default function TournamentDetailPage() {
  const { id } = useParams();
  const { data: t, isLoading } = useGetTournamentQuery(id);
  const { data: regsRaw } = useGetRegistrationsQuery(id);
  const [zoom, setZoom] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const regs = Array.isArray(regsRaw) ? regsRaw : [];
  const st = statusOf(t);
  const meta = STATUS_META[st];
  const single = String(t?.eventType || "").toLowerCase() === "single";
  const cap = Number(t?.maxPairs || 0);
  const regCount = Number(t?.stats?.registrationsCount ?? regs.length);
  const pct = cap ? Math.min(100, Math.round((regCount / cap) * 100)) : 0;
  const dLeft = st === "upcoming" ? daysUntil(t?.registrationDeadline || t?.startDate) : null;
  const fee = t?.isFreeRegistration ? "Miễn phí" : fmtMoney(t?.registrationFee ?? t?.entryFee);
  const canManage = Boolean(t?.amOwner || t?.amManager);

  const copyAccount = async () => {
    try {
      await navigator.clipboard.writeText(String(t?.bankAccountNumber || ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard bị chặn thì thôi */
    }
  };

  return (
    <>
      <SEOHead
        title={`${t?.name || "Giải đấu"} — PickleTour`}
        description={`Thông tin, điều lệ và danh sách đăng ký giải ${t?.name || "pickleball"} trên PickleTour.`}
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
                            ĐANG DIỄN RA
                          </span>
                        ) : (
                          meta && <Badge variant={meta.variant} label={meta.label} />
                        )}
                        {t?.code && <span style={{ fontSize: 12, fontWeight: 700, color: "#9AA0A6", letterSpacing: ".03em" }}>{t.code}</span>}
                        {dLeft != null && dLeft >= 0 && (
                          <Badge variant="info" label={dLeft === 0 ? "Chốt đăng ký hôm nay" : `Chốt đăng ký sau ${dLeft} ngày`} />
                        )}
                      </div>

                      <h1 className="pk-rise" style={{ margin: "16px 0 0", fontWeight: 750, fontSize: "clamp(26px, 3.4vw, 44px)", lineHeight: 1.12, letterSpacing: "-0.02em", color: "#F5F6F7", animationDelay: ".07s" }}>
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
                            {single ? "Đấu đơn" : "Đấu đôi"}
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
                              Yêu cầu xác minh CCCD
                            </span>
                          )}
                        </span>
                      </div>

                      {cap > 0 && (
                        <div className="pk-rise" style={{ marginTop: 20, maxWidth: 420, animationDelay: ".2s" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                            <Text type="supporting" color="secondary">Đăng ký</Text>
                            <Text type="supporting" weight="semibold">{regCount}/{cap} đội</Text>
                          </div>
                          <div style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, background: pct >= 100 ? "linear-gradient(90deg,#F2555A,#FF8A5C)" : "linear-gradient(90deg,#2694FE,#3D87FF)" }} />
                          </div>
                        </div>
                      )}

                      <div className="pk-rise" style={{ display: "flex", gap: 11, marginTop: 26, flexWrap: "wrap", animationDelay: ".26s" }}>
                        {st === "upcoming" && (
                          <WhitePill label={pct >= 100 ? "Đã đủ đội" : "Đăng ký thi đấu"} href={`/tournament/${id}/register`} size="lg" />
                        )}
                        <GrayPill label={st === "finished" ? "Kết quả & sơ đồ" : "Sơ đồ thi đấu"} href={`/tournament/${id}/bracket`} size="lg" />
                        {st !== "finished" && <GrayPill label="Check-in" href={`/tournament/${id}/checkin`} size="lg" />}
                        {canManage && <GrayPill label="Quản lý giải" href={`/tournament/${id}/manage`} size="lg" />}
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
                          <img src={t.image} alt={t?.name || "Poster giải"} style={{ display: "block", width: "100%", maxHeight: 400, objectFit: "cover" }} />
                        </div>
                        <div style={{ marginTop: 8, textAlign: "center" }}>
                          <Text type="supporting" color="tertiary">Bấm vào poster để phóng to</Text>
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
                  <StatCard label="Đội đăng ký" value={regCount} accent="#7FB3FF" />
                  <StatCard label="Đã thanh toán" value={Number(t?.stats?.paidCount || 0)} accent="#7CC7A2" />
                  <StatCard label="Đã check-in" value={Number(t?.stats?.checkedInCount || 0)} />
                  <StatCard label="Số trận" value={Number(t?.matchesCount || 0)} />
                </div>
              </Container>
            )}

            {/* ======= nội dung ======= */}
            <Container>
              <div className="pk-2col" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(280px, 1fr)", gap: 20, marginTop: 20, alignItems: "start" }}>
                {/* điều lệ */}
                <div style={{ borderRadius: 18, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", padding: "22px 24px" }}>
                  <div style={{ color: "#F0F1F3", fontWeight: 750, fontSize: 18 }}>Điều lệ giải đấu</div>
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
                        {ruleOpen ? "Thu gọn" : "Xem toàn bộ điều lệ"}
                      </button>
                    </>
                  ) : (
                    <div style={{ marginTop: 14 }}>
                      <Text type="body" color="secondary">Ban tổ chức chưa đăng điều lệ.</Text>
                    </div>
                  )}
                </div>

                {/* cột phải */}
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {(t?.bankAccountNumber || fee) && (
                    <div style={{ borderRadius: 18, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", padding: "20px 22px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#F0F1F3", fontWeight: 750, fontSize: 16 }}>
                        <Landmark size={17} style={{ opacity: 0.8 }} />
                        Lệ phí & chuyển khoản
                      </div>
                      {fee && (
                        <div style={{ marginTop: 12, fontSize: 24, fontWeight: 800, color: "#F0C24B", letterSpacing: "-.01em" }}>{fee}</div>
                      )}
                      {t?.bankAccountNumber && (
                        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                          <div style={{ color: "#C9CDD2", fontSize: 13.5 }}>{t?.bankShortName || t?.qrBank}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            <span style={{ color: "#F0F1F3", fontWeight: 750, fontSize: 16.5, letterSpacing: ".02em" }}>{t.bankAccountNumber}</span>
                            <button
                              type="button"
                              onClick={copyAccount}
                              aria-label="Sao chép số tài khoản"
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
                    <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#F0F1F3", fontWeight: 750, fontSize: 16 }}>
                      <ClipboardCheck size={17} style={{ opacity: 0.8 }} />
                      Liên hệ ban tổ chức
                    </div>
                    {t?.contactHtml ? (
                      <div className="pk-prose" style={{ marginTop: 12 }} dangerouslySetInnerHTML={{ __html: t.contactHtml }} />
                    ) : (
                      <div style={{ marginTop: 12 }}>
                        <Text type="supporting" color="secondary">Chưa có thông tin liên hệ.</Text>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ======= đội đăng ký ======= */}
              <div style={{ margin: "44px 0 84px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Users size={18} color="#9AA0A6" />
                  <span style={{ color: "#F0F1F3", fontWeight: 750, fontSize: 20 }}>
                    {single ? "Vận động viên đăng ký" : "Đội đăng ký"}
                  </span>
                  {regCount > 0 && (
                    <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: "rgba(255,255,255,.07)", color: "#C9CDD2" }}>{regCount}</span>
                  )}
                </div>
                {regs.length ? (
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
                      <Text type="body" color="secondary">Chưa có đội nào đăng ký{st === "upcoming" ? " — hãy là đội đầu tiên!" : "."}</Text>
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
