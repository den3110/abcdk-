// src/screens/PickleBall/TournamentBracket.jsx
import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Spinner, Alert, Button } from 'react-bootstrap';
import { Bracket } from 'react-brackets';

import {
  useGetMatchesQuery,
  useGetTournamentQuery,
} from '../../slices/tournamentsApiSlice';

/* ========= helper ========= */

/** Lấy số vòng (1‑n) từ chuỗi mã “V2‑SF1”, “V3‑FINAL”… */
const roundIndex = (code = '') => {
  const m = code.match(/^V(\d+)/i);
  return m ? Number(m[1]) : 0;
};

/** Nhãn mặc định khi đội chưa xác định */
const PLACEHOLDER = 'Thắng trận trước';

/** Tạo object team cho react‑brackets */
const makeTeam = (name, score) => ({
  name : name?.trim() ? name : PLACEHOLDER,
  score: score ?? undefined,
});

/** Chuyển danh sách match từ BE → rounds[] của react‑brackets */
const toRounds = (matches = []) => {
  const map = new Map();            // roundNo -> seeds[]

  matches.forEach((m) => {
    const rNo = roundIndex(m.code);
    if (!rNo) return;               // bỏ vòng bảng / mã không hợp lệ

    const seed = {
      id  : m._id,
      date: m.date ?? '',
      teams: [
        makeTeam(m.team1, m.score1),
        makeTeam(m.team2, m.score2),
      ],
    };

    if (!map.has(rNo)) map.set(rNo, []);
    map.get(rNo).push(seed);
  });

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])    // vòng 1 → n
    .map(([no, seeds]) => ({
      title: `Vòng ${no}`,
      seeds,
    }));
};

/* ========= page ========= */
export default function TournamentBracket() {
  const { id } = useParams();

  const { data: tour } = useGetTournamentQuery(id);
  const {
    data: matches = [],
    isLoading,
    error,
  } = useGetMatchesQuery(id);

  /* chỉ lấy các trận knock‑out (mã V2/V3 …) */
  const rounds = useMemo(() => {
    const ko = matches.filter((m) => /^V[23]/.test(m.code));
    return toRounds(ko);
  }, [matches]);

  return (
    <Container fluid className="py-3">
      {/* ---------- header ---------- */}
      <Row className="mb-3">
        <Col>
          <h4 className="mb-0">Sơ đồ knock‑out – {tour?.name}</h4>
        </Col>
        <Col className="text-end">
          <Button
            as={Link}
            to={`/tournament/${id}/checkin`}
            size="sm"
            variant="success"
            className="me-2"
          >
            Check‑in
          </Button>
          <Button
            as={Link}
            to={`/tournament/${id}/register`}
            size="sm"
            variant="info"
          >
            Đăng ký
          </Button>
        </Col>
      </Row>

      {/* ---------- body ---------- */}
      {isLoading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error?.data?.message || error.error}</Alert>
      ) : rounds.length === 0 ? (
        <Alert variant="warning">Chưa có dữ liệu knock‑out.</Alert>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          {/* Bracket co giãn theo nội dung */}
          <Bracket rounds={rounds} />
        </div>
      )}
    </Container>
  );
}
