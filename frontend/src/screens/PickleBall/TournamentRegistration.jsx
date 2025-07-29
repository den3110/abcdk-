// src/pages/TournamentRegistration.jsx
// Trang đăng ký 2 VĐV + bảng danh sách (phong cách SportConnect)

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Container,
  Row,
  Col,
  Form,
  Button,
  Table,
  Spinner,
  Alert,
  Badge,
  Image,
} from "react-bootstrap";
import {
  useGetRegistrationsQuery,
  useCreateRegistrationMutation,
  useUpdatePaymentMutation,
  useCheckinMutation,
  useGetTournamentQuery,
} from "../../slices/tournamentsApiSlice";
import { toast } from "react-toastify";

const PROVINCES = [
  "An Giang",
  "Bà Rịa‑Vũng Tàu",
  "Bắc Giang",
  "Bắc Kạn",
  "Bạc Liêu",
  "Bắc Ninh",
  "Bến Tre",
  "Bình Định",
  "Bình Dương",
  "Bình Phước",
  "Bình Thuận",
  "Cà Mau",
  "Cần Thơ",
  "Cao Bằng",
  "Đà Nẵng",
  "Đắk Lắk",
  "Đắk Nông",
  "Điện Biên",
  "Đồng Nai",
  "Đồng Tháp",
  "Gia Lai",
  "Hà Giang",
  "Hà Nam",
  "Hà Nội",
  "Hà Tĩnh",
  "Hải Dương",
  "Hải Phòng",
  "Hậu Giang",
  "Hòa Bình",
  "Hưng Yên",
  "Khánh Hòa",
  "Kiên Giang",
  "Kon Tum",
  "Lai Châu",
  "Lâm Đồng",
  "Lạng Sơn",
  "Lào Cai",
  "Long An",
  "Nam Định",
  "Nghệ An",
  "Ninh Bình",
  "Ninh Thuận",
  "Phú Thọ",
  "Phú Yên",
  "Quảng Bình",
  "Quảng Nam",
  "Quảng Ngãi",
  "Quảng Ninh",
  "Quảng Trị",
  "Sóc Trăng",
  "Sơn La",
  "Tây Ninh",
  "Thái Bình",
  "Thái Nguyên",
  "Thanh Hóa",
  "Thừa Thiên‑Huế",
  "Tiền Giang",
  "TP. Hồ Chí Minh",
  "Trà Vinh",
  "Tuyên Quang",
  "Vĩnh Long",
  "Vĩnh Phúc",
  "Yên Bái",
];

const emptyPlayer = {
  fullName: "",
  phone: "",
  avatar: "",
  selfScore: "",
  province: "",
  note: "",
};
const PLACEHOLDER = "https://dummyimage.com/80x80/cccccc/ffffff&text=Avatar";
const TournamentRegistration = () => {
  const { id } = useParams();
  const [player1, setP1] = useState(emptyPlayer);
  const [player2, setP2] = useState(emptyPlayer);
  const [message, setMessage] = useState("");
  const { data: tour } = useGetTournamentQuery(id);
  const { data: regs, isLoading, error } = useGetRegistrationsQuery(id);
  const [createReg, { isLoading: saving }] = useCreateRegistrationMutation();
  const [updatePayment] = useUpdatePaymentMutation();
  const [checkin] = useCheckinMutation();

  const onChange = (setter) => (e) =>
    setter((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    try {
      await createReg({
        tourId: id,
        player1,
        player2,
        message,
      }).unwrap();
      toast.success("Đăng ký thành công");
      setP1(emptyPlayer);
      setP2(emptyPlayer);
      setMessage("");
    } catch (err) {
      toast.error(err?.data?.message || err.error);
    }
  };

  const togglePayment = async (reg) => {
    try {
      await updatePayment({
        regId: reg._id,
        status: reg.payment.status === "Đã nộp" ? "Chưa nộp" : "Đã nộp",
      }).unwrap();
    } catch (err) {
      toast.error("Lỗi cập nhật lệ phí");
    }
  };

  const handleCheckin = async (reg) => {
    try {
      await checkin({ regId: reg._id }).unwrap();
    } catch (err) {
      toast.error("Lỗi check‑in");
    }
  };

  const playerForm = (p, setP, label) => (
    <>
      <h6 className="mt-3">{label}</h6>
      <Form.Group className="mb-2" controlId={`${label}-name`}>
        <Form.Label>Họ tên</Form.Label>
        <Form.Control
          name="fullName"
          value={p.fullName}
          onChange={onChange(setP)}
          required
        />
      </Form.Group>
      <Form.Group className="mb-2" controlId={`${label}-phone`}>
        <Form.Label>Số ĐT</Form.Label>
        <Form.Control
          name="phone"
          value={p.phone}
          onChange={onChange(setP)}
          required
        />
      </Form.Group>
      <Form.Group className="mb-2" controlId={`${label}-avatar`}>
        <Form.Label>Ảnh (URL)</Form.Label>
        <Form.Control
          name="avatar"
          value={p.avatar}
          onChange={onChange(setP)}
        />
      </Form.Group>
      <Row>
        <Col>
          <Form.Group className="mb-2" controlId={`${label}-score`}>
            <Form.Label>Điểm tự chấm</Form.Label>
            <Form.Control
              type="number"
              min="0"
              max="10"
              name="selfScore"
              value={p.selfScore}
              onChange={onChange(setP)}
              required
            />
          </Form.Group>
        </Col>
        <Col>
          <Form.Group className="mb-2" controlId={`${label}-province`}>
            <Form.Label>Khu vực</Form.Label>
            <Form.Select
              name="province"
              value={p.province}
              onChange={onChange(setP)}
              required
            >
              <option value="">Chọn tỉnh</option>
              {PROVINCES.map((pr) => (
                <option key={pr} value={pr}>
                  {pr}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Col>
      </Row>
      <Form.Group className="mb-3" controlId={`${label}-note`}>
        <Form.Label>Ghi chú</Form.Label>
        <Form.Control name="note" value={p.note} onChange={onChange(setP)} />
      </Form.Group>
    </>
  );

  const Avatar = ({ src, name }) => (
    <Image
      src={src || PLACEHOLDER}
      onError={(e) => {
        e.currentTarget.src = PLACEHOLDER;
      }}
      roundedCircle
      width={40}
      height={40}
      className="me-2 mb-1"
      alt={name}
    />
  );

  return (
    <Container className="py-4">
      <h3 className="mb-4">Đăng ký Giải đấu</h3>
      <Row>
        {/* Left form */}
        <Col lg={4}>
          <Form onSubmit={submit}>
            {playerForm(player1, setP1, "VĐV 1")}
            {playerForm(player2, setP2, "VĐV 2")}

            <Form.Group className="mb-3" controlId="message">
              <Form.Label>Lời nhắn</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </Form.Group>

            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Đang lưu…" : "Đăng ký"}
            </Button>
            <Button
              as={Link}
              to={`/tournament/${id}/checkin`}
              variant="success"
              className="me-2"
              size="sm"
            >
              Check‑in
            </Button>
            <Button
              as={Link}
              to={`/tournament/${id}/bracket`}
              variant="info"
              size="sm"
            >
              Sơ đồ
            </Button>
          </Form>
        </Col>

        {/* Right table list */}
        <Col lg={8}>
          <h5 className="mb-2">Danh sách đăng ký</h5>
          {isLoading ? (
            <Spinner animation="border" />
          ) : error ? (
            <Alert variant="danger">
              {error?.data?.message || error.error}
            </Alert>
          ) : (
            <Table
              striped
              bordered
              hover
              responsive
              size="sm"
              className="align-middle"
            >
              <thead>
                <tr>
                  <th>#</th>
                  <th>VĐV 1</th>
                  <th>VĐV 2</th>
                  <th>Đăng lúc</th>
                  <th>Lệ phí</th>
                  <th>Check‑in</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {regs.map((r, idx) => (
                  <tr key={r._id}>
                    <td>{idx + 1}</td>
                    <td>
                      <Avatar
                        src={r.player1.avatar}
                        name={r.player1.fullName}
                      />
                      {r.player1.fullName}
                      <br />
                      <small>{r.player1.phone}</small>
                    </td>
                    <td>
                      <Avatar
                        src={r.player2.avatar}
                        name={r.player2.fullName}
                      />
                      {r.player2.fullName}
                      <br />
                      <small>{r.player2.phone}</small>
                    </td>
                    <td>{new Date(r.createdAt).toLocaleString()}</td>
                    <td>
                      {r.payment.status === "Đã nộp" ? (
                        <Badge bg="success">
                          Đã nộp
                          <br />
                          {new Date(r.payment.paidAt).toLocaleDateString()}
                        </Badge>
                      ) : (
                        <Badge bg="secondary">Chưa nộp</Badge>
                      )}
                    </td>
                    <td>
                      {r.checkinAt ? (
                        <Badge bg="info">
                          {new Date(r.checkinAt).toLocaleTimeString()}
                        </Badge>
                      ) : (
                        <Badge bg="secondary">Chưa</Badge>
                      )}
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant={
                          r.payment.status === "Đã nộp"
                            ? "outline-danger"
                            : "outline-success"
                        }
                        className="me-1"
                        onClick={() => togglePayment(r)}
                      >
                        {r.payment.status === "Đã nộp"
                          ? "Huỷ phí"
                          : "Xác nhận phí"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={() => handleCheckin(r)}
                      >
                        Check‑in
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {tour && (
            <Row className="mt-4">
              <Col md={6}>
                <div dangerouslySetInnerHTML={{ __html: tour.contactHtml }} />
              </Col>
              <Col md={6}>
                <div dangerouslySetInnerHTML={{ __html: tour.contentHtml }} />
              </Col>
            </Row>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default TournamentRegistration;
