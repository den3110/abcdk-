// src/pages/TournamentCheckin.jsx
import { useState, useMemo, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { Container, Row, Col } from "react-bootstrap";
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
  Box,
  Paper,
  Divider,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import {
  useGetRegistrationsQuery,
  useCheckinMutation,
  useGetTournamentQuery,
  useGetTournamentMatchesForCheckinQuery,
  // 👇 2 hook mới cho user check-in (tìm theo SĐT/nickname)
  useSearchUserMatchesQuery,
  useUserCheckinRegistrationMutation,
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

const fmtDate = (s) => (s ? new Date(s).toLocaleDateString() : "—");
const fmtTime = (s) => (s && s.length ? s : "—");

export default function TournamentCheckin() {
  const { id } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  /* fetch */
  const { data: tour } = useGetTournamentQuery(id);
  const {
    data: regs = [],
    isLoading,
    error,
    refetch: refetchRegs,
  } = useGetRegistrationsQuery(id);
  const { data: matches = [] } = useGetTournamentMatchesForCheckinQuery(id);

  // ----- phần cũ: check-in theo SĐT có sẵn -----
  const [phone, setPhone] = useState("");
  const [busyId, setBusy] = useState(null);
  const [checkin] = useCheckinMutation();

  const handlePhone = async () => {
    const reg = regs.find(
      (r) => r.player1.phone === phone || r.player2.phone === phone
    );
    if (!reg)
      return toast.error("Không tìm thấy số ĐT trong danh sách đăng ký");
    if (reg.payment?.status !== "Paid")
      return toast.error("Chưa thanh toán lệ phí — không thể check-in");
    if (reg.checkinAt) return toast.info("Đã check-in rồi");

    setBusy(reg._id);
    try {
      await checkin({ regId: reg._id }).unwrap();
      toast.success("Check-in thành công");
      refetchRegs();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Lỗi check-in");
    } finally {
      setBusy(null);
      setPhone("");
    }
  };

  // ----- MỚI THÊM: tìm & check-in theo SĐT/Nickname -----
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const {
    data: searchRes,
    isFetching: searching,
    isError: searchError,
    error: searchErrObj,
    refetch: refetchSearch,
  } = useSearchUserMatchesQuery(
    { tournamentId: id, q: submittedQ },
    { skip: !submittedQ }
  );
  const [userCheckin, { isLoading: checkingUser }] =
    useUserCheckinRegistrationMutation();

  const onSubmitSearch = useCallback(() => {
    const key = q.trim();
    if (!key) return toast.info("Nhập SĐT hoặc nickname để tìm");
    setSubmittedQ(key);
  }, [q]);

  const onKeyDownSearch = (e) => {
    if (e.key === "Enter") onSubmitSearch();
  };

  const results = searchRes?.results || [];
  const handleUserCheckin = async (regId) => {
    try {
      const res = await userCheckin({
        tournamentId: id,
        q: submittedQ,
        regId,
      }).unwrap();
      toast.success(res?.message || "Check-in thành công");
      refetchSearch();
      refetchRegs();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Check-in thất bại");
    }
  };

  // ----- filter danh sách TRẬN của GIẢI (phần cũ) -----
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const key = search.trim().toLowerCase();
    if (!key) return matches;
    return matches.filter(
      (m) =>
        m.code.toLowerCase().includes(key) ||
        (m.team1 && m.team1.toLowerCase().includes(key)) ||
        (m.team2 && m.team2.toLowerCase().includes(key)) ||
        (m.status || "").toLowerCase().includes(key)
    );
  }, [matches, search]);

  /* ---------- RENDER ---------- */
  return (
    <Container fluid className="py-4">
      {/* HEADER */}
      <Typography variant="h5" fontWeight={700} mb={3}>
        Chào mừng bạn đến với giải đấu:&nbsp;
        <span style={{ textTransform: "uppercase", color: "#1976d2" }}>
          {tour?.name}
        </span>
      </Typography>

      {/* ACTION BAR (cũ): check-in theo SĐT trong danh sách đăng ký */}
      <Stack
        direction={isMobile ? "column" : "row"}
        spacing={2}
        alignItems={isMobile ? "stretch" : "center"}
        mb={3}
      >
        {/* <Stack
          direction={isMobile ? "column" : "row"}
          spacing={1}
          alignItems={isMobile ? "stretch" : "center"}
        >
          <TextField
            size="small"
            fullWidth={isMobile}
            placeholder="Nhập SĐT VĐV đăng ký"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            sx={{ maxWidth: isMobile ? "100%" : 220 }}
          />
          <MuiButton
            variant="contained"
            size="small"
            onClick={handlePhone}
            disabled={busyId !== null}
            fullWidth={isMobile}
          >
            Check-in
          </MuiButton>
        </Stack> */}

        <MuiButton
          component={Link}
          to={`/tournament/${id}/bracket`}
          variant="contained"
          color="warning"
          size="small"
          fullWidth={isMobile}
        >
          Sơ đồ giải đấu
        </MuiButton>

        <MuiButton
          component={Link}
          to={`/tournament/${id}/register`}
          variant="contained"
          color="info"
          size="small"
          fullWidth={isMobile}
        >
          Danh sách đăng ký
        </MuiButton>
      </Stack>

      {/* ====== MỚI THÊM: Tìm & check-in theo SĐT/Nickname (KHÔNG xoá phần cũ) ====== */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} mb={1}>
          Check-in theo SĐT/Nickname
        </Typography>
        <Stack
          direction={isMobile ? "column" : "row"}
          spacing={1}
          alignItems="center"
        >
          <TextField
            fullWidth
            size="small"
            placeholder="Nhập SĐT hoặc nickname đã đăng ký…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDownSearch}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <MuiButton
            variant="contained"
            onClick={onSubmitSearch}
            disabled={searching}
          >
            Tìm
          </MuiButton>
        </Stack>

        {/* Kết quả tìm */}
        {searching && (
          <Box py={2} textAlign="center">
            <CircularProgress size={22} />
          </Box>
        )}
        {submittedQ && !searching && results.length === 0 && !searchError && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Không tìm thấy đăng ký nào khớp với <strong>{submittedQ}</strong>.
          </Alert>
        )}
        {searchError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {searchErrObj?.data?.message ||
              searchErrObj?.error ||
              "Lỗi tìm kiếm"}
          </Alert>
        )}

        {/* Render các registration khớp */}
        <Stack spacing={2} mt={results.length ? 2 : 0}>
          {results.map((reg) => {
            const canCheckin = reg.paid && !reg.checkinAt;
            return (
              <Paper key={reg.regId} variant="outlined" sx={{ p: 2 }}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems={{ xs: "flex-start", sm: "center" }}
                  spacing={2}
                  flexWrap="wrap"
                >
                  <Box>
                    <Typography variant="subtitle1" fontWeight={700}>
                      {reg.teamLabel}
                    </Typography>
                    <Stack direction="row" spacing={1} mt={0.5} flexWrap="wrap">
                      <Chip
                        size="small"
                        label={reg.paid ? "Đã thanh toán" : "Chưa thanh toán"}
                        color={reg.paid ? "success" : "default"}
                      />
                      {reg.checkinAt ? (
                        <Chip
                          size="small"
                          label={`Đã check-in • ${new Date(
                            reg.checkinAt
                          ).toLocaleString()}`}
                          color="success"
                          variant="outlined"
                        />
                      ) : (
                        <Chip
                          size="small"
                          label="Chưa check-in"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  </Box>
                  <MuiButton
                    variant="contained"
                    disabled={!canCheckin || checkingUser}
                    onClick={() => handleUserCheckin(reg.regId)}
                  >
                    Check-in
                  </MuiButton>
                </Stack>

                {/* danh sách trận của registration này */}
                <Divider sx={{ my: 1.5 }} />
                {reg.matches?.length ? (
                  <Box sx={{ width: "100%", overflowX: "auto" }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Mã trận</TableCell>
                          <TableCell>Ngày</TableCell>
                          <TableCell>Giờ</TableCell>
                          <TableCell align="center">Tỷ số</TableCell>
                          <TableCell>Sân</TableCell>
                          <TableCell>Trọng tài</TableCell>
                          <TableCell>Tình trạng</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {reg.matches.map((m) => (
                          <TableRow key={m._id}>
                            <TableCell>{m.code}</TableCell>
                            <TableCell>{fmtDate(m.date)}</TableCell>
                            <TableCell>{fmtTime(m.time)}</TableCell>
                            <TableCell align="center">
                              <strong>
                                {m.score1} - {m.score2}
                              </strong>
                            </TableCell>
                            <TableCell>{m.field || "Chưa xác định"}</TableCell>
                            <TableCell>{m.referee || "—"}</TableCell>
                            <TableCell>
                              <Chip
                                label={m.status}
                                size="small"
                                color={m.statusColor || "default"}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Chưa có trận nào được xếp cho đôi này.
                  </Typography>
                )}
              </Paper>
            );
          })}
        </Stack>
      </Paper>
      {/* ====== HẾT phần mới, phần dưới GIỮ NGUYÊN ====== */}

      {/* SEARCH BOX cho danh sách TRẬN của GIẢI (cũ) */}
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

      {/* DANH SÁCH TRẬN CỦA GIẢI (cũ) */}
      {isLoading ? (
        <CircularProgress />
      ) : error ? (
        <Alert severity="error">{error?.data?.message || error.error}</Alert>
      ) : isMobile ? (
        /* ---------- MOBILE: Thẻ xếp dọc ---------- */
        <Stack spacing={2}>
          {filtered.map((m) => (
            <Paper key={m._id} elevation={1} sx={{ p: 2 }}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
              >
                <Typography variant="subtitle2" fontWeight={600}>
                  {m.code}
                </Typography>
                <Chip
                  label={m.status}
                  size="small"
                  color={m.statusColor || "default"}
                />
              </Stack>

              <Typography variant="caption" color="text.secondary">
                {fmtDate(m.date)} • {fmtTime(m.time)} • {m.field}
              </Typography>

              <Divider sx={{ my: 1 }} />

              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
              >
                <Typography variant="body2" fontWeight={500}>
                  {m.team1}
                </Typography>
                <Typography variant="subtitle1" fontWeight={700}>
                  {m.score1}-{m.score2}
                </Typography>
                <Typography
                  variant="body2"
                  fontWeight={500}
                  textAlign="right"
                  sx={{ minWidth: 80 }}
                >
                  {m.team2}
                </Typography>
              </Stack>

              {m.referee && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  mt={0.5}
                  display="block"
                >
                  Trọng tài: {m.referee}
                </Typography>
              )}
            </Paper>
          ))}
        </Stack>
      ) : (
        /* ---------- DESKTOP: Bảng cũ ---------- */
        <Box sx={{ width: "100%", overflowX: "auto" }}>
          <Table
            size="small"
            stickyHeader
            sx={{
              "& thead th": { fontWeight: 600 },
              "& tbody td": { whiteSpace: "nowrap" },
            }}
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
                  <TableCell>{fmtDate(m.date)}</TableCell>
                  <TableCell>{fmtTime(m.time)}</TableCell>
                  <TableCell>{m.team1}</TableCell>
                  <TableCell align="center">
                    <strong>
                      {m.score1} - {m.score2}
                    </strong>
                  </TableCell>
                  <TableCell>{m.team2}</TableCell>
                  <TableCell>{m.field}</TableCell>
                  <TableCell>{m.referee}</TableCell>
                  <TableCell>
                    <Chip
                      label={m.status}
                      size="small"
                      color={m.statusColor || "default"}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Container>
  );
}
