// src/pages/TournamentCheckin.jsx
import { useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Container,
  Row,
  Col,
  Table,
  Button,
  Form,
  Badge,
  Spinner,
  Alert,
  InputGroup,
  Image,
} from "react-bootstrap";
import {
  useGetRegistrationsQuery,
  useCheckinMutation,
  useGetTournamentQuery,
  useGetMatchesQuery,
} from "../../slices/tournamentsApiSlice";
import { toast } from "react-toastify";

const PLACE = "https://dummyimage.com/70x70/cccccc/ffffff&text=Avatar";

const Avatar = ({ src, alt }) => (
  <Image
    src={src || PLACE}
    onError={(e) => (e.currentTarget.src = PLACE)}
    roundedCircle
    width={30}
    height={30}
    className="me-2"
    alt={alt}
  />
);

export default function TournamentCheckin() {
  const { id } = useParams();

  /* fetch */
  const { data: tour } = useGetTournamentQuery(id);
  const { data: regs = [], isLoading, error } = useGetRegistrationsQuery(id);
  const { data: matches = [] } = useGetMatchesQuery(id);

  const [phone, setPhone] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusy] = useState(null);
  const [checkin] = useCheckinMutation();

  /** check‑in theo SĐT */
  const handlePhone = async () => {
    const reg = regs.find(
      (r) => r.player1.phone === phone || r.player2.phone === phone
    );
    if (!reg) return toast.error("Không tìm thấy số ĐT");
    if (reg.checkinAt) return toast.info("Đã check‑in rồi");
    setBusy(reg._id);
    try {
      await checkin({ regId: reg._id }).unwrap();
    } catch {
      toast.error("Lỗi check‑in");
    } finally {
      setBusy(null);
      setPhone("");
    }
  };

  /** filter search list */
  const filtered = useMemo(() => {
    const key = search.trim().toLowerCase();
    if (!key) return matches;
    return matches.filter(
      (m) =>
        m.code.toLowerCase().includes(key) ||
        (m.team1 && m.team1.toLowerCase().includes(key)) ||
        (m.team2 && m.team2.toLowerCase().includes(key)) ||
        m.status.toLowerCase().includes(key)
    );
  }, [matches, search]);

  return (
    <Container fluid className="py-3">
      {/* HEADER + buttons */}
      <h4 className="fw-bold mb-3">
        Chào mừng bạn đến với giải đấu:&nbsp;
        <span className="text-uppercase">{tour?.name}</span>
      </h4>

      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <InputGroup style={{ maxWidth: 220 }}>
          <Form.Control
            placeholder="Nhập SĐT VĐV đăng ký"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Button variant="primary" onClick={handlePhone}>
            Check‑in
          </Button>
        </InputGroup>

        <Button variant="warning" as={Link} to={`/tournament/${id}/bracket`}>
          Xem sơ đồ giải đấu
        </Button>
        <Button variant="info" as={Link} to={`/tournament/${id}/register`}>
          Danh sách đăng ký
        </Button>
      </div>

      {/* SEARCH */}
      <Row className="mb-3">
        <Col md={4}>
          <Form.Control
            placeholder="Tìm: Tên VĐV, mã trận hoặc tình trạng"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Col>
      </Row>

      {isLoading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error?.data?.message || error.error}</Alert>
      ) : (
        <Table striped bordered hover responsive>
          <thead className="table-dark">
            <tr>
              <th>Mã trận</th>
              <th>Ngày</th>
              <th>Giờ</th>
              <th>Đội 1</th>
              <th>Tỷ số</th>
              <th>Đội 2</th>
              <th>Sân</th>
              <th>Trọng tài</th>
              <th>Tình trạng</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m._id}>
                <td>{m.code}</td>
                <td>{new Date(m.date).toLocaleDateString()}</td>
                <td>{m.time}</td>
                <td>{m.team1}</td>
                <td>
                  {m.score1} ‑ {m.score2}
                </td>
                <td>{m.team2}</td>
                <td>{m.field}</td>
                <td>{m.referee}</td>
                <td>
                  <Badge
                    bg={
                      m.status === "Hoàn thành"
                        ? "success"
                        : m.status === "Đang chơi"
                        ? "warning"
                        : "secondary"
                    }
                  >
                    {m.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Container>
  );
}
