// src/pages/TournamentDashboard.jsx – “Đăng ký” chuyển route /tournament/:id/register
import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import {
  Card,
  Table,
  Image,
  Container,
  Spinner,
  Alert,
  Modal,
  Button,
  Tabs,
  Tab,
} from "react-bootstrap";
import { useGetTournamentsQuery } from "../../slices/tournamentsApiSlice";

const THUMB_SIZE = 120;

const TournamentDashboard = () => {
  const [params] = useSearchParams();
  const sportType = params.get("sportType") || 2;
  const groupId = params.get("groupId") || 0;

  const [previewSrc, setPreviewSrc] = useState(null);
  const [key, setKey] = useState("Sắp diễn ra");

  const {
    data: tournaments,
    isLoading,
    error,
  } = useGetTournamentsQuery({
    sportType,
    groupId,
  });

  const openPreview = (src) => setPreviewSrc(src);
  const closePreview = () => setPreviewSrc(null);

  const renderRows = (list) =>
    list.map((t) => (
      <tr key={t._id}>
        <td>
          <Image
            src={t.image}
            alt={t.name}
            thumbnail
            fluid
            style={{ cursor: "pointer", width: THUMB_SIZE, height: "auto" }}
            onClick={() => openPreview(t.image)}
          />
        </td>
        <td>{t.name}</td>
        <td>{new Date(t.registrationDeadline).toLocaleDateString()}</td>
        <td>
          {t.registered}/{t.expected}
        </td>
        <td>{t.matchesCount}</td>
        <td>
          {new Date(t.startDate).toLocaleDateString()} –{" "}
          {new Date(t.endDate).toLocaleDateString()}
        </td>
        <td>{t.location}</td>
        <td>{t.status}</td>
        <td>
          <Button
            as={Link}
            to={`/tournament/${t._id}/register`}
            size="sm"
            variant="primary"
            className="me-1"
          >
            Đăng ký
          </Button>
          <Button
            as={Link}
            to={`/tournament/${t._id}/checkin`}
            size="sm"
            variant="success"
            className="me-1"
          >
            Check‑in
          </Button>
          <Button
            as={Link}
            to={`/tournament/${t._id}/bracket`}
            size="sm"
            variant="info"
          >
            Sơ đồ
          </Button>
        </td>
      </tr>
    ));

  const tableHead = (
    <thead className="table-dark">
      <tr>
        <th style={{ width: THUMB_SIZE }}>Ảnh</th>
        <th>Tên giải</th>
        <th>Hạn đăng ký</th>
        <th>Đăng ký / Dự kiến</th>
        <th>Số trận</th>
        <th>Thời gian</th>
        <th>Địa điểm</th>
        <th>Trạng thái</th>
        <th>Hành động</th>
      </tr>
    </thead>
  );

  return (
    <Container className="py-4">
      <h3 className="mb-3">Dashboard Giải đấu</h3>

      {isLoading && <Spinner animation="border" />}
      {error && (
        <Alert variant="danger">{error?.data?.message || error.error}</Alert>
      )}

      {tournaments && (
        <Tabs activeKey={key} onSelect={(k) => setKey(k)} className="mb-3">
          {["Sắp diễn ra", "Đang diễn ra", "Đã diễn ra"].map((tab) => (
            <Tab eventKey={tab} title={tab} key={tab}>
              <Card body className="p-0 overflow-auto">
                <Table hover responsive className="mb-0 align-middle">
                  {tableHead}
                  <tbody>
                    {renderRows(tournaments.filter((t) => t.status === tab))}
                  </tbody>
                </Table>
              </Card>
            </Tab>
          ))}
        </Tabs>
      )}

      <Modal show={!!previewSrc} onHide={closePreview} centered size="lg">
        <Modal.Body className="p-0 text-center">
          {previewSrc && <Image src={previewSrc} alt="Preview" fluid />}
        </Modal.Body>
        <Modal.Footer className="justify-content-center border-0 pt-0">
          <Button variant="secondary" onClick={closePreview}>
            Đóng
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default TournamentDashboard;
