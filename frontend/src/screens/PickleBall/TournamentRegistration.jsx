// src/pages/TournamentRegistration.jsx
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  useUpdatePaymentMutation,
  useCheckinMutation,
} from "../../slices/tournamentsApiSlice";
import PlayerSelector from "../../components/PlayerSelector";

export default function TournamentRegistration() {
  const { id } = useParams();

  /* ───────── queries ───────── */
  const { data: tour } = useGetTournamentQuery(id);
  const { data: regs = [], isLoading, error } = useGetRegistrationsQuery(id);

  const [createReg, { isLoading: saving }] = useCreateRegistrationMutation();
  const [updatePay] = useUpdatePaymentMutation();
  const [checkin] = useCheckinMutation();

  /* ───────── local state ───────── */
  const [p1, setP1] = useState(null);
  const [p2, setP2] = useState(null);

  const [msg, setMsg] = useState("");

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  if (!tour) return null;

  /* ───────── actions ───────── */
  const submit = async (e) => {
    e.preventDefault();
    if (!p1 || !p2) return toast.error("Chọn đủ 2 VĐV");
    try {
      await createReg({
        tourId: id,
        message: msg,
        player1Id: p1._id,
        player2Id: p2._id,
      }).unwrap();
      toast.success("Đăng ký thành công");
      setP1(null);
      setP2(null);
      setMsg("");
    } catch (err) {
      toast.error(err?.data?.message || err.error);
    }
  };

  const togglePayment = async (reg) => {
    try {
      await updatePay({
        regId: reg._id,
        status: reg.payment.status === "Paid" ? "Unpaid" : "Paid",
      }).unwrap();
    } catch {
      toast.error("Failed to update fee status");
    }
  };

  const handleCheckin = async (reg) => {
    try {
      await checkin({ regId: reg._id }).unwrap();
    } catch {
      toast.error("Failed to check-in");
    }
  };

  /* ───────── UI ───────── */
  return (
    <Container className="py-4">
      <Typography variant="h4" className="mb-3">
        Đăng ký giải đấu
      </Typography>

      <Row>
        {/* ──────── FORM ──────── */}
        <Col lg={4}>
          <Grid item xs={12} lg={4} component="form" onSubmit={submit}>
            <PlayerSelector
              label="VĐV 1"
              eventType={tour.eventType}
              onChange={setP1}
            />
            <Box mt={3}>
              <PlayerSelector
                label="VĐV 2"
                eventType={tour.eventType}
                onChange={setP2}
              />
            </Box>

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
                disabled={saving || !p1 || !p2}
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
              {regs.map((r, i) => (
                <Paper key={r._id} sx={{ p: 2 }}>
                  <Typography variant="subtitle2">#{i + 1}</Typography>

                  {[r.player1, r.player2].map((pl) => (
                    <Stack
                      key={pl.phone}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      mt={1}
                    >
                      <Avatar src={pl.avatar} />
                      <Box>
                        <Typography variant="body2">{pl.fullName}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {pl.phone}
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

                  <Stack direction="row" spacing={1} mt={2}>
                    <Button
                      variant="outlined"
                      size="small"
                      color={r.payment.status === "Paid" ? "error" : "success"}
                      onClick={() => togglePayment(r)}
                    >
                      {r.payment.status === "Paid"
                        ? "Cancel fee"
                        : "Confirm fee"}
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => handleCheckin(r)}
                    >
                      Check-in
                    </Button>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          ) : (
            /* desktop table */
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Athlete 1</TableCell>
                  <TableCell>Athlete 2</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Fee</TableCell>
                  <TableCell>Check-in</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {regs.map((r, i) => (
                  <TableRow key={r._id} hover>
                    <TableCell>{i + 1}</TableCell>

                    {[r.player1, r.player2].map((pl) => (
                      <TableCell key={pl.phone}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Avatar src={pl.avatar} />
                          <Box>
                            <Typography variant="body2">
                              {pl.fullName}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {pl.phone}
                            </Typography>
                          </Box>
                        </Stack>
                      </TableCell>
                    ))}

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
                      <Stack direction="row" spacing={1}>
                        <Button
                          variant="outlined"
                          size="small"
                          color={
                            r.payment.status === "Paid" ? "error" : "success"
                          }
                          onClick={() => togglePayment(r)}
                        >
                          {r.payment.status === "Paid"
                            ? "Cancel fee"
                            : "Confirm fee"}
                        </Button>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => handleCheckin(r)}
                        >
                          Check-in
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Col>
      </Row>
    </Container>
  );
}
