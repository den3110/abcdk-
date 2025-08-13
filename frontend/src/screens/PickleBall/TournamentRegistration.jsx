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
  Tooltip,
  IconButton,
  TableContainer,
  Divider,
} from "@mui/material";
import { Container as RBContainer } from "react-bootstrap";
import { toast } from "react-toastify";
import {
  MonetizationOn, // mark as Paid
  MoneyOff, // mark as Unpaid
  DeleteOutline, // delete/cancel
} from "@mui/icons-material";

import {
  useGetTournamentQuery,
  useGetRegistrationsQuery,
  useCreateRegInviteMutation,
  useListMyRegInvitesQuery,
  useRespondRegInviteMutation,
  useCancelRegistrationMutation,
  // quản lý
  useManagerSetRegPaymentStatusMutation,
  useManagerDeleteRegistrationMutation,
} from "../../slices/tournamentsApiSlice";
import PlayerSelector from "../../components/PlayerSelector";

/* ---------------- helpers ---------------- */
function normType(t) {
  const s = String(t || "").toLowerCase();
  if (s === "single" || s === "singles") return "single";
  if (s === "double" || s === "doubles") return "double";
  return s || "double";
}
const PLACE = "";

/* Chip gọn, 1 dòng + tooltip chi tiết */
function PaymentChip({ status, paidAt }) {
  const isPaid = status === "Paid";
  return (
    <Tooltip
      title={
        isPaid
          ? `Đã thanh toán: ${paidAt ? new Date(paidAt).toLocaleString() : ""}`
          : "Chưa thanh toán"
      }
      arrow
    >
      <Chip
        size="small"
        color={isPaid ? "success" : "default"}
        label={isPaid ? "Đã thanh toán" : "Chưa thanh toán"}
        sx={{ whiteSpace: "nowrap" }}
      />
    </Tooltip>
  );
}

function CheckinChip({ checkinAt }) {
  const ok = !!checkinAt;
  return (
    <Tooltip
      title={
        ok
          ? `Đã check-in: ${new Date(checkinAt).toLocaleString()}`
          : "Chưa check-in"
      }
      arrow
    >
      <Chip
        size="small"
        color={ok ? "info" : "default"}
        label={ok ? "Đã check-in" : "Chưa check-in"}
        sx={{ whiteSpace: "nowrap" }}
      />
    </Tooltip>
  );
}

/* Ô hành động: icon + tooltip, luôn 1 dòng */
function ActionCell({
  r,
  isManager,
  isOwner,
  onTogglePayment,
  onCancel,
  busy,
}) {
  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{ alignItems: "center", flexWrap: "nowrap" }}
    >
      {isManager && (
        <Tooltip
          arrow
          title={
            r.payment?.status === "Paid"
              ? "Đánh dấu CHƯA thanh toán"
              : "Xác nhận ĐÃ thanh toán"
          }
        >
          <span>
            <IconButton
              size="small"
              onClick={() => onTogglePayment(r)}
              disabled={busy?.settingPayment}
            >
              {r.payment?.status === "Paid" ? (
                <MoneyOff fontSize="small" />
              ) : (
                <MonetizationOn fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>
      )}

      {(isManager || isOwner) && (
        <Tooltip arrow title={isManager ? "Huỷ cặp đấu" : "Huỷ đăng ký"}>
          <span>
            <IconButton
              size="small"
              color="error"
              onClick={() => onCancel(r)}
              disabled={busy?.deletingId === r._id}
            >
              <DeleteOutline fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Stack>
  );
}

export default function TournamentRegistration() {
  const { id } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const me = useSelector((s) => s.auth?.userInfo || null);

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

  const { data: myInvites = [], refetch: refetchInvites } =
    useListMyRegInvitesQuery();

  const [createInvite, { isLoading: saving }] = useCreateRegInviteMutation();
  const [respondInvite, { isLoading: responding }] =
    useRespondRegInviteMutation();

  const [cancelReg, { isLoading: canceling }] = useCancelRegistrationMutation();

  // quản lý
  const [setPaymentStatus, { isLoading: settingPayment }] =
    useManagerSetRegPaymentStatusMutation();
  const [adminDeleteReg, { isLoading: adminDeleting }] =
    useManagerDeleteRegistrationMutation();

  /* ───────── local state ───────── */
  const [p1, setP1] = useState(null);
  const [p2, setP2] = useState(null);
  const [msg, setMsg] = useState("");
  const [cancelingId, setCancelingId] = useState(null);

  const evType = useMemo(() => normType(tour?.eventType), [tour]);
  const isSingles = evType === "single";
  const isDoubles = evType === "double";

  // có phải manager không
  const isManager = useMemo(() => {
    if (!me || !tour) return false;
    if (String(tour.createdBy) === String(me._id)) return true;
    if (Array.isArray(tour.managers)) {
      return tour.managers.some((m) => String(m?.user ?? m) === String(me._id));
    }
    return !!tour.isManager;
  }, [me, tour]);

  // lời mời thuộc giải hiện tại
  const pendingInvitesHere = (myInvites || []).filter(
    (it) => String(it?.tournament?._id || it?.tournament) === String(id)
  );

  /* ───────── actions ───────── */
  const submit = async (e) => {
    e.preventDefault();
    if (!p1) return toast.error("Chọn VĐV 1");
    if (isDoubles && !p2) return toast.error("Giải đôi cần 2 VĐV");

    try {
      await createInvite({
        tourId: id,
        message: msg,
        player1Id: p1._id,
        ...(isDoubles ? { player2Id: p2._id } : {}),
      }).unwrap();
      toast.success(
        isSingles
          ? "Đã gửi lời mời (single). Nếu bạn chính là VĐV, đăng ký sẽ tự xác nhận."
          : "Đã gửi lời mời (double). Chờ người còn lại chấp nhận."
      );
      setP1(null);
      setP2(null);
      setMsg("");
      refetchInvites();
      refetchRegs();
    } catch (err) {
      toast.error(err?.data?.message || err.error);
    }
  };

  const handleCancel = async (r) => {
    // user thường: nếu đã thanh toán → chỉ cảnh báo, không huỷ
    if (!isManager && r?.payment?.status === "Paid") {
      toast.info(
        "Không thể huỷ khi đã nộp lệ phí, vui lòng liên hệ với BTC giải để hỗ trợ nhé"
      );
      return;
    }
    // user thường: phải là chủ sở hữu
    if (!isManager) {
      const isOwner = me && String(r?.createdBy) === String(me?._id);
      if (!isOwner) return toast.error("Bạn không có quyền huỷ đăng ký này");
    }

    const extraWarn =
      r?.payment?.status === "Paid"
        ? "\n⚠️ Cặp này đã nộp lệ phí. Hãy đảm bảo hoàn tiền/offline theo quy trình trước khi xoá."
        : "";
    if (!window.confirm(`Bạn chắc chắn muốn huỷ cặp đăng ký này?${extraWarn}`))
      return;

    try {
      setCancelingId(r._id);
      if (isManager) {
        await adminDeleteReg(r._id).unwrap();
      } else {
        await cancelReg(r._id).unwrap();
      }
      toast.success("Đã huỷ đăng ký");
      refetchRegs();
    } catch (e) {
      toast.error(e?.data?.message || e.error || "Huỷ đăng ký thất bại");
    } finally {
      setCancelingId(null);
    }
  };

  const handleInviteRespond = async (inviteId, action) => {
    try {
      await respondInvite({ inviteId, action }).unwrap();
      if (action === "accept") toast.success("Đã chấp nhận lời mời");
      else toast.info("Đã từ chối lời mời");
      await refetchInvites();
      await refetchRegs();
    } catch (e) {
      toast.error(e?.data?.message || e.error || "Không thể gửi phản hồi");
    }
  };

  const togglePayment = async (r) => {
    const next = r?.payment?.status === "Paid" ? "Unpaid" : "Paid";
    try {
      await setPaymentStatus({ regId: r._id, status: next }).unwrap();
      toast.success(
        next === "Paid"
          ? "Đã xác nhận đã thanh toán"
          : "Đã chuyển về chưa thanh toán"
      );
      refetchRegs();
    } catch (e) {
      toast.error(
        e?.data?.message || e.error || "Cập nhật thanh toán thất bại"
      );
    }
  };

  /* ───────── helpers ───────── */
  const playersOfReg = (r) => [r?.player1, r?.player2].filter(Boolean);
  const disableSubmit = saving || !p1 || (isDoubles && !p2);

  const renderInviteConfirmState = (inv) => {
    const { confirmations = {}, eventType } = inv || {};
    const isSingle = eventType === "single";
    const chip = (v) =>
      v === "accepted" ? (
        <Chip size="small" color="success" label="Đã chấp nhận" />
      ) : v === "declined" ? (
        <Chip size="small" color="error" label="Từ chối" />
      ) : (
        <Chip size="small" color="default" label="Chờ xác nhận" />
      );
    return (
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Typography variant="caption">Xác nhận:</Typography>
        <Chip size="small" variant="outlined" label="P1" />
        {chip(confirmations?.p1)}
        {!isSingle && (
          <>
            <Chip size="small" variant="outlined" label="P2" />
            {chip(confirmations?.p2)}
          </>
        )}
      </Stack>
    );
  };

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
    <RBContainer fluid="xl" className="py-4">
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} className="mb-3">
        <Typography variant="h4">Đăng ký giải đấu</Typography>
        <Chip
          size="small"
          label={isSingles ? "Giải đơn" : "Giải đôi"}
          color={isSingles ? "default" : "primary"}
          variant="outlined"
        />
      </Stack>

      {/* Lời mời đang chờ xác nhận */}
      {pendingInvitesHere.length > 0 && (
        <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
          <Stack spacing={1.5}>
            <Typography fontWeight={700}>Lời mời đang chờ xác nhận</Typography>
            {pendingInvitesHere.map((inv) => (
              <Stack
                key={inv._id}
                direction={{ xs: "column", md: "row" }}
                alignItems={{ xs: "flex-start", md: "center" }}
                spacing={1.5}
                sx={{
                  border: "1px dashed",
                  borderColor: "divider",
                  p: 1.5,
                  borderRadius: 1,
                }}
              >
                <Box sx={{ minWidth: 220 }}>
                  <Typography variant="body2" fontWeight={700}>
                    {inv.tournament?.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {inv.eventType === "single" ? "Giải đơn" : "Giải đôi"} •{" "}
                    {new Date(inv.tournament?.startDate).toLocaleDateString()}
                  </Typography>
                </Box>

                <Box sx={{ flex: 1 }}>{renderInviteConfirmState(inv)}</Box>

                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    disabled={responding}
                    onClick={() => handleInviteRespond(inv._id, "decline")}
                  >
                    Từ chối
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={responding}
                    onClick={() => handleInviteRespond(inv._id, "accept")}
                  >
                    Chấp nhận
                  </Button>
                </Stack>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {/* FORM (trên) */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3, maxWidth: 760 }}>
        <Typography variant="h6" gutterBottom>
          Gửi lời mời đăng ký
        </Typography>
        <Grid item xs={12} component="form" onSubmit={submit}>
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

          <Typography variant="caption" color="text.secondary">
            {isSingles
              ? "Giải đơn: nếu bạn chính là VĐV mời chính mình, đăng ký sẽ tự xác nhận."
              : "Giải đôi: cần cả hai VĐV chấp nhận lời mời thì mới tạo đăng ký."}
          </Typography>

          <Stack direction="row" spacing={2} mt={2}>
            <Button type="submit" variant="contained" disabled={disableSubmit}>
              {saving ? "Đang gửi lời mời…" : "Gửi lời mời"}
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
      </Paper>

      {/* LIST (dưới) */}
      <Typography variant="h5" className="mb-1">
        Danh sách đăng ký
      </Typography>

      {isLoading ? (
        <CircularProgress />
      ) : error ? (
        <Typography color="error">
          {error?.data?.message || error.error}
        </Typography>
      ) : regs.length === 0 ? (
        <Typography color="text.secondary">Danh sách đăng ký trống!</Typography>
      ) : isMobile ? (
        // mobile cards
        <Stack spacing={2}>
          {regs.map((r, i) => {
            const isOwner = me && String(r?.createdBy) === String(me?._id);
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
                      <Typography variant="body2" noWrap>
                        {pl?.fullName || "—"}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                      >
                        {pl?.phone || ""}
                      </Typography>
                    </Box>
                  </Stack>
                ))}

                <Typography variant="caption" color="text.secondary" mt={1}>
                  {new Date(r.createdAt).toLocaleString()}
                </Typography>

                <Stack direction="row" spacing={1} mt={1} alignItems="center">
                  <PaymentChip
                    status={r.payment?.status}
                    paidAt={r.payment?.paidAt}
                  />
                  <CheckinChip checkinAt={r.checkinAt} />
                </Stack>

                {/* Actions (mobile, icon only) */}
                <Box mt={1}>
                  <ActionCell
                    r={r}
                    isManager={isManager}
                    isOwner={isOwner}
                    onTogglePayment={togglePayment}
                    onCancel={handleCancel}
                    busy={{ settingPayment, deletingId: cancelingId }}
                  />
                </Box>
              </Paper>
            );
          })}
        </Stack>
      ) : (
        // desktop table (luôn nằm dưới)
        <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ whiteSpace: "nowrap" }}>#</TableCell>
                <TableCell>{isSingles ? "VĐV" : "VĐV 1"}</TableCell>
                {!isSingles && <TableCell>VĐV 2</TableCell>}
                <TableCell sx={{ whiteSpace: "nowrap" }}>
                  Thời gian tạo
                </TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>Lệ phí</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>Check-in</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap", minWidth: 140 }}>
                  Hành động
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {regs.map((r, i) => {
                const isOwner = me && String(r?.createdBy) === String(me?._id);
                return (
                  <TableRow key={r._id} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{i + 1}</TableCell>

                    {/* Athlete 1 */}
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Avatar src={r.player1?.avatar || PLACE} />
                        <Box sx={{ maxWidth: 300, overflow: "hidden" }}>
                          <Typography variant="body2" noWrap>
                            {r.player1?.fullName}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                          >
                            {r.player1?.phone}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>

                    {/* Athlete 2 */}
                    {!isSingles && (
                      <TableCell>
                        {r.player2 ? (
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                          >
                            <Avatar src={r.player2?.avatar || PLACE} />
                            <Box sx={{ maxWidth: 300, overflow: "hidden" }}>
                              <Typography variant="body2" noWrap>
                                {r.player2?.fullName}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                noWrap
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

                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>

                    <TableCell>
                      <PaymentChip
                        status={r.payment?.status}
                        paidAt={r.payment?.paidAt}
                      />
                    </TableCell>

                    <TableCell>
                      <CheckinChip checkinAt={r.checkinAt} />
                    </TableCell>

                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      <ActionCell
                        r={r}
                        isManager={isManager}
                        isOwner={isOwner}
                        onTogglePayment={togglePayment}
                        onCancel={handleCancel}
                        busy={{ settingPayment, deletingId: cancelingId }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </RBContainer>
  );
}
