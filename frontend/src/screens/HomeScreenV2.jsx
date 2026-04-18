import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import {
  alpha,
  Avatar,
  Box,
  Button,
  Container,
  Divider,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  ArrowForwardRounded,
  CalendarMonthRounded,
  CloseRounded,
  Groups2Rounded,
  MenuRounded,
  PlaceRounded,
  QueryStatsRounded,
} from "@mui/icons-material";

import SEOHead from "../components/SEOHead.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useGetHeroContentQuery } from "../slices/cmsApiSlice.js";
import { useGetHomeSummaryQuery } from "../slices/homeApiSlice.js";
import { useListTournamentsQuery } from "../slices/tournamentsApiSlice.js";

const fallbackImg = `${import.meta.env.BASE_URL}hero.jpg`;

const DISPLAY_FONT_FAMILY =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif';
const ACCENT_COLOR = "#cb6b2f";
const HERO_PANEL_BG = "rgba(18, 15, 13, 0.58)";
const SURFACE_BORDER = "rgba(255, 255, 255, 0.12)";
const SURFACE_BG = "rgba(24, 20, 18, 0.76)";

function toEpochMs(primaryValue, fallbackValue) {
  const first = primaryValue ? new Date(primaryValue).getTime() : NaN;
  if (Number.isFinite(first) && first > 0) return first;
  const second = fallbackValue ? new Date(fallbackValue).getTime() : NaN;
  return Number.isFinite(second) && second > 0 ? second : 0;
}

function normalizeLocation(item) {
  if (!item) return "";
  if (typeof item.location === "string" && item.location.trim()) {
    return item.location.trim();
  }

  if (item.location && typeof item.location === "object") {
    const parts = [
      item.location.venue,
      item.location.city,
      item.location.province,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    if (parts.length) return parts.join(", ");
  }

  const parts = [item.venueName, item.city, item.province]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return parts.join(", ");
}

function formatCompactNumber(value, locale) {
  const numericValue = Number(value || 0);
  return new Intl.NumberFormat(locale, {
    notation: numericValue >= 1000 ? "compact" : "standard",
    maximumFractionDigits: numericValue >= 1000 ? 1 : 0,
  }).format(numericValue);
}

function formatDateRange(startDate, endDate, locale) {
  const startMs = toEpochMs(startDate);
  const endMs = toEpochMs(endDate);
  const effectiveStartMs = startMs || endMs;
  const effectiveEndMs = endMs || startMs;

  if (!effectiveStartMs) return "--";

  const formatter = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  if (!effectiveEndMs || effectiveEndMs === effectiveStartMs) {
    return formatter.format(new Date(effectiveStartMs));
  }

  return `${formatter.format(new Date(effectiveStartMs))} - ${formatter.format(
    new Date(effectiveEndMs),
  )}`;
}

function getCountdownParts(targetMs, nowMs) {
  const diff = Math.max(0, targetMs - nowMs);
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    days,
    hours,
    minutes,
    seconds,
  };
}

function padCountdown(value) {
  return String(Math.max(0, Number(value) || 0)).padStart(2, "0");
}

function buildHeroLines(title, locale) {
  const trimmed = String(title || "").trim();
  const words = trimmed.split(/\s+/).filter(Boolean);

  if (!words.length) {
    return locale.startsWith("en")
      ? [
          { text: "Run Better" },
          { text: "Tournaments", accent: true, italic: true },
          { text: "Together" },
        ]
      : [
          { text: "Tổ Chức" },
          { text: "Giải Đấu", accent: true, italic: true },
          { text: "Mượt Hơn" },
        ];
  }

  if (words.length <= 4) {
    return [
      { text: words.slice(0, 2).join(" ") },
      { text: words.slice(2).join(" "), accent: true, italic: true },
    ];
  }

  const firstCut = Math.max(2, Math.ceil(words.length * 0.34));
  const secondCut = Math.max(firstCut + 1, Math.ceil(words.length * 0.68));

  return [
    { text: words.slice(0, firstCut).join(" ") },
    {
      text: words.slice(firstCut, secondCut).join(" "),
      accent: true,
      italic: true,
    },
    { text: words.slice(secondCut).join(" ") },
  ].filter((line) => line.text);
}

function buildPageCopy(isEnglish) {
  return {
    navItems: [
      {
        label: isEnglish ? "Tournaments" : "Giải đấu",
        to: "/pickle-ball/tournaments",
      },
      {
        label: isEnglish ? "Rankings" : "Điểm trình",
        to: "/pickle-ball/rankings",
      },
      {
        label: isEnglish ? "Clubs" : "Câu lạc bộ",
        to: "/clubs",
      },
      {
        label: isEnglish ? "News" : "Tin tức",
        to: "/news",
      },
    ],
    eyebrow: isEnglish
      ? "Tournament, rankings, clubs, live"
      : "Giải đấu, điểm trình, câu lạc bộ, live",
    primaryCta: isEnglish ? "Create account" : "Tạo tài khoản",
    secondaryCta: isEnglish ? "Explore tournaments" : "Xem giải đấu",
    tertiaryCta: isEnglish ? "View rankings" : "Xem bảng xếp hạng",
    nextEvent: isEnglish ? "Next event countdown" : "Đếm ngược sự kiện tiếp theo",
    nextEventFallback: isEnglish ? "PickleTour season" : "Mùa giải PickleTour",
    registerNow: isEnglish ? "Register now" : "Đăng ký ngay",
    seasonData: isEnglish ? "Performance data" : "Dữ liệu mùa giải",
    seasonTitle: isEnglish
      ? "Public tournament momentum, one landing page."
      : "Nhịp vận hành giải đấu, gói gọn trên một landing page.",
    seasonBody: isEnglish
      ? "The homepage should feel like an event platform first: clear hierarchy, bold hero, quick stats, and obvious paths into tournaments, rankings, clubs, and news."
      : "Trang chủ cần cho cảm giác một event platform thực thụ: hero rõ thứ bậc, nhịp typography lớn, số liệu ngay lập tức, và đường dẫn nhanh vào giải đấu, bảng xếp hạng, câu lạc bộ, và tin tức.",
    featuredEyebrow: isEnglish ? "Upcoming calendar" : "Lịch nổi bật",
    featuredTitle: isEnglish ? "Featured tournaments" : "Giải đấu nổi bật",
    featuredBody: isEnglish
      ? "Built directly from the public tournament feed so the landing stays aligned with the real schedule."
      : "Lấy trực tiếp từ feed giải đấu public để landing luôn bám sát lịch thật ngoài hệ thống.",
    featuredPrimaryCta: isEnglish ? "Open overview" : "Mở tổng quan",
    featuredSecondaryCta: isEnglish ? "All tournaments" : "Tất cả giải đấu",
    capabilitiesEyebrow: isEnglish ? "Platform capabilities" : "Năng lực nền tảng",
    capabilitiesTitle: isEnglish
      ? "The rest of the platform is already there."
      : "Phần còn lại của nền tảng đã có sẵn ở backend.",
    capabilitiesBody: isEnglish
      ? "V2 should not be a pretty shell only. It should pull users into the real system: registration flows, rankings, clubs, and public content."
      : "V2 không chỉ là lớp vỏ đẹp hơn. Nó phải kéo người dùng vào đúng luồng hệ thống thật: đăng ký giải, bảng xếp hạng, câu lạc bộ, và nội dung public.",
    clubsEyebrow: isEnglish ? "Club network" : "Mạng lưới câu lạc bộ",
    clubsTitle: isEnglish ? "Trusted by active clubs" : "Được tin dùng bởi các CLB hoạt động mạnh",
    clubsBody: isEnglish
      ? "Use public club data as proof that the ecosystem is already active."
      : "Dùng dữ liệu club public như bằng chứng rằng hệ sinh thái đã hoạt động thật sự.",
    ctaTitle: isEnglish
      ? "Ready to move from browsing to registration?"
      : "Sẵn sàng chuyển từ xem landing sang đăng ký thật?",
    ctaBody: isEnglish
      ? "Keep the energy of the hero, then send people into the actual tournament and profile flows already backed by the platform."
      : "Giữ đúng năng lượng của phần hero, sau đó đẩy người dùng vào luồng giải đấu và hồ sơ thật đã có sẵn trong nền tảng.",
    ctaPrimary: isEnglish ? "Browse tournaments" : "Duyệt giải đấu",
    ctaSecondary: isEnglish ? "Open clubs" : "Mở câu lạc bộ",
    footerBlurb: isEnglish
      ? "Public landing for tournaments, ratings, clubs, and community activity."
      : "Landing public cho giải đấu, điểm trình, câu lạc bộ, và hoạt động cộng đồng.",
    footerLinksTitle: isEnglish ? "Quick links" : "Liên kết nhanh",
    footerLegalTitle: isEnglish ? "Legal" : "Pháp lý",
    liveLabel: isEnglish ? "Live data" : "Dữ liệu live",
    clubsFallback: isEnglish ? "Vietnam" : "Việt Nam",
    viewClub: isEnglish ? "View club" : "Xem CLB",
    seasonStats: [
      {
        key: "players",
        icon: "01",
      },
      {
        key: "tournaments",
        icon: "02",
      },
      {
        key: "matches",
        icon: "03",
      },
      {
        key: "clubs",
        icon: "04",
      },
    ],
  };
}

export default function HomeScreenV2() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const { t, locale, language } = useLanguage();
  const { userInfo } = useSelector((state) => state.auth);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const { data: heroRes, isError: heroError, isLoading: heroLoading } =
    useGetHeroContentQuery();
  const { data: homeRes } = useGetHomeSummaryQuery({ clubsLimit: 6 });
  const { data: tournamentsRes = [] } = useListTournamentsQuery({
    limit: 8,
    sort: "startDate",
  });

  const isEnglish = language === "en";
  const copy = useMemo(() => buildPageCopy(isEnglish), [isEnglish]);
  const fallbackHero = t("home.heroFallback");
  const featureItems = t("home.features.items", {}, []);
  const clubMembersLabel = t("home.clubs.members", { count: "{count}" });

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!isMobile && mobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  }, [isMobile, mobileMenuOpen]);

  const heroData = useMemo(() => {
    if (heroLoading || heroError) {
      return {
        title: fallbackHero.title,
        lead: fallbackHero.lead,
        imageUrl: fallbackImg,
        imageAlt: fallbackHero.imageAlt,
      };
    }

    return {
      title: heroRes?.title || fallbackHero.title,
      lead: heroRes?.lead || fallbackHero.lead,
      imageUrl: heroRes?.imageUrl || fallbackImg,
      imageAlt: heroRes?.imageAlt || fallbackHero.imageAlt,
    };
  }, [fallbackHero, heroError, heroLoading, heroRes]);

  const heroLines = useMemo(
    () => buildHeroLines(heroData.title, locale),
    [heroData.title, locale],
  );

  const tournaments = useMemo(
    () => (Array.isArray(tournamentsRes) ? tournamentsRes : []),
    [tournamentsRes],
  );

  const upcomingTournaments = useMemo(() => {
    const next = tournaments
      .filter((item) => toEpochMs(item?.startAt, item?.startDate) >= nowMs)
      .sort(
        (left, right) =>
          toEpochMs(left?.startAt, left?.startDate) -
          toEpochMs(right?.startAt, right?.startDate),
      );

    return next;
  }, [nowMs, tournaments]);

  const nextTournament = upcomingTournaments[0] || tournaments[0] || null;
  const featuredTournaments = useMemo(() => {
    const source = upcomingTournaments.length ? upcomingTournaments : tournaments;
    return source.slice(0, 3);
  }, [tournaments, upcomingTournaments]);

  const countdownTargetMs =
    toEpochMs(nextTournament?.startAt, nextTournament?.startDate) ||
    nowMs + 1000 * 60 * 60 * 24 * 12;
  const countdownParts = getCountdownParts(countdownTargetMs, nowMs);

  const isLoggedIn = Boolean(userInfo?._id || userInfo?.id || userInfo?.email);
  const heroPrimaryLink = isLoggedIn ? "/pickle-ball/tournaments" : "/register";
  const heroSecondaryLink = isLoggedIn ? "/pickle-ball/rankings" : "/pickle-ball/tournaments";

  const stats = useMemo(
    () => [
      {
        key: "players",
        label: t("home.stats.cards.players"),
        value: homeRes?.stats?.players || 0,
      },
      {
        key: "tournaments",
        label: t("home.stats.cards.tournaments"),
        value: homeRes?.stats?.tournaments || 0,
      },
      {
        key: "matches",
        label: t("home.stats.cards.matches"),
        value: homeRes?.stats?.matches || 0,
      },
      {
        key: "clubs",
        label: t("home.stats.cards.clubs"),
        value: homeRes?.stats?.clubs || 0,
      },
    ],
    [
      homeRes?.stats?.clubs,
      homeRes?.stats?.matches,
      homeRes?.stats?.players,
      homeRes?.stats?.tournaments,
      t,
    ],
  );

  const clubs = Array.isArray(homeRes?.clubs) ? homeRes.clubs.slice(0, 3) : [];
  const heroSpotlightStats = stats.slice(0, 3);
  const heroBackdropUrl = heroData.imageUrl || fallbackImg;
  const footerLinks = [
    ...copy.navItems,
    {
      label: isEnglish ? "Docs" : "Tài liệu",
      to: "/docs/api",
    },
  ];
  const footerLegalLinks = [
    {
      label: isEnglish ? "Privacy" : "Quyền riêng tư",
      to: "/privacy-and-policy",
    },
    {
      label: isEnglish ? "Terms" : "Điều khoản",
      to: "/terms-of-service",
    },
    {
      label: isEnglish ? "Cookies" : "Cookies",
      to: "/cookies",
    },
  ];

  return (
    <Box
      sx={{
        minHeight: "100vh",
        color: "#f8f5f0",
        background:
          "linear-gradient(180deg, #120f0d 0%, #17110e 22%, #101216 48%, #0d1015 100%)",
      }}
    >
      <SEOHead
        path="/"
        title="PickleTour"
        description={t("home.seoDescription")}
        keywords={t("home.seoKeywords")}
        ogImage={heroData.imageUrl}
      />

      <Box
        sx={{
          position: "relative",
          overflow: "clip",
          background: "linear-gradient(180deg, #1a120d 0%, #17100d 46%, #130f12 100%)",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url(${heroBackdropUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(34px) saturate(0.72)",
            transform: "scale(1.14)",
            opacity: 0.58,
          }}
        />
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(16,11,9,0.66) 0%, rgba(14,10,10,0.52) 18%, rgba(10,10,12,0.12) 42%, rgba(11,9,10,0.7) 100%), linear-gradient(90deg, rgba(20,12,10,0.9) 0%, rgba(20,12,10,0.58) 24%, rgba(20,12,10,0.18) 54%, rgba(20,12,10,0.42) 100%)",
          }}
        />
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 72% 74%, rgba(255,255,255,0.18), transparent 16%), radial-gradient(circle at 82% 18%, rgba(203,107,47,0.28), transparent 18%), repeating-linear-gradient(90deg, transparent 0, transparent 119px, rgba(255,255,255,0.03) 120px)",
          }}
        />
        <Stack
          direction="row"
          spacing={{ md: 1.8, xl: 2.2 }}
          sx={{
            position: "absolute",
            top: { md: 38, xl: 34 },
            left: { md: "53%", xl: "56%" },
            transform: "translateX(-18%)",
            display: { xs: "none", md: "flex" },
            opacity: 0.9,
          }}
        >
          {[
            "rgba(181,72,45,0.75)",
            "rgba(37,118,169,0.68)",
            "rgba(193,168,61,0.68)",
            "rgba(82,146,77,0.68)",
            "rgba(183,183,183,0.44)",
          ].map((color, index) => (
            <Box
              key={`hero-band-${index}`}
              sx={{
                width: { md: 58, xl: 72 },
                height: { md: 180, xl: 210 },
                borderRadius: "0 0 26px 26px",
                background: `linear-gradient(180deg, ${color}, rgba(255,255,255,0.08))`,
                boxShadow: "0 28px 42px rgba(0,0,0,0.18)",
                transform: `rotate(${index % 2 === 0 ? -1.5 : 1.5}deg)`,
              }}
            />
          ))}
        </Stack>

        <Box
          sx={{
            position: "absolute",
            insetInline: 0,
            bottom: 0,
            height: { xs: 140, md: 220 },
            background:
              "linear-gradient(180deg, rgba(12,10,10,0) 0%, rgba(12,10,10,0.58) 36%, rgba(12,10,10,0.94) 100%)",
          }}
        />

        <Container
          maxWidth={false}
          sx={{
            position: "relative",
            zIndex: 2,
            maxWidth: "1440px",
            px: { xs: 2, md: 4, xl: 6 },
            pt: { xs: 2, md: 3 },
          }}
        >
          <Box
            sx={{
              position: "relative",
              borderRadius: { xs: 5, md: 0 },
              px: { xs: 2, md: 3.5 },
              py: { xs: 1.4, md: 1.6 },
              border: { xs: `1px solid ${SURFACE_BORDER}`, md: "none" },
              background: { xs: "rgba(20, 16, 14, 0.58)", md: "transparent" },
              backdropFilter: { xs: "blur(18px)", md: "none" },
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={2}
            >
              <Stack
                component={Link}
                to="/"
                direction="row"
                spacing={1.5}
                alignItems="center"
                sx={{
                  color: "#f8f5f0",
                  textDecoration: "none",
                  minWidth: 0,
                }}
              >
                <Box
                  sx={{
                    width: 38,
                    height: 38,
                    borderRadius: "50%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid rgba(255,255,255,0.2)",
                    background:
                      "linear-gradient(135deg, rgba(255,255,255,0.16), rgba(203,107,47,0.18))",
                    color: ACCENT_COLOR,
                    fontWeight: 800,
                    fontSize: "1rem",
                  }}
                >
                  PT
                </Box>
                <Stack spacing={0.15} sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontWeight: 800,
                      letterSpacing: "0.24em",
                      fontSize: { xs: "0.88rem", md: "1.1rem" },
                    }}
                  >
                    PICKLETOUR
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: "rgba(248,245,240,0.62)" }}
                  >
                    {copy.liveLabel}
                  </Typography>
                </Stack>
              </Stack>

              <Stack
                direction="row"
                spacing={0.25}
                alignItems="center"
                sx={{ display: { xs: "none", md: "flex" } }}
              >
                {copy.navItems.map((item) => (
                  <Button
                    key={item.to}
                    component={Link}
                    to={item.to}
                    sx={{
                      color: "rgba(248,245,240,0.74)",
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      px: 1.8,
                      py: 1,
                      borderRadius: 999,
                      "&:hover": {
                        color: "#f8f5f0",
                        backgroundColor: "rgba(255,255,255,0.08)",
                      },
                    }}
                  >
                    {item.label}
                  </Button>
                ))}
              </Stack>

              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ display: { xs: "none", md: "flex" } }}
              >
                <Button
                  component={Link}
                  to={isLoggedIn ? "/profile" : "/login"}
                  sx={{
                    color: "#f8f5f0",
                    textTransform: "none",
                    fontWeight: 600,
                    px: 2.2,
                    py: 1.1,
                    borderRadius: 999,
                    "&:hover": {
                      backgroundColor: "rgba(255,255,255,0.08)",
                    },
                  }}
                >
                  {isLoggedIn
                    ? isEnglish
                      ? "Profile"
                      : "Hồ sơ"
                    : copy.tertiaryCta}
                </Button>
                <Button
                  component={Link}
                  to={heroPrimaryLink}
                  variant="contained"
                  disableElevation
                  startIcon={<Box sx={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "#fff" }} />}
                  sx={{
                    minHeight: 48,
                    px: 2.6,
                    borderRadius: 999,
                    textTransform: "uppercase",
                    letterSpacing: "0.09em",
                    fontWeight: 800,
                    backgroundColor: ACCENT_COLOR,
                    "&:hover": {
                      backgroundColor: "#db7b3a",
                    },
                  }}
                >
                  {isLoggedIn ? copy.featuredSecondaryCta : copy.primaryCta}
                </Button>
              </Stack>

              <IconButton
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                sx={{
                  display: { xs: "inline-flex", md: "none" },
                  color: "#f8f5f0",
                  border: "1px solid rgba(255,255,255,0.14)",
                  backgroundColor: "rgba(255,255,255,0.04)",
                }}
              >
                {mobileMenuOpen ? <CloseRounded /> : <MenuRounded />}
              </IconButton>
            </Stack>

            {mobileMenuOpen ? (
              <Box
                sx={{
                  display: { xs: "block", md: "none" },
                  pt: 2,
                }}
              >
                <Divider sx={{ borderColor: "rgba(255,255,255,0.1)", mb: 2 }} />
                <Stack spacing={1}>
                  {copy.navItems.map((item) => (
                    <Button
                      key={item.to}
                      component={Link}
                      to={item.to}
                      onClick={() => setMobileMenuOpen(false)}
                      sx={{
                        justifyContent: "space-between",
                        color: "#f8f5f0",
                        textTransform: "none",
                        fontWeight: 700,
                        fontSize: "1rem",
                        px: 0.5,
                        py: 1.2,
                      }}
                    >
                      {item.label}
                    </Button>
                  ))}
                  <Stack direction="row" spacing={1} pt={1}>
                    <Button
                      component={Link}
                      to={heroSecondaryLink}
                      onClick={() => setMobileMenuOpen(false)}
                      variant="outlined"
                      fullWidth
                      sx={{
                        minHeight: 48,
                        borderRadius: 999,
                        color: "#f8f5f0",
                        borderColor: "rgba(255,255,255,0.18)",
                      }}
                    >
                      {copy.tertiaryCta}
                    </Button>
                    <Button
                      component={Link}
                      to={heroPrimaryLink}
                      onClick={() => setMobileMenuOpen(false)}
                      variant="contained"
                      fullWidth
                      sx={{
                        minHeight: 48,
                        borderRadius: 999,
                        backgroundColor: ACCENT_COLOR,
                      }}
                    >
                      {isLoggedIn ? copy.featuredSecondaryCta : copy.primaryCta}
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            ) : null}
          </Box>
        </Container>

        <Container
          maxWidth={false}
          sx={{
            position: "relative",
            zIndex: 1,
            maxWidth: "1440px",
            px: { xs: 2, md: 4, xl: 6 },
            pt: { xs: 7, md: 12 },
            pb: { xs: 6, md: 7 },
          }}
        >
          <Box
            sx={{
              display: "grid",
              gap: { xs: 4, md: 5 },
              gridTemplateColumns: "1fr",
              alignItems: "end",
              minHeight: { xs: "auto", md: "calc(100svh - 135px)" },
            }}
          >
            <Stack
              spacing={{ xs: 3, md: 4 }}
              sx={{
                maxWidth: 900,
                justifyContent: "flex-end",
                pt: { md: 6 },
                pb: { md: 2.5 },
              }}
            >
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{
                  alignSelf: "flex-start",
                  px: 1.3,
                  py: 0.7,
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.12)",
                  backgroundColor: "rgba(20,14,11,0.36)",
                  backdropFilter: "blur(10px)",
                }}
              >
                <Box sx={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: ACCENT_COLOR, flexShrink: 0 }} />
                <Typography
                  variant="overline"
                  sx={{
                    color: "rgba(248,245,240,0.84)",
                    letterSpacing: "0.18em",
                  }}
                >
                  {copy.eyebrow}
                </Typography>
              </Stack>

              <Box>
                {heroLines.map((line, index) => (
                  <Typography
                    key={`${line.text}-${index}`}
                    component="div"
                    sx={{
                      fontFamily: DISPLAY_FONT_FAMILY,
                      fontSize: {
                        xs: "clamp(3.4rem, 15vw, 4.9rem)",
                        md: "clamp(6rem, 8vw, 8.8rem)",
                      },
                      lineHeight: { xs: 0.92, md: 0.88 },
                      letterSpacing: "-0.06em",
                      color: line.accent ? ACCENT_COLOR : "#f8f5f0",
                      fontStyle: line.italic ? "italic" : "normal",
                      pr: { md: 10 },
                      textShadow: "0 18px 42px rgba(0,0,0,0.22)",
                    }}
                  >
                    {line.text}
                  </Typography>
                ))}
              </Box>

              <Typography
                sx={{
                  maxWidth: 580,
                  color: "rgba(248,245,240,0.82)",
                  fontSize: { xs: "1rem", md: "1.22rem" },
                  lineHeight: 1.78,
                  textShadow: "0 10px 28px rgba(0,0,0,0.22)",
                }}
              >
                {heroData.lead}
              </Typography>

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <Button
                  component={Link}
                  to={heroPrimaryLink}
                  variant="contained"
                  disableElevation
                  endIcon={<ArrowForwardRounded />}
                  sx={{
                    minHeight: 58,
                    px: 3.2,
                    borderRadius: 999,
                    textTransform: "none",
                    fontWeight: 800,
                    fontSize: "1rem",
                    backgroundColor: ACCENT_COLOR,
                    boxShadow: `0 18px 40px ${alpha(ACCENT_COLOR, 0.34)}`,
                    "&:hover": {
                      backgroundColor: "#db7b3a",
                    },
                  }}
                >
                  {isLoggedIn ? copy.featuredSecondaryCta : copy.primaryCta}
                </Button>

                <Button
                  component={Link}
                  to={heroSecondaryLink}
                  variant="outlined"
                  sx={{
                    minHeight: 58,
                    px: 3.2,
                    borderRadius: 999,
                    textTransform: "none",
                    fontWeight: 700,
                    fontSize: "1rem",
                    color: "#f8f5f0",
                    borderColor: "rgba(255,255,255,0.18)",
                    backgroundColor: "rgba(255,255,255,0.04)",
                    "&:hover": {
                      borderColor: "rgba(255,255,255,0.34)",
                      backgroundColor: "rgba(255,255,255,0.08)",
                    },
                  }}
                >
                  {copy.secondaryCta}
                </Button>
              </Stack>
            </Stack>

            <Stack
              spacing={1.35}
              sx={{
                display: "none",
                minWidth: 0,
                justifyContent: "flex-end",
                mb: { md: 2.5 },
                maxWidth: { lg: 392 },
                ml: "auto",
              }}
            >
              <Box
                sx={{
                  position: "relative",
                  minHeight: { xs: 250, md: 315 },
                  p: { xs: 2.1, md: 2.4 },
                  borderRadius: { xs: 4.5, md: 5 },
                  border: `1px solid ${SURFACE_BORDER}`,
                  background: alpha("#110c0b", 0.52),
                  backdropFilter: "blur(18px)",
                  boxShadow: "0 28px 70px rgba(0,0,0,0.22)",
                }}
              >
                <Stack spacing={2.1} sx={{ position: "relative", zIndex: 1 }}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    spacing={1.2}
                  >
                    <Box
                      sx={{
                        display: "inline-flex",
                        alignSelf: "flex-start",
                        px: 1.3,
                        py: 0.65,
                        borderRadius: 999,
                        backgroundColor: "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.12)",
                      }}
                    >
                      <Typography
                        variant="overline"
                        sx={{
                          color: alpha(ACCENT_COLOR, 0.98),
                          letterSpacing: "0.16em",
                          fontWeight: 700,
                        }}
                      >
                        {nextTournament ? copy.nextEvent : copy.liveLabel}
                      </Typography>
                    </Box>

                    <Stack
                      direction="row"
                      spacing={0.75}
                      alignItems="center"
                      sx={{
                        alignSelf: "flex-start",
                        px: 1.1,
                        py: 0.7,
                        borderRadius: 999,
                        backgroundColor: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)",
                      }}
                    >
                      <PlaceRounded
                        sx={{ fontSize: 16, color: alpha(ACCENT_COLOR, 0.96) }}
                      />
                      <Typography
                        variant="caption"
                        sx={{ color: "rgba(248,245,240,0.72)" }}
                      >
                        {normalizeLocation(nextTournament) || copy.clubsFallback}
                      </Typography>
                    </Stack>
                  </Stack>

                  <Stack spacing={1.2}>
                    <Typography
                      sx={{
                        fontFamily: DISPLAY_FONT_FAMILY,
                        fontSize: { xs: "2rem", md: "3rem" },
                        lineHeight: { xs: 0.98, md: 0.94 },
                        letterSpacing: "-0.05em",
                        maxWidth: 420,
                      }}
                    >
                      {nextTournament?.name || copy.nextEventFallback}
                    </Typography>

                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={{ xs: 1, sm: 2 }}
                      divider={
                        <Divider
                          orientation="vertical"
                          flexItem
                          sx={{
                            borderColor: "rgba(255,255,255,0.1)",
                            display: { xs: "none", sm: "block" },
                          }}
                        />
                      }
                    >
                      <Stack direction="row" spacing={1} alignItems="center">
                        <CalendarMonthRounded
                          sx={{ fontSize: 18, color: alpha(ACCENT_COLOR, 0.96) }}
                        />
                        <Typography sx={{ color: "rgba(248,245,240,0.76)" }}>
                          {formatDateRange(
                            nextTournament?.startDate,
                            nextTournament?.endDate,
                            locale,
                          )}
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Groups2Rounded
                          sx={{ fontSize: 18, color: alpha(ACCENT_COLOR, 0.96) }}
                        />
                        <Typography sx={{ color: "rgba(248,245,240,0.76)" }}>
                          {formatCompactNumber(homeRes?.stats?.players || 0, locale)}{" "}
                          {t("home.stats.cards.players")}
                        </Typography>
                      </Stack>
                    </Stack>
                  </Stack>

                  <Typography
                    sx={{
                      maxWidth: 420,
                      color: "rgba(248,245,240,0.72)",
                      lineHeight: 1.75,
                    }}
                  >
                    {copy.featuredBody}
                  </Typography>
                </Stack>
              </Box>

              <Box
                sx={{
                  display: "grid",
                  gap: { xs: 1.2, md: 1.4 },
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "repeat(3, minmax(0, 1fr))",
                  },
                }}
              >
                {heroSpotlightStats.map((item) => (
                  <Box
                    key={`hero-${item.key}`}
                    sx={{
                      p: { xs: 1.5, md: 1.8 },
                      borderRadius: { xs: 3.4, md: 4 },
                      border: `1px solid ${SURFACE_BORDER}`,
                      background: "rgba(255,255,255,0.05)",
                      backdropFilter: "blur(10px)",
                    }}
                  >
                    <Stack spacing={0.8}>
                      <Typography
                        sx={{
                          fontFamily: DISPLAY_FONT_FAMILY,
                          fontSize: { xs: "1.65rem", md: "2rem" },
                          lineHeight: 0.94,
                        }}
                      >
                        {formatCompactNumber(item?.value || 0, locale)}
                      </Typography>
                      <Typography
                        variant="overline"
                        sx={{
                          color: "rgba(248,245,240,0.58)",
                          letterSpacing: "0.16em",
                        }}
                      >
                        {item?.label}
                      </Typography>
                    </Stack>
                  </Box>
                ))}
              </Box>
            </Stack>
          </Box>
        </Container>

        <Box
          sx={{
            position: "relative",
            zIndex: 2,
            borderTop: "1px solid rgba(255,255,255,0.08)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            background:
              "linear-gradient(90deg, rgba(30,20,14,0.96), rgba(22,18,19,0.9) 52%, rgba(30,20,14,0.96))",
            backdropFilter: "blur(18px)",
          }}
        >
          <Container
            maxWidth={false}
            sx={{
              maxWidth: "1440px",
              px: { xs: 2, md: 4, xl: 6 },
              py: { xs: 2.4, md: 3.2 },
            }}
          >
            <Box
              sx={{
                display: "grid",
                gap: { xs: 2.5, md: 3 },
                gridTemplateColumns: {
                  xs: "1fr",
                  lg: "minmax(0, 1.2fr) repeat(4, minmax(0, 0.38fr)) minmax(0, 0.8fr)",
                },
                alignItems: "center",
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: ACCENT_COLOR, flexShrink: 0 }} />
                <Typography
                  variant="overline"
                  sx={{
                    color: alpha(ACCENT_COLOR, 0.96),
                    letterSpacing: "0.18em",
                    fontWeight: 700,
                  }}
                >
                  {copy.nextEvent} — {nextTournament?.name || copy.nextEventFallback}
                </Typography>
              </Stack>

              {[
                {
                  key: "days",
                  label: isEnglish ? "Days" : "Ngày",
                  value: countdownParts.days,
                },
                {
                  key: "hours",
                  label: isEnglish ? "Hours" : "Giờ",
                  value: countdownParts.hours,
                },
                {
                  key: "minutes",
                  label: isEnglish ? "Min" : "Phút",
                  value: countdownParts.minutes,
                },
                {
                  key: "seconds",
                  label: isEnglish ? "Sec" : "Giây",
                  value: countdownParts.seconds,
                },
              ].map((item) => (
                <Stack
                  key={item.key}
                  spacing={0.4}
                  alignItems={{ xs: "flex-start", lg: "center" }}
                >
                  <Typography
                    sx={{
                      fontFamily: DISPLAY_FONT_FAMILY,
                      fontSize: { xs: "2.3rem", md: "3.4rem" },
                      lineHeight: 0.95,
                      color: "#f8f5f0",
                    }}
                  >
                    {padCountdown(item.value)}
                  </Typography>
                  <Typography
                    variant="overline"
                    sx={{
                      color: "rgba(248,245,240,0.58)",
                      letterSpacing: "0.18em",
                    }}
                  >
                    {item.label}
                  </Typography>
                </Stack>
              ))}

              <Stack alignItems={{ xs: "flex-start", lg: "flex-end" }}>
                <Button
                  component={Link}
                  to={nextTournament?._id ? `/tournament/${nextTournament._id}` : "/pickle-ball/tournaments"}
                  endIcon={<ArrowForwardRounded />}
                  sx={{
                    color: ACCENT_COLOR,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    fontWeight: 800,
                    p: 0,
                    "&:hover": {
                      backgroundColor: "transparent",
                      color: "#db7b3a",
                    },
                  }}
                >
                  {copy.registerNow}
                </Button>
              </Stack>
            </Box>
          </Container>
        </Box>
      </Box>

      <Container
        maxWidth={false}
        sx={{
          maxWidth: "1440px",
          px: { xs: 2, md: 4, xl: 6 },
          py: { xs: 6, md: 9 },
        }}
      >
        <Stack spacing={{ xs: 5, md: 8 }}>
          <Box
            sx={{
              display: "grid",
              gap: { xs: 2, md: 3 },
              gridTemplateColumns: {
                xs: "1fr",
                lg: "minmax(0, 0.95fr) minmax(0, 1.05fr)",
              },
              alignItems: "start",
            }}
          >
            <Stack spacing={1.5} sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box sx={{ width: 40, height: 2, backgroundColor: ACCENT_COLOR, borderRadius: 1 }} />
                <Typography
                  variant="overline"
                  sx={{
                    color: alpha(ACCENT_COLOR, 0.96),
                    letterSpacing: "0.18em",
                    fontWeight: 700,
                  }}
                >
                  {copy.seasonData}
                </Typography>
              </Stack>
              <Typography
                sx={{
                  fontFamily: DISPLAY_FONT_FAMILY,
                  fontSize: { xs: "2.4rem", md: "4.2rem" },
                  lineHeight: { xs: 1, md: 0.96 },
                  letterSpacing: "-0.05em",
                }}
              >
                {copy.seasonTitle}
              </Typography>
            </Stack>

            <Typography
              sx={{
                color: "rgba(248,245,240,0.72)",
                fontSize: { xs: "1rem", md: "1.08rem" },
                lineHeight: 1.85,
                maxWidth: 760,
              }}
            >
              {copy.seasonBody}
            </Typography>
          </Box>

          <Box
            sx={{
              display: "grid",
              gap: { xs: 2, md: 2.5 },
              gridTemplateColumns: {
                xs: "repeat(2, minmax(0, 1fr))",
                lg: "1fr 1fr 1fr",
              },
            }}
          >
            {copy.seasonStats.map((item, index) => {
              const stat = stats[index];
              const isLarge = index === 0;
              const isAccent = index === 2;

              return (
                <Box
                  key={item.key}
                  sx={{
                    p: isLarge ? { xs: 2.5, md: 3.5 } : { xs: 2.2, md: 2.8 },
                    borderRadius: { xs: 4, md: 5 },
                    border: `1px solid ${SURFACE_BORDER}`,
                    background: isAccent
                      ? `linear-gradient(135deg, ${alpha(ACCENT_COLOR, 0.28)}, ${alpha(ACCENT_COLOR, 0.1)})`
                      : SURFACE_BG,
                    boxShadow: "0 24px 54px rgba(0,0,0,0.18)",
                    ...(isLarge && { gridRow: { lg: "1 / 3" } }),
                    ...(index === 1 && { gridColumn: { lg: "2 / 4" } }),
                  }}
                >
                  <Stack spacing={1.5} sx={{ height: "100%", justifyContent: isLarge ? "flex-end" : "flex-start" }}>
                    <Typography
                      variant="overline"
                      sx={{
                        color: alpha(ACCENT_COLOR, 0.96),
                        letterSpacing: "0.16em",
                        fontWeight: 700,
                      }}
                    >
                      {stat?.label}
                    </Typography>
                    <Typography
                      sx={{
                        fontFamily: DISPLAY_FONT_FAMILY,
                        fontSize: isLarge
                          ? { xs: "4rem", md: "7rem" }
                          : { xs: "2.2rem", md: "3.1rem" },
                        lineHeight: 1,
                      }}
                    >
                      {formatCompactNumber(stat?.value || 0, locale)}
                    </Typography>
                  </Stack>
                </Box>
              );
            })}
          </Box>

          <Box
            sx={{
              display: "grid",
              gap: { xs: 2.2, md: 2.5 },
              gridTemplateColumns: {
                xs: "1fr",
                lg: "minmax(0, 1.35fr) minmax(0, 0.65fr)",
              },
            }}
          >
            <Stack spacing={1.4} sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box sx={{ width: 40, height: 2, backgroundColor: ACCENT_COLOR, borderRadius: 1 }} />
                <Typography
                  variant="overline"
                  sx={{
                    color: alpha(ACCENT_COLOR, 0.96),
                    letterSpacing: "0.18em",
                    fontWeight: 700,
                  }}
                >
                  {copy.featuredEyebrow}
                </Typography>
              </Stack>
              <Typography
                sx={{
                  fontFamily: DISPLAY_FONT_FAMILY,
                  fontSize: { xs: "2.2rem", md: "3.8rem" },
                  lineHeight: { xs: 1.02, md: 0.98 },
                  letterSpacing: "-0.05em",
                }}
              >
                {copy.featuredTitle}
              </Typography>
              <Typography
                sx={{
                  color: "rgba(248,245,240,0.72)",
                  lineHeight: 1.8,
                  maxWidth: 760,
                }}
              >
                {copy.featuredBody}
              </Typography>
            </Stack>

            <Stack
              direction={{ xs: "column", sm: "row", lg: "column" }}
              spacing={1.2}
              alignItems={{ xs: "stretch", lg: "flex-end" }}
              justifyContent="flex-end"
            >
              <Button
                component={Link}
                to="/pickle-ball/tournaments"
                variant="outlined"
                sx={{
                  minHeight: 52,
                  px: 2.8,
                  borderRadius: 999,
                  color: "#f8f5f0",
                  borderColor: "rgba(255,255,255,0.18)",
                }}
              >
                {copy.featuredSecondaryCta}
              </Button>
            </Stack>
          </Box>

          <Box
            sx={{
              display: "grid",
              gap: { xs: 2.2, md: 2.5 },
              gridTemplateColumns: {
                xs: "1fr",
                lg: "minmax(0, 1.15fr) minmax(0, 0.85fr)",
              },
            }}
          >
            <Box
              sx={{
                position: "relative",
                minHeight: { xs: 360, md: 470 },
                p: { xs: 2.5, md: 3.2 },
                borderRadius: { xs: 5, md: 6 },
                overflow: "hidden",
                border: `1px solid ${SURFACE_BORDER}`,
                backgroundImage: [
                  "linear-gradient(180deg, rgba(8, 9, 12, 0.16), rgba(8, 9, 12, 0.84))",
                  "linear-gradient(120deg, rgba(20, 14, 11, 0.76), rgba(13, 14, 18, 0.48))",
                  `url(${nextTournament?.image || ""})`,
                  `url(${heroBackdropUrl})`,
                ].join(", "),
                backgroundSize: "cover",
                backgroundPosition: "center",
                boxShadow: "0 32px 80px rgba(0,0,0,0.24)",
              }}
            >
              <Stack
                justifyContent="space-between"
                sx={{ position: "relative", zIndex: 1, minHeight: "100%" }}
              >
                <Stack direction="row" justifyContent="space-between" spacing={2}>
                  <Box
                    sx={{
                      display: "inline-flex",
                      alignSelf: "flex-start",
                      px: 1.3,
                      py: 0.7,
                      borderRadius: 999,
                      backgroundColor: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    <Typography
                      variant="overline"
                      sx={{
                        color: alpha(ACCENT_COLOR, 0.98),
                        letterSpacing: "0.16em",
                        fontWeight: 700,
                      }}
                    >
                      {nextTournament ? copy.nextEvent : copy.liveLabel}
                    </Typography>
                  </Box>
                </Stack>

                <Stack spacing={2} sx={{ maxWidth: 680 }}>
                  <Stack spacing={1.1}>
                    <Typography
                      sx={{
                        fontFamily: DISPLAY_FONT_FAMILY,
                        fontSize: { xs: "2.2rem", md: "4rem" },
                        lineHeight: { xs: 0.98, md: 0.94 },
                        letterSpacing: "-0.05em",
                      }}
                    >
                      {nextTournament?.name || heroData.title}
                    </Typography>

                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={{ xs: 1, sm: 2 }}
                      divider={
                        <Divider
                          orientation="vertical"
                          flexItem
                          sx={{
                            borderColor: "rgba(255,255,255,0.1)",
                            display: { xs: "none", sm: "block" },
                          }}
                        />
                      }
                    >
                      <Stack direction="row" spacing={1} alignItems="center">
                        <CalendarMonthRounded
                          sx={{ fontSize: 18, color: alpha(ACCENT_COLOR, 0.96) }}
                        />
                        <Typography sx={{ color: "rgba(248,245,240,0.76)" }}>
                          {formatDateRange(
                            nextTournament?.startDate,
                            nextTournament?.endDate,
                            locale,
                          )}
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <PlaceRounded
                          sx={{ fontSize: 18, color: alpha(ACCENT_COLOR, 0.96) }}
                        />
                        <Typography sx={{ color: "rgba(248,245,240,0.76)" }}>
                          {normalizeLocation(nextTournament) || copy.clubsFallback}
                        </Typography>
                      </Stack>
                    </Stack>
                  </Stack>

                  <Typography
                    sx={{
                      maxWidth: 560,
                      color: "rgba(248,245,240,0.78)",
                      lineHeight: 1.8,
                    }}
                  >
                    {copy.capabilitiesBody}
                  </Typography>

                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.3}>
                    <Button
                      component={Link}
                      to={nextTournament?._id ? `/tournament/${nextTournament._id}` : "/pickle-ball/tournaments"}
                      variant="contained"
                      endIcon={<ArrowForwardRounded />}
                      sx={{
                        minHeight: 56,
                        px: 3,
                        borderRadius: 999,
                        textTransform: "none",
                        fontWeight: 800,
                        backgroundColor: ACCENT_COLOR,
                      }}
                    >
                      {copy.featuredPrimaryCta}
                    </Button>
                    <Button
                      component={Link}
                      to="/pickle-ball/tournaments"
                      variant="outlined"
                      sx={{
                        minHeight: 56,
                        px: 3,
                        borderRadius: 999,
                        color: "#f8f5f0",
                        borderColor: "rgba(255,255,255,0.2)",
                        textTransform: "none",
                        fontWeight: 700,
                      }}
                    >
                      {copy.featuredSecondaryCta}
                    </Button>
                  </Stack>
                </Stack>
              </Stack>
            </Box>

            <Stack spacing={2.2}>
              {featuredTournaments.slice(1).map((item, index) => (
                <Box
                  key={item?._id || `tournament-${index}`}
                  sx={{
                    position: "relative",
                    overflow: "hidden",
                    minHeight: { xs: 220, md: 232 },
                    p: { xs: 2.2, md: 2.5 },
                    borderRadius: { xs: 4.5, md: 5 },
                    border: `1px solid ${SURFACE_BORDER}`,
                    backgroundImage: [
                      "linear-gradient(180deg, rgba(8,9,12,0.12), rgba(8,9,12,0.92))",
                      "linear-gradient(140deg, rgba(20,14,11,0.18), rgba(12,14,18,0.28))",
                      `url(${item?.image || ""})`,
                      `url(${heroBackdropUrl})`,
                    ].join(", "),
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    boxShadow: "0 20px 48px rgba(0,0,0,0.18)",
                  }}
                >
                  <Stack spacing={1.6}>
                    <Stack direction="row" justifyContent="space-between" spacing={1.5}>
                      <Typography
                        variant="overline"
                        sx={{
                          color: alpha(ACCENT_COLOR, 0.96),
                          letterSpacing: "0.16em",
                          fontWeight: 700,
                        }}
                      >
                        {item?.status || copy.liveLabel}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: "rgba(248,245,240,0.52)" }}
                      >
                        {formatDateRange(item?.startDate, item?.endDate, locale)}
                      </Typography>
                    </Stack>

                    <Typography
                      sx={{
                        fontFamily: DISPLAY_FONT_FAMILY,
                        fontSize: { xs: "1.8rem", md: "2.3rem" },
                        lineHeight: 1,
                        letterSpacing: "-0.04em",
                      }}
                    >
                      {item?.name}
                    </Typography>

                    <Stack direction="row" spacing={1} alignItems="center">
                      <PlaceRounded sx={{ fontSize: 18, color: alpha(ACCENT_COLOR, 0.96) }} />
                      <Typography sx={{ color: "rgba(248,245,240,0.72)" }}>
                        {normalizeLocation(item) || copy.clubsFallback}
                      </Typography>
                    </Stack>

                    <Button
                      component={Link}
                      to={item?._id ? `/tournament/${item._id}` : "/pickle-ball/tournaments"}
                      endIcon={<ArrowForwardRounded />}
                      sx={{
                        alignSelf: "flex-start",
                        color: "#f8f5f0",
                        textTransform: "none",
                        fontWeight: 700,
                        px: 0,
                        "&:hover": {
                          backgroundColor: "transparent",
                          color: ACCENT_COLOR,
                        },
                      }}
                    >
                      {copy.featuredPrimaryCta}
                    </Button>
                  </Stack>
                </Box>
              ))}
            </Stack>
          </Box>

          <Box
            sx={{
              display: "grid",
              gap: { xs: 2.2, md: 2.8 },
              gridTemplateColumns: {
                xs: "1fr",
                lg: "minmax(0, 0.92fr) minmax(0, 1.08fr)",
              },
              alignItems: "start",
            }}
          >
            <Stack spacing={1.4} sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box sx={{ width: 40, height: 2, backgroundColor: ACCENT_COLOR, borderRadius: 1 }} />
                <Typography
                  variant="overline"
                  sx={{
                    color: alpha(ACCENT_COLOR, 0.96),
                    letterSpacing: "0.18em",
                    fontWeight: 700,
                  }}
                >
                  {copy.capabilitiesEyebrow}
                </Typography>
              </Stack>
              <Typography
                sx={{
                  fontFamily: DISPLAY_FONT_FAMILY,
                  fontSize: { xs: "2.3rem", md: "3.7rem" },
                  lineHeight: { xs: 1.02, md: 0.98 },
                  letterSpacing: "-0.05em",
                }}
              >
                {copy.capabilitiesTitle}
              </Typography>
              <Typography
                sx={{
                  color: "rgba(248,245,240,0.72)",
                  lineHeight: 1.8,
                  maxWidth: 640,
                }}
              >
                {copy.capabilitiesBody}
              </Typography>
            </Stack>

            <Box
              sx={{
                display: "grid",
                gap: { xs: 2, md: 2.2 },
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(2, minmax(0, 1fr))",
                  xl: "repeat(3, minmax(0, 1fr))",
                },
              }}
            >
              {(Array.isArray(featureItems) ? featureItems : []).map((item, index) => (
                <Box
                  key={`${item?.title || "feature"}-${index}`}
                  sx={{
                    p: { xs: 2.2, md: 2.5 },
                    borderRadius: { xs: 4.5, md: 5 },
                    border: `1px solid ${SURFACE_BORDER}`,
                    background: SURFACE_BG,
                    boxShadow: "0 18px 44px rgba(0,0,0,0.16)",
                  }}
                >
                  <Stack spacing={1.7}>
                    <Box
                      sx={{
                        width: 42,
                        height: 42,
                        borderRadius: "50%",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: alpha(ACCENT_COLOR, 0.14),
                        color: ACCENT_COLOR,
                      }}
                    >
                      <QueryStatsRounded sx={{ fontSize: 20 }} />
                    </Box>

                    <Typography variant="h6" fontWeight={800}>
                      {item?.title}
                    </Typography>
                    <Typography sx={{ color: "rgba(248,245,240,0.68)", lineHeight: 1.75 }}>
                      {item?.desc}
                    </Typography>
                  </Stack>
                </Box>
              ))}
            </Box>
          </Box>

          <Box
            sx={{
              display: "grid",
              gap: { xs: 2.2, md: 2.5 },
              gridTemplateColumns: {
                xs: "1fr",
                lg: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
              },
              alignItems: "start",
            }}
          >
            <Stack spacing={1.4} sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box sx={{ width: 40, height: 2, backgroundColor: ACCENT_COLOR, borderRadius: 1 }} />
                <Typography
                  variant="overline"
                  sx={{
                    color: alpha(ACCENT_COLOR, 0.96),
                    letterSpacing: "0.18em",
                    fontWeight: 700,
                  }}
                >
                  {copy.clubsEyebrow}
                </Typography>
              </Stack>
              <Typography
                sx={{
                  fontFamily: DISPLAY_FONT_FAMILY,
                  fontSize: { xs: "2.3rem", md: "3.7rem" },
                  lineHeight: { xs: 1.02, md: 0.98 },
                  letterSpacing: "-0.05em",
                }}
              >
                {copy.clubsTitle}
              </Typography>
              <Typography
                sx={{
                  color: "rgba(248,245,240,0.72)",
                  lineHeight: 1.8,
                  maxWidth: 620,
                }}
              >
                {copy.clubsBody}
              </Typography>
            </Stack>

            <Box
              sx={{
                display: "grid",
                gap: { xs: 2, md: 2.2 },
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(3, minmax(0, 1fr))",
                },
              }}
            >
              {clubs.map((club, index) => {
                const imageUrl = club?.coverUrl || club?.logoUrl || fallbackImg;
                const clubName = club?.name || `Club ${index + 1}`;
                const clubHref = club?.id ? `/clubs/${club.id}` : "/clubs";
                const memberText = clubMembersLabel.replace(
                  "{count}",
                  formatCompactNumber(club?.memberCount || 0, locale),
                );

                return (
                  <Box
                    key={club?.id || `club-${index}`}
                    sx={{
                      position: "relative",
                      minHeight: 310,
                      p: 1,
                      borderRadius: { xs: 4.5, md: 5 },
                      border: `1px solid ${SURFACE_BORDER}`,
                      background: SURFACE_BG,
                      boxShadow: "0 20px 48px rgba(0,0,0,0.18)",
                    }}
                  >
                    <Box
                      sx={{
                        position: "relative",
                        minHeight: "100%",
                        borderRadius: 4,
                        overflow: "hidden",
                        backgroundImage: [
                          "linear-gradient(180deg, rgba(8,9,12,0.18), rgba(8,9,12,0.82))",
                          "linear-gradient(135deg, rgba(20,14,11,0.42), rgba(11,15,22,0.28))",
                          `url(${imageUrl})`,
                        ].join(", "),
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    >
                      <Stack
                        justifyContent="space-between"
                        sx={{ position: "relative", zIndex: 1, minHeight: "100%", p: 2.2 }}
                      >
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                          <Avatar
                            src={club?.logoUrl || ""}
                            alt={clubName}
                            sx={{
                              width: 50,
                              height: 50,
                              bgcolor: "rgba(255,255,255,0.14)",
                              color: "#f8f5f0",
                              fontWeight: 800,
                            }}
                          >
                            {clubName.charAt(0).toUpperCase()}
                          </Avatar>

                          <Box
                            sx={{
                              px: 1,
                              py: 0.45,
                              borderRadius: 999,
                              backgroundColor: "rgba(255,255,255,0.08)",
                              border: "1px solid rgba(255,255,255,0.12)",
                            }}
                          >
                            <Typography
                              variant="caption"
                              sx={{ color: alpha(ACCENT_COLOR, 0.96), fontWeight: 700 }}
                            >
                              {club?.verified ? "Verified" : copy.liveLabel}
                            </Typography>
                          </Box>
                        </Stack>

                        <Stack spacing={1}>
                          <Typography variant="h5" fontWeight={800}>
                            {clubName}
                          </Typography>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <PlaceRounded
                              sx={{ fontSize: 18, color: alpha(ACCENT_COLOR, 0.96) }}
                            />
                            <Typography sx={{ color: "rgba(248,245,240,0.76)" }}>
                              {club?.location || copy.clubsFallback}
                            </Typography>
                          </Stack>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Groups2Rounded
                              sx={{ fontSize: 18, color: alpha(ACCENT_COLOR, 0.96) }}
                            />
                            <Typography sx={{ color: "rgba(248,245,240,0.76)" }}>
                              {memberText}
                            </Typography>
                          </Stack>
                          <Button
                            component={Link}
                            to={clubHref}
                            endIcon={<ArrowForwardRounded />}
                            sx={{
                              alignSelf: "flex-start",
                              mt: 0.6,
                              color: "#f8f5f0",
                              fontWeight: 700,
                              px: 0,
                              textTransform: "none",
                              "&:hover": {
                                backgroundColor: "transparent",
                                color: ACCENT_COLOR,
                              },
                            }}
                          >
                            {copy.viewClub}
                          </Button>
                        </Stack>
                      </Stack>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>

          <Box
            sx={{
              p: { xs: 2.8, md: 4 },
              borderRadius: { xs: 5, md: 6 },
              border: `1px solid ${SURFACE_BORDER}`,
              background:
                "linear-gradient(135deg, rgba(203,107,47,0.24), rgba(34,26,22,0.88) 36%, rgba(13,16,21,0.94) 100%)",
              boxShadow: `0 28px 70px ${alpha("#000000", 0.24)}`,
            }}
          >
            <Box
              sx={{
                display: "grid",
                gap: { xs: 2.5, md: 3 },
                gridTemplateColumns: {
                  xs: "1fr",
                  lg: "minmax(0, 1fr) auto",
                },
                alignItems: "center",
              }}
            >
              <Stack spacing={1.4} sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontFamily: DISPLAY_FONT_FAMILY,
                    fontSize: { xs: "2.2rem", md: "3.6rem" },
                    lineHeight: { xs: 1.02, md: 0.96 },
                    letterSpacing: "-0.05em",
                  }}
                >
                  {copy.ctaTitle}
                </Typography>
                <Typography
                  sx={{
                    maxWidth: 760,
                    color: "rgba(248,245,240,0.76)",
                    lineHeight: 1.8,
                  }}
                >
                  {copy.ctaBody}
                </Typography>
              </Stack>

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
                <Button
                  component={Link}
                  to="/pickle-ball/tournaments"
                  variant="contained"
                  endIcon={<ArrowForwardRounded />}
                  sx={{
                    minHeight: 56,
                    px: 3,
                    borderRadius: 999,
                    textTransform: "none",
                    fontWeight: 800,
                    backgroundColor: ACCENT_COLOR,
                  }}
                >
                  {copy.ctaPrimary}
                </Button>
                <Button
                  component={Link}
                  to="/clubs"
                  variant="outlined"
                  sx={{
                    minHeight: 56,
                    px: 3,
                    borderRadius: 999,
                    color: "#f8f5f0",
                    borderColor: "rgba(255,255,255,0.2)",
                    textTransform: "none",
                    fontWeight: 700,
                  }}
                >
                  {copy.ctaSecondary}
                </Button>
              </Stack>
            </Box>
          </Box>
        </Stack>
      </Container>

      <Box
        component="footer"
        sx={{
          borderTop: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(8, 10, 14, 0.62)",
        }}
      >
        <Container
          maxWidth={false}
          sx={{
            maxWidth: "1440px",
            px: { xs: 2, md: 4, xl: 6 },
            py: { xs: 3.5, md: 4.2 },
            pb: { xs: 10, md: 10 },
          }}
        >
          <Box
            sx={{
              display: "grid",
              gap: { xs: 3, md: 4 },
              gridTemplateColumns: {
                xs: "1fr",
                md: "minmax(0, 1.2fr) repeat(2, minmax(0, 0.55fr))",
              },
            }}
          >
            <Stack spacing={1.25} sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 800, letterSpacing: "0.16em" }}>
                PICKLETOUR
              </Typography>
              <Typography sx={{ color: "rgba(248,245,240,0.62)", maxWidth: 420 }}>
                {copy.footerBlurb}
              </Typography>
            </Stack>

            <Stack spacing={1}>
              <Typography
                variant="overline"
                sx={{ color: "rgba(248,245,240,0.52)", letterSpacing: "0.16em" }}
              >
                {copy.footerLinksTitle}
              </Typography>
              {footerLinks.map((item) => (
                <Typography
                  key={item.to}
                  component={Link}
                  to={item.to}
                  sx={{
                    color: "#f8f5f0",
                    textDecoration: "none",
                    fontWeight: 600,
                    "&:hover": {
                      color: ACCENT_COLOR,
                    },
                  }}
                >
                  {item.label}
                </Typography>
              ))}
            </Stack>

            <Stack spacing={1}>
              <Typography
                variant="overline"
                sx={{ color: "rgba(248,245,240,0.52)", letterSpacing: "0.16em" }}
              >
                {copy.footerLegalTitle}
              </Typography>
              {footerLegalLinks.map((item) => (
                <Typography
                  key={item.to}
                  component={Link}
                  to={item.to}
                  sx={{
                    color: "#f8f5f0",
                    textDecoration: "none",
                    fontWeight: 600,
                    "&:hover": {
                      color: ACCENT_COLOR,
                    },
                  }}
                >
                  {item.label}
                </Typography>
              ))}
            </Stack>
          </Box>
        </Container>
      </Box>

      {/* Sticky bottom bar */}
      <Box
        sx={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1200,
          borderTop: `1px solid ${SURFACE_BORDER}`,
          background: "rgba(12, 10, 10, 0.88)",
          backdropFilter: "blur(18px)",
        }}
      >
        <Container
          maxWidth={false}
          sx={{
            maxWidth: "1440px",
            px: { xs: 2, md: 4, xl: 6 },
            py: { xs: 1.2, md: 1.5 },
          }}
        >
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            spacing={2}
          >
            <Stack spacing={0.2} sx={{ minWidth: 0 }}>
              <Typography
                variant="overline"
                sx={{
                  color: "rgba(248,245,240,0.52)",
                  letterSpacing: "0.14em",
                  fontSize: "0.7rem",
                }}
              >
                {nextTournament?.name || copy.nextEventFallback} · {formatDateRange(nextTournament?.startDate, nextTournament?.endDate, locale)}
              </Typography>
              <Typography
                sx={{
                  color: "rgba(248,245,240,0.76)",
                  fontWeight: 700,
                  fontSize: { xs: "0.82rem", md: "0.88rem" },
                }}
              >
                {formatCompactNumber(homeRes?.stats?.players || 0, locale)} {t("home.stats.cards.players")} — {isEnglish ? "early registration active" : "đăng ký sớm đang mở"}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ display: { xs: "none", md: "flex" }, flexShrink: 0 }}>
              <Button
                component={Link}
                to="/pickle-ball/tournaments"
                sx={{
                  color: "rgba(248,245,240,0.72)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  fontWeight: 700,
                  fontSize: "0.78rem",
                  whiteSpace: "nowrap",
                }}
              >
                {copy.featuredSecondaryCta}
              </Button>
              <Button
                component={Link}
                to={heroPrimaryLink}
                variant="contained"
                disableElevation
                startIcon={<Box sx={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "#fff" }} />}
                sx={{
                  minHeight: 42,
                  px: 2.4,
                  borderRadius: 999,
                  textTransform: "none",
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                  backgroundColor: ACCENT_COLOR,
                  "&:hover": {
                    backgroundColor: "#db7b3a",
                  },
                }}
              >
                {isLoggedIn ? copy.featuredSecondaryCta : copy.primaryCta}
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
