/**
 * ClubsPage — trang Câu lạc bộ phong cách Astryx (trong ShadowFrame, dark).
 * Cấu trúc: SiteNav → PageHead (chip tổng số CLB) → toolbar sticky (search
 * server-side q=) → grid card CLB (ảnh bìa + logo chồng kiểu fanpage, tick
 * verified, địa điểm, chip thành viên/cúp/chính sách tham gia) → "Xem thêm"
 * (page*limit < total) → SiteFooter. Bấm card sang /clubs/:id (trang chi tiết cũ).
 * ?ui=v1 tại route này ra trang cũ (gate ở ClubsScreen.jsx).
 */
import "@fontsource-variable/figtree";

import { useEffect, useRef, useState } from "react";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Text } from "@astryxdesign/core/Text";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { BadgeCheck, MapPin, Search, Trophy, UserPlus, Users } from "lucide-react";

import SEOHead from "../../components/SEOHead.jsx";
import ShadowFrame from "./ShadowFrame.jsx";
import SiteNav from "./SiteNav.jsx";
import SiteFooter from "./SiteFooter.jsx";
import PickleMark from "./PickleMark.jsx";
import { A, GrayPill } from "./ui.jsx";
import { useListClubsQuery } from "../../slices/clubsApiSlice.js";

/* ------------------------------- helpers ------------------------------- */
const Container = ({ children, style }) => (
  <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px", ...style }}>
    {children}
  </div>
);

const fmtInt = (n) => Number(n || 0).toLocaleString("vi-VN");
const placeOf = (c) =>
  String(c?.locationText || [c?.city, c?.province].filter(Boolean).join(", ") || "").trim();

/* ------------------------------ page head ------------------------------ */
function PageHead({ total }) {
  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(46% 62% at 24% 4%, rgba(61,135,255,.12), transparent 62%)" }} />
      <div
        aria-hidden
        className="pk-spin-slow"
        style={{ position: "absolute", right: -140, top: -130, opacity: 0.06, color: "var(--color-brand, #3D87FF)", pointerEvents: "none" }}
      >
        <PickleMark size={440} />
      </div>
      <Container style={{ position: "relative", zIndex: 2 }}>
        <div style={{ padding: "76px 0 46px" }}>
          <div style={{ minHeight: 32 }}>
            {total > 0 && (
              <span
                className="pk-rise"
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 13px", borderRadius: 999, fontSize: 13, fontWeight: 700, background: "rgba(61,135,255,.12)", color: "#9CC1FF", border: "1px solid rgba(61,135,255,.3)" }}
              >
                <Users size={13} />
                {fmtInt(total)} câu lạc bộ đang hoạt động
              </span>
            )}
          </div>
          <h1
            className="pk-rise"
            style={{ margin: "14px 0 0", fontWeight: 750, fontSize: "clamp(42px, 6.4vw, 84px)", lineHeight: 1.02, letterSpacing: "-0.028em", color: "#F5F6F7", animationDelay: ".07s" }}
          >
            Câu lạc bộ
            <br />
            <span style={{ color: "var(--color-brand, #3D87FF)" }}>khắp cả nước.</span>
          </h1>
          <div className="pk-rise" style={{ maxWidth: 620, marginTop: 22, animationDelay: ".16s" }}>
            <Text type="large" color="secondary">
              Tìm hội chơi gần bạn, xem thành viên và gia nhập ngay trên PickleTour.
            </Text>
          </div>
        </div>
      </Container>
    </div>
  );
}

/* --------------------------------- card -------------------------------- */
function ClubCard({ c, index }) {
  const place = placeOf(c);
  const members = Number(c?.stats?.memberCount || 0);
  const wins = Number(c?.stats?.tournamentWins || 0);
  const open = String(c?.joinPolicy || "").toLowerCase() === "open";
  return (
    <A
      href={`/clubs/${c._id}`}
      className="pk-tcard pk-reveal-card"
      style={{
        display: "block",
        textDecoration: "none",
        borderRadius: 18,
        overflow: "hidden",
        background: "var(--color-background-surface)",
        border: "1px solid var(--color-border)",
        animationDelay: `${Math.min(index, 8) * 0.05}s`,
      }}
    >
      <div style={{ position: "relative", height: 128, overflow: "hidden", background: "#191A1D" }}>
        {c?.coverUrl ? (
          <div className="pk-tcard-img" style={{ position: "absolute", inset: 0, backgroundImage: `url("${c.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(80% 120% at 50% 0%, rgba(61,135,255,.16), transparent 70%)" }} />
        )}
        <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(10,11,13,.12) 30%, rgba(16,17,20,.78) 100%)" }} />
      </div>

      <div style={{ padding: "0 16px 15px" }}>
        {/* logo chồng lên bìa kiểu fanpage */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: -26 }}>
          <span style={{ display: "inline-block", borderRadius: 18, padding: 3, background: "var(--color-background-surface)" }}>
            <Avatar size="large" src={c?.logoUrl || undefined} name={c?.name || "CLB"} />
          </span>
          <div style={{ minWidth: 0, paddingBottom: 4, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ color: "#F0F1F3", fontWeight: 750, fontSize: 16.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c?.name || "Câu lạc bộ"}
              </span>
              {c?.isVerified && <BadgeCheck size={16} color="#3E9EFB" style={{ flexShrink: 0 }} />}
            </div>
            {place && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, color: "#9AA0A6", fontSize: 12.5 }}>
                <MapPin size={12} style={{ flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{place}</span>
              </div>
            )}
          </div>
        </div>

        {c?.description && (
          <div
            style={{
              marginTop: 11,
              color: "#B9BEC5",
              fontSize: 13.5,
              lineHeight: 1.5,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              minHeight: 40,
            }}
          >
            {c.description}
          </div>
        )}

        <div style={{ display: "flex", gap: 7, marginTop: 13, flexWrap: "wrap" }}>
          <span style={chip}>
            <Users size={11} />
            {fmtInt(members)} thành viên
          </span>
          {wins > 0 && (
            <span style={{ ...chip, color: "#F0C24B", borderColor: "rgba(240,194,75,.3)", background: "rgba(240,194,75,.08)" }}>
              <Trophy size={11} />
              {fmtInt(wins)} cúp
            </span>
          )}
          <span style={open ? { ...chip, color: "#7CC7A2", borderColor: "rgba(59,165,93,.32)", background: "rgba(59,165,93,.10)" } : chip}>
            <UserPlus size={11} />
            {open ? "Tham gia tự do" : "Duyệt tham gia"}
          </span>
        </div>
      </div>
    </A>
  );
}

const chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 9px",
  borderRadius: 999,
  fontSize: 11.5,
  fontWeight: 650,
  background: "rgba(255,255,255,.06)",
  color: "#C9CDD2",
  border: "1px solid rgba(255,255,255,.08)",
};

function CardSkeleton() {
  return (
    <div style={{ borderRadius: 18, overflow: "hidden", border: "1px solid var(--color-border)", background: "var(--color-background-surface)" }}>
      <Skeleton width="100%" height="128px" />
      <div style={{ padding: 16 }}>
        <Skeleton width="65%" height="18px" />
        <div style={{ height: 10 }} />
        <Skeleton width="90%" height="13px" />
        <div style={{ height: 8 }} />
        <Skeleton width="45%" height="13px" />
      </div>
    </div>
  );
}

/* ================================= PAGE ================================= */
export default function ClubsPage() {
  const [qInput, setQInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setKeyword(qInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [qInput]);

  const { data, isFetching } = useListClubsQuery({
    ...(keyword ? { q: keyword } : {}),
    page,
    limit: 18,
  });

  useEffect(() => {
    const items = Array.isArray(data?.items) ? data.items : null;
    if (!items) return;
    setRows((prev) => {
      if (page === 1) return items;
      const seen = new Set(prev.map((x) => x._id));
      return [...prev, ...items.filter((d) => !seen.has(d._id))];
    });
  }, [data, page]);

  const total = Number(data?.total || 0);
  const hasMore = rows.length < total;
  const initialLoading = isFetching && page === 1 && !rows.length;

  return (
    <>
      <SEOHead
        title="Câu lạc bộ pickleball — PickleTour"
        description="Danh sách câu lạc bộ pickleball trên toàn quốc — tìm hội chơi gần bạn và gia nhập trên PickleTour."
      />
      <ShadowFrame style={{ minHeight: "100vh" }}>
        <Theme theme={neutralTheme}>
          <div style={{ minHeight: "100vh", background: "var(--color-background-body)" }}>
            <SiteNav />
            <PageHead total={total} />

            <div
              style={{
                position: "sticky",
                top: 64,
                zIndex: 15,
                background: "rgba(17,17,18,.78)",
                backdropFilter: "saturate(160%) blur(12px)",
                borderBottom: "1px solid var(--color-border)",
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <Container>
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", flexWrap: "wrap" }}>
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 9, height: 38, padding: "0 14px", borderRadius: 999, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.10)", minWidth: 220, flex: "0 1 380px" }}
                  >
                    <Search size={15} color="#9AA0A6" style={{ flexShrink: 0 }} />
                    <input
                      value={qInput}
                      onChange={(e) => setQInput(e.target.value)}
                      placeholder="Tìm câu lạc bộ, tỉnh thành…"
                      style={{ all: "unset", width: "100%", color: "#E6E8EA", fontSize: 14, fontFamily: "inherit" }}
                    />
                    {qInput && (
                      <button type="button" onClick={() => setQInput("")} style={{ all: "unset", cursor: "pointer", color: "#9AA0A6", fontSize: 12.5, fontWeight: 700 }}>
                        Xoá
                      </button>
                    )}
                  </label>
                  <div style={{ flex: 1 }} />
                  {total > 0 && (
                    <Text type="supporting" color="secondary">{fmtInt(total)} câu lạc bộ</Text>
                  )}
                </div>
              </Container>
            </div>

            <Container>
              <div style={{ padding: "30px 0 84px" }}>
                {initialLoading ? (
                  <div style={gridStyle}>
                    {[...Array(6)].map((_, i) => (
                      <CardSkeleton key={i} />
                    ))}
                  </div>
                ) : rows.length ? (
                  <div style={gridStyle}>
                    {rows.map((c, i) => (
                      <ClubCard key={c._id || i} c={c} index={i} />
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "90px 0 70px" }}>
                    <div style={{ display: "flex", justifyContent: "center", opacity: 0.6 }}>
                      <PickleMark size={44} />
                    </div>
                    <div style={{ marginTop: 18, color: "#DFE2E5", fontSize: 19, fontWeight: 700 }}>
                      Không tìm thấy câu lạc bộ nào
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Text type="body" color="secondary">Thử từ khoá khác xem sao.</Text>
                    </div>
                  </div>
                )}

                {hasMore && !initialLoading && (
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
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

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
  gap: 20,
};
