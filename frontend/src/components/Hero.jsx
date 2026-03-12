// src/components/Hero.jsx
import { useMemo } from "react";
import { Container, Row, Col, Button, Card, Badge } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useGetLatestAssessmentQuery } from "../slices/assessmentsApiSlice";
import {
  useGetHeroContentQuery,
  useGetContactContentQuery,
} from "../slices/cmsApiSlice";
import { useGetHomeSummaryQuery } from "../slices/homeApiSlice";
import AppInstallBanner from "./AppInstallBanner";
import SponsorMarquee from "./SponsorMarquee";
import SEOHead from "./SEOHead";
import { useTheme } from "@mui/material/styles";
import { useThemeMode } from "../context/ThemeContext.jsx";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import PeopleAltIcon from "@mui/icons-material/PeopleAlt";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import HomeWorkIcon from "@mui/icons-material/HomeWork";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import HandshakeIcon from "@mui/icons-material/Handshake";
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import LocationOnIcon from "@mui/icons-material/LocationOn";

// ===== Assets & Fallbacks =====
const fallbackImg = `${import.meta.env.BASE_URL}hero.jpg`;
const APPSTORE_BADGE = `${import.meta.env.BASE_URL}app-store-badge.svg`;
const PLAY_BADGE = `${import.meta.env.BASE_URL}google-play-badge.svg`;

const HERO_FALLBACK = {
  title: "Kết nối cộng đồng & quản lý giải đấu thể thao",
  lead: "PickleTour giúp bạn đăng ký, tổ chức, theo dõi điểm trình và cập nhật bảng xếp hạng cho mọi môn thể thao – ngay trên điện thoại.",
  imageUrl: fallbackImg,
  imageAlt: "PickleTour — Kết nối cộng đồng & quản lý giải đấu",
};

const CONTACT_FALLBACK = {
  address: "Abcd, abcd, abcd",
  phone: "012345678",
  email: "support@pickletour.vn",
  support: {
    generalEmail: "support@pickletour.vn",
    generalPhone: "0123456789",
    scoringEmail: "support@pickletour.vn",
    scoringPhone: "0123456789",
    salesEmail: "support@pickletour.vn",
  },
  socials: {
    facebook: "https://facebook.com",
    youtube: "https://youtube.com",
    zalo: "#",
  },
  apps: {
    appStore: "",
    playStore: "",
    apkPickleTour: "",
    apkReferee: "",
  },
};

const CLUB_COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD"];


// ===== Styled Components =====

const animatedGradientText = {
  background: "linear-gradient(to right, #00C9FF 0%, #92FE9D 25%, #00C9FF 50%, #92FE9D 75%, #00C9FF 100%)",
  backgroundSize: "400% auto",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
  animation: "shine 4s linear infinite",
};

const floatingAnimation = `
  @keyframes float {
    0% { transform: translateY(0px) rotate(0deg); }
    33% { transform: translateY(-20px) rotate(5deg); }
    66% { transform: translateY(10px) rotate(-5deg); }
    100% { transform: translateY(0px) rotate(0deg); }
  }
  @keyframes floatReverse {
    0% { transform: translateY(0px) rotate(0deg); }
    33% { transform: translateY(20px) rotate(-5deg); }
    66% { transform: translateY(-10px) rotate(5deg); }
    100% { transform: translateY(0px) rotate(0deg); }
  }
  @keyframes shine {
    to { background-position: 400% center; }
  }
  @keyframes pulseGlow {
    0% { box-shadow: 0 0 0 0 rgba(13, 110, 253, 0.4); }
    70% { box-shadow: 0 0 0 15px rgba(13, 110, 253, 0); }
    100% { box-shadow: 0 0 0 0 rgba(13, 110, 253, 0); }
  }
  @keyframes gradientBorder {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  @keyframes panBackground {
    0% { background-position: 0% 0%; }
    100% { background-position: 100% 100%; }
  }
  
  .premium-btn {
    position: relative;
    background: var(--btn-bg);
    border: none;
    border-radius: 50px;
    z-index: 1;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: var(--btn-shadow);
  }
  .premium-btn:hover {
    transform: translateY(-2px) scale(1.02);
    background: var(--btn-hover-bg);
    box-shadow: var(--btn-hover-shadow);
  }
`;

const SkeletonBar = ({ w = "100%", h = 20, r = 8, className = "" }) => (
  <div
    className={`placeholder-glow ${className}`}
    style={{ width: w, height: h, borderRadius: r }}
  >
    <span className="placeholder w-100 h-100 bg-secondary bg-opacity-10"></span>
  </div>
);

// ===== Icons =====
const Icon = ({ path, size = 20, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ verticalAlign: "text-bottom" }}
  >
    {path}
  </svg>
);
const ILocation = (p) => (
  <Icon
    {...p}
    path={
      <>
        <path d="M12 21s-6-5.33-6-10a6 6 0 1 1 12 0c0 4.67-6 10-6 10z" />
        <circle cx="12" cy="11" r="2.5" />
      </>
    }
  />
);
const IPhone = (p) => (
  <Icon
    {...p}
    path={
      <path d="M22 16.92v2a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 4.2 2 2 0 0 1 4.1 2h2a2 2 0 0 1 2 1.72c.12.9.33 1.77.63 2.6a2 2 0 0 1-.45 2.11L7.1 9.9a16 16 0 0 0 6 6l1.46-1.18a2 2 0 0 1 2.11-.45c.83.3 1.7.51 2.6.63A2 2 0 0 1 22 16.92z" />
    }
  />
);
const IEmail = (p) => (
  <Icon
    {...p}
    path={
      <>
        <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
        <path d="m22 6-10 7L2 6" />
      </>
    }
  />
);
const IFacebook = (p) => (
  <Icon
    {...p}
    path={
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3.5l.5-4H14V7a1 1 0 0 1 1-1h3z" />
    }
  />
);
const IYouTube = (p) => (
  <Icon
    {...p}
    path={
      <>
        <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-2C18.88 4 12 4 12 4s-6.88 0-8.59.42a2.78 2.78 0 0 0-1.95 2A29.94 29.94 0 0 0 1 12a29.94 29.94 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 2C5.12 20 12 20 12 20s6.88 0 8.59-.42a2.78 2.78 0 0 0 1.95-2A29.94 29.94 0 0 0 23 12a29.94 29.94 0 0 0-.46-5.58z" />
        <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" />
      </>
    }
  />
);
const IChat = (p) => (
  <Icon
    {...p}
    path={
      <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    }
  />
);
const IDownload = (p) => (
  <Icon
    {...p}
    path={
      <>
        <path d="M12 3v12" />
        <path d="m8 11 4 4 4-4" />
        <path d="M6 19h12" />
      </>
    }
  />
);

/* ======================= MAIN COMPONENT ======================= */
export default function Hero() {
  const { userInfo } = useSelector((state) => state.auth);
  const isLoggedIn = !!userInfo;
  const userId = userInfo?._id || userInfo?.id;
  const { isDark } = useThemeMode();
  const theme = useTheme();

  const { data: latest, isFetching } = useGetLatestAssessmentQuery(userId, {
    skip: !userId,
  });
  const {
    data: heroRes,
    isLoading: heroLoading,
    isError: heroError,
  } = useGetHeroContentQuery();
  const {
    data: contactRes,
    isLoading: contactLoading,
    isError: contactError,
  } = useGetContactContentQuery();
  const { data: homeRes, isLoading: homeLoading } = useGetHomeSummaryQuery({ clubsLimit: 6 });

  // ===== Data Logic =====
  const heroData = useMemo(() => {
    if (heroLoading) return null;
    if (heroError) return HERO_FALLBACK;
    const d = heroRes || {};
    return {
      title: d.title || HERO_FALLBACK.title,
      lead: d.lead || HERO_FALLBACK.lead,
      imageUrl: d.imageUrl || HERO_FALLBACK.imageUrl,
      imageAlt: d.imageAlt || HERO_FALLBACK.imageAlt,
    };
  }, [heroLoading, heroError, heroRes]);

  const contactInfo = useMemo(() => {
    if (contactLoading) return null;
    if (contactError) return CONTACT_FALLBACK;
    return { ...CONTACT_FALLBACK, ...(contactRes || {}) };
  }, [contactLoading, contactError, contactRes]);

  const needSelfAssess = useMemo(() => {
    if (!isLoggedIn || isFetching) return false;
    if (!latest) return true;
    const s = Number(latest.singleLevel || 0);
    const d = Number(latest.doubleLevel || 0);
    return s === 0 || d === 0;
  }, [isLoggedIn, isFetching, latest]);

  const needKyc =
    isLoggedIn && (userInfo?.cccdStatus || "unverified") !== "verified";

  const hasAppStore = !!contactInfo?.apps?.appStore;
  const hasPlayStore = !!contactInfo?.apps?.playStore;
  const hasApkPickleTour = !!contactInfo?.apps?.apkPickleTour;
  const hasApkReferee = !!contactInfo?.apps?.apkReferee;
  const glassCardStyle = {
    background: isDark ? "rgba(30, 30, 30, 0.8)" : "rgba(255, 255, 255, 0.9)",
    backdropFilter: "blur(10px)",
    border: isDark
      ? "1px solid rgba(255, 255, 255, 0.1)"
      : "1px solid rgba(255, 255, 255, 0.5)",
    boxShadow: isDark
      ? "0 10px 30px -5px rgba(0, 0, 0, 0.5)"
      : "0 10px 30px -5px rgba(0, 0, 0, 0.05)",
    color: isDark ? "#fff" : "inherit",
  };

  const numberFormatter = useMemo(() => new Intl.NumberFormat("vi-VN"), []);

  const formatCountPlus = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "0";
    return `${numberFormatter.format(n)}+`;
  };

  const statsList = homeRes?.stats
    ? [
        {
          number: formatCountPlus(homeRes.stats.players),
          label: "Người chơi",
          icon: <PeopleAltIcon sx={{ fontSize: "2.5rem" }} />,
        },
        {
          number: formatCountPlus(homeRes.stats.tournaments),
          label: "Giải đấu",
          icon: <EmojiEventsIcon sx={{ fontSize: "2.5rem" }} />,
        },
        {
          number: formatCountPlus(homeRes.stats.matches),
          label: "Trận đấu",
          icon: <SportsTennisIcon sx={{ fontSize: "2.5rem" }} />,
        },
        {
          number: formatCountPlus(homeRes.stats.clubs),
          label: "CLB Pickleball",
          icon: <HomeWorkIcon sx={{ fontSize: "2.5rem" }} />,
        },
      ]
    : null;

  const clubsList = Array.isArray(homeRes?.clubs)
    ? homeRes.clubs.map((club, idx) => ({
        id: club.id || club._id || club.slug || idx,
        name: club.name || "CLB",
        location: club.location || "-",
        members: formatCountPlus(club.memberCount),
        color: CLUB_COLORS[idx % CLUB_COLORS.length],
      }))
    : [];


  return (
    <>
      <style>{floatingAnimation}</style>
      <SEOHead
        path="/"
        description="Pickletour.vn - Nền tảng kết nối cộng đồng thể thao, quản lý giải đấu, theo dõi điểm trình và bảng xếp hạng Pickleball Việt Nam."
        keywords="pickleball, giải đấu, bảng xếp hạng, điểm trình, thể thao, cộng đồng"
      />
      {/* ======= Smart install banner (Mobile Only) ======= */}
      {contactInfo?.apps && (
        <AppInstallBanner
          links={{
            appStore: contactInfo.apps.appStore || "",
            playStore: contactInfo.apps.playStore || "",
            apkPickleTour: contactInfo.apps.apkPickleTour || "",
          }}
        />
      )}
      <SponsorMarquee variant="glass" height={80} gap={24} />

      {/* ======= RADICAL HERO SECTION ======= */}
      <section
        className="position-relative overflow-hidden"
        style={{
          backgroundColor: isDark ? "#050505" : "#fbfbfd",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          paddingTop: "120px",
          paddingBottom: "140px",
        }}
      >
        {/* Animated Grid Background */}
        <div
          className="position-absolute w-100 h-100"
          style={{
            top: 0,
            left: 0,
            backgroundImage: isDark
              ? "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)"
              : "linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            animation: "panBackground 20s linear infinite",
            maskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />

        {/* Dynamic Glowing Orbs Background */}
        <div
          className="position-absolute"
          style={{
            top: "20%",
            left: "20%",
            width: "40vw",
            height: "40vw",
            background: "radial-gradient(circle, rgba(13,110,253,0.15) 0%, rgba(0,0,0,0) 70%)",
            filter: "blur(60px)",
            zIndex: 0,
            animation: "float 14s ease-in-out infinite",
            pointerEvents: "none"
          }}
        />
        <div
          className="position-absolute"
          style={{
            bottom: "10%",
            right: "15%",
            width: "35vw",
            height: "35vw",
            background: "radial-gradient(circle, rgba(146,254,157,0.12) 0%, rgba(0,0,0,0) 70%)",
            filter: "blur(60px)",
            zIndex: 0,
            animation: "floatReverse 18s ease-in-out infinite",
            pointerEvents: "none"
          }}
        />
        <div
          className="position-absolute d-none d-lg-block"
          style={{
            top: "40%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "60vw",
            height: "20vh",
            background: isDark 
              ? "radial-gradient(ellipse, rgba(13,202,240,0.1) 0%, rgba(0,0,0,0) 70%)" 
              : "radial-gradient(ellipse, rgba(13,202,240,0.05) 0%, rgba(255,255,255,0) 70%)",
            filter: "blur(80px)",
            zIndex: 0,
            pointerEvents: "none"
          }}
        />

        <Container className="position-relative" style={{ zIndex: 1, maxWidth: "1200px" }}>
          <div className="text-center mb-5">
            {heroData ? (
              <>
                <Badge
                  bg="transparent"
                  className="mb-4 px-4 py-2 rounded-pill fw-bold bg-opacity-10"
                  style={{ 
                    fontSize: "0.85rem", 
                    letterSpacing: "1px",
                    textTransform: "uppercase",
                    color: isDark ? "#92FE9D" : theme.palette.primary.main,
                    border: isDark ? "1px solid rgba(146,254,157,0.3)" : `1px solid ${theme.palette.primary.main}40`,
                    backgroundColor: isDark ? "rgba(146,254,157,0.05)" : "rgba(13,110,253,0.05)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                >
                  <RocketLaunchIcon sx={{ fontSize: "1.1rem" }} /> Cách Mạng Hoá Pickleball Việt Nam
                </Badge>
                
                <h1 
                  className="fw-bold mb-4"
                  style={{
                    fontSize: "clamp(2.5rem, 6vw, 5rem)",
                    lineHeight: 1.15,
                    letterSpacing: "-0.03em",
                    color: isDark ? "#fff" : "#111",
                    position: "relative",
                  }}
                >
                  {String(heroData.title || "")
                    .split("\n")
                    .map((line, i) => (
                      <span key={i} style={{ display: "block" }}>
                        {line}
                      </span>
                    ))}
                </h1>
                
                <p 
                  className="mx-auto mb-5"
                  style={{ 
                    fontSize: "clamp(1.1rem, 2vw, 1.4rem)",
                    lineHeight: "1.6",
                    maxWidth: "700px",
                    color: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.6)",
                  }}
                >
                  {heroData.lead}
                </p>
              </>
            ) : (
                <div className="d-flex flex-column align-items-center mb-5">
                  <SkeletonBar w="150px" h={30} className="mb-4 rounded-pill" />
                  <SkeletonBar w="80%" h={80} className="mb-3" />
                  <SkeletonBar w="60%" h={80} className="mb-4" />
                  <SkeletonBar w="50%" h={24} className="mb-2" />
                  <SkeletonBar w="40%" h={24} className="mb-5" />
                </div>
            )}

            {/* Action Buttons */}
            <div className="d-flex flex-column flex-sm-row gap-4 justify-content-center align-items-center animate__animated animate__fadeInUp">
                {!isLoggedIn ? (
                  <>
                    <Button
                      as={Link}
                      to="/register"
                      size="lg"
                      className="premium-btn px-5 py-3 fw-bold text-decoration-none"
                      style={{
                        "--btn-bg": isDark ? "#fff" : "#111",
                        "--btn-hover-bg": isDark ? "#f0f0f0" : "#333",
                        "--btn-shadow": isDark ? "0 10px 30px rgba(255,255,255,0.1)" : "0 10px 30px rgba(0,0,0,0.1)",
                        "--btn-hover-shadow": isDark ? "0 15px 40px rgba(255,255,255,0.2)" : "0 15px 40px rgba(0,0,0,0.2)",
                        color: isDark ? "#000" : "#fff",
                      }}
                    >
                      Bắt đầu ngay
                    </Button>
                    <Button
                      as={Link}
                      to="/login"
                      variant="text"
                      size="lg"
                      className="rounded-pill px-5 py-3 fw-bold text-decoration-none"
                      style={{ 
                        color: isDark ? "#fff" : "#111",
                        transition: "all 0.3s ease",
                        border: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.1)",
                        backgroundColor: "transparent",
                      }}
                      onMouseOver={(e) => e.target.style.backgroundColor = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}
                      onMouseOut={(e) => e.target.style.backgroundColor = "transparent"}
                    >
                      Đăng nhập <span style={{ marginLeft: "8px" }}>&rarr;</span>
                    </Button>
                  </>
                ) : (
                  <>
                    {needSelfAssess && (
                      <Button
                        as={Link}
                        to="/levelpoint"
                        size="lg"
                        className="premium-btn px-5 py-3 fw-bold text-decoration-none"
                        style={{
                          "--btn-bg": isDark ? "#fff" : "#111",
                          "--btn-hover-bg": isDark ? "#f0f0f0" : "#333",
                          "--btn-shadow": isDark ? "0 10px 30px rgba(255,255,255,0.1)" : "0 10px 30px rgba(0,0,0,0.1)",
                          "--btn-hover-shadow": isDark ? "0 15px 40px rgba(255,255,255,0.2)" : "0 15px 40px rgba(0,0,0,0.2)",
                          color: isDark ? "#000" : "#fff",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <AutoAwesomeIcon sx={{ fontSize: "1.2rem" }} /> Tự chấm trình
                        </span>
                      </Button>
                    )}
                    {needKyc && (
                      <Button
                        as={Link}
                        to="/profile#2"
                        size="lg"
                        className={`rounded-pill px-5 py-3 fw-bold border text-decoration-none`}
                        style={{
                           backgroundColor: needSelfAssess ? "transparent" : (isDark ? "#fff" : "#111"),
                           color: needSelfAssess ? (isDark ? "#fff" : "#111") : (isDark ? "#000" : "#fff"),
                           borderColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
                           boxShadow: !needSelfAssess ? "0 10px 30px rgba(0,0,0,0.2)" : "none",
                           transition: "all 0.3s ease"
                        }}
                        onMouseOver={(e) => e.target.style.backgroundColor = needSelfAssess ? (isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)") : (isDark ? "#e0e0e0" : "#333")}
                        onMouseOut={(e) => e.target.style.backgroundColor = needSelfAssess ? "transparent" : (isDark ? "#fff" : "#111")}
                      >
                        Xác minh danh tính
                      </Button>
                    )}
                    {!needSelfAssess && !needKyc && (
                      <Button
                        as={Link}
                        to="/pickle-ball/tournaments"
                        size="lg"
                        className="premium-btn px-5 py-3 fw-bold text-decoration-none"
                        style={{
                          "--btn-bg": isDark ? "#fff" : "#111",
                          "--btn-hover-bg": isDark ? "#f0f0f0" : "#333",
                          "--btn-shadow": isDark ? "0 10px 30px rgba(255,255,255,0.1)" : "0 10px 30px rgba(0,0,0,0.1)",
                          "--btn-hover-shadow": isDark ? "0 15px 40px rgba(255,255,255,0.2)" : "0 15px 40px rgba(0,0,0,0.2)",
                          color: isDark ? "#000" : "#fff",
                        }}
                      >
                        Khám phá giải đấu
                      </Button>
                    )}
                  </>
                )}
            </div>
          </div>

          {/* MASSIVE IMAGE AT BOTTOM WITH ENHANCED 3D */}
          <div 
            className="w-100 mx-auto mt-5 pt-3 animate__animated animate__fadeInUp animate__delay-1s" 
            style={{ 
              maxWidth: "1000px",
              perspective: "1500px",
              transformStyle: "preserve-3d"
            }}
          >
            {heroData ? (
              <div
                className="overflow-hidden position-relative"
                style={{
                  borderRadius: "32px",
                  border: isDark ? "1px solid rgba(255,255,255,0.15)" : "1px solid rgba(255,255,255,0.6)",
                  boxShadow: isDark 
                    ? "0 50px 100px -20px rgba(0,0,0,0.9), 0 30px 60px -30px rgba(13,202,240,0.3)" 
                    : "0 50px 100px -20px rgba(0,0,0,0.15), 0 30px 60px -30px rgba(13,110,253,0.2)",
                  transform: "rotateX(8deg) scale(0.92) translateY(20px)",
                  transformOrigin: "bottom center",
                  transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
                  backgroundColor: isDark ? "#111" : "#fff",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = "rotateX(0deg) scale(1) translateY(0px)";
                  e.currentTarget.style.boxShadow = isDark 
                    ? "0 40px 80px -10px rgba(0,0,0,0.9), 0 20px 40px -20px rgba(13,202,240,0.4)" 
                    : "0 40px 80px -10px rgba(0,0,0,0.2), 0 20px 40px -20px rgba(13,110,253,0.3)";
                  
                  // Glare effect
                  const glare = e.currentTarget.querySelector('.img-glare');
                  if(glare) {
                    glare.style.opacity = '1';
                    glare.style.transform = 'translate(100%, 100%)';
                  }
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = "rotateX(8deg) scale(0.92) translateY(20px)";
                  e.currentTarget.style.boxShadow = isDark 
                    ? "0 50px 100px -20px rgba(0,0,0,0.9), 0 30px 60px -30px rgba(13,202,240,0.3)" 
                    : "0 50px 100px -20px rgba(0,0,0,0.15), 0 30px 60px -30px rgba(13,110,253,0.2)";
                    
                  // Glare effect reset
                  const glare = e.currentTarget.querySelector('.img-glare');
                  if(glare) {
                    glare.style.opacity = '0';
                    glare.style.transform = 'translate(-100%, -100%)';
                  }
                }}
              >
                {/* Glass Glare Highlight */}
                <div 
                  className="img-glare"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: "linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 50%)",
                    transform: "translate(-100%, -100%)",
                    transition: "transform 1s cubic-bezier(0.16, 1, 0.3, 1), opacity 1s",
                    opacity: 0,
                    pointerEvents: "none",
                    zIndex: 2,
                  }} 
                />
                
                <div style={{ paddingBottom: "56.25%", position: "relative", zIndex: 1 }}> {/* 16:9 Aspect Ratio */}
                  <img
                    draggable={false}
                    src={heroData.imageUrl || fallbackImg}
                    alt={heroData.imageAlt || "Hero image"}
                    style={{ 
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%", 
                      height: "100%", 
                      objectFit: "cover",
                    }}
                  />
                </div>
              </div>
            ) : (
              <SkeletonBar w="100%" h={500} r={24} className="shadow-lg mt-5 mx-auto" style={{ maxWidth: "1000px" }} />
            )}
          </div>
        </Container>
      </section>

      {/* ======= STATS SECTION ======= */}
      <section
        style={{
          backgroundColor: isDark ? "#050505" : "#fbfbfd",
          padding: "100px 0",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Bridging Orb 1 */}
        <div
          className="position-absolute"
          style={{
            top: "-10%",
            right: "-5%",
            width: "40vw",
            height: "40vw",
            background: isDark
              ? "radial-gradient(circle, rgba(0,201,255,0.04) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(0,110,253,0.03) 0%, transparent 70%)",
            filter: "blur(80px)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <Container style={{ maxWidth: "1200px", position: "relative", zIndex: 1 }}>
          <div className="text-center mb-5">
            <p
              className="text-uppercase fw-bold mb-2"
              style={{
                fontSize: "0.85rem",
                letterSpacing: "2px",
                color: isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)",
              }}
            >
              Con số biết nói
            </p>
            <h2
              className="fw-bolder"
              style={{
                fontSize: "clamp(2rem, 4vw, 3.5rem)",
                color: isDark ? "#fff" : "#111",
                letterSpacing: "-0.03em",
              }}
            >
              Cộng đồng đang phát triển
            </h2>
          </div>
          <Row className="g-4 justify-content-center">
            {statsList ? (
              statsList.map((stat, idx) => (
                <Col key={idx} xs={6} md={3}>
                  <div
                    className="text-center p-4 h-100"
                    style={{
                      borderRadius: "24px",
                      backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                      border: isDark
                        ? "1px solid rgba(255,255,255,0.06)"
                        : "1px solid rgba(0,0,0,0.06)",
                      transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                      cursor: "default",
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.transform = "translateY(-6px)";
                      e.currentTarget.style.boxShadow = isDark
                        ? "0 20px 40px rgba(0,0,0,0.4)"
                        : "0 20px 40px rgba(0,0,0,0.08)";
                      e.currentTarget.style.borderColor = isDark
                        ? "rgba(255,255,255,0.15)"
                        : "rgba(0,0,0,0.12)";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "none";
                      e.currentTarget.style.borderColor = isDark
                        ? "rgba(255,255,255,0.06)"
                        : "rgba(0,0,0,0.06)";
                    }}
                  >
                    <div style={{ marginBottom: "12px", color: isDark ? "rgba(255,255,255,0.8)" : theme.palette.primary.main }}>{stat.icon}</div>
                    <h3
                      className="fw-bolder mb-1"
                      style={{
                        fontSize: "clamp(1.8rem, 3vw, 2.8rem)",
                        color: isDark ? "#fff" : "#111",
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {stat.number}
                    </h3>
                    <p
                      className="mb-0"
                      style={{
                        fontSize: "0.95rem",
                        color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
                        fontWeight: 500,
                      }}
                    >
                      {stat.label}
                    </p>
                  </div>
                </Col>
              ))
            ) : homeLoading ? (
              Array.from({ length: 4 }).map((_, idx) => (
                <Col key={idx} xs={6} md={3}>
                  <div
                    className="text-center p-4 h-100"
                    style={{
                      borderRadius: "24px",
                      backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                      border: isDark
                        ? "1px solid rgba(255,255,255,0.06)"
                        : "1px solid rgba(0,0,0,0.06)",
                      transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                      cursor: "default",
                    }}
                  >
                    <SkeletonBar w="40%" h={24} className="mx-auto mb-3" />
                    <SkeletonBar w="60%" h={28} className="mx-auto mb-2" />
                    <SkeletonBar w="50%" h={16} className="mx-auto" />
                  </div>
                </Col>
              ))
            ) : null}

          </Row>
        </Container>
      </section>

      {/* ======= FEATURES SECTION ======= */}
      <section
        style={{
          backgroundColor: isDark ? "#050505" : "#fbfbfd",
          padding: "120px 0",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Bridging Orb 2 */}
        <div
          className="position-absolute"
          style={{
            bottom: "-15%",
            left: "-10%",
            width: "50vw",
            height: "50vw",
            background: isDark
              ? "radial-gradient(circle, rgba(146,254,157,0.03) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(25,135,84,0.02) 0%, transparent 70%)",
            filter: "blur(100px)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <Container style={{ maxWidth: "1200px", position: "relative", zIndex: 1 }}>
          <div className="text-center mb-5">
            <p
              className="text-uppercase fw-bold mb-2"
              style={{
                fontSize: "0.85rem",
                letterSpacing: "2px",
                color: isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)",
              }}
            >
              Tính năng nổi bật
            </p>
            <h2
              className="fw-bolder mb-3"
              style={{
                fontSize: "clamp(2rem, 4vw, 3.5rem)",
                color: isDark ? "#fff" : "#111",
                letterSpacing: "-0.03em",
              }}
            >
              Mọi thứ bạn cần, một nền tảng
            </h2>
            <p
              className="mx-auto"
              style={{
                maxWidth: "600px",
                color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
                fontSize: "1.1rem",
                lineHeight: 1.6,
              }}
            >
              Từ quản lý giải đấu đến theo dõi điểm trình, PickleTour cung cấp đầy đủ công cụ cho mọi người chơi.
            </p>
          </div>

          <Row className="g-4">
            {[
              {
                icon: <AnalyticsIcon />,
                title: "Hệ thống điểm DUPR",
                desc: "Tính điểm trình chuyên nghiệp theo chuẩn quốc tế, cập nhật sau mỗi trận đấu thi đấu.",
              },
              {
                icon: <EmojiEventsIcon />,
                title: "Tổ chức giải đấu",
                desc: "Tạo và quản lý giải đấu dễ dàng với bảng đấu tự động, bracket và kết quả real-time.",
              },
              {
                icon: <PeopleAltIcon />,
                title: "Hồ sơ & Thống kê",
                desc: "Theo dõi lịch sử thi đấu, phong độ, win-rate và tiến trình phát triển cá nhân.",
              },
              {
                icon: <HandshakeIcon />,
                title: "Cộng đồng năng động",
                desc: "Kết nối với hàng nghìn người chơi, tìm đối thủ phù hợp trình độ gần bạn.",
              },
              {
                icon: <SmartphoneIcon />,
                title: "Ứng dụng di động",
                desc: "Trải nghiệm mượt mà trên cả iOS và Android, luôn cập nhật mọi lúc mọi nơi.",
              },
              {
                icon: <NotificationsActiveIcon />,
                title: "Thông báo thông minh",
                desc: "Nhận nhắc nhở về giải đấu sắp diễn ra, kết quả trận đấu và cập nhật điểm.",
              },
            ].map((feature, idx) => (
              <Col key={idx} md={6} lg={4}>
                <div
                  className="p-4 h-100"
                  style={{
                    borderRadius: "24px",
                    backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "#fff",
                    border: isDark
                      ? "1px solid rgba(255,255,255,0.06)"
                      : "1px solid rgba(0,0,0,0.06)",
                    transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                    cursor: "default",
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.transform = "translateY(-8px)";
                    e.currentTarget.style.boxShadow = isDark
                      ? "0 20px 50px rgba(0,0,0,0.5)"
                      : "0 20px 50px rgba(0,0,0,0.08)";
                    e.currentTarget.style.borderColor = isDark
                      ? "rgba(255,255,255,0.12)"
                      : "rgba(0,0,0,0.1)";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.borderColor = isDark
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(0,0,0,0.06)";
                  }}
                >
                  <div
                    className="d-flex align-items-center justify-content-center mb-3"
                    style={{
                      width: "56px",
                      height: "56px",
                      borderRadius: "16px",
                      backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                      color: isDark ? "rgba(255,255,255,0.8)" : theme.palette.primary.main,
                    }}
                  >
                    {feature.icon}
                  </div>
                  <h5
                    className="fw-bold mb-2"
                    style={{ color: isDark ? "#fff" : "#111" }}
                  >
                    {feature.title}
                  </h5>
                  <p
                    className="mb-0"
                    style={{
                      color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
                      lineHeight: 1.6,
                      fontSize: "0.95rem",
                    }}
                  >
                    {feature.desc}
                  </p>
                </div>
              </Col>
            ))}
          </Row>
        </Container>
      </section>

      {/* ======= CLUB SHOWCASE SECTION ======= */}
      <section
        style={{
          backgroundColor: isDark ? "#050505" : "#fbfbfd",
          padding: "120px 0",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Bridging Orb 3 */}
        <div
          className="position-absolute"
          style={{
            top: "20%",
            right: "10%",
            width: "35vw",
            height: "35vw",
            background: isDark
              ? "radial-gradient(circle, rgba(13,202,240,0.04) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(13,202,240,0.03) 0%, transparent 70%)",
            filter: "blur(80px)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <Container style={{ maxWidth: "1200px", position: "relative", zIndex: 1 }}>
          <div className="text-center mb-5">
            <p
              className="text-uppercase fw-bold mb-2"
              style={{
                fontSize: "0.85rem",
                letterSpacing: "2px",
                color: isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)",
              }}
            >
              Đối tác & Câu lạc bộ
            </p>
            <h2
              className="fw-bolder mb-3"
              style={{
                fontSize: "clamp(2rem, 4vw, 3.5rem)",
                color: isDark ? "#fff" : "#111",
                letterSpacing: "-0.03em",
              }}
            >
              Được tin dùng bởi các CLB hàng đầu
            </h2>
            <p
              className="mx-auto"
              style={{
                maxWidth: "600px",
                color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
                fontSize: "1.1rem",
                lineHeight: 1.6,
              }}
            >
              Hàng trăm câu lạc bộ Pickleball trên khắp Việt Nam đã lựa chọn PickleTour làm nền tảng quản lý giải đấu và theo dõi điểm trình.
            </p>
          </div>

          <div className="mt-5 pt-4">
            <Row className="g-4 justify-content-center">
            {clubsList.length > 0 ? (
              clubsList.map((club, idx) => (
                <Col key={club.id || idx} xs={6} md={4} lg={4}>
                  <div
                    className="p-4 h-100 d-flex flex-column"
                    style={{
                      borderRadius: "24px",
                      backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "#fff",
                      border: isDark
                        ? "1px solid rgba(255,255,255,0.06)"
                        : "1px solid rgba(0,0,0,0.06)",
                      transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                      cursor: "default",
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.transform = "translateY(-6px)";
                      e.currentTarget.style.borderColor = club.color + "40";
                      e.currentTarget.style.boxShadow = `0 20px 40px ${club.color}15`;
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.borderColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <div
                      className="d-flex align-items-center justify-content-center mb-3"
                      style={{
                        width: "48px",
                        height: "48px",
                        borderRadius: "14px",
                        backgroundColor: club.color + "18",
                        fontSize: "1.4rem",
                        fontWeight: 800,
                        color: club.color,
                      }}
                    >
                      {(club.name || "C").charAt(0)}
                    </div>
                    <h6
                      className="fw-bold mb-1"
                      style={{
                        color: isDark ? "#fff" : "#111",
                        fontSize: "1rem",
                      }}
                    >
                      {club.name}
                    </h6>
                    <p
                      className="mb-2 d-flex align-items-center gap-1"
                      style={{
                        color: isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)",
                        fontSize: "0.85rem",
                      }}
                    >
                      <LocationOnIcon sx={{ fontSize: "0.95rem" }} /> {club.location}
                    </p>
                    <p
                      className="mb-0 mt-auto"
                      style={{
                        color: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.6)",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                      }}
                    >
                      {club.members} thành viên
                    </p>
                  </div>
                </Col>
              ))
            ) : homeLoading ? (
              Array.from({ length: 6 }).map((_, idx) => (
                <Col key={idx} xs={6} md={4} lg={4}>
                  <div
                    className="p-4 h-100 d-flex flex-column"
                    style={{
                      borderRadius: "24px",
                      backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "#fff",
                      border: isDark
                        ? "1px solid rgba(255,255,255,0.06)"
                        : "1px solid rgba(0,0,0,0.06)",
                    }}
                  >
                    <SkeletonBar w="48px" h={48} r={14} className="mb-3" />
                    <SkeletonBar w="70%" h={18} className="mb-2" />
                    <SkeletonBar w="60%" h={14} className="mb-2" />
                    <SkeletonBar w="50%" h={14} className="mt-auto" />
                  </div>
                </Col>
              ))
            ) : null}

          </Row>
          </div>
        </Container>
      </section>

      {/* ======= BOTTOM CTA SECTION ======= */}
      <section
        className="position-relative overflow-hidden"
        style={{
          padding: "120px 0",
          backgroundColor: isDark ? "#050505" : "#fbfbfd",
        }}
      >
        {/* Background orbs */}
        <div
          className="position-absolute"
          style={{
            top: "50%",
            left: "30%",
            transform: "translate(-50%, -50%)",
            width: "40vw",
            height: "40vw",
            background: "radial-gradient(circle, rgba(13,110,253,0.08) 0%, transparent 70%)",
            filter: "blur(60px)",
            pointerEvents: "none",
          }}
        />
        <div
          className="position-absolute"
          style={{
            top: "50%",
            right: "10%",
            transform: "translateY(-50%)",
            width: "30vw",
            height: "30vw",
            background: "radial-gradient(circle, rgba(146,254,157,0.06) 0%, transparent 70%)",
            filter: "blur(60px)",
            pointerEvents: "none",
          }}
        />
        <Container style={{ maxWidth: "900px", position: "relative", zIndex: 1 }}>
          <div
            className="text-center p-5"
            style={{
              borderRadius: "32px",
              backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
              border: isDark
                ? "1px solid rgba(255,255,255,0.08)"
                : "1px solid rgba(0,0,0,0.06)",
              backdropFilter: "blur(20px)",
            }}
          >
            <h2
              className="fw-bolder mb-3"
              style={{
                fontSize: "clamp(1.8rem, 3.5vw, 3rem)",
                color: isDark ? "#fff" : "#111",
                letterSpacing: "-0.03em",
              }}
            >
              Sẵn sàng nâng tầm trải nghiệm Pickleball?
            </h2>
            <p
              className="mx-auto mb-5"
              style={{
                maxWidth: "600px",
                color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
                fontSize: "1.15rem",
                lineHeight: 1.7,
              }}
            >
              Tham gia cùng hàng nghìn người chơi trên PickleTour. Đăng ký miễn phí và bắt đầu hành trình của bạn ngay hôm nay.
            </p>
            <div className="d-flex flex-column flex-sm-row gap-3 justify-content-center">
              <Button
                as={Link}
                to={isLoggedIn ? "/pickle-ball/tournaments" : "/register"}
                size="lg"
                className="premium-btn px-5 py-3 fw-bold text-decoration-none"
                style={{
                  "--btn-bg": isDark ? "#fff" : "#111",
                  "--btn-hover-bg": isDark ? "#f0f0f0" : "#333",
                  "--btn-shadow": isDark ? "0 10px 30px rgba(255,255,255,0.1)" : "0 10px 30px rgba(0,0,0,0.1)",
                  "--btn-hover-shadow": isDark ? "0 15px 40px rgba(255,255,255,0.2)" : "0 15px 40px rgba(0,0,0,0.2)",
                  color: isDark ? "#000" : "#fff",
                }}
              >
                {isLoggedIn ? "Khám phá giải đấu" : "Tạo tài khoản miễn phí"}
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* ======= CONTACT INFO & APP SECTION ======= */}
      <section className="py-5" style={{ backgroundColor: isDark ? "#050505" : "#fbfbfd" }}>
        <Container>
          <Row className="g-4">
            {/* Card 1: Liên hệ chính */}
            <Col lg={4} md={6}>
              <Card className="h-100 border-0" style={glassCardStyle}>
                <Card.Body className="p-4">
                  <div
                    className="d-inline-flex align-items-center justify-content-center bg-primary bg-opacity-10 text-primary rounded-circle mb-3"
                    style={{ width: 50, height: 50 }}
                  >
                    <ILocation size={24} />
                  </div>
                  <h5 className="fw-bold mb-3">Trụ sở chính</h5>

                  {!contactInfo ? (
                    <SkeletonBar h={80} />
                  ) : (
                    <ul className={`list-unstyled mb-0 d-grid gap-3 ${isDark ? "opacity-75" : "text-secondary"}`}>
                      <li className="d-flex gap-3">
                        <span className="fw-semibold flex-shrink-0">
                          Địa chỉ:
                        </span>
                        <span>{contactInfo.address}</span>
                      </li>
                      <li className="d-flex gap-3">
                        <span className="fw-semibold flex-shrink-0">
                          Hotline:
                        </span>
                        {contactInfo.phone ? (
                          <a
                            href={`tel:${contactInfo.phone}`}
                            className="text-decoration-none fw-bold text-primary"
                          >
                            {contactInfo.phone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </li>
                      <li className="d-flex gap-3">
                        <span className="fw-semibold flex-shrink-0">
                          Email:
                        </span>
                        <a
                          href={`mailto:${contactInfo.email}`}
                          className="text-decoration-none text-primary text-break"
                        >
                          {contactInfo.email}
                        </a>
                      </li>
                    </ul>
                  )}
                </Card.Body>
              </Card>
            </Col>

            {/* Card 2: Kênh hỗ trợ */}
            <Col lg={4} md={6}>
              <Card className="h-100 border-0" style={glassCardStyle}>
                <Card.Body className="p-4">
                  <div
                    className="d-inline-flex align-items-center justify-content-center bg-info bg-opacity-10 text-info rounded-circle mb-3"
                    style={{ width: 50, height: 50 }}
                  >
                    <IChat size={24} />
                  </div>
                  <h5 className="fw-bold mb-3">Kênh hỗ trợ</h5>

                  {!contactInfo ? (
                    <SkeletonBar h={80} />
                  ) : (
                    <div className="d-grid gap-3">
                      {[
                        { label: "Chung", ...contactInfo.support },
                        {
                          label: "Điểm trình",
                          email: contactInfo.support.scoringEmail,
                          phone: contactInfo.support.scoringPhone,
                        },
                        {
                          label: "Hợp tác",
                          email: contactInfo.support.salesEmail,
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="d-flex flex-column p-2 rounded-3"
                          style={{
                            backgroundColor: isDark
                              ? "rgba(255, 255, 255, 0.05)"
                              : "#f8f9fa",
                          }}
                        >
                          <small
                            className="text-uppercase fw-bold opacity-75"
                            style={{ fontSize: "0.7rem" }}
                          >
                            {item.label}
                          </small>
                          <div className="d-flex justify-content-between align-items-center mt-1">
                            <a
                              href={`mailto:${item.email || item.generalEmail}`}
                              className="text-reset text-decoration-none small text-break"
                            >
                              {item.email || item.generalEmail}
                            </a>
                            {(item.phone || item.generalPhone) && (
                              <a
                                href={`tel:${item.phone || item.generalPhone}`}
                                className={`badge border shadow-sm text-decoration-none ms-2 flex-shrink-0 ${
                                  isDark
                                    ? "bg-dark text-light border-secondary"
                                    : "bg-white text-dark"
                                }`}
                              >
                                {item.phone || item.generalPhone}
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>

            {/* Card 3: Kết nối & Tải App */}
            <Col lg={4} md={12}>
              <div className="h-100 d-flex flex-column gap-4">
                {/* Socials */}
                <Card className="border-0" style={glassCardStyle}>
                  <Card.Body className="p-4 text-center">
                    <h6 className="fw-bold mb-3 text-start">Mạng xã hội</h6>
                    <div className="d-flex gap-2 justify-content-start">
                      {contactInfo?.socials?.facebook && (
                        <a
                          href={contactInfo.socials.facebook}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-outline-primary border-0 bg-primary bg-opacity-10"
                        >
                          <IFacebook />
                        </a>
                      )}
                      {contactInfo?.socials?.youtube && (
                        <a
                          href={contactInfo.socials.youtube}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-outline-danger border-0 bg-danger bg-opacity-10"
                        >
                          <IYouTube />
                        </a>
                      )}
                      {contactInfo?.socials?.zalo && (
                        <a
                          href={contactInfo.socials.zalo}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-outline-info border-0 bg-info bg-opacity-10"
                        >
                          <span className="fw-bold small">Zalo</span>
                        </a>
                      )}
                    </div>
                  </Card.Body>
                </Card>

                {/* App Downloads */}
                {(hasAppStore || hasPlayStore || hasApkPickleTour) && (
                  <Card
                    className="flex-grow-1 border-0"
                    style={{ ...glassCardStyle }}
                  >
                    <Card.Body className="p-4">
                      <h6 className="fw-bold mb-3">
                        Tải ứng dụng
                      </h6>
                      <div className="d-flex flex-wrap gap-2">
                        {hasAppStore && (
                          <a
                            href={contactInfo.apps.appStore}
                            target="_blank"
                            rel="noreferrer"
                            className="opacity-100 hover-opacity-75 transition"
                          >
                            <img
                              src={APPSTORE_BADGE}
                              height={35}
                              alt="App Store"
                            />
                          </a>
                        )}
                        {hasPlayStore && (
                          <a
                            href={contactInfo.apps.playStore}
                            target="_blank"
                            rel="noreferrer"
                            className="opacity-100 hover-opacity-75 transition"
                          >
                            <img
                              src={PLAY_BADGE}
                              height={35}
                              alt="Google Play"
                            />
                          </a>
                        )}
                      </div>
                      {(hasApkPickleTour || hasApkReferee) && (
                        <div className={`mt-3 pt-3 border-top ${isDark ? "border-secondary" : "border-2"}`}>
                          <div className={`small mb-2 ${isDark ? "text-secondary" : "text-muted"}`}>
                            Tải file APK trực tiếp:
                          </div>
                          <div className="d-flex gap-2">
                            {hasApkPickleTour && (
                              <a
                                href={contactInfo.apps.apkPickleTour}
                                className={`btn btn-sm rounded-pill ${isDark ? "btn-outline-light" : "btn-outline-primary"}`}
                                download
                              >
                                <IDownload size={14} /> Cho người dùng
                              </a>
                            )}
                            {hasApkReferee && (
                              <a
                                href={contactInfo.apps.apkReferee}
                                className={`btn btn-sm rounded-pill ${isDark ? "btn-outline-secondary" : "btn-outline-dark"}`}
                                download
                              >
                                <IDownload size={14} /> Trọng tài
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </Card.Body>
                  </Card>
                )}
              </div>
            </Col>
          </Row>
        </Container>
      </section>
    </>
  );
}
