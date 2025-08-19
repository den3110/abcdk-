// src/components/Hero.jsx
import React, { useMemo } from "react";
import { Container, Row, Col, Button } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useGetLatestAssessmentQuery } from "../slices/assessmentsApiSlice";
import { useGetHeroContentQuery } from "../slices/cmsApiSlice";

const fallbackImg = `${import.meta.env.BASE_URL}hero.jpg`;
const FALLBACK = {
  title: "Kết nối cộng đồng & quản lý giải đấu thể thao",
  lead: "PickleTour giúp bạn đăng ký, tổ chức, theo dõi điểm trình và cập nhật bảng xếp hạng cho mọi môn thể thao – ngay trên điện thoại.",
  imageUrl: fallbackImg,
  imageAlt: "PickleTour — Kết nối cộng đồng & quản lý giải đấu",
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

const Hero = () => {
  const { userInfo } = useSelector((state) => state.auth);
  const isLoggedIn = !!userInfo;
  const userId = userInfo?._id || userInfo?.id;

  const { data: latest, isFetching } = useGetLatestAssessmentQuery(userId, {
    skip: !userId,
  });

  // 👉 Chỉ dùng fallback khi isError. Khi isLoading thì để skeleton.
  const {
    data: heroRes,
    isLoading: heroLoading,
    isError: heroError,
  } = useGetHeroContentQuery();

  const heroData = useMemo(() => {
    if (heroLoading) return null; // đang load → skeleton
    if (heroError) return FALLBACK; // lỗi → fallback
    const d = heroRes || {};
    return {
      title: d.title || FALLBACK.title,
      lead: d.lead || FALLBACK.lead,
      imageUrl: d.imageUrl || FALLBACK.imageUrl,
      imageAlt: d.imageAlt || FALLBACK.imageAlt,
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

  return (
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
                {/* Skeleton Title */}
                <div className="mb-4">
                  <SkeletonBar w="85%" h={40} />
                  <div style={{ height: 12 }} />
                  <SkeletonBar w="70%" h={40} />
                </div>
                {/* Skeleton Lead */}
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
                      variant={needSelfAssess ? "outline-secondary" : "primary"}
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
                // Skeleton image
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
  );
};

export default Hero;
