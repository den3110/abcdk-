import { useState, useMemo } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
// ❌ Không dùng Redux auth nữa
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
  Alert,
  Pagination,
} from "@mui/material";
import { Container as RBContainer } from "react-bootstrap";
import { toast } from "react-toastify";
import {
  MonetizationOn,
  MoneyOff,
  DeleteOutline,
  EditOutlined,
  Equalizer,
  Groups,
} from "@mui/icons-material";

import {
  useGetTournamentQuery,
  useGetRegistrationsQuery,
  useCreateRegInviteMutation,
  useListMyRegInvitesQuery,
  useRespondRegInviteMutation,
  useCancelRegistrationMutation,
  useManagerSetRegPaymentStatusMutation,
  useManagerDeleteRegistrationMutation,
  useManagerReplaceRegPlayerMutation,
} from "../../slices/tournamentsApiSlice";
import { useGetMeScoreQuery } from "../../slices/usersApiSlice";
import PlayerSelector from "../../components/PlayerSelector";
import PublicProfileDialog from "../../components/PublicProfileDialog";

/* ---------------- helpers ---------------- */
const PLACE = "https://dummyimage.com/800x600/cccccc/ffffff&text=?";

/** round to 3 decimals and trim trailing zeros */
const fmt3 = (v) => {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  const r = Math.round(n * 1000) / 1000;
  return r.toFixed(3).replace(/\.?0+$/, "");
};

const normType = (t) => {
  const s = String(t || "").toLowerCase();
  if (s === "single" || s === "singles") return "single";
  if (s === "double" || s === "doubles") return "double";
  return s || "double";
};

const displayName = (pl) => {
  if (!pl) return "—";
  const nn = pl.nickName || pl.nickname || pl?.user?.nickname || "";
  return nn || pl.fullName || pl.name || pl.displayName || "—";
};

const getUserId = (pl) => {
  const u = pl?.user;
  if (!u) return null;
  if (typeof u === "string") return u.trim() || null;
  if (typeof u === "object" && u._id) return String(u._id);
  return null;
};

const totalScoreOf = (r, isSingles) =>
  (r?.player1?.score || 0) + (isSingles ? 0 : r?.player2?.score || 0);

/** Lấy cap theo loại giải */
const getScoreCap = (tour, isSingles) => {
  if (!tour) return 0;
  return isSingles
    ? Number(tour?.singleCap ?? tour?.scoreCap ?? 0)
    : Number(tour?.scoreCap ?? 0);
};

/** Lấy chênh lệch tối đa cho phép (đặt tên field linh hoạt) */
const getMaxDelta = (tour) => {
  return Number(
    tour?.scoreGap ??
      tour?.maxDelta ??
      tour?.scoreTolerance ??
      tour?.tolerance ??
      0
  );
};

/** Quyết định màu & tooltip cho chip Tổng điểm */
const totalChipStyle = (total, cap, delta) => {
  const hasCap = Number.isFinite(cap) && cap > 0;
  if (!hasCap || !Number.isFinite(total)) {
    return { color: "default", title: "Không có giới hạn" };
  }
  const threshold = cap + (Number.isFinite(delta) ? delta : 0);

  if (total <= cap) {
    return { color: "success", title: `≤ ${fmt3(cap)} (Hợp lệ)` };
  }
  if (total === threshold) {
    return {
      color: "warning",
      title: `= ${fmt3(cap)} + ${fmt3(delta)} (Chạm ngưỡng tối đa)`,
    };
  }
  if (total < threshold) {
    return {
      color: "error",
      title: `Trong vùng vượt cap nhưng < cap + Δ (${fmt3(cap)} + ${fmt3(
        delta
      )})`,
    };
  }
  // total > threshold
  return {
    color: "error",
    title: `> ${fmt3(cap)} + ${fmt3(delta)} (Vượt quá chênh lệch tối đa)`,
  };
};

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

/* Stat item */
function StatItem({ icon, label, value, hint }) {
  return (
    <Box sx={{ p: 1, height: "100%" }}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            backgroundColor: "action.hover",
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" noWrap>
            {label}
          </Typography>
          <Typography
            variant="h6"
            sx={{ lineHeight: 1.2 }}
            noWrap
            title={String(value)}
          >
            {value}
          </Typography>
          {hint && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {hint}
            </Typography>
          )}
        </Box>
      </Stack>
    </Box>
  );
}

/** VĐV 1 (Bạn) — read-only, lấy từ /api/users/me/score */
function SelfPlayerReadonly({ me, isSingles }) {
  if (!me?._id) return null;
  const display = me?.nickname || me?.name || "Tôi";
  const scoreVal = isSingles ? me?.score?.single : me?.score?.double;

  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <Typography variant="subtitle2" gutterBottom>
        VĐV 1 (Bạn)
      </Typography>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Avatar src={me?.avatar || PLACE} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" noWrap title={display}>
            {display}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {me?.phone || "—"}
          </Typography>
        </Box>
        <Tooltip
          arrow
          title={`Điểm ${isSingles ? "đơn" : "đôi"} hiện tại của bạn`}
        >
          <Chip
            size="small"
            variant="outlined"
            icon={<Equalizer fontSize="small" />}
            label={fmt3(scoreVal ?? 0)}
            sx={{ whiteSpace: "nowrap" }}
          />
        </Tooltip>
      </Stack>
    </Box>
  );
}

/* Ô hành động */
function ActionCell({
  r,
  canManage,
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
      {canManage && (
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

      {(canManage || isOwner) && (
        <Tooltip arrow title={canManage ? "Huỷ cặp đấu" : "Huỷ đăng ký"}>
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

  // Lấy "mình" + điểm từ API mới
  const { data: me, isLoading: meLoading, error: meErr } = useGetMeScoreQuery();
  const isLoggedIn = !!me?._id;

  // Pagination (client-side)
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  /* ───────── queries ───────── */
  const {
    data: tour,
    isLoading: tourLoading,
    error: tourErr,
  } = useGetTournamentQuery(id);

  const {
    data: regs = [],
    isLoading: regsLoading,
    error: regsErr,
    refetch: refetchRegs,
  } = useGetRegistrationsQuery(id);

  // chỉ gọi khi đã đăng nhập để tránh loop
  const {
    data: myInvites = [],
    error: invitesErr,
    refetch: refetchInvites,
  } = useListMyRegInvitesQuery(undefined, { skip: !isLoggedIn });

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
  // VĐV1 là bạn (không state), chỉ cần p2 nếu giải đôi
  const [p2, setP2] = useState(null);
  const [msg, setMsg] = useState("");
  const [cancelingId, setCancelingId] = useState(null);

  const [imgPreview, setImgPreview] = useState({
    open: false,
    src: "",
    name: "",
  });

  const [replaceDlg, setReplaceDlg] = useState({
    open: false,
    reg: null,
    slot: "p1",
  });
  const [newPlayer, setNewPlayer] = useState(null);

  // Public profile dialog
  const [profileDlg, setProfileDlg] = useState({ open: false, userId: null });
  const openProfileByPlayer = (pl) => {
    const uid = getUserId(pl);
    if (uid) setProfileDlg({ open: true, userId: uid });
    else toast.info("Không tìm thấy userId của VĐV này.");
  };
  const closeProfileDlg = () => setProfileDlg({ open: false, userId: null });

  const evType = useMemo(() => normType(tour?.eventType), [tour]);
  const isSingles = evType === "single";
  const isDoubles = evType === "double";
  const cap = useMemo(() => getScoreCap(tour, isSingles), [tour, isSingles]);
  const delta = useMemo(() => getMaxDelta(tour), [tour]);
  // quyền
  const isManager = useMemo(() => {
    if (!isLoggedIn || !tour) return false;
    if (String(tour.createdBy) === String(me._id)) return true;
    if (Array.isArray(tour.managers)) {
      return tour.managers.some((m) => String(m?.user ?? m) === String(me._id));
    }
    return !!tour.isManager;
  }, [isLoggedIn, me, tour]);

  const isAdmin = !!(
    me?.isAdmin ||
    me?.role === "admin" ||
    (Array.isArray(me?.roles) && me.roles.includes("admin"))
  );
  const canManage = isLoggedIn && (isManager || isAdmin);

  // invites của giải hiện tại (memo)
  const pendingInvitesHere = useMemo(() => {
    if (!isLoggedIn) return [];
    return (myInvites || []).filter(
      (it) => String(it?.tournament?._id || it?.tournament) === String(id)
    );
  }, [myInvites, id, isLoggedIn]);

  // path bốc thăm
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

  /* ───────── derived helpers ───────── */
  const regCount = regs?.length ?? 0;
  const paidCount = useMemo(
    () => regs.filter((r) => r?.payment?.status === "Paid").length,
    [regs]
  );

  const totalPages = Math.max(1, Math.ceil(regCount / pageSize));
  const baseIndex = (page - 1) * pageSize;
  const paginatedRegs = useMemo(
    () => regs.slice(baseIndex, baseIndex + pageSize),
    [regs, baseIndex, pageSize]
  );

  const playersOfReg = (r) => [r?.player1, r?.player2].filter(Boolean);

  // Submit: cần me xong; nếu đôi thì cần p2
  const disableSubmit =
    saving || meLoading || !isLoggedIn || (isDoubles && !p2);

  const formatDate = (d) => (d ? new Date(d).toLocaleDateString() : "");
  const formatRange = (a, b) => {
    const A = formatDate(a);
    const B = formatDate(b);
    if (A && B) return `${A} – ${B}`;
    return A || B || "—";
  };

  /* ───────── actions ───────── */
  const submit = async (e) => {
    e.preventDefault();
    if (!isLoggedIn) return toast.info("Vui lòng đăng nhập để đăng ký.");
    if (!me?._id) return toast.error("Không xác định được VĐV 1 (bạn).");
    if (isDoubles && !p2) return toast.error("Giải đôi cần 2 VĐV");

    try {
      const res = await createInvite({
        tourId: id,
        message: msg,
        player1Id: String(me._id), // luôn là bạn
        ...(isDoubles ? { player2Id: p2._id } : {}),
      }).unwrap();

      if (
        res?.registration ||
        res?.mode === "direct_by_admin" ||
        res?.mode === "direct_by_kyc"
      ) {
        const mode = res?.mode || "direct";
        const label =
          mode === "direct_by_admin"
            ? "Admin"
            : mode === "direct_by_kyc"
            ? "KYC"
            : "Trực tiếp";
        toast.success(`Đã tạo đăng ký (${label}).`);

        setP2(null);
        setMsg("");
        await refetchRegs();
        return;
      }

      toast.error("Không thể tạo đăng ký.");
    } catch (err) {
      if (err?.status === 412) {
        toast.error(
          err?.data?.message ||
            "Bạn (hoặc đồng đội) cần hoàn tất KYC (đã xác minh) trước khi đăng ký."
        );
      } else {
        toast.error(
          err?.data?.message || err?.error || "Không thể tạo đăng ký."
        );
      }
    }
  };

  const handleCancel = async (r) => {
    if (!isLoggedIn) return toast.info("Vui lòng đăng nhập.");
    if (!canManage && r?.payment?.status === "Paid") {
      toast.info(
        "Không thể huỷ khi đã nộp lệ phí, vui lòng liên hệ BTC để hỗ trợ"
      );
      return;
    }
    if (!canManage) {
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
      if (canManage) await adminDeleteReg(r._id).unwrap();
      else await cancelReg(r._id).unwrap();
      toast.success("Đã huỷ đăng ký");
      refetchRegs();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Huỷ đăng ký thất bại");
    } finally {
      setCancelingId(null);
    }
  };

  // Toggle trạng thái thanh toán của 1 đăng ký
  const togglePayment = async (r) => {
    if (!canManage) {
      toast.info("Bạn không có quyền cập nhật thanh toán.");
      return;
    }
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
        e?.data?.message || e?.error || "Cập nhật thanh toán thất bại"
      );
    }
  };
  const handleInviteRespond = async (inviteId, action) => {
    if (!isLoggedIn)
      return toast.info("Vui lòng đăng nhập để phản hồi lời mời.");
    try {
      await respondInvite({ inviteId, action }).unwrap();
      if (action === "accept") toast.success("Đã chấp nhận lời mời");
      else toast.info("Đã từ chối lời mời");
      await Promise.all([refetchInvites(), refetchRegs()]);
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Không thể gửi phản hồi");
    }
  };

  const openPreview = (src, name) =>
    setImgPreview({ open: true, src, name: name || "" });
  const closePreview = () => setImgPreview({ open: false, src: "", name: "" });

  const openReplace = (reg, slot) => {
    if (!canManage) return;
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
        slot: replaceDlg.slot,
        userId: newPlayer._id,
      }).unwrap();
      toast.success("Đã thay VĐV");
      closeReplace();
      refetchRegs();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Không thể thay VĐV");
    }
  };

  /* ───────── UI guard ───────── */
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
        <Alert severity="error">
          {tourErr?.data?.message || tourErr?.error || "Lỗi tải giải đấu"}
        </Alert>
      </Box>
    );
  }
  if (!tour) return null;

  const PlayerCell = ({ player, onEdit, canEdit }) => (
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

      <Box
        sx={{
          maxWidth: 300,
          overflow: "hidden",
          cursor: getUserId(player) ? "pointer" : "default",
        }}
        onClick={() => openProfileByPlayer(player)}
        title="Xem hồ sơ"
      >
        <Typography variant="body2" noWrap>
          {displayName(player)}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {player?.phone}
        </Typography>
      </Box>

      <Tooltip arrow title="Điểm trình (chốt lúc đăng ký)">
        <Chip
          size="small"
          variant="outlined"
          icon={<Equalizer fontSize="small" />}
          label={fmt3(player?.score ?? 0)}
          sx={{ whiteSpace: "nowrap" }}
        />
      </Tooltip>

      {canEdit && (
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

  /* ───────── RENDER ───────── */
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

      {/* Thông tin giải */}
      <Box sx={{ mb: 2 }}>
        <Grid container spacing={1.5} alignItems="center">
          <Grid item xs={12} md={5}>
            <Stack spacing={0.5}>
              <Typography variant="h6" noWrap title={tour.name}>
                {tour.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {tour.location || "—"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {formatRange(tour.startDate, tour.endDate)}
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                sx={{ mt: 0.5 }}
                alignItems="center"
                flexWrap="wrap"
              >
                <Chip
                  size="small"
                  variant="outlined"
                  label={isSingles ? "Đơn" : "Đôi"}
                />
              </Stack>
            </Stack>
          </Grid>

          <Grid item xs={12} md={7}>
            <Grid container spacing={1}>
              <Grid item xs={12} sm={6}>
                <StatItem
                  icon={<Equalizer fontSize="small" />}
                  label={
                    isDoubles ? "Giới hạn tổng điểm (đội)" : "Giới hạn điểm/VĐV"
                  }
                  value={
                    isDoubles
                      ? fmt3(tour?.scoreCap ?? 0)
                      : fmt3(tour?.singleCap ?? tour?.scoreCap ?? 0)
                  }
                  hint={
                    isDoubles ? "Giới hạn điểm (đôi)" : "Giới hạn điểm (đơn)"
                  }
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <StatItem
                  icon={<Equalizer fontSize="small" />}
                  label="Giới hạn điểm mỗi VĐV"
                  value={fmt3(tour?.singleCap ?? 0)}
                  hint="Giới hạn điểm (đơn)"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <StatItem
                  icon={<Groups fontSize="small" />}
                  label={isSingles ? "Số VĐV dự kiến" : "Số đội dự kiến"}
                  value={fmt3(tour?.maxPairs ?? 0)}
                  hint="Tối đa số cặp (đôi)"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <StatItem
                  icon={<Groups fontSize="small" />}
                  label={isSingles ? "Số VĐV đã đăng ký" : "Số đội đã đăng ký"}
                  value={fmt3(regCount)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <StatItem
                  icon={<MonetizationOn fontSize="small" />}
                  label={
                    isSingles ? "Số VĐV đã nộp lệ phí" : "Số đội đã nộp lệ phí"
                  }
                  value={fmt3(paidCount)}
                />
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </Box>

      {/* Thông báo đăng nhập */}
      {meLoading
        ? null
        : !isLoggedIn && (
            <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
              <Alert severity="info">
                Bạn chưa đăng nhập. Hãy đăng nhập để thực hiện đăng ký.
              </Alert>
            </Paper>
          )}

      {/* FORM: VĐV1 = Bạn (read-only), chỉ chọn VĐV2 nếu là đôi */}
      <Paper variant="outlined" sx={{ p: 2, mb: 1.5, maxWidth: 760 }}>
        <Typography variant="h6" gutterBottom>
          {isAdmin ? "Tạo đăng ký (admin)" : "Đăng ký thi đấu"}
        </Typography>

        <Grid item xs={12} component="form" onSubmit={submit}>
          {meLoading ? (
            <Box sx={{ p: 2 }}>
              <CircularProgress size={20} />
            </Box>
          ) : meErr ? (
            <Alert severity="error">Không tải được thông tin của bạn.</Alert>
          ) : isLoggedIn ? (
            <SelfPlayerReadonly me={me} isSingles={isSingles} />
          ) : (
            <Alert severity="info">
              Bạn chưa đăng nhập. Hãy đăng nhập để đăng ký.
            </Alert>
          )}

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
            {isAdmin
              ? "Quyền admin: tạo đăng ký trực tiếp."
              : isSingles
              ? "Giải đơn: VĐV phải KYC (đã xác minh) thì mới đăng ký được."
              : "Giải đôi: CẢ HAI VĐV phải KYC (đã xác minh) thì mới đăng ký được."}
          </Typography>

          <Stack direction="row" spacing={2} mt={2}>
            <Button type="submit" variant="contained" disabled={disableSubmit}>
              {saving ? "Đang tạo…" : isAdmin ? "Tạo đăng ký" : "Đăng ký"}
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

      {/* === Nội dung/ liên hệ (nếu có) === */}
      {(tour?.contactHtml || tour?.contentHtml) && (
        <Box
          sx={{
            mb: 2,
            display: { xs: "block", md: "flex" },
            justifyContent: { md: "space-between" },
            gap: { md: 2 },
          }}
        >
          {tour?.contactHtml && (
            <Box sx={{ width: { xs: "100%", md: "48%" } }}>
              <Typography variant="h6" gutterBottom>
                Thông tin liên hệ
              </Typography>
              <Box
                sx={{
                  "& a": { color: "primary.main" },
                  "& img": {
                    maxWidth: "100%",
                    height: "auto",
                    borderRadius: 1,
                  },
                  overflowX: "auto",
                }}
                dangerouslySetInnerHTML={{ __html: tour.contactHtml }}
              />
            </Box>
          )}

          {tour?.contentHtml && (
            <Box
              sx={{ width: { xs: "100%", md: "48%" }, mt: { xs: 2, md: 0 } }}
            >
              <Typography variant="h6" gutterBottom>
                Nội dung giải đấu
              </Typography>
              <Box
                sx={{
                  "& a": { color: "primary.main" },
                  "& img": {
                    maxWidth: "100%",
                    height: "auto",
                    borderRadius: 1,
                  },
                  overflowX: "auto",
                }}
                dangerouslySetInnerHTML={{ __html: tour.contentHtml }}
              />
            </Box>
          )}
        </Box>
      )}

      {/* Khu quản lý */}
      {canManage && (
        <Box sx={{ mb: 3 }}>
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
            <Button
              component={Link}
              to={`/tournament/${id}/manage`}
              variant="outlined"
              size="small"
            >
              Quản lý giải
            </Button>
          </Stack>
        </Box>
      )}

      {/* LIST đăng ký */}
      <Stack direction="row" alignItems="center" spacing={1} className="mb-1">
        <Typography variant="h5">Danh sách đăng ký ({regCount})</Typography>
        <Chip
          size="small"
          color="primary"
          variant="outlined"
          icon={<Groups fontSize="small" />}
          label={`${regCount} ${isSingles ? "VĐV" : "đội"}`}
          sx={{ ml: 0.5 }}
        />
      </Stack>

      {regsLoading ? (
        <CircularProgress />
      ) : regsErr ? (
        <Alert severity="error">
          {regsErr?.data?.message || regsErr?.error || "Lỗi tải danh sách"}
        </Alert>
      ) : regs.length === 0 ? (
        <Typography color="text.secondary">Danh sách đăng ký trống!</Typography>
      ) : isMobile ? (
        // mobile cards
        <Stack spacing={2}>
          {paginatedRegs.map((r, i0) => {
            const isOwner =
              isLoggedIn && String(r?.createdBy) === String(me?._id);
            return (
              <Paper key={r._id} sx={{ p: 2 }}>
                <Typography variant="subtitle2">
                  #{baseIndex + i0 + 1}
                </Typography>

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

                    <Box
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        cursor: getUserId(pl) ? "pointer" : "default",
                      }}
                      onClick={() => openProfileByPlayer(pl)}
                      title="Xem hồ sơ"
                    >
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

                    <Tooltip arrow title="Điểm trình (chốt lúc đăng ký)">
                      <Chip
                        size="small"
                        variant="outlined"
                        icon={<Equalizer fontSize="small" />}
                        label={fmt3(pl?.score ?? 0)}
                        sx={{ whiteSpace: "nowrap" }}
                      />
                    </Tooltip>

                    {canManage && (
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

                {!isSingles && !r.player2 && canManage && (
                  <Box mt={1}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => openReplace(r, "p2")}
                    >
                      Thêm VĐV 2
                    </Button>
                  </Box>
                )}

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

                <Stack direction="row" spacing={1} mt={1} alignItems="center">
                  <Typography variant="body2">Tổng điểm:</Typography>
                  {(() => {
                    const total = totalScoreOf(r, isSingles);
                    const { color, title } = totalChipStyle(total, cap, delta);
                    return (
                      <Tooltip
                        arrow
                        title={`Tổng điểm: ${fmt3(total)} • ${title}`}
                      >
                        <Chip
                          size="small"
                          icon={<Equalizer fontSize="small" />}
                          label={fmt3(total)}
                          color={color}
                          variant="filled"
                          sx={{ whiteSpace: "nowrap" }}
                        />
                      </Tooltip>
                    );
                  })()}
                </Stack>

                <Box mt={1}>
                  <ActionCell
                    r={r}
                    canManage={canManage}
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
        // desktop table
        <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ whiteSpace: "nowrap" }}>#</TableCell>
                <TableCell>{isSingles ? "VĐV" : "VĐV 1"}</TableCell>
                {!isSingles && <TableCell>VĐV 2</TableCell>}
                <TableCell sx={{ whiteSpace: "nowrap" }}>Tổng điểm</TableCell>
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
              {paginatedRegs.map((r, i0) => {
                const isOwner =
                  isLoggedIn && String(r?.createdBy) === String(me?._id);
                return (
                  <TableRow key={r._id} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {baseIndex + i0 + 1}
                    </TableCell>

                    <TableCell>
                      <PlayerCell
                        player={r.player1}
                        onEdit={() => openReplace(r, "p1")}
                        canEdit={canManage}
                      />
                    </TableCell>

                    {!isSingles && (
                      <TableCell>
                        {r.player2 ? (
                          <PlayerCell
                            player={r.player2}
                            onEdit={() => openReplace(r, "p2")}
                            canEdit={canManage}
                          />
                        ) : canManage ? (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => openReplace(r, "p2")}
                          >
                            Thêm VĐV 2
                          </Button>
                        ) : (
                          <Typography color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                    )}

                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {(() => {
                        const total = totalScoreOf(r, isSingles);
                        const { color, title } = totalChipStyle(
                          total,
                          cap,
                          delta
                        );
                        return (
                          <Tooltip
                            arrow
                            title={`Tổng điểm trình (chốt lúc đăng ký): ${fmt3(
                              total
                            )} • ${title}`}
                          >
                            <Chip
                              size="small"
                              icon={<Equalizer fontSize="small" />}
                              label={fmt3(total)}
                              color={color}
                              variant="filled"
                              sx={{ whiteSpace: "nowrap" }}
                            />
                          </Tooltip>
                        );
                      })()}
                    </TableCell>

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
                        canManage={canManage}
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

      {/* Pagination */}
      {!regsLoading && !regsErr && regCount > 0 && (
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          alignItems={{ xs: "center", md: "center" }}
          justifyContent="center"
          sx={{ mt: 2 }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <Pagination
              color="primary"
              page={page}
              count={totalPages}
              onChange={(_, p) => setPage(p)}
            />
          </Stack>
        </Stack>
      )}

      {/* Preview ảnh */}
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

      {/* Dialog thay VĐV */}
      <Dialog
        open={replaceDlg.open}
        onClose={closeReplace}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {replaceDlg.slot === "p2" ? "Thay/Thêm VĐV 2" : "Thay VĐV 1"}
        </DialogTitle>
        <DialogContent dividers>
          <PlayerSelector
            label="Chọn VĐV mới"
            eventType={tour?.eventType}
            value={newPlayer}
            onChange={setNewPlayer}
          />
          <Typography variant="caption" color="text.secondary">
            Lưu ý: Thao tác này cập nhật trực tiếp cặp đăng ký.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeReplace}>Huỷ</Button>
          <Button
            onClick={submitReplace}
            variant="contained"
            disabled={replacing || !newPlayer?._id}
          >
            {replacing ? "Đang lưu…" : "Lưu thay đổi"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog hồ sơ công khai */}
      <PublicProfileDialog
        open={profileDlg.open}
        onClose={closeProfileDlg}
        userId={profileDlg.userId}
      />
    </RBContainer>
  );
}
