// src/pages/TournamentCheckin.jsx
import { useState, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Container, Row, Col } from "react-bootstrap"; // vẫn Bootstrap grid
import {
  TextField,
  Button as MuiButton,
  InputAdornment,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Chip,
  Avatar,
  CircularProgress,
  Alert,
  Stack,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import {
  useGetRegistrationsQuery,
  useCheckinMutation,
  useGetTournamentQuery,
  useGetMatchesQuery,
} from "../../slices/tournamentsApiSlice";
import { toast } from "react-toastify";

const PLACE = "https://dummyimage.com/70x70/cccccc/ffffff&text=Avatar";
const AvatarMini = ({ src, alt }) => (
  <Avatar
    src={src || PLACE}
    alt={alt}
    sx={{ width: 30, height: 30, mr: 1 }}
    imgProps={{ onError: (e) => (e.currentTarget.src = PLACE) }}
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

  /* --- Check‑in theo SĐT --- */
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

  /* --- Lọc danh sách trận --- */
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
    <Container fluid className="py-4">
      {/* HEADER */}
      <Typography variant="h5" fontWeight={700} mb={3}>
        Chào mừng bạn đến với giải đấu:&nbsp;
        <span style={{ textTransform: "uppercase", color: "#1976d2" }}>
          {tour?.name}
        </span>
      </Typography>

      {/* ACTION BAR */}
      <Stack
        direction="row"
        spacing={2}
        flexWrap="wrap"
        alignItems="center"
        mb={3}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            size="small"
            placeholder="Nhập SĐT VĐV đăng ký"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            sx={{ maxWidth: 220 }}
          />
          <MuiButton
            variant="contained"
            size="small"
            onClick={handlePhone}
            disabled={busyId !== null}
          >
            Check‑in
          </MuiButton>
        </Stack>

        <MuiButton
          component={Link}
          to={`/tournament/${id}/bracket`}
          variant="contained"
          color="warning"
          size="small"
        >
          Sơ đồ giải đấu
        </MuiButton>

        <MuiButton
          component={Link}
          to={`/tournament/${id}/register`}
          variant="contained"
          color="info"
          size="small"
        >
          Danh sách đăng ký
        </MuiButton>
      </Stack>

      {/* SEARCH BOX */}
      <Row className="mb-3">
        <Col md={4}>
          <TextField
            fullWidth
            size="small"
            placeholder="Tìm: Tên VĐV, mã trận, tình trạng…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
        </Col>
      </Row>

      {/* BẢNG TRẬN */}
      {isLoading ? (
        <CircularProgress />
      ) : error ? (
        <Alert severity="error">{error?.data?.message || error.error}</Alert>
      ) : (
        <Table
          size="small"
          sx={{
            "& thead th": { fontWeight: 600 },
            "& tbody td": { whiteSpace: "nowrap" },
          }}
          stickyHeader
        >
          <TableHead>
            <TableRow>
              <TableCell>Mã trận</TableCell>
              <TableCell>Ngày</TableCell>
              <TableCell>Giờ</TableCell>
              <TableCell>Đội&nbsp;1</TableCell>
              <TableCell>Tỷ số</TableCell>
              <TableCell>Đội&nbsp;2</TableCell>
              <TableCell>Sân</TableCell>
              <TableCell>Trọng tài</TableCell>
              <TableCell>Tình trạng</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {filtered.map((m) => (
              <TableRow key={m._id} hover>
                <TableCell>{m.code}</TableCell>
                <TableCell>{new Date(m.date).toLocaleDateString()}</TableCell>
                <TableCell>{m.time}</TableCell>
                <TableCell>{m.team1}</TableCell>
                <TableCell align="center">
                  <strong>
                    {m.score1} ‑ {m.score2}
                  </strong>
                </TableCell>
                <TableCell>{m.team2}</TableCell>
                <TableCell>{m.field}</TableCell>
                <TableCell>{m.referee}</TableCell>
                <TableCell>
                  <Chip
                    label={m.status}
                    size="small"
                    color={
                      m.status === "Hoàn thành"
                        ? "success"
                        : m.status === "Đang chơi"
                        ? "warning"
                        : "default"
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Container>
  );
}
