import { useState, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { Container, Row, Col } from "react-bootstrap";
import { toast } from "react-toastify";

import {
  useGetTournamentQuery,
  useGetRegistrationsQuery,
  useCreateRegistrationMutation,
  // NEW:
  useCancelRegistrationMutation,
} from "../../slices/tournamentsApiSlice";
import PlayerSelector from "../../components/PlayerSelector";

function normType(t) {
  const s = String(t || "").toLowerCase();
  if (s === "single" || s === "singles") return "single";
  if (s === "double" || s === "doubles") return "double";
  return s || "double";
}
const PLACE = "";

export default function TournamentRegistration() {
  const { id } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const me = useSelector((s) => s.auth?.userInfo || null); // cần có auth slice chứa userInfo {_id,...}

  /* ───────── queries ───────── */
  const {
    data: tour,
    isLoading: tourLoading,
    error: tourErr,
  } = useGetTournamentQuery(id);
  const {
    data: regs = [],
    isLoading,
    error,
    refetch: refetchRegs,
  } = useGetRegistrationsQuery(id);

  const [createReg, { isLoading: saving }] = useCreateRegistrationMutation();
  const [cancelReg, { isLoading: canceling }] = useCancelRegistrationMutation();

  /* ───────── local state ───────── */
  const [p1, setP1] = useState(null);
  const [p2, setP2] = useState(null);
  const [msg, setMsg] = useState("");
  const [cancelingId, setCancelingId] = useState(null);

  const evType = useMemo(() => normType(tour?.eventType), [tour]);
  const isSingles = evType === "single";
  const isDoubles = evType === "double";

  /* ───────── actions ───────── */
  const submit = async (e) => {
    e.preventDefault();
    if (!p1) return toast.error("Chọn VĐV 1");
    if (isDoubles && !p2) return toast.error("Giải đôi cần 2 VĐV");

    try {
      await createReg({
        tourId: id,
        message: msg,
        player1Id: p1._id,
        ...(isDoubles ? { player2Id: p2._id } : {}),
      }).unwrap();
      toast.success("Đăng ký thành công");
      setP1(null);
      setP2(null);
      setMsg("");
      refetchRegs();
    } catch (err) {
      toast.error(err?.data?.message || err.error);
    }
  };

  const handleCancel = async (reg) => {
    // chỉ cho huỷ khi chưa thanh toán
    if (reg?.payment?.status === "Paid") {
      return toast.error("Đăng ký đã thanh toán, không thể huỷ");
    }
    // chỉ người tạo mới được huỷ
    const isOwner = me && String(reg?.createdBy) === String(me?._id);
    if (!isOwner) {
      return toast.error("Bạn không có quyền huỷ đăng ký này");
    }
    if (!window.confirm("Bạn chắc chắn muốn huỷ đăng ký này?")) return;

    try {
      setCancelingId(reg._id);
      await cancelReg(reg._id).unwrap();
      toast.success("Đã huỷ đăng ký");
      refetchRegs();
    } catch (e) {
      toast.error(e?.data?.message || e.error || "Huỷ đăng ký thất bại");
    } finally {
      setCancelingId(null);
    }
  };

  /* ───────── helpers ───────── */
  const playersOfReg = (r) => [r?.player1, r?.player2].filter(Boolean);
  const disableSubmit = saving || !p1 || (isDoubles && !p2);

  /* ───────── UI ───────── */
  if (tourLoading) {
    return (
      <Box p={3} textAlign="center">
        <CircularProgress />
      </Box>
    );
  }
  if (tourErr) {
    return (
      <Box p={3}>
        <Typography color="error">
          {tourErr?.data?.message || tourErr.error}
        </Typography>
      </Box>
    );
  }
  if (!tour) return null;

  return (
    <Container className="py-4">
      <Stack direction="row" alignItems="center" spacing={2} className="mb-3">
        <Typography variant="h4">Đăng ký giải đấu</Typography>
        <Chip
          size="small"
          label={isSingles ? "Giải đơn" : "Giải đôi"}
          color={isSingles ? "default" : "primary"}
          variant="outlined"
        />
      </Stack>

      <Row>
        {/* ──────── FORM ──────── */}
        <Col lg={4}>
          <Grid item xs={12} lg={4} component="form" onSubmit={submit}>
            <PlayerSelector
              label={isSingles ? "VĐV" : "VĐV 1"}
              eventType={tour.eventType}
              value={p1}
              onChange={setP1}
            />
            {isDoubles && (
              <Box mt={3}>
                <PlayerSelector
                  label="VĐV 2"
                  eventType={tour.eventType}
                  value={p2}
                  onChange={setP2}
                />
              </Box>
            )}

            <TextField
              label="Lời nhắn"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              fullWidth
              multiline
              rows={2}
              margin="normal"
            />

            <Stack direction="row" spacing={2} mt={2}>
              <Button
                type="submit"
                variant="contained"
                disabled={disableSubmit}
              >
                {saving ? "Đang lưu…" : "Đăng ký"}
              </Button>
              <Button
                component={Link}
                to={`/tournament/${id}/checkin`}
                variant="outlined"
              >
                Check-in
              </Button>
              <Button
                component={Link}
                to={`/tournament/${id}/bracket`}
                variant="outlined"
              >
                Sơ đồ
              </Button>
            </Stack>
          </Grid>
        </Col>

        {/* ──────── LIST ──────── */}
        <Col lg={8}>
          <Typography variant="h6" className="mb-1">
            Registration List
          </Typography>

          {isLoading ? (
            <CircularProgress />
          ) : error ? (
            <Typography color="error">
              {error?.data?.message || error.error}
            </Typography>
          ) : regs.length === 0 ? (
            <Typography color="text.secondary">
              No registrations yet!
            </Typography>
          ) : isMobile ? (
            /* mobile cards */
            <Stack spacing={2}>
              {regs.map((r, i) => {
                const isOwner = me && String(r?.createdBy) === String(me?._id);
                const canCancel = isOwner && r?.payment?.status !== "Paid";
                return (
                  <Paper key={r._id} sx={{ p: 2 }}>
                    <Typography variant="subtitle2">#{i + 1}</Typography>

                    {playersOfReg(r).map((pl, idx) => (
                      <Stack
                        key={`${pl?.phone || pl?.fullName || idx}`}
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        mt={1}
                      >
                        <Avatar src={pl?.avatar || PLACE} />
                        <Box>
                          <Typography variant="body2">
                            {pl?.fullName || "—"}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {pl?.phone || ""}
                          </Typography>
                        </Box>
                      </Stack>
                    ))}

                    <Typography variant="caption" color="text.secondary" mt={1}>
                      Created: {new Date(r.createdAt).toLocaleString()}
                    </Typography>

                    <Stack direction="row" spacing={1} mt={1} flexWrap="wrap">
                      <Chip
                        size="small"
                        color={
                          r.payment.status === "Paid" ? "success" : "default"
                        }
                        label={
                          r.payment.status === "Paid"
                            ? `Thanh toán\n${new Date(
                                r.payment.paidAt
                              ).toLocaleDateString()}`
                            : "Chờ thanh toán"
                        }
                        sx={{ whiteSpace: "pre-line" }}
                      />
                      <Chip
                        size="small"
                        color={r.checkinAt ? "info" : "default"}
                        label={
                          r.checkinAt
                            ? `Checked-in\n${new Date(
                                r.checkinAt
                              ).toLocaleTimeString()}`
                            : "Not checked-in"
                        }
                        sx={{ whiteSpace: "pre-line" }}
                      />
                    </Stack>

                    {isOwner && (
                      <Stack direction="row" spacing={1} mt={2}>
                        <Button
                          variant="outlined"
                          size="small"
                          color="error"
                          onClick={() => handleCancel(r)}
                          disabled={
                            !canCancel || cancelingId === r._id || canceling
                          }
                        >
                          {cancelingId === r._id ? "Đang huỷ…" : "Huỷ đăng ký"}
                        </Button>
                      </Stack>
                    )}
                  </Paper>
                );
              })}
            </Stack>
          ) : (
            /* desktop table */
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>{isSingles ? "Athlete" : "Athlete 1"}</TableCell>
                  {!isSingles && <TableCell>Athlete 2</TableCell>}
                  <TableCell>Created</TableCell>
                  <TableCell>Fee</TableCell>
                  <TableCell>Check-in</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {regs.map((r, i) => {
                  const isOwner =
                    me && String(r?.createdBy) === String(me?._id);
                  const canCancel = isOwner && r?.payment?.status !== "Paid";
                  return (
                    <TableRow key={r._id} hover>
                      <TableCell>{i + 1}</TableCell>

                      {/* Athlete 1 */}
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Avatar src={r.player1?.avatar || PLACE} />
                          <Box>
                            <Typography variant="body2">
                              {r.player1?.fullName}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {r.player1?.phone}
                            </Typography>
                          </Box>
                        </Stack>
                      </TableCell>

                      {/* Athlete 2 (ẩn nếu đơn) */}
                      {!isSingles && (
                        <TableCell>
                          {r.player2 ? (
                            <Stack
                              direction="row"
                              spacing={1}
                              alignItems="center"
                            >
                              <Avatar src={r.player2?.avatar || PLACE} />
                              <Box>
                                <Typography variant="body2">
                                  {r.player2?.fullName}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {r.player2?.phone}
                                </Typography>
                              </Box>
                            </Stack>
                          ) : (
                            <Typography color="text.secondary">—</Typography>
                          )}
                        </TableCell>
                      )}

                      <TableCell>
                        {new Date(r.createdAt).toLocaleString()}
                      </TableCell>

                      <TableCell>
                        <Chip
                          size="small"
                          color={
                            r.payment.status === "Paid" ? "success" : "default"
                          }
                          label={
                            r.payment.status === "Paid"
                              ? `Thanh toán\n${new Date(
                                  r.payment.paidAt
                                ).toLocaleDateString()}`
                              : "Chờ thanh toán"
                          }
                          sx={{ whiteSpace: "pre-line" }}
                        />
                      </TableCell>

                      <TableCell>
                        <Chip
                          size="small"
                          color={r.checkinAt ? "info" : "default"}
                          label={
                            r.checkinAt
                              ? new Date(r.checkinAt).toLocaleTimeString()
                              : "No"
                          }
                        />
                      </TableCell>

                      <TableCell>
                        {isOwner ? (
                          <Button
                            variant="outlined"
                            size="small"
                            color="error"
                            onClick={() => handleCancel(r)}
                            disabled={
                              !canCancel || cancelingId === r._id || canceling
                            }
                          >
                            {cancelingId === r._id
                              ? "Đang huỷ…"
                              : "Huỷ đăng ký"}
                          </Button>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            —
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Col>
      </Row>
    </Container>
  );
}
