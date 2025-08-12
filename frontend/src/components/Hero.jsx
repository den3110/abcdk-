// src/components/Hero.jsx
import React, { useMemo } from "react";
import { Container, Row, Col, Button } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useGetLatestAssessmentQuery } from "../slices/assessmentsApiSlice";
const heroSrc = `${import.meta.env.BASE_URL}hero.jpg`;

const Hero = () => {
  const { userInfo } = useSelector((state) => state.auth);
  const isLoggedIn = !!userInfo;
  const userId = userInfo?._id || userInfo?.id;

  // gọi API: nếu chưa login thì skip
  const { data: latest, isFetching } = useGetLatestAssessmentQuery(userId, {
    skip: !userId,
  });

  // điều kiện hai nút
  const needSelfAssess = useMemo(() => {
    if (!isLoggedIn || isFetching) return false;
    if (!latest) return true; // chưa từng chấm
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
            <h1 className="display-5 fw-bold mb-4">
              Kết nối cộng đồng &amp; <br className="d-none d-lg-block" />
              quản lý giải đấu thể thao
            </h1>
            <p className="lead mb-4">
              PickleTour giúp bạn đăng ký, tổ chức, theo dõi điểm trình và
              cập&nbsp;nhật bảng xếp&nbsp;hạng cho mọi môn thể thao – ngay trên
              điện thoại.
            </p>

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
                      to="/profile" // sửa route nếu khác
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
              <img
                src={heroSrc} // 👈 dùng biến ở trên
                alt="PickleTour — Kết nối cộng đồng & quản lý giải đấu"
                className="w-100 h-100"
                style={{ objectFit: "cover" }}
              />
            </div>
          </Col>
        </Row>
      </Container>
    </section>
  );
};

export default Hero;
