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
import { toast } from "react-toastify";

import {
  useGetRegistrationsQuery,
  useCheckinMutation,
  useGetTournamentQuery,
  useGetTournamentMatchesForCheckinQuery,
  // Tìm & check-in theo SĐT / nickname
  useSearchUserMatchesQuery,
  useUserCheckinRegistrationMutation,
} from "../../slices/tournamentsApiSlice";

/* ---------- Utils ---------- */
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString() : "—");
const fmtTime = (s) => (s && s.length ? s : "—");
const normType = (t) => {
  const s = String(t || "").toLowerCase();
  if (s === "single" || s === "singles") return "single";
  if (s === "double" || s === "doubles") return "double";
  return s || "double";
};

export default function TournamentCheckin() {
  const { id } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  /* fetch tournament / registrations / matches */
  const { data: tour } = useGetTournamentQuery(id);
  const {
    data: regs = [],
    isLoading,
    error,
    refetch: refetchRegs,
  } = useGetRegistrationsQuery(id);
  const { data: matches = [] } = useGetTournamentMatchesForCheckinQuery(id);

  const evType = normType(tour?.eventType);
  const isSingles = evType === "single";

  /* ----- format tên đội/ VĐV: đơn thì bỏ phần sau && hoặc & ----- */
  const fmtSide = useCallback(
    (label) => {
      if (!label) return "—";
      const s = String(label).trim();
      if (!isSingles) return s; // đôi: giữ nguyên
      return s.split(/\s*&&\s*|\s*&\s*/)[0].trim();
    },
    [isSingles]
  );

  /* --------- (Cũ) Check-in theo số ĐT trong danh sách đăng ký --------- */
  const [phone, setPhone] = useState("");
  const [busyId, setBusy] = useState(null);
  const [checkin] = useCheckinMutation();

  const handlePhone = async () => {
    const reg = regs.find(
      (r) => r.player1?.phone === phone || r.player2?.phone === phone
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

  /* --------- (Mới) Tìm & check-in theo SĐT/Nickname --------- */
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

  /* --------- Filter danh sách TRẬN của GIẢI (thêm filter theo bracketName) --------- */
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const key = search.trim().toLowerCase();
    if (!key) return matches;
    return matches.filter((m) => {
      const t1 = (m.team1 || "").toLowerCase();
      const t2 = (m.team2 || "").toLowerCase();
      const code = (m.code || "").toLowerCase();
      const stt = (m.status || "").toLowerCase();
      const bn = (m.bracketName || "").toLowerCase();
      return (
        code.includes(key) ||
        t1.includes(key) ||
        t2.includes(key) ||
        stt.includes(key) ||
        bn.includes(key)
      );
    });
  }, [matches, search]);

  /* ---------- RENDER ---------- */
  return (
    <Container fluid className="py-4">
      {/* HEADER */}
      <Stack
        direction={isMobile ? "column" : "row"}
        justifyContent="space-between"
        alignItems={isMobile ? "flex-start" : "center"}
        spacing={1}
        mb={2}
      >
        <Typography variant="h5" fontWeight={700}>
          Chào mừng đến với giải đấu:&nbsp;
          <span style={{ textTransform: "uppercase", color: "#1976d2" }}>
            {tour?.name || "—"}
          </span>
        </Typography>
        {tour?.eventType && (
          <Chip
            size="small"
            label={isSingles ? "Giải đơn" : "Giải đôi"}
            color={isSingles ? "default" : "primary"}
            variant="outlined"
          />
        )}
      </Stack>

      {/* ACTIONS */}
      <Stack
        direction={isMobile ? "column" : "row"}
        spacing={2}
        alignItems={isMobile ? "stretch" : "center"}
        mb={3}
      >
        {/* (giữ API check-in theo SĐT trong danh sách, có thể ẩn nếu không dùng) */}
        <Stack
          direction={isMobile ? "column" : "row"}
          spacing={1}
          alignItems={isMobile ? "stretch" : "center"}
        >
          <TextField
            size="small"
            fullWidth={isMobile}
            placeholder="Nhập SĐT VĐV đã đăng ký"
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
            {busyId ? "Đang check-in…" : "Check-in (theo SĐT đã đăng ký)"}
          </MuiButton>
        </Stack>

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

      {/* ====== Tìm & check-in theo SĐT/Nickname ====== */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} mb={1}>
          Check-in theo SĐT / Nickname
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
            {searching ? "Đang tìm…" : "Tìm"}
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

        {/* Danh sách registration khớp */}
        <Stack spacing={2} mt={results.length ? 2 : 0}>
          {results.map((reg) => {
            const canCheckin = reg.paid && !reg.checkinAt;
            const disabledReason = !reg.paid
              ? "Chưa thanh toán lệ phí"
              : reg.checkinAt
              ? "Đã check-in"
              : "";
            const teamLabel = isSingles
              ? fmtSide(reg.teamLabel)
              : reg.teamLabel;

            return (
              <Paper
                key={reg.regId || reg._id}
                variant="outlined"
                sx={{ p: 2 }}
              >
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems={{ xs: "flex-start", sm: "center" }}
                  spacing={2}
                  flexWrap="wrap"
                >
                  <Box>
                    <Typography variant="subtitle1" fontWeight={700}>
                      {teamLabel || "—"}
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
                  <Stack alignItems="flex-end" spacing={0.5}>
                    <MuiButton
                      variant="contained"
                      disabled={!canCheckin || checkingUser}
                      onClick={() => handleUserCheckin(reg.regId || reg._id)}
                    >
                      {checkingUser ? "Đang check-in…" : "Check-in"}
                    </MuiButton>
                    {!canCheckin && disabledReason && (
                      <Typography variant="caption" color="text.secondary">
                        * {disabledReason}
                      </Typography>
                    )}
                  </Stack>
                </Stack>

                {/* Danh sách trận của registration này */}
                <Divider sx={{ my: 1.5 }} />
                {Array.isArray(reg.matches) && reg.matches.length ? (
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
                          <TableCell>Bracket</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {reg.matches.map((m) => (
                          <TableRow key={m._id || m.code}>
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
                            <TableCell>{m.bracketName || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Chưa có trận nào được xếp cho {isSingles ? "VĐV" : "đôi"}{" "}
                    này.
                  </Typography>
                )}
              </Paper>
            );
          })}
        </Stack>
      </Paper>

      {/* ====== (Cũ) SEARCH BOX cho danh sách TRẬN của GIẢI ====== */}
      <Row className="mb-3">
        <Col md={4}>
          <TextField
            fullWidth
            size="small"
            placeholder="Tìm: Tên VĐV/đội, mã trận, tình trạng, bracket…"
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

      {/* ====== DANH SÁCH TRẬN CỦA GIẢI ====== */}
      {isLoading ? (
        <CircularProgress />
      ) : error ? (
        <Alert severity="error">{error?.data?.message || error.error}</Alert>
      ) : isMobile ? (
        /* MOBILE cards */
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
                {fmtDate(m.date)} • {fmtTime(m.time)} • {m.field || "—"}
                {m.bracketName ? ` • ${m.bracketName}` : ""}
              </Typography>

              <Divider sx={{ my: 1 }} />

              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
              >
                <Typography variant="body2" fontWeight={500}>
                  {fmtSide(m.team1)}
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
                  {fmtSide(m.team2)}
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
        /* DESKTOP table */
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
                <TableCell>Bracket</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((m) => (
                <TableRow key={m._id} hover>
                  <TableCell>{m.code}</TableCell>
                  <TableCell>{fmtDate(m.date)}</TableCell>
                  <TableCell>{fmtTime(m.time)}</TableCell>
                  <TableCell>{fmtSide(m.team1)}</TableCell>
                  <TableCell align="center">
                    <strong>
                      {m.score1} - {m.score2}
                    </strong>
                  </TableCell>
                  <TableCell>{fmtSide(m.team2)}</TableCell>
                  <TableCell>{m.field}</TableCell>
                  <TableCell>{m.referee}</TableCell>
                  <TableCell>
                    <Chip
                      label={m.status}
                      size="small"
                      color={m.statusColor || "default"}
                    />
                  </TableCell>
                  <TableCell>{m.bracketName || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Container>
  );
}
