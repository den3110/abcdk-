/**
 * HomeScreenAstryx — trang chủ THỬ NGHIỆM (chỉ hiện với ?ui=v2).
 * Cảm hứng: astryx.atmeta.com (light, sạch, typography lớn, nhiều whitespace, grid showcase).
 * Full-bleed (App.jsx ẩn header/footer global khi ?ui=v2).
 * Data: /api/public/home (stats+clubs), /api/public/home/pulse (live/climbers),
 *       /api/tournaments, /api/rankings, /api/live/feed — tất cả guard rỗng/loading.
 * KHÔNG đụng production: không có ?ui=v2 thì file này không bao giờ render.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Avatar,
  Box,
  Button,
  Chip,
  Container,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import ArrowOutwardIcon from "@mui/icons-material/ArrowOutward";
import BoltIcon from "@mui/icons-material/Bolt";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import VerifiedIcon from "@mui/icons-material/Verified";
import GroupsIcon from "@mui/icons-material/Groups";

import SEOHead from "../components/SEOHead.jsx";
import {
  useGetHomeSummaryQuery,
  useGetHomePulseQuery,
} from "../slices/homeApiSlice.js";
import { useListTournamentsQuery } from "../slices/tournamentsApiSlice.js";
import { useGetRankingsListQuery } from "../slices/rankingsApiSlice.js";
import { useGetLiveFeedQuery } from "../slices/liveApiSlice.js";

/* ----------------------------- tokens ----------------------------- */
const T = {
  ink: "#0B0B0F",
  sub: "#606A78",
  faint: "#8A93A0",
  bg: "#FFFFFF",
  bgAlt: "#F6F7F9",
  line: "rgba(11,11,15,0.08)",
  lineStrong: "rgba(11,11,15,0.14)",
  teal: "#10B981",
  indigo: "#6366F1",
  amber: "#F59E0B",
};
const FONT =
  '"Inter","SF Pro Display",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

/* --------------------------- small utils --------------------------- */
const imgUrl = (u) => {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^(https?:)?\/\//i.test(s) || s.startsWith("data:")) return s;
  return s.startsWith("/") ? s : `/${s}`;
};
const asArray = (d) =>
  Array.isArray(d)
    ? d
    : d?.items || d?.list || d?.rows || d?.data || d?.matches || [];
const fmtInt = (n) => Number(n || 0).toLocaleString("vi-VN");
const firstText = (...xs) =>
  xs.map((x) => (x == null ? "" : String(x).trim())).find(Boolean) || "";

/* count-up khi cuộn tới */
function useReveal() {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.18 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return [ref, shown];
}

function CountUp({ value, duration = 1100 }) {
  const [ref, shown] = useReveal();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!shown) return undefined;
    const target = Number(value || 0);
    if (!target) {
      setN(0);
      return undefined;
    }
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown, value, duration]);
  return <span ref={ref}>{fmtInt(n)}</span>;
}

/* section wrapper reveal-on-scroll */
function Reveal({ children, delay = 0, sx }) {
  const [ref, shown] = useReveal();
  return (
    <Box
      ref={ref}
      sx={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(22px)",
        transition: `opacity .7s cubic-bezier(.2,.7,.2,1) ${delay}ms, transform .7s cubic-bezier(.2,.7,.2,1) ${delay}ms`,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

const pillBtnSx = (variant) => ({
  borderRadius: 999,
  px: 2.6,
  py: 1.1,
  fontWeight: 700,
  fontSize: 15,
  textTransform: "none",
  fontFamily: FONT,
  boxShadow: "none",
  ...(variant === "dark"
    ? {
        bgcolor: T.ink,
        color: "#fff",
        "&:hover": { bgcolor: "#000", boxShadow: "none" },
      }
    : {
        bgcolor: "transparent",
        color: T.ink,
        border: `1px solid ${T.lineStrong}`,
        "&:hover": { bgcolor: T.bgAlt, borderColor: T.ink },
      }),
});

const kicker = {
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 13,
  letterSpacing: 1.4,
  textTransform: "uppercase",
  color: T.teal,
};
const h2Sx = {
  fontFamily: FONT,
  fontWeight: 800,
  letterSpacing: "-0.02em",
  color: T.ink,
  fontSize: "clamp(28px, 4.4vw, 46px)",
  lineHeight: 1.05,
};

/* ------------------------------ NAV ------------------------------ */
function Nav() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const links = [
    { label: "Giải đấu", to: "/pickle-ball/tournaments" },
    { label: "Bảng xếp hạng", to: "/pickle-ball/rankings" },
    { label: "Trực tiếp", to: "/live" },
    { label: "Câu lạc bộ", to: "/clubs" },
  ];
  return (
    <Box
      component="header"
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        backdropFilter: "saturate(180%) blur(14px)",
        WebkitBackdropFilter: "saturate(180%) blur(14px)",
        bgcolor: solid ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.6)",
        borderBottom: `1px solid ${solid ? T.line : "transparent"}`,
        transition: "background .3s, border-color .3s",
      }}
    >
      <Container maxWidth="lg">
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ height: 66 }}
        >
          <Box
            component={Link}
            to="/"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              textDecoration: "none",
            }}
          >
            <Box
              sx={{
                width: 30,
                height: 30,
                borderRadius: "9px",
                background: `linear-gradient(135deg, ${T.teal}, ${T.indigo})`,
                display: "grid",
                placeItems: "center",
                color: "#fff",
              }}
            >
              <SportsTennisIcon sx={{ fontSize: 18 }} />
            </Box>
            <Typography
              sx={{
                fontFamily: FONT,
                fontWeight: 800,
                fontSize: 19,
                letterSpacing: "-0.02em",
                color: T.ink,
              }}
            >
              PickleTour
            </Typography>
          </Box>

          <Stack
            direction="row"
            spacing={3}
            sx={{ display: { xs: "none", md: "flex" } }}
          >
            {links.map((l) => (
              <Typography
                key={l.to}
                component={Link}
                to={l.to}
                sx={{
                  fontFamily: FONT,
                  fontWeight: 600,
                  fontSize: 15,
                  color: T.sub,
                  textDecoration: "none",
                  "&:hover": { color: T.ink },
                }}
              >
                {l.label}
              </Typography>
            ))}
          </Stack>

          <Stack direction="row" spacing={1.2} alignItems="center">
            <Button
              component={Link}
              to="/login"
              sx={{
                ...pillBtnSx("ghost"),
                display: { xs: "none", sm: "inline-flex" },
                py: 0.8,
              }}
            >
              Đăng nhập
            </Button>
            <Button
              component={Link}
              to="/register"
              endIcon={<ArrowOutwardIcon sx={{ fontSize: 16 }} />}
              sx={{ ...pillBtnSx("dark"), py: 0.8 }}
            >
              Bắt đầu
            </Button>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}

/* ------------------------------ HERO ------------------------------ */
function Hero({ pulse }) {
  const liveNow = Number(pulse?.liveNow || 0);
  return (
    <Box sx={{ position: "relative", overflow: "hidden", bgcolor: T.bg }}>
      {/* glow nền */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(60% 60% at 50% -10%, rgba(99,102,241,0.10), transparent 60%), radial-gradient(40% 40% at 85% 10%, rgba(16,185,129,0.10), transparent 60%)`,
          pointerEvents: "none",
        }}
      />
      <Container maxWidth="lg" sx={{ position: "relative", pt: { xs: 7, md: 12 }, pb: { xs: 6, md: 9 } }}>
        <Reveal>
          <Stack alignItems="center" spacing={3} textAlign="center">
            <Chip
              icon={
                <Box
                  component="span"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: liveNow > 0 ? "#EF4444" : T.faint,
                    boxShadow: liveNow > 0 ? "0 0 0 0 rgba(239,68,68,.6)" : "none",
                    animation: liveNow > 0 ? "pkPulse 1.6s infinite" : "none",
                    ml: 1,
                  }}
                />
              }
              label={
                liveNow > 0
                  ? `${liveNow} trận đang trực tiếp`
                  : "Nền tảng giải đấu pickleball"
              }
              component={Link}
              to={liveNow > 0 ? "/live" : "/pickle-ball/tournaments"}
              clickable
              sx={{
                bgcolor: T.bgAlt,
                border: `1px solid ${T.line}`,
                color: T.ink,
                fontFamily: FONT,
                fontWeight: 600,
                fontSize: 13,
                height: 34,
                borderRadius: 999,
                "& .MuiChip-label": { px: 1.4 },
              }}
            />

            <Typography
              component="h1"
              sx={{
                fontFamily: FONT,
                fontWeight: 800,
                letterSpacing: "-0.035em",
                color: T.ink,
                fontSize: "clamp(38px, 7.2vw, 84px)",
                lineHeight: 0.98,
                maxWidth: 980,
              }}
            >
              Tổ chức giải đấu pickleball{" "}
              <Box
                component="span"
                sx={{
                  background: `linear-gradient(120deg, ${T.teal}, ${T.indigo})`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                chuyên nghiệp
              </Box>{" "}
              chỉ trong vài phút
            </Typography>

            <Typography
              sx={{
                fontFamily: FONT,
                fontSize: "clamp(16px, 2.2vw, 20px)",
                color: T.sub,
                maxWidth: 620,
                lineHeight: 1.55,
              }}
            >
              Bốc thăm, chấm điểm trực tiếp, phát sóng có overlay và điểm trình
              chuẩn hoá — tất cả trong một nền tảng cho ban tổ chức và vận động
              viên.
            </Typography>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ pt: 1 }}>
              <Button
                component={Link}
                to="/pickle-ball/tournaments"
                endIcon={<ArrowOutwardIcon />}
                sx={{ ...pillBtnSx("dark"), px: 3.2, py: 1.3, fontSize: 16 }}
              >
                Khám phá giải đấu
              </Button>
              <Button
                component={Link}
                to="/pickle-ball/rankings"
                sx={{ ...pillBtnSx("ghost"), px: 3.2, py: 1.3, fontSize: 16 }}
              >
                Xem bảng xếp hạng
              </Button>
            </Stack>
          </Stack>
        </Reveal>
      </Container>
    </Box>
  );
}

/* --------------------------- STAT BAND --------------------------- */
function StatBand({ stats, loading }) {
  const items = [
    { key: "players", label: "Vận động viên", icon: <GroupsIcon /> },
    { key: "tournaments", label: "Giải đấu", icon: <EmojiEventsIcon /> },
    { key: "matches", label: "Trận đã đấu", icon: <SportsTennisIcon /> },
    { key: "clubs", label: "Câu lạc bộ", icon: <VerifiedIcon /> },
  ];
  return (
    <Box sx={{ borderTop: `1px solid ${T.line}`, borderBottom: `1px solid ${T.line}`, bgcolor: T.bgAlt }}>
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 5 } }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4,1fr)" },
            gap: { xs: 3, md: 2 },
          }}
        >
          {items.map((it) => (
            <Stack key={it.key} spacing={0.5} alignItems="center" textAlign="center">
              <Box sx={{ color: T.faint, mb: 0.5 }}>{it.icon}</Box>
              <Typography
                sx={{
                  fontFamily: FONT,
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  color: T.ink,
                  fontSize: "clamp(28px, 4.5vw, 44px)",
                  lineHeight: 1,
                }}
              >
                {loading ? (
                  <Skeleton width={80} sx={{ mx: "auto" }} />
                ) : (
                  <>
                    <CountUp value={stats?.[it.key]} />
                    <Box component="span" sx={{ color: T.teal }}>
                      +
                    </Box>
                  </>
                )}
              </Typography>
              <Typography sx={{ fontFamily: FONT, fontWeight: 600, fontSize: 14, color: T.sub }}>
                {it.label}
              </Typography>
            </Stack>
          ))}
        </Box>
      </Container>
    </Box>
  );
}

/* ---------------------------- LIVE NOW ---------------------------- */
function liveTitle(m) {
  const a = firstText(
    m?.teamAName,
    m?.homeName,
    m?.nameA,
    m?.pairAName,
    m?.teamA?.name,
    m?.a?.name,
  );
  const b = firstText(
    m?.teamBName,
    m?.awayName,
    m?.nameB,
    m?.pairBName,
    m?.teamB?.name,
    m?.b?.name,
  );
  if (a && b) return `${a}  vs  ${b}`;
  return firstText(m?.title, m?.matchTitle, m?.name, "Trận đấu trực tiếp");
}

function LiveSection({ items, loading }) {
  const list = (items || []).slice(0, 3);
  if (!loading && !list.length) return null;
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 6, md: 9 } }}>
      <Reveal>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mb: 3 }}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Box
                sx={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  bgcolor: "#EF4444",
                  animation: "pkPulse 1.6s infinite",
                }}
              />
              <Typography sx={{ ...kicker, color: "#EF4444" }}>Đang trực tiếp</Typography>
            </Stack>
            <Typography sx={h2Sx}>Xem trận ngay bây giờ</Typography>
          </Box>
          <Button component={Link} to="/live" endIcon={<ArrowOutwardIcon sx={{ fontSize: 16 }} />} sx={{ ...pillBtnSx("ghost"), py: 0.7 }}>
            Tất cả
          </Button>
        </Stack>
      </Reveal>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3,1fr)" }, gap: 2.5 }}>
        {loading && !list.length
          ? [0, 1, 2].map((i) => (
              <Skeleton key={i} variant="rounded" height={220} sx={{ borderRadius: 3 }} />
            ))
          : list.map((m, i) => {
              const thumb = imgUrl(
                firstText(m?.thumbnail, m?.cover, m?.image, m?.poster, m?.tournamentImage),
              );
              const sub = firstText(m?.tournamentName, m?.tournament?.name, m?.courtName, m?.court?.name);
              return (
                <Reveal key={m?._id || m?.matchId || i} delay={i * 70}>
                  <Box
                    component={Link}
                    to="/live"
                    sx={{
                      display: "block",
                      textDecoration: "none",
                      borderRadius: 3,
                      overflow: "hidden",
                      border: `1px solid ${T.line}`,
                      bgcolor: T.bg,
                      transition: "transform .3s, box-shadow .3s, border-color .3s",
                      "&:hover": {
                        transform: "translateY(-4px)",
                        boxShadow: "0 18px 40px rgba(11,11,15,0.10)",
                        borderColor: T.lineStrong,
                      },
                    }}
                  >
                    <Box
                      sx={{
                        position: "relative",
                        aspectRatio: "16 / 9",
                        bgcolor: "#0B0B0F",
                        backgroundImage: thumb ? `url(${thumb})` : "none",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    >
                      {!thumb && (
                        <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "rgba(255,255,255,0.35)" }}>
                          <LiveTvIcon sx={{ fontSize: 44 }} />
                        </Box>
                      )}
                      <Chip
                        size="small"
                        label="● LIVE"
                        sx={{
                          position: "absolute",
                          top: 12,
                          left: 12,
                          bgcolor: "#EF4444",
                          color: "#fff",
                          fontWeight: 800,
                          fontSize: 11,
                          height: 24,
                          fontFamily: FONT,
                        }}
                      />
                    </Box>
                    <Box sx={{ p: 2 }}>
                      <Typography sx={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, color: T.ink, lineHeight: 1.3 }} noWrap>
                        {liveTitle(m)}
                      </Typography>
                      {sub && (
                        <Typography sx={{ fontFamily: FONT, fontSize: 13.5, color: T.sub, mt: 0.5 }} noWrap>
                          {sub}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </Reveal>
              );
            })}
      </Box>
    </Container>
  );
}

/* ------------------------- TOURNAMENTS --------------------------- */
const STATUS_META = {
  ongoing: { label: "Đang diễn ra", color: T.teal },
  upcoming: { label: "Sắp diễn ra", color: T.indigo },
  finished: { label: "Đã kết thúc", color: T.faint },
};
function fmtDate(d) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return "";
  }
}
function TournamentShowcase({ items, loading }) {
  const list = useMemo(() => {
    const arr = asArray(items).filter((t) => !t?.isTest);
    const rank = { ongoing: 0, upcoming: 1, finished: 2 };
    return [...arr]
      .sort((a, b) => (rank[a?.status] ?? 3) - (rank[b?.status] ?? 3))
      .slice(0, 6);
  }, [items]);

  return (
    <Box sx={{ bgcolor: T.bgAlt, borderTop: `1px solid ${T.line}` }}>
      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 10 } }}>
        <Reveal>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mb: 4 }}>
            <Box>
              <Typography sx={{ ...kicker, mb: 1 }}>Giải đấu nổi bật</Typography>
              <Typography sx={h2Sx}>Tìm giải để tham gia hoặc theo dõi</Typography>
            </Box>
            <Button component={Link} to="/pickle-ball/tournaments" endIcon={<ArrowOutwardIcon sx={{ fontSize: 16 }} />} sx={{ ...pillBtnSx("ghost"), py: 0.7 }}>
              Tất cả
            </Button>
          </Stack>
        </Reveal>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3,1fr)" }, gap: 2.5 }}>
          {loading && !list.length
            ? [0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} variant="rounded" height={280} sx={{ borderRadius: 3 }} />
              ))
            : list.map((t, i) => {
                const st = STATUS_META[t?.status] || STATUS_META.upcoming;
                const cover = imgUrl(firstText(t?.image, t?.coverUrl, t?.banner));
                return (
                  <Reveal key={t?._id || t?.id || i} delay={(i % 3) * 70}>
                    <Box
                      component={Link}
                      to={`/tournament/${t?._id || t?.id}`}
                      sx={{
                        display: "block",
                        textDecoration: "none",
                        borderRadius: 3,
                        overflow: "hidden",
                        border: `1px solid ${T.line}`,
                        bgcolor: T.bg,
                        height: "100%",
                        transition: "transform .3s, box-shadow .3s, border-color .3s",
                        "&:hover": {
                          transform: "translateY(-4px)",
                          boxShadow: "0 18px 40px rgba(11,11,15,0.10)",
                          borderColor: T.lineStrong,
                        },
                      }}
                    >
                      <Box
                        sx={{
                          aspectRatio: "16 / 10",
                          bgcolor: "#E9ECF1",
                          backgroundImage: cover ? `url(${cover})` : "none",
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                          position: "relative",
                        }}
                      >
                        <Chip
                          size="small"
                          label={st.label}
                          sx={{
                            position: "absolute",
                            top: 12,
                            left: 12,
                            bgcolor: "rgba(255,255,255,0.92)",
                            color: st.color,
                            fontWeight: 800,
                            fontSize: 11.5,
                            height: 24,
                            fontFamily: FONT,
                            border: `1px solid ${T.line}`,
                          }}
                        />
                      </Box>
                      <Box sx={{ p: 2.2 }}>
                        <Typography
                          sx={{ fontFamily: FONT, fontWeight: 750, fontSize: 17, color: T.ink, lineHeight: 1.3, minHeight: 44, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                        >
                          {firstText(t?.name, "Giải đấu")}
                        </Typography>
                        <Stack direction="row" spacing={2} sx={{ mt: 1.3 }}>
                          <Typography sx={{ fontFamily: FONT, fontSize: 13, color: T.sub }} noWrap>
                            📍 {firstText(t?.location, t?.province, "—")}
                          </Typography>
                          <Typography sx={{ fontFamily: FONT, fontSize: 13, color: T.sub, whiteSpace: "nowrap" }}>
                            🗓 {fmtDate(t?.startDate || t?.startAt)}
                          </Typography>
                        </Stack>
                      </Box>
                    </Box>
                  </Reveal>
                );
              })}
        </Box>
      </Container>
    </Box>
  );
}

/* ---------------------------- FEATURES --------------------------- */
function Features() {
  const feats = [
    {
      icon: <EmojiEventsIcon />,
      title: "Bốc thăm & sơ đồ tự động",
      body: "Vòng bảng, loại trực tiếp, playoff — tạo khung, bốc thăm và cập nhật sơ đồ theo thời gian thực.",
    },
    {
      icon: <SportsTennisIcon />,
      title: "Chấm điểm trực tiếp",
      body: "Trọng tài chấm trên điện thoại, tỉ số đồng bộ tức thì tới khán giả, overlay và bảng xếp hạng.",
    },
    {
      icon: <LiveTvIcon />,
      title: "Phát sóng có overlay",
      body: "Live/record ngay trên Android với scoreboard, logo, tài trợ và widget điều khiển từ xa.",
    },
    {
      icon: <TrendingUpIcon />,
      title: "Điểm trình chuẩn hoá",
      body: "Hệ thống rating cộng/trừ sau mỗi trận, minh bạch theo vòng bảng và playoff.",
    },
  ];
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 7, md: 11 } }}>
      <Reveal>
        <Typography sx={{ ...kicker, mb: 1.5 }}>Tất cả trong một</Typography>
        <Typography sx={{ ...h2Sx, maxWidth: 720, mb: { xs: 4, md: 6 } }}>
          Tổ chức. Chấm điểm. Phát sóng. Ship nhanh hơn.
        </Typography>
      </Reveal>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: { xs: 2.5, md: 3 } }}>
        {feats.map((f, i) => (
          <Reveal key={f.title} delay={(i % 2) * 80}>
            <Box
              sx={{
                p: { xs: 3, md: 4 },
                borderRadius: 3,
                border: `1px solid ${T.line}`,
                bgcolor: T.bg,
                height: "100%",
                transition: "border-color .3s, background .3s",
                "&:hover": { borderColor: T.lineStrong, bgcolor: T.bgAlt },
              }}
            >
              <Box
                sx={{
                  width: 46,
                  height: 46,
                  borderRadius: "13px",
                  display: "grid",
                  placeItems: "center",
                  color: "#fff",
                  background: `linear-gradient(135deg, ${T.teal}, ${T.indigo})`,
                  mb: 2,
                }}
              >
                {f.icon}
              </Box>
              <Typography sx={{ fontFamily: FONT, fontWeight: 750, fontSize: 20, color: T.ink, mb: 1 }}>
                {f.title}
              </Typography>
              <Typography sx={{ fontFamily: FONT, fontSize: 15.5, color: T.sub, lineHeight: 1.6 }}>
                {f.body}
              </Typography>
            </Box>
          </Reveal>
        ))}
      </Box>
    </Container>
  );
}

/* --------------------- LEADERBOARD + CLIMBERS -------------------- */
function rankName(r) {
  return firstText(r?.nickname, r?.nickName, r?.user?.nickname, r?.fullName, r?.name, r?.user?.name, "VĐV");
}
function rankAvatar(r) {
  return imgUrl(firstText(r?.avatar, r?.user?.avatar, r?.avatarUrl));
}
function rankScore(r) {
  const v = Number(firstText(r?.double, r?.points, r?.single) || 0);
  return v ? v.toFixed(3) : "—";
}

function Leaderboard({ ranks, ranksLoading, climbers }) {
  const top = asArray(ranks).slice(0, 6);
  const medal = ["#F59E0B", "#9CA3AF", "#B45309"];
  return (
    <Box sx={{ bgcolor: T.bgAlt, borderTop: `1px solid ${T.line}`, borderBottom: `1px solid ${T.line}` }}>
      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 10 } }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.4fr 1fr" }, gap: { xs: 4, md: 5 } }}>
          {/* Top players */}
          <Reveal>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mb: 3 }}>
              <Box>
                <Typography sx={{ ...kicker, mb: 1 }}>Bảng xếp hạng</Typography>
                <Typography sx={h2Sx}>Top vận động viên</Typography>
              </Box>
              <Button component={Link} to="/pickle-ball/rankings" endIcon={<ArrowOutwardIcon sx={{ fontSize: 16 }} />} sx={{ ...pillBtnSx("ghost"), py: 0.7 }}>
                Xem tất cả
              </Button>
            </Stack>
            <Box sx={{ borderRadius: 3, border: `1px solid ${T.line}`, bgcolor: T.bg, overflow: "hidden" }}>
              {ranksLoading && !top.length
                ? [0, 1, 2, 3, 4].map((i) => (
                    <Box key={i} sx={{ p: 2, borderBottom: i < 4 ? `1px solid ${T.line}` : "none" }}>
                      <Skeleton height={40} />
                    </Box>
                  ))
                : top.map((r, i) => (
                    <Stack
                      key={r?._id || r?.user?._id || r?.user || i}
                      direction="row"
                      alignItems="center"
                      spacing={2}
                      sx={{ px: 2.2, py: 1.6, borderBottom: i < top.length - 1 ? `1px solid ${T.line}` : "none" }}
                    >
                      <Typography sx={{ fontFamily: FONT, fontWeight: 800, fontSize: 16, width: 26, color: i < 3 ? medal[i] : T.faint }}>
                        {i + 1}
                      </Typography>
                      <Avatar src={rankAvatar(r)} sx={{ width: 40, height: 40, bgcolor: T.bgAlt, color: T.faint, fontSize: 15 }}>
                        {rankName(r).charAt(0).toUpperCase()}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={0.6} alignItems="center">
                          <Typography sx={{ fontFamily: FONT, fontWeight: 700, fontSize: 15.5, color: T.ink }} noWrap>
                            {rankName(r)}
                          </Typography>
                          {(r?.verified || r?.user?.verified) && (
                            <VerifiedIcon sx={{ fontSize: 15, color: T.indigo }} />
                          )}
                        </Stack>
                        {firstText(r?.province, r?.user?.province) && (
                          <Typography sx={{ fontFamily: FONT, fontSize: 12.5, color: T.faint }} noWrap>
                            {firstText(r?.province, r?.user?.province)}
                          </Typography>
                        )}
                      </Box>
                      <Typography sx={{ fontFamily: FONT, fontWeight: 800, fontSize: 16, color: T.ink, letterSpacing: "-0.02em" }}>
                        {rankScore(r)}
                      </Typography>
                    </Stack>
                  ))}
            </Box>
          </Reveal>

          {/* Week climbers — SÁNG CHẾ từ backend pulse */}
          <Reveal delay={100}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 3 }}>
              <BoltIcon sx={{ color: T.amber }} />
              <Typography sx={{ ...kicker, color: T.amber, mb: 0 }}>Leo hạng tuần này</Typography>
            </Stack>
            <Box sx={{ borderRadius: 3, border: `1px solid ${T.line}`, bgcolor: T.bg, p: 1 }}>
              {!climbers?.length ? (
                <Box sx={{ p: 3, textAlign: "center" }}>
                  <Typography sx={{ fontFamily: FONT, fontSize: 14, color: T.faint }}>
                    Chưa có dữ liệu tuần này.
                  </Typography>
                </Box>
              ) : (
                climbers.slice(0, 5).map((c, i) => (
                  <Stack key={c?.userId || i} direction="row" alignItems="center" spacing={1.5} sx={{ px: 1.4, py: 1.3, borderRadius: 2, "&:hover": { bgcolor: T.bgAlt } }}>
                    <Avatar src={imgUrl(c?.avatar)} sx={{ width: 36, height: 36, bgcolor: T.bgAlt, color: T.faint, fontSize: 14 }}>
                      {firstText(c?.nickname, "?").charAt(0).toUpperCase()}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontFamily: FONT, fontWeight: 700, fontSize: 14.5, color: T.ink }} noWrap>
                        {firstText(c?.nickname, "VĐV")}
                      </Typography>
                      <Typography sx={{ fontFamily: FONT, fontSize: 12, color: T.faint }} noWrap>
                        {c?.matches || 0} trận · {firstText(c?.province, "—")}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      icon={<TrendingUpIcon sx={{ fontSize: 15, color: `${T.teal} !important` }} />}
                      label={`+${Number(c?.delta || 0).toFixed(3)}`}
                      sx={{ bgcolor: "rgba(16,185,129,0.12)", color: T.teal, fontWeight: 800, fontFamily: FONT, fontSize: 12.5, height: 26 }}
                    />
                  </Stack>
                ))
              )}
            </Box>
          </Reveal>
        </Box>
      </Container>
    </Box>
  );
}

/* ------------------------------ CLUBS ---------------------------- */
function Clubs({ clubs }) {
  const list = asArray(clubs).slice(0, 6);
  if (!list.length) return null;
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 6, md: 10 } }}>
      <Reveal>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mb: 4 }}>
          <Box>
            <Typography sx={{ ...kicker, mb: 1 }}>Cộng đồng</Typography>
            <Typography sx={h2Sx}>Câu lạc bộ nổi bật</Typography>
          </Box>
          <Button component={Link} to="/clubs" endIcon={<ArrowOutwardIcon sx={{ fontSize: 16 }} />} sx={{ ...pillBtnSx("ghost"), py: 0.7 }}>
            Tất cả
          </Button>
        </Stack>
      </Reveal>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3,1fr)", md: "repeat(6,1fr)" }, gap: 2 }}>
        {list.map((c, i) => (
          <Reveal key={c?.id || c?._id || i} delay={(i % 6) * 50}>
            <Box
              component={Link}
              to={`/clubs/${c?.slug || c?.id || c?._id}`}
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
                p: 2,
                borderRadius: 3,
                border: `1px solid ${T.line}`,
                bgcolor: T.bg,
                textDecoration: "none",
                textAlign: "center",
                transition: "transform .25s, border-color .25s",
                "&:hover": { transform: "translateY(-3px)", borderColor: T.lineStrong },
              }}
            >
              <Avatar src={imgUrl(c?.logoUrl)} sx={{ width: 54, height: 54, bgcolor: T.bgAlt, color: T.faint }}>
                {firstText(c?.name, "?").charAt(0).toUpperCase()}
              </Avatar>
              <Typography sx={{ fontFamily: FONT, fontWeight: 700, fontSize: 13.5, color: T.ink, lineHeight: 1.25 }} noWrap>
                {firstText(c?.name, "CLB")}
              </Typography>
              <Typography sx={{ fontFamily: FONT, fontSize: 11.5, color: T.faint }} noWrap>
                {Number(c?.memberCount || 0)} thành viên
              </Typography>
            </Box>
          </Reveal>
        ))}
      </Box>
    </Container>
  );
}

/* ------------------------------ CTA ------------------------------ */
function CtaBand() {
  return (
    <Container maxWidth="lg" sx={{ pb: { xs: 7, md: 11 } }}>
      <Reveal>
        <Box
          sx={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 5,
            px: { xs: 4, md: 9 },
            py: { xs: 6, md: 9 },
            textAlign: "center",
            background: `linear-gradient(135deg, ${T.ink}, #1B1E2B)`,
          }}
        >
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(50% 80% at 20% 0%, rgba(16,185,129,0.25), transparent 60%), radial-gradient(50% 80% at 90% 100%, rgba(99,102,241,0.28), transparent 60%)`,
            }}
          />
          <Box sx={{ position: "relative" }}>
            <Typography sx={{ fontFamily: FONT, fontWeight: 800, letterSpacing: "-0.03em", color: "#fff", fontSize: "clamp(28px, 4.6vw, 52px)", lineHeight: 1.05, mb: 2 }}>
              Sẵn sàng tổ chức giải của bạn?
            </Typography>
            <Typography sx={{ fontFamily: FONT, fontSize: 18, color: "rgba(255,255,255,0.75)", maxWidth: 560, mx: "auto", mb: 4 }}>
              Tạo giải miễn phí, mời vận động viên và lên sóng chỉ trong hôm nay.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="center">
              <Button component={Link} to="/register" endIcon={<ArrowOutwardIcon />} sx={{ borderRadius: 999, px: 3.4, py: 1.35, fontFamily: FONT, fontWeight: 700, fontSize: 16, textTransform: "none", bgcolor: "#fff", color: T.ink, "&:hover": { bgcolor: "#F0F0F0" } }}>
                Tạo giải miễn phí
              </Button>
              <Button component={Link} to="/pickle-ball/tournaments" sx={{ borderRadius: 999, px: 3.4, py: 1.35, fontFamily: FONT, fontWeight: 700, fontSize: 16, textTransform: "none", color: "#fff", border: "1px solid rgba(255,255,255,0.28)", "&:hover": { bgcolor: "rgba(255,255,255,0.08)" } }}>
                Xem giải đang mở
              </Button>
            </Stack>
          </Box>
        </Box>
      </Reveal>
    </Container>
  );
}

/* ---------------------------- FOOTER ----------------------------- */
function Footer() {
  const cols = [
    { h: "Sản phẩm", links: [["Giải đấu", "/pickle-ball/tournaments"], ["Bảng xếp hạng", "/pickle-ball/rankings"], ["Trực tiếp", "/live"], ["Câu lạc bộ", "/clubs"]] },
    { h: "Tài khoản", links: [["Đăng nhập", "/login"], ["Đăng ký", "/register"], ["Hồ sơ", "/profile"]] },
    { h: "Hỗ trợ", links: [["Liên hệ", "/contact"], ["Trạng thái", "/status"], ["Chính sách", "/privacy-and-policy"]] },
  ];
  return (
    <Box sx={{ borderTop: `1px solid ${T.line}`, bgcolor: T.bg }}>
      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 8 } }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "2fr 1fr 1fr 1fr" }, gap: 4 }}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <Box sx={{ width: 28, height: 28, borderRadius: "8px", background: `linear-gradient(135deg, ${T.teal}, ${T.indigo})`, display: "grid", placeItems: "center", color: "#fff" }}>
                <SportsTennisIcon sx={{ fontSize: 17 }} />
              </Box>
              <Typography sx={{ fontFamily: FONT, fontWeight: 800, fontSize: 18, color: T.ink }}>PickleTour</Typography>
            </Stack>
            <Typography sx={{ fontFamily: FONT, fontSize: 14, color: T.sub, maxWidth: 280, lineHeight: 1.6 }}>
              Nền tảng tổ chức & phát sóng giải đấu pickleball cho cộng đồng Việt Nam.
            </Typography>
          </Box>
          {cols.map((col) => (
            <Box key={col.h}>
              <Typography sx={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: T.ink, mb: 1.5 }}>{col.h}</Typography>
              <Stack spacing={1}>
                {col.links.map(([label, to]) => (
                  <Typography key={to} component={Link} to={to} sx={{ fontFamily: FONT, fontSize: 14, color: T.sub, textDecoration: "none", "&:hover": { color: T.ink } }}>
                    {label}
                  </Typography>
                ))}
              </Stack>
            </Box>
          ))}
        </Box>
        <Typography sx={{ fontFamily: FONT, fontSize: 13, color: T.faint, mt: 5 }}>
          © {new Date().getFullYear()} PickleTour · Bản thử nghiệm giao diện (ui=v2)
        </Typography>
      </Container>
    </Box>
  );
}

/* ============================== PAGE ============================== */
export default function HomeScreenAstryx() {
  const { data: summary, isLoading: summaryLoading } = useGetHomeSummaryQuery({ clubsLimit: 6 });
  const { data: pulse } = useGetHomePulseQuery();
  const { data: tournaments, isLoading: tourLoading } = useListTournamentsQuery({ limit: 24, sort: "-startDate" });
  const { data: ranks, isLoading: ranksLoading } = useGetRankingsListQuery({ limit: 8 });
  const { data: liveFeed, isLoading: liveLoading } = useGetLiveFeedQuery({ limit: 6, sort: "smart" });

  return (
    <Box sx={{ bgcolor: T.bg, minHeight: "100vh", fontFamily: FONT }}>
      <SEOHead
        title="PickleTour — Nền tảng giải đấu pickleball chuyên nghiệp"
        description="Tổ chức, chấm điểm trực tiếp và phát sóng giải đấu pickleball. Bảng xếp hạng và điểm trình chuẩn hoá."
      />
      {/* keyframes cục bộ */}
      <style>{`
        @keyframes pkPulse {
          0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.55); }
          70% { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
          100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
        }
      `}</style>

      <Nav />
      <Hero pulse={pulse} />
      <StatBand stats={summary?.stats} loading={summaryLoading} />
      <LiveSection items={asArray(liveFeed)} loading={liveLoading} />
      <TournamentShowcase items={tournaments} loading={tourLoading} />
      <Features />
      <Leaderboard ranks={ranks} ranksLoading={ranksLoading} climbers={pulse?.weekClimbers} />
      <Clubs clubs={summary?.clubs} />
      <CtaBand />
      <Footer />
    </Box>
  );
}
