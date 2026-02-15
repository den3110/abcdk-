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
import AppInstallBanner from "./AppInstallBanner";
import SponsorMarquee from "./SponsorMarquee";
import SEOHead from "./SEOHead";
import { useTheme } from "@mui/material/styles";
import { useThemeMode } from "../context/ThemeContext.jsx";

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

// ===== Styled Components =====

const gradientTextStyle = {
  background: "linear-gradient(135deg, #0d6efd 0%, #0dcaf0 100%)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
  fontWeight: "800",
};

// Moved inside component for theme awareness

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

  return (
    <>
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

      {/* ======= HERO SECTION ======= */}
      <section
        className="position-relative overflow-hidden py-5"
        style={{
          backgroundColor: theme.palette.background.default,
          minHeight: "85vh",
          display: "flex",
          alignItems: "center",
        }}
      >
        {/* Background Blob */}
        <div
          className="position-absolute d-none d-lg-block"
          style={{
            top: "-10%",
            right: "-5%",
            width: "50vw",
            height: "50vw",
            background:
              "radial-gradient(circle, rgba(13,202,240,0.1) 0%, rgba(255,255,255,0) 70%)",
            borderRadius: "50%",
            zIndex: 0,
          }}
        />

        <Container className="position-relative" style={{ zIndex: 1 }}>
          <Row className="align-items-center g-5">
            {/* TEXT COLUMN */}
            <Col lg={6} className="text-center text-lg-start">
              {heroData ? (
                <>
                  <Badge
                    bg={isDark ? "dark" : "light"}
                    text={isDark ? "light" : "primary"}
                    className={`mb-3 px-3 py-2 rounded-pill border shadow-sm fw-bold ${
                      isDark ? "border-secondary" : ""
                    }`}
                  >
                    🏆 Nền tảng Pickleball số #1
                  </Badge>
                  <h1 className="display-4 fw-bolder mb-4 lh-tight">
                    {String(heroData.title || "")
                      .split("\n")
                      .map((line, i) => (
                        <span key={i} style={i === 0 ? gradientTextStyle : {}}>
                          {line}
                          {i <
                            String(heroData.title || "").split("\n").length -
                              1 && <br />}
                          {i === 0 && " "}
                        </span>
                      ))}
                  </h1>
                  <p className={`lead mb-4 pe-lg-5 fs-5 ${isDark ? "text-light opacity-75" : "text-secondary"}`}>
                    {heroData.lead}
                  </p>
                </>
              ) : (
                <div className="mb-4">
                  <SkeletonBar
                    w="100px"
                    h={30}
                    className="mb-3 mx-auto mx-lg-0"
                  />
                  <SkeletonBar
                    w="90%"
                    h={50}
                    className="mb-2 mx-auto mx-lg-0"
                  />
                  <SkeletonBar
                    w="60%"
                    h={50}
                    className="mb-4 mx-auto mx-lg-0"
                  />
                  <SkeletonBar w="100%" h={80} />
                </div>
              )}

              {/* Action Buttons */}
              <div className="d-flex flex-column flex-sm-row gap-3 justify-content-center justify-content-lg-start animate__animated animate__fadeInUp">
                {!isLoggedIn ? (
                  <>
                    <Button
                      as={Link}
                      to="/register"
                      size="lg"
                      className="rounded-pill px-5 py-3 fw-bold shadow-sm btn-primary"
                    >
                      Bắt đầu ngay
                    </Button>
                    <Button
                      as={Link}
                      to="/login"
                      variant={isDark ? "outline-light" : "light"}
                      size="lg"
                      className={`rounded-pill px-5 py-3 fw-bold shadow-sm border ${
                        isDark ? "" : "text-primary"
                      }`}
                    >
                      Đăng nhập
                    </Button>
                  </>
                ) : (
                  <>
                    {needSelfAssess && (
                      <Button
                        as={Link}
                        to="/levelpoint"
                        size="lg"
                        className="rounded-pill px-4 py-3 fw-bold shadow btn-primary"
                      >
                        ✨ Tự chấm trình
                      </Button>
                    )}
                    {needKyc && (
                      <Button
                        as={Link}
                        to="/profile#2"
                        variant={needSelfAssess ? "outline-primary" : "primary"}
                        size="lg"
                        className="rounded-pill px-4 py-3 fw-bold shadow-sm"
                      >
                        Xác minh danh tính
                      </Button>
                    )}
                    {!needSelfAssess && !needKyc && (
                      <Button
                        as={Link}
                        to="/pickle-ball/tournaments"
                        size="lg"
                        className="rounded-pill px-5 py-3 fw-bold shadow btn-primary"
                      >
                        Khám phá giải đấu
                      </Button>
                    )}
                  </>
                )}
              </div>
            </Col>

            {/* IMAGE COLUMN */}
            <Col lg={6}>
              <div className="position-relative">
                {heroData ? (
                  <div
                    className="rounded-5 shadow-lg overflow-hidden"
                    style={{
                      transform: "rotate(-2deg)",
                      border: "5px solid rgba(255,255,255,0.8)",
                    }}
                  >
                    <img
                      draggable={false}
                      src={heroData.imageUrl || fallbackImg}
                      alt={heroData.imageAlt || "Hero image"}
                      className="w-100 h-100 object-fit-cover"
                      style={{ minHeight: "350px", display: "block" }}
                    />
                  </div>
                ) : (
                  <SkeletonBar w="100%" h={400} r={32} className="shadow-sm" />
                )}
              </div>
            </Col>
          </Row>
        </Container>
      </section>

      {/* ======= CONTACT INFO & APP SECTION ======= */}
      <section className="py-5" style={{ backgroundColor: theme.palette.background.paper }}>
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
                  <h5 className="fw-bold mb-3">Trụ sở chính 123</h5>

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
                        Tải ứng dụng ngay
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
