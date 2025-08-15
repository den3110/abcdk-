import { useState, useMemo } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
} from "@mui/material";
import { Container as RBContainer } from "react-bootstrap";
import { toast } from "react-toastify";
import {
  MonetizationOn, // mark as Paid
  MoneyOff, // mark as Unpaid
  DeleteOutline, // delete/cancel
  EditOutlined, // replace player
  Close as CloseIcon, // close preview
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
  // NEW
  useManagerReplaceRegPlayerMutation,
} from "../../slices/tournamentsApiSlice";
import PlayerSelector from "../../components/PlayerSelector";

/* ---------------- helpers ---------------- */
function normType(t) {
  const s = String(t || "").toLowerCase();
  if (s === "single" || s === "singles") return "single";
  if (s === "double" || s === "doubles") return "double";
  return s || "double";
}
const PLACE = "https://dummyimage.com/800x600/cccccc/ffffff&text=?";

const displayName = (pl) => {
  if (!pl) return "—";
  const fn = pl.fullName || "";
  const nn = pl.nickName || pl.nickname || "";
  return nn ? `${fn} (${nn})` : fn || "—";
};

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

  const [cancelReg] = useCancelRegistrationMutation();

  // quản lý
  const [setPaymentStatus, { isLoading: settingPayment }] =
    useManagerSetRegPaymentStatusMutation();
  const [adminDeleteReg] = useManagerDeleteRegistrationMutation();
  const [replacePlayer, { isLoading: replacing }] =
    useManagerReplaceRegPlayerMutation();

  /* ───────── local state ───────── */
  const [p1, setP1] = useState(null);
  const [p2, setP2] = useState(null);
  const [msg, setMsg] = useState("");
  const [cancelingId, setCancelingId] = useState(null);

  // preview ảnh
  const [imgPreview, setImgPreview] = useState({
    open: false,
    src: "",
    name: "",
  });

  // dialog thay VĐV (manager)
  const [replaceDlg, setReplaceDlg] = useState({
    open: false,
    reg: null,
    slot: "p1",
  });
  const [newPlayer, setNewPlayer] = useState(null);

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

  // admin toàn hệ thống
  const isAdmin = !!(
    me?.isAdmin ||
    me?.role === "admin" ||
    (Array.isArray(me?.roles) && me.roles.includes("admin"))
  );
  const canManage = isManager || isAdmin;

  // lời mời thuộc giải hiện tại
  const pendingInvitesHere = (myInvites || []).filter(
    (it) => String(it?.tournament?._id || it?.tournament) === String(id)
  );

  // build path bốc thăm: thay segment cuối bằng 'draw'
  const location = useLocation();
  const drawPath = useMemo(() => {
    try {
      const parts = (location?.pathname || "").split("/").filter(Boolean);
      if (parts.length === 0) return `/tournament/${id}/draw`;
      parts[parts.length - 1] = "draw";
      return "/" + parts.join("/");
    } catch {
      return `/tournament/${id}/draw`;
    }
  }, [location?.pathname, id]);

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
    if (!isManager && r?.payment?.status === "Paid") {
      toast.info(
        "Không thể huỷ khi đã nộp lệ phí, vui lòng liên hệ BTC để hỗ trợ"
      );
      return;
    }
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
      if (isManager) await adminDeleteReg(r._id).unwrap();
      else await cancelReg(r._id).unwrap();
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

  // mở preview ảnh
  const openPreview = (src, name) =>
    setImgPreview({ open: true, src, name: name || "" });
  const closePreview = () => setImgPreview({ open: false, src: "", name: "" });

  // thay VĐV
  const openReplace = (reg, slot) => {
    setReplaceDlg({ open: true, reg, slot });
    setNewPlayer(null);
  };
  const closeReplace = () =>
    setReplaceDlg({ open: false, reg: null, slot: "p1" });

  const submitReplace = async () => {
    if (!replaceDlg?.reg?._id) return;
    if (!newPlayer?._id) return toast.error("Chọn VĐV mới");
    try {
      await replacePlayer({
        regId: replaceDlg.reg._id,
        slot: replaceDlg.slot, // 'p1' | 'p2'
        userId: newPlayer._id, // gửi userId vì player là subdoc snapshot
      }).unwrap();
      toast.success("Đã thay VĐV");
      closeReplace();
      refetchRegs();
    } catch (e) {
      toast.error(e?.data?.message || e.error || "Không thể thay VĐV");
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

  const PlayerCell = ({ player, onEdit }) => (
    <Stack direction="row" spacing={1} alignItems="center">
      <Box
        onClick={() =>
          openPreview(player?.avatar || PLACE, displayName(player))
        }
        sx={{
          borderRadius: "50%",
          overflow: "hidden",
          lineHeight: 0,
          cursor: "zoom-in",
        }}
      >
        <Avatar src={player?.avatar || PLACE} />
      </Box>
      <Box sx={{ maxWidth: 300, overflow: "hidden" }}>
        <Typography variant="body2" noWrap>
          {displayName(player)}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {player?.phone}
        </Typography>
      </Box>
      {isManager && (
        <Tooltip arrow title="Thay VĐV">
          <span>
            <IconButton size="small" onClick={onEdit}>
              <EditOutlined fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Stack>
  );

  return (
    <RBContainer fluid="xl" className="py-4">
      {/* Header */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        className="mb-3"
      >
        <Stack direction="row" alignItems="center" spacing={2}>
          <Typography variant="h4">Đăng ký giải đấu</Typography>
          <Chip
            size="small"
            label={isSingles ? "Giải đơn" : "Giải đôi"}
            color={isSingles ? "default" : "primary"}
            variant="outlined"
          />
        </Stack>
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
      <Box sx={{ mb: 3 }}>
        {canManage && (
          <>
            <Typography variant="h5" className="mb-1">
              Quản lý giải đấu
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                component={Link}
                to={drawPath}
                variant="contained"
                size="small"
              >
                Bốc thăm
              </Button>
              {/* <Button variant="outlined" size="small">Nút khác</Button>  // để trống cho sau này */}
            </Stack>
          </>
        )}
      </Box>
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
                    <Box
                      onClick={() =>
                        openPreview(pl?.avatar || PLACE, displayName(pl))
                      }
                      sx={{
                        borderRadius: "50%",
                        overflow: "hidden",
                        lineHeight: 0,
                        cursor: "zoom-in",
                      }}
                    >
                      <Avatar src={pl?.avatar || PLACE} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        {displayName(pl)}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                      >
                        {pl?.phone || ""}
                      </Typography>
                    </Box>
                    {isManager && (
                      <Tooltip
                        arrow
                        title={`Thay ${idx === 0 ? "VĐV 1" : "VĐV 2"}`}
                      >
                        <span>
                          <IconButton
                            size="small"
                            onClick={() =>
                              openReplace(r, idx === 0 ? "p1" : "p2")
                            }
                          >
                            <EditOutlined fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
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
                      <PlayerCell
                        player={r.player1}
                        onEdit={() => openReplace(r, "p1")}
                      />
                    </TableCell>

                    {/* Athlete 2 */}
                    {!isSingles && (
                      <TableCell>
                        {r.player2 ? (
                          <PlayerCell
                            player={r.player2}
                            onEdit={() => openReplace(r, "p2")}
                          />
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

      {/* Preview ảnh (zoom) */}
      <Dialog
        open={imgPreview.open}
        onClose={closePreview}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Ảnh VĐV</DialogTitle>
        <DialogContent
          dividers
          sx={{ display: "flex", justifyContent: "center" }}
        >
          <img
            src={imgPreview.src || PLACE}
            alt={imgPreview.name || "player"}
            style={{
              width: "100%",
              maxHeight: "80vh",
              objectFit: "contain",
              borderRadius: 8,
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closePreview}>Đóng</Button>
        </DialogActions>
      </Dialog>
    </RBContainer>
  );
}
