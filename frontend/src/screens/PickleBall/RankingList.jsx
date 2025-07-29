import { useState, useEffect } from 'react';
import {
  Container, Table, Spinner, Alert, Form, Button, Image
} from 'react-bootstrap';
import { useGetRankingsQuery } from '../../slices/rankingsApiSlice';

const PLACEHOLDER = 'https://dummyimage.com/40x40/cccccc/ffffff&text=?';
const colorByGames = (g) => g < 1 ? '#f00' : g < 7 ? '#ffc107' : '#212529';

export default function RankingList() {
  const [keyword, setKeyword] = useState('');
  const { data: list = [], isLoading, error, refetch } = useGetRankingsQuery(keyword);

  useEffect(() => { const t = setTimeout(refetch, 300); return () => clearTimeout(t); }, [keyword]);

  return (
    <Container fluid className="py-3">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h4 className="mb-0">PLAYER RANKING</h4>
        <Button size="sm" variant="primary">Tự chấm trình</Button>
      </div>

      {/* chú thích màu */}
      <p className="mb-2">
        <b>Đỏ</b>: tự chấm&nbsp;&nbsp;
        <b>Vàng</b>: &lt; 7 trận&nbsp;&nbsp;
        <b>Đen</b>: ≥ 7 trận
      </p>

      <Form.Control
        placeholder="Search"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        style={{ maxWidth: 300 }} className="mb-2"
      />

      {isLoading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error?.data?.message || error.error}</Alert>
      ) : (
        <Table striped bordered hover responsive size="sm">
          <thead>
            <tr>
              <th>#</th><th>ID</th><th>Ảnh</th><th>Nick</th><th>Giới&nbsp;tính</th>
              <th>Tỉnh</th><th>Điểm&nbsp;đôi</th><th>Điểm&nbsp;đơn</th>
              <th>Cập nhật</th><th>Tham gia</th><th>Xác thực</th><th></th><th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, idx) => {
              const u = r.user || {};
              const c = colorByGames(r.games);
              return (
                <tr key={r._id}>
                  <td>{idx + 1}</td>
                  <td>{u._id?.toString().slice(-5)}</td>
                  <td><Image src={u.avatar || PLACEHOLDER} roundedCircle width={32} height={32} /></td>
                  <td>{u.nickname}</td>
                  <td>{u.gender || '--'}</td>
                  <td>{u.province || '--'}</td>
                  <td style={{ color: c }}>{r.ratingDouble.toFixed(3)}</td>
                  <td style={{ color: c }}>{r.ratingSingle.toFixed(3)}</td>
                  <td>{new Date(r.updatedAt).toLocaleDateString()}</td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td>{u.verified ? 'Xác thực' : 'Chờ'}</td>
                  <td><Button size="sm">Chấm</Button></td>
                  <td><Button size="sm" variant="success">Hồ sơ</Button></td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Container>
  );
}
