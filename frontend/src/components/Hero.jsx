// src/components/Hero.jsx
import React, { useMemo } from "react";
import { Container, Row, Col, Button, Card } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useGetLatestAssessmentQuery } from "../slices/assessmentsApiSlice";
import {
  useGetHeroContentQuery,
  useGetContactContentQuery,
} from "../slices/cmsApiSlice";

const fallbackImg = `${import.meta.env.BASE_URL}hero.jpg`;

// 👉 đường dẫn ảnh badge cục bộ (đặt file vào public/badges/*)
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
  apps: { appStore: "", playStore: "" },
};

const SkeletonBar = ({ w = "100%", h = 20, r = 8, style = {} }) => (
  <div
    style={{
      width: w,
      height: h,
      borderRadius: r,
      background: "rgba(0,0,0,0.08)",
      ...style,
    }}
  />
);

// Icon SVG nội bộ
const Icon = ({ path, size = 18, className = "" }) => (
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
  >
    {path}
  </svg>
);

const ILocation = (props) => (
  <Icon
    {...props}
    path={
      <>
        <path d="M12 21s-6-5.33-6-10a6 6 0 1 1 12 0c0 4.67-6 10-6 10z" />
        <circle cx="12" cy="11" r="2.5" />
      </>
    }
  />
);
const IPhone = (props) => (
  <Icon
    {...props}
    path={
      <>
        <path d="M22 16.92v2a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 4.2 2 2 0 0 1 4.1 2h2a2 2 0 0 1 2 1.72c.12.9.33 1.77.63 2.6a2 2 0 0 1-.45 2.11L7.1 9.9a16 16 0 0 0 6 6l1.46-1.18a2 2 0 0 1 2.11-.45c.83.3 1.7.51 2.6.63A2 2 0 0 1 22 16.92z" />
      </>
    }
  />
);
const IEmail = (props) => (
  <Icon
    {...props}
    path={
      <>
        <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
        <path d="m22 6-10 7L2 6" />
      </>
    }
  />
);
const IFacebook = (props) => (
  <Icon
    {...props}
    path={
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3.5l.5-4H14V7a1 1 0 0 1 1-1h3z" />
    }
  />
);
const IYouTube = (props) => (
  <Icon
    {...props}
    path={
      <>
        <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-2C18.88 4 12 4 12 4s-6.88 0-8.59.42a2.78 2.78 0 0 0-1.95 2A29.94 29.94 0 0 0 1 12a29.94 29.94 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 2C5.12 20 12 20 12 20s6.88 0 8.59-.42a2.78 2.78 0 0 0 1.95-2A29.94 29.94 0 0 0 23 12a29.94 29.94 0 0 0-.46-5.58z" />
        <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" />
      </>
    }
  />
);
const IChat = (props) => (
  <Icon
    {...props}
    path={
      <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    }
  />
);

const ContactSkeleton = () => (
  <Card className="shadow-sm rounded-4 border-0">
    <Card.Body className="p-4">
      <div className="mb-3 text-center">
        <SkeletonBar w="40%" h={26} />
      </div>
      <Row className="g-4">
        <Col md={6}>
          <SkeletonBar w="70%" h={18} />
          <div style={{ height: 10 }} />
          <SkeletonBar w="55%" h={18} />
          <div style={{ height: 10 }} />
          <SkeletonBar w="65%" h={18} />
        </Col>
        <Col md={6}>
          <SkeletonBar w="60%" h={18} />
          <div style={{ height: 10 }} />
          <SkeletonBar w="75%" h={18} />
          <div style={{ height: 10 }} />
          <SkeletonBar w="50%" h={18} />
        </Col>
      </Row>
    </Card.Body>
  </Card>
);

const Hero = () => {
  const { userInfo } = useSelector((state) => state.auth);
  const isLoggedIn = !!userInfo;
  const userId = userInfo?._id || userInfo?.id;

  // Hero content
  const { data: latest, isFetching } = useGetLatestAssessmentQuery(userId, {
    skip: !userId,
  });
  const {
    data: heroRes,
    isLoading: heroLoading,
    isError: heroError,
  } = useGetHeroContentQuery();

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

  const needSelfAssess = useMemo(() => {
    if (!isLoggedIn || isFetching) return false;
    if (!latest) return true;
    const s = Number(latest.singleLevel || 0);
    const d = Number(latest.doubleLevel || 0);
    return s === 0 || d === 0;
  }, [isLoggedIn, isFetching, latest]);

  const needKyc =
    isLoggedIn && (userInfo?.cccdStatus || "unverified") !== "verified";

  // Contact content
  const {
    data: contactRes,
    isLoading: contactLoading,
    isError: contactError,
  } = useGetContactContentQuery();

  const contactInfo = useMemo(() => {
    if (contactLoading) return null;
    if (contactError) return CONTACT_FALLBACK;
    return { ...CONTACT_FALLBACK, ...(contactRes || {}) };
  }, [contactLoading, contactError, contactRes]);

  const hasAppStore = !!contactInfo?.apps?.appStore;
  const hasPlayStore = !!contactInfo?.apps?.playStore;

  return (
    <>
      {/* HERO */}
      <section className="bg-light py-5 text-center text-lg-start">
        <Container>
          <Row className="align-items-center g-5">
            <Col lg={6}>
              {heroData ? (
                <>
                  <h1 className="display-5 fw-bold mb-4">
                    {heroData.title.split("\n").map((line, i) => (
                      <span key={i}>
                        {line}
                        {i === 0 && <br className="d-none d-lg-block" />}
                      </span>
                    ))}
                  </h1>
                  <p className="lead mb-4">{heroData.lead}</p>
                </>
              ) : (
                <>
                  <div className="mb-4">
                    <SkeletonBar w="85%" h={40} />
                    <div style={{ height: 12 }} />
                    <SkeletonBar w="70%" h={40} />
                  </div>
                  <div className="mb-4">
                    <SkeletonBar w="95%" h={18} />
                    <div style={{ height: 8 }} />
                    <SkeletonBar w="75%" h={18} />
                  </div>
                </>
              )}

              <div className="d-flex flex-column flex-sm-row gap-3 justify-content-center justify-content-lg-start">
                {!isLoggedIn ? (
                  <>
                    <Button
                      as={Link}
                      to="/register"
                      variant="primary"
                      className="px-4 py-2"
                    >
                      Bắt&nbsp;đầu ngay
                    </Button>
                    <Button
                      as={Link}
                      to="/login"
                      variant="outline-secondary"
                      className="px-4 py-2"
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
                        variant="primary"
                        className="px-4 py-2"
                      >
                        Tự chấm trình
                      </Button>
                    )}
                    {needKyc && (
                      <Button
                        as={Link}
                        to="/profile"
                        variant={
                          needSelfAssess ? "outline-secondary" : "primary"
                        }
                        className="px-4 py-2"
                      >
                        Xác minh ngay
                      </Button>
                    )}
                    {!needSelfAssess && !needKyc && (
                      <Button
                        as={Link}
                        to="/pickle-ball/tournaments"
                        variant="primary"
                        className="px-4 py-2"
                      >
                        Khám phá giải đấu
                      </Button>
                    )}
                  </>
                )}
              </div>
            </Col>

            <Col lg={6}>
              <div className="ratio ratio-16x9 shadow rounded">
                {heroData ? (
                  <img
                    src={heroData.imageUrl || fallbackImg}
                    alt={heroData.imageAlt || "Hero image"}
                    className="w-100 h-100"
                    style={{ objectFit: "cover" }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      background: "rgba(0,0,0,0.08)",
                      borderRadius: 8,
                    }}
                  />
                )}
              </div>
            </Col>
          </Row>
        </Container>
      </section>

      {/* CONTACT */}
      <section className="py-5 bg-white border-top">
        <Container>
          <Card className="shadow-sm rounded-4 border-0">
            <Card.Body className="p-4 p-lg-5">
              <h2 className="fw-bold text-center mb-4">Thông tin liên hệ</h2>

              {!contactInfo ? (
                <ContactSkeleton />
              ) : (
                <Row className="g-4">
                  <Col md={6} lg={5}>
                    <ul className="list-unstyled mb-0">
                      <li className="mb-2 d-flex align-items-start gap-2">
                        <ILocation className="flex-shrink-0 mt-1" />
                        <span>
                          <strong>Địa chỉ:</strong> {contactInfo.address}
                        </span>
                      </li>
                      <li className="mb-2 d-flex align-items-start gap-2">
                        <IPhone className="flex-shrink-0 mt-1" />
                        <span>
                          <strong>Điện thoại:</strong>{" "}
                          {contactInfo.phone ? (
                            <a href={`tel:${contactInfo.phone}`}>
                              {contactInfo.phone}
                            </a>
                          ) : (
                            "—"
                          )}
                        </span>
                      </li>
                      <li className="mb-2 d-flex align-items-start gap-2">
                        <IEmail className="flex-shrink-0 mt-1" />
                        <span>
                          <strong>Email:</strong>{" "}
                          <a href={`mailto:${contactInfo.email}`}>
                            {contactInfo.email}
                          </a>
                        </span>
                      </li>
                    </ul>
                  </Col>

                  <Col md={6} lg={4}>
                    <h5 className="fw-semibold mb-3">Kênh hỗ trợ</h5>
                    <ul className="list-unstyled mb-0">
                      <li className="mb-2">
                        <div className="text-muted small mb-1">Chung</div>
                        <div>
                          <a
                            href={`mailto:${contactInfo.support.generalEmail}`}
                          >
                            {contactInfo.support.generalEmail}
                          </a>{" "}
                          –{" "}
                          {contactInfo.support.generalPhone ? (
                            <a href={`tel:${contactInfo.support.generalPhone}`}>
                              {contactInfo.support.generalPhone}
                            </a>
                          ) : (
                            "—"
                          )}
                        </div>
                      </li>
                      <li className="mb-2">
                        <div className="text-muted small mb-1">Điểm trình</div>
                        <div>
                          <a
                            href={`mailto:${contactInfo.support.scoringEmail}`}
                          >
                            {contactInfo.support.scoringEmail}
                          </a>{" "}
                          –{" "}
                          {contactInfo.support.scoringPhone ? (
                            <a href={`tel:${contactInfo.support.scoringPhone}`}>
                              {contactInfo.support.scoringPhone}
                            </a>
                          ) : (
                            "—"
                          )}
                        </div>
                      </li>
                      <li>
                        <div className="text-muted small mb-1">Bán hàng</div>
                        <div>
                          <a href={`mailto:${contactInfo.support.salesEmail}`}>
                            {contactInfo.support.salesEmail}
                          </a>
                        </div>
                      </li>
                    </ul>
                  </Col>

                  <Col lg={3}>
                    <h5 className="fw-semibold mb-3">Kết nối</h5>
                    <div className="d-flex flex-wrap gap-2 mb-3">
                      {contactInfo?.socials?.facebook && (
                        <a
                          href={contactInfo.socials.facebook}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-outline-primary d-inline-flex align-items-center gap-2"
                        >
                          <IFacebook /> Facebook
                        </a>
                      )}
                      {contactInfo?.socials?.youtube && (
                        <a
                          href={contactInfo.socials.youtube}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-outline-danger d-inline-flex align-items-center gap-2"
                        >
                          <IYouTube /> YouTube
                        </a>
                      )}
                      {contactInfo?.socials?.zalo && (
                        <a
                          href={contactInfo.socials.zalo}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-outline-info d-inline-flex align-items-center gap-2"
                        >
                          <IChat /> Zalo
                        </a>
                      )}
                    </div>

                    {/* Tải ứng dụng — dùng badge ảnh chuẩn */}
                    {(hasAppStore || hasPlayStore) && (
                      <div>
                        <h6 className="fw-semibold mb-2">Tải ứng dụng</h6>
                        <div className="d-flex flex-column gap-2">
                          {hasAppStore && (
                            <a
                              href={contactInfo.apps.appStore}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="d-inline-block"
                              aria-label="Tải trên App Store"
                            >
                              <img
                                src={APPSTORE_BADGE}
                                alt="Download on the App Store"
                                height={40}
                                style={{ display: "block" }}
                                loading="lazy"
                              />
                            </a>
                          )}
                          {hasPlayStore && (
                            <a
                              href={contactInfo.apps.playStore}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="d-inline-block"
                              aria-label="Tải trên Google Play"
                            >
                              <img
                                src={PLAY_BADGE}
                                alt="Get it on Google Play"
                                height={40}
                                style={{ display: "block" }}
                                loading="lazy"
                              />
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </Col>
                </Row>
              )}
            </Card.Body>
          </Card>
        </Container>
      </section>
    </>
  );
};

export default Hero;
