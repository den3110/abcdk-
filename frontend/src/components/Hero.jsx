// src/components/Hero.jsx
import React from "react";
import { Container, Row, Col, Button } from "react-bootstrap";
import { Link } from "react-router-dom";

const Hero = () => {
  return (
    <section className="bg-light py-5 text-center text-lg-start">
      <Container>
        <Row className="align-items-center g-5">
          {/* LEFT: Nội dung */} 
          <Col lg={6}>
            <h1 className="display-5 fw-bold mb-4">
              Kết nối cộng đồng &amp; <br className="d-none d-lg-block" />
              quản lý giải đấu thể thao
            </h1>
            <p className="lead mb-4">
              PickleTour giúp bạn đăng ký, tổ chức, theo dõi điểm trình và
              cập nhật bảng xếp hạng cho mọi môn thể thao – ngay trên điện
              thoại.
            </p>

            <div className="d-flex flex-column flex-sm-row gap-3 justify-content-center justify-content-lg-start">
              <Button
                as={Link}
                to="/register"
                variant="primary"
                className="px-4 py-2"
              >
                Bắt đầu ngay
              </Button>
              <Button
                href="https://play.google.com/store/apps/details?id=com.ericdev.vnss"
                variant="outline-secondary"
                className="px-4 py-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                Tải trên Google Play
              </Button>
            </div>
          </Col>

          {/* RIGHT: Video embedded responsive */}
          <Col lg={6}>
            <div className="ratio ratio-16x9 shadow rounded">
              <iframe
                src="https://www.youtube.com/embed/IzSYlr3VI1A"
                title="Giới thiệu PickleTour"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
          </Col>
        </Row>
      </Container>
    </section>
  );
};

export default Hero;
