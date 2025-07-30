// src/pages/RankingList.jsx
import { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Avatar,
  CircularProgress,
  Alert,
  Stack,
  Chip,
} from '@mui/material';
import { useGetRankingsQuery } from '../../slices/rankingsApiSlice';
import { Link } from 'react-router-dom';

const PLACEHOLDER = 'https://dummyimage.com/40x40/cccccc/ffffff&text=?';
const colorByGames = (g) => g < 1 ? '#f44336' : g < 7 ? '#ff9800' : '#212121';

export default function RankingList() {
  const [keyword, setKeyword] = useState('');
  const { data: list = [], isLoading, error, refetch } = useGetRankingsQuery(keyword);

  useEffect(() => {
    const t = setTimeout(refetch, 300);
    return () => clearTimeout(t);
  }, [keyword]);

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5" fontWeight={600}>PLAYER RANKING</Typography>
        <Button as={Link}
                        to="/levelpoint" variant="contained" size="small">Tự chấm trình</Button>
      </Box>

      {/* Chú thích */}
      <Stack direction="row" spacing={2} mb={2}>
        <Chip label="Đỏ: tự chấm" sx={{ bgcolor: '#f44336', color: '#fff' }} />
        <Chip label="Vàng: < 7 trận" sx={{ bgcolor: '#ff9800', color: '#fff' }} />
        <Chip label="Đen: ≥ 7 trận" sx={{ bgcolor: '#212121', color: '#fff' }} />
      </Stack>

      {/* Ô tìm kiếm */}
      <TextField
        label="Tìm kiếm"
        variant="outlined"
        size="small"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        sx={{ mb: 2, width: 300 }}
      />

      {/* Hiển thị bảng */}
      {isLoading ? (
        <CircularProgress />
      ) : error ? (
        <Alert severity="error">{error?.data?.message || error.error}</Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>ID</TableCell>
                <TableCell>Ảnh</TableCell>
                <TableCell>Nick</TableCell>
                <TableCell>Giới&nbsp;tính</TableCell>
                <TableCell>Tỉnh</TableCell>
                <TableCell>Điểm&nbsp;đôi</TableCell>
                <TableCell>Điểm&nbsp;đơn</TableCell>
                <TableCell>Cập nhật</TableCell>
                <TableCell>Tham gia</TableCell>
                <TableCell>Xác thực</TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((r, idx) => {
                const u = r.user || {};
                const color = colorByGames(r.games);
                return (
                  <TableRow key={r._id}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell>{u._id?.toString().slice(-5)}</TableCell>
                    <TableCell>
                      <Avatar
                        src={u.avatar || PLACEHOLDER}
                        sx={{ width: 32, height: 32 }}
                        alt={u.nickname || '?'}
                      />
                    </TableCell>
                    <TableCell>{u.nickname}</TableCell>
                    <TableCell>{u.gender || '--'}</TableCell>
                    <TableCell>{u.province || '--'}</TableCell>
                    <TableCell sx={{ color }}>{r.ratingDouble.toFixed(3)}</TableCell>
                    <TableCell sx={{ color }}>{r.ratingSingle.toFixed(3)}</TableCell>
                    <TableCell>{new Date(r.updatedAt).toLocaleDateString()}</TableCell>
                    <TableCell>{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Chip
                        label={u.verified ? 'Xác thực' : 'Chờ'}
                        size="small"
                        color={u.verified ? 'success' : 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      <Button size="small" variant="outlined">Chấm</Button>
                    </TableCell>
                    <TableCell>
                      <Button size="small" variant="contained" color="success">Hồ sơ</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Container>
  );
}
