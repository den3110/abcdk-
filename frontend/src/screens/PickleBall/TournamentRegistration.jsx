import React, {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useDeferredValue,
  forwardRef,
  memo,
} from "react";
import { Link, useParams, useLocation } from "react-router-dom";
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  InputAdornment,
  TableContainer,
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
  QrCode,
  ReportProblem,
  Search,
  Clear,
} from "@mui/icons-material";
import { Virtuoso, TableVirtuoso } from "react-virtuoso";

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
  useCreateComplaintMutation,
  useSearchRegistrationsQuery,
} from "../../slices/tournamentsApiSlice";
import { useGetMeScoreQuery } from "../../slices/usersApiSlice";
import PlayerSelector from "../../components/PlayerSelector";
import PublicProfileDialog from "../../components/PublicProfileDialog";
import { getFeeAmount } from "../../utils/fee";

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
const getMaxDelta = (tour) =>
  Number(
    tour?.scoreGap ??
      tour?.maxDelta ??
      tour?.scoreTolerance ??
      tour?.tolerance ??
      0
  );

/** Quyết định màu & tooltip cho chip Tổng điểm */
const totalChipStyle = (total, cap, delta) => {
  const hasCap = Number.isFinite(cap) && cap > 0;
  if (!hasCap || !Number.isFinite(total)) {
    return { color: "default", title: "Không có giới hạn" };
  }
  const d = Number.isFinite(delta) && delta > 0 ? Number(delta) : 0;
  const threshold = cap + d;
  const EPS = 1e-6;
  if (total > threshold + EPS) {
    return {
      color: "error",
      title: `> ${fmt3(cap)} + ${fmt3(d)} (Vượt quá mức cho phép)`,
    };
  }
  if (Math.abs(total - threshold) <= EPS) {
    return {
      color: "warning",
      title: `= ${fmt3(cap)} + ${fmt3(d)} (Chạm ngưỡng tối đa)`,
    };
  }
  return { color: "success", title: `< ${fmt3(cap)} + ${fmt3(d)} (Hợp lệ)` };
};

/* ====== HTTP → HTTPS (nếu không phải localhost) ====== */
const isPrivateHost = (h) =>
  /(^localhost$)|(^127\.)|(^10\.)|(^192\.168\.)|(^172\.(1[6-9]|2\d|3[0-1])\.)|(\.local$)|(\.lan$)/i.test(
    h || ""
  );

const shouldForceHttps =
  typeof window !== "undefined" && !isPrivateHost(window.location.hostname);

const toHttpsIfNeeded = (u) => {
  if (!shouldForceHttps || !u || typeof u !== "string") return u;
  try {
    if (u.startsWith("//")) return "https:" + u;
    if (!/^https?:\/\//i.test(u)) return u;
    const url = new URL(u);
    if (url.protocol === "http:" && !isPrivateHost(url.hostname)) {
      url.protocol = "https:";
      return url.toString();
    }
  } catch {}
  return u;
};

const safeSrc = (u) => toHttpsIfNeeded(u);

const fixHtmlHttps = (html) => {
  if (!shouldForceHttps || !html) return html || "";
  try {
    return String(html)
      .replace(/(\s(?:href|src)=["'])http:\/\//gi, "$1https://")
      .replace(/(\s(?:href|src)=["'])\/\/([^"']+)["']/gi, '$1https://$2"');
  } catch {
    return html;
  }
};

/* ====== MUI × Virtuoso bridge ====== */
const VirtuosoTableComponents = {
  Scroller: forwardRef((props, ref) => (
    <TableContainer
      component={Paper}
      variant="outlined"
      {...props}
      ref={ref}
      sx={{ height: "100%" }}
    />
  )),
  Table: (props) => <Table {...props} size="small" />,
  TableHead,
  TableRow,
  TableBody,
};

/* ====== Small memo components ====== */
const PaymentChip = memo(function PaymentChip({ status, paidAt }) {
  const isPaid = status === "Paid";
  return (
    <Tooltip
      arrow
      title={
        isPaid
          ? `Đã thanh toán: ${paidAt ? new Date(paidAt).toLocaleString() : ""}`
          : "Chưa thanh toán"
      }
    >
      <Chip
        size="small"
        color={isPaid ? "success" : "default"}
        label={isPaid ? "Đã thanh toán" : "Chưa thanh toán"}
        sx={{ whiteSpace: "nowrap" }}
      />
    </Tooltip>
  );
});

const CheckinChip = memo(function CheckinChip({ checkinAt }) {
  const ok = !!checkinAt;
  return (
    <Tooltip
      arrow
      title={
        ok
          ? `Đã check-in: ${new Date(checkinAt).toLocaleString()}`
          : "Chưa check-in"
      }
    >
      <Chip
        size="small"
        color={ok ? "info" : "default"}
        label={ok ? "Đã check-in" : "Chưa check-in"}
        sx={{ whiteSpace: "nowrap" }}
      />
    </Tooltip>
  );
});

const CodeBadge = memo(function CodeBadge({ code, withLabel = true }) {
  const text = withLabel ? `Mã đăng ký: ${code}` : String(code);
  return (
    <Chip
      size="small"
      variant="outlined"
      label={text}
      sx={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
    />
  );
});

const StatItem = memo(function StatItem({ icon, label, value, hint }) {
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
          <Typography variant="h6" sx={{ lineHeight: 1.2 }} noWrap>
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
});

const PlayerCell = memo(function PlayerCell({
  player,
  onEdit,
  canEdit,
  onOpenPreview,
  onOpenProfile,
  onImgError,
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Box
        onClick={() =>
          onOpenPreview(player?.avatar || PLACE, displayName(player))
        }
        sx={{
          borderRadius: "50%",
          overflow: "hidden",
          lineHeight: 0,
          cursor: "zoom-in",
        }}
      >
        <Avatar
          src={safeSrc(player?.avatar || PLACE)}
          imgProps={{ onError: onImgError, loading: "lazy", decoding: "async" }}
        />
      </Box>

      <Box
        sx={{
          maxWidth: 300,
          overflow: "hidden",
          cursor: getUserId(player) ? "pointer" : "default",
        }}
        onClick={() => onOpenProfile(player)}
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
});

const ActionCell = memo(function ActionCell({
  r,
  canManage,
  isOwner,
  onTogglePayment,
  onCancel,
  onOpenComplaint,
  onOpenPayment,
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

      <Tooltip arrow title="Thanh toán bằng mã QR">
        <span>
          <Button
            size="small"
            variant="contained"
            onClick={() => onOpenPayment(r)}
            startIcon={<QrCode fontSize="small" />}
            sx={{ textTransform: "none" }}
          >
            Thanh toán
          </Button>
        </span>
      </Tooltip>

      <Tooltip arrow title="Gửi khiếu nại cho đăng ký này">
        <span>
          <Button
            size="small"
            variant="contained"
            color="warning"
            onClick={() => onOpenComplaint(r)}
            startIcon={<ReportProblem fontSize="small" />}
            sx={{ textTransform: "none" }}
          >
            Khiếu nại
          </Button>
        </span>
      </Tooltip>

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
});

/** VĐV 1 (Bạn) readonly cho user thường */
const SelfPlayerReadonly = memo(function SelfPlayerReadonly({
  me,
  isSingles,
  onImgError,
}) {
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
        <Avatar
          src={safeSrc(me?.avatar || PLACE)}
          imgProps={{ onError: onImgError, loading: "lazy", decoding: "async" }}
        />
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
});

const MobileCard = memo(function MobileCard({
  r,
  i,
  isSingles,
  cap,
  delta,
  isLoggedIn,
  me,
  canManage,
  onOpenReplace,
  onOpenPreview,
  onOpenProfile,
  onTogglePayment,
  onCancel,
  onOpenComplaint,
  onOpenPayment,
  onImgError,
}) {
  const total = useMemo(() => totalScoreOf(r, isSingles), [r, isSingles]);
  const chip = useMemo(
    () => totalChipStyle(total, cap, delta),
    [total, cap, delta]
  );
  const isOwner = isLoggedIn && String(r?.createdBy) === String(me?._id);
  const code =
    r?.code ||
    r?.shortCode ||
    String(r?._id || "")
      .slice(-5)
      .toUpperCase();

  return (
    <Paper sx={{ p: 2, mx: 0.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <CodeBadge code={code} />
        <Typography variant="caption" color="text.secondary">
          #{i + 1}
        </Typography>
      </Stack>

      {[r.player1, r.player2].filter(Boolean).map((pl, idx) => (
        <Stack
          key={`${pl?.phone || pl?.fullName || idx}`}
          direction="row"
          spacing={1}
          alignItems="center"
          mt={1}
        >
          <Box
            onClick={() => onOpenPreview(pl?.avatar || PLACE, displayName(pl))}
            sx={{
              borderRadius: "50%",
              overflow: "hidden",
              lineHeight: 0,
              cursor: "zoom-in",
            }}
          >
            <Avatar
              src={safeSrc(pl?.avatar || PLACE)}
              imgProps={{
                onError: onImgError,
                loading: "lazy",
                decoding: "async",
              }}
            />
          </Box>

          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              cursor: getUserId(pl) ? "pointer" : "default",
            }}
            onClick={() => onOpenProfile(pl)}
            title="Xem hồ sơ"
          >
            <Typography variant="body2" noWrap>
              {displayName(pl)}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
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
            <Tooltip arrow title={`Thay ${idx === 0 ? "VĐV 1" : "VĐV 2"}`}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => onOpenReplace(r, idx === 0 ? "p1" : "p2")}
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
            onClick={() => onOpenReplace(r, "p2")}
          >
            Thêm VĐV 2
          </Button>
        </Box>
      )}

      <Typography variant="caption" color="text.secondary" mt={1}>
        {new Date(r.createdAt).toLocaleString()}
      </Typography>

      <Stack direction="row" spacing={1} mt={1} alignItems="center">
        <PaymentChip status={r.payment?.status} paidAt={r.payment?.paidAt} />
        <CheckinChip checkinAt={r.checkinAt} />
      </Stack>

      <Stack direction="row" spacing={1} mt={1} alignItems="center">
        <Typography variant="body2">Tổng điểm:</Typography>
        <Tooltip arrow title={`Tổng điểm: ${fmt3(total)} • ${chip.title}`}>
          <Chip
            size="small"
            icon={<Equalizer fontSize="small" />}
            label={fmt3(total)}
            color={chip.color}
            variant="filled"
            sx={{ whiteSpace: "nowrap" }}
          />
        </Tooltip>
      </Stack>

      <Box mt={1}>
        <ActionCell
          r={r}
          canManage={canManage}
          isOwner={isOwner}
          onTogglePayment={onTogglePayment}
          onCancel={onCancel}
          onOpenComplaint={onOpenComplaint}
          onOpenPayment={onOpenPayment}
        />
      </Box>
    </Paper>
  );
});

/* ===================== MAIN COMPONENT ===================== */
export default function TournamentRegistration() {
  const { id } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"), { noSsr: true });

  // Lấy "mình" + điểm
  const { data: me, isLoading: meLoading, error: meErr } = useGetMeScoreQuery();
  const isLoggedIn = !!me?._id;

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

  // invites (nếu cần)
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

  const [createComplaint, { isLoading: sendingComplaint }] =
    useCreateComplaintMutation();

  /* ───────── local state ───────── */
  const [p1, setP1] = useState(null);
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

  // Khiếu nại + Thanh toán (QR)
  const [complaintDlg, setComplaintDlg] = useState({
    open: false,
    reg: null,
    text: "",
  });
  const [paymentDlg, setPaymentDlg] = useState({ open: false, reg: null });

  // Public profile dialog
  const [profileDlg, setProfileDlg] = useState({ open: false, userId: null });
  const openProfileByPlayer = useCallback((pl) => {
    const uid = getUserId(pl);
    if (uid) setProfileDlg({ open: true, userId: uid });
    else toast.info("Không tìm thấy userId của VĐV này.");
  }, []);
  const closeProfileDlg = useCallback(
    () => setProfileDlg({ open: false, userId: null }),
    []
  );

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

  // invites của giải hiện tại
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

  /* ───────── SEARCH state + query ───────── */
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const deferredQ = useDeferredValue(debouncedQ);

  const {
    data: searchedRegs = [],
    isLoading: searching,
    isFetching: searchingFetching,
    error: searchErr,
  } = useSearchRegistrationsQuery({ id, q: deferredQ }, { skip: !deferredQ });

  /* ───────── derived helpers ───────── */
  const listLoading = deferredQ ? searching || searchingFetching : regsLoading;
  const listError = deferredQ ? searchErr : regsErr;
  const listRegs = deferredQ ? searchedRegs || [] : regs || [];
  const regCount = listRegs?.length ?? 0;

  const overallRegCount = regs?.length ?? 0;
  const paidCount = useMemo(
    () => (regs || []).filter((r) => r?.payment?.status === "Paid").length,
    [regs]
  );

  // formatters & fixed HTML (memo)
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }),
    []
  );
  const formatDate = useCallback(
    (d) => (d ? dateFmt.format(new Date(d)) : ""),
    [dateFmt]
  );
  const formatRange = useCallback(
    (a, b) => {
      const A = formatDate(a);
      const B = formatDate(b);
      return A && B ? `${A} – ${B}` : A || B || "—";
    },
    [formatDate]
  );

  const contactHtmlFixed = useMemo(
    () => fixHtmlHttps(tour?.contactHtml),
    [tour?.contactHtml]
  );
  const contentHtmlFixed = useMemo(
    () => fixHtmlHttps(tour?.contentHtml),
    [tour?.contentHtml]
  );

  // stable handlers
  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      if (!isLoggedIn) return toast.info("Vui lòng đăng nhập để đăng ký.");

      const player1Id = isAdmin ? p1?._id : String(me?._id);
      if (!player1Id) {
        return toast.error(
          isAdmin ? "Vui lòng chọn VĐV 1." : "Không xác định được VĐV 1 (bạn)."
        );
      }
      if (isDoubles && !p2?._id) return toast.error("Giải đôi cần 2 VĐV");

      try {
        const res = await createInvite({
          tourId: id,
          message: msg,
          player1Id,
          ...(isDoubles ? { player2Id: p2._id } : {}),
        }).unwrap();

        if (
          res?.registration ||
          res?.mode === "direct_by_admin" ||
          res?.mode === "direct_by_kyc" ||
          res?.mode === "direct"
        ) {
          const mode = res?.mode || "direct";
          const label =
            mode === "direct_by_admin"
              ? "Admin"
              : mode === "direct_by_kyc"
              ? "KYC"
              : "Trực tiếp";
          toast.success(`Đã tạo đăng ký (${label}).`);

          if (isAdmin) setP1(null);
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
              "VĐV cần hoàn tất KYC (đã xác minh) trước khi đăng ký."
          );
        } else {
          toast.error(
            err?.data?.message || err?.error || "Không thể tạo đăng ký."
          );
        }
      }
    },
    [
      isLoggedIn,
      isAdmin,
      p1,
      p2,
      msg,
      isDoubles,
      id,
      me,
      createInvite,
      refetchRegs,
    ]
  );

  const handleCancel = useCallback(
    async (r) => {
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
      if (
        !window.confirm(`Bạn chắc chắn muốn huỷ cặp đăng ký này?${extraWarn}`)
      )
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
    },
    [isLoggedIn, canManage, me, adminDeleteReg, cancelReg, refetchRegs]
  );

  const togglePayment = useCallback(
    async (r) => {
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
    },
    [canManage, setPaymentStatus, refetchRegs]
  );

  const handleInviteRespond = useCallback(
    async (inviteId, action) => {
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
    },
    [isLoggedIn, respondInvite, refetchInvites, refetchRegs]
  );

  const openPreview = useCallback(
    (src, name) =>
      setImgPreview({ open: true, src: safeSrc(src), name: name || "" }),
    []
  );
  const closePreview = useCallback(
    () => setImgPreview({ open: false, src: "", name: "" }),
    []
  );

  const openReplace = useCallback(
    (reg, slot) => {
      if (!canManage) return;
      setReplaceDlg({ open: true, reg, slot });
      setNewPlayer(null);
    },
    [canManage]
  );
  const closeReplace = useCallback(
    () => setReplaceDlg({ open: false, reg: null, slot: "p1" }),
    []
  );

  const submitReplace = useCallback(async () => {
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
  }, [replaceDlg, newPlayer, replacePlayer, closeReplace, refetchRegs]);

  const onImgError = useCallback((e) => {
    e.currentTarget.src = PLACE;
  }, []);
  const maskPhone = useCallback((phone) => {
    if (!phone) return "*******???";
    const d = String(phone).replace(/\D/g, "");
    const tail = d.slice(-3) || "???";
    return "*******" + tail;
  }, []);
  const regCodeOf = useCallback(
    (r) =>
      r?.code ||
      r?.shortCode ||
      String(r?._id || "")
        .slice(-5)
        .toUpperCase(),
    []
  );
  const normalizeNoAccent = useCallback(
    (s) =>
      (s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    []
  );
  const getQrProviderConfig = useCallback(() => {
    const bank =
      tour?.bankShortName ||
      tour?.qrBank ||
      tour?.bankCode ||
      tour?.bank ||
      import.meta.env?.VITE_QR_BANK ||
      "";
    const acc =
      tour?.bankAccountNumber ||
      tour?.qrAccount ||
      tour?.bankAccount ||
      import.meta.env?.VITE_QR_ACC ||
      "";
    return { bank, acc };
  }, [
    tour?.bankShortName,
    tour?.qrBank,
    tour?.bankCode,
    tour?.bank,
    tour?.bankAccountNumber,
    tour?.qrAccount,
    tour?.bankAccount,
  ]);

  const qrImgUrlFor = useCallback(
    (r) => {
      const { bank, acc } = getQrProviderConfig();
      if (!bank || !acc) return null;
      const code = regCodeOf(r);
      const ph = maskPhone(
        r?.player1?.phone || r?.player2?.phone || me?.phone || ""
      );
      const des = normalizeNoAccent(
        `Ma giai ${id} Ma dang ky ${code} SDT ${ph}`
      );
      const params = new URLSearchParams({
        bank,
        acc,
        des,
        template: "compact",
      });
      const amount = getFeeAmount(tour, r);
      if (amount > 0) params.set("amount", String(amount));
      return `https://qr.sepay.vn/img?${params.toString()}`;
    },
    [
      getQrProviderConfig,
      regCodeOf,
      maskPhone,
      normalizeNoAccent,
      id,
      me?.phone,
      tour,
    ]
  );

  const openComplaint = useCallback(
    (reg) => setComplaintDlg({ open: true, reg, text: "" }),
    []
  );
  const closeComplaint = useCallback(
    () => setComplaintDlg({ open: false, reg: null, text: "" }),
    []
  );
  const submitComplaint = useCallback(async () => {
    const regId = complaintDlg?.reg?._id;
    const content = complaintDlg.text?.trim();
    if (!content) return toast.info("Vui lòng nhập nội dung khiếu nại.");
    if (!regId)
      return toast.error("Không tìm thấy mã đăng ký để gửi khiếu nại.");
    if (!isLoggedIn) return toast.info("Vui lòng đăng nhập để gửi khiếu nại.");
    try {
      await createComplaint({ tournamentId: id, regId, content }).unwrap();
      toast.success("Đã gửi khiếu nại. BTC sẽ phản hồi sớm.");
      closeComplaint();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Gửi khiếu nại thất bại");
    }
  }, [complaintDlg, isLoggedIn, createComplaint, id, closeComplaint]);

  const openPayment = useCallback(
    (reg) => setPaymentDlg({ open: true, reg }),
    []
  );
  const closePayment = useCallback(
    () => setPaymentDlg({ open: false, reg: null }),
    []
  );

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
                  label={isSingles ? "Số VĐV đã đăng ký" : "Số đội đã đăng ký"}
                  value={fmt3(overallRegCount)}
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

      {/* FORM đăng ký */}
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
          ) : !isLoggedIn ? (
            <Alert severity="info">
              Bạn chưa đăng nhập. Hãy đăng nhập để đăng ký.
            </Alert>
          ) : isAdmin ? (
            <>
              <Box mt={1}>
                <PlayerSelector
                  label="VĐV 1"
                  eventType={tour?.eventType}
                  value={p1}
                  onChange={setP1}
                />
              </Box>
              {isDoubles && (
                <Box mt={2}>
                  <PlayerSelector
                    label="VĐV 2"
                    eventType={tour?.eventType}
                    value={p2}
                    onChange={setP2}
                  />
                </Box>
              )}
            </>
          ) : (
            <>
              <SelfPlayerReadonly
                me={me}
                isSingles={isSingles}
                onImgError={onImgError}
              />
              {isDoubles && (
                <Box mt={3}>
                  <PlayerSelector
                    label="VĐV 2"
                    eventType={tour?.eventType}
                    value={p2}
                    onChange={setP2}
                  />
                </Box>
              )}
            </>
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
              ? "Quyền admin: chọn VĐV 1 (và VĐV 2 nếu là đôi) để tạo đăng ký trực tiếp."
              : isSingles
              ? "Giải đơn: VĐV phải KYC (đã xác minh) thì mới đăng ký được."
              : "Giải đôi: CẢ HAI VĐV phải KYC (đã xác minh) thì mới đăng ký được."}
          </Typography>

          <Stack direction="row" spacing={2} mt={2}>
            <Button
              type="submit"
              variant="contained"
              disabled={
                saving ||
                meLoading ||
                !isLoggedIn ||
                (isAdmin ? !p1 || (isDoubles && !p2) : isDoubles && !p2)
              }
            >
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
                dangerouslySetInnerHTML={{ __html: contactHtmlFixed }}
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
                dangerouslySetInnerHTML={{ __html: contentHtmlFixed }}
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

      {/* Search box */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        alignItems={{ xs: "stretch", sm: "center" }}
        sx={{ mb: 1 }}
      >
        <TextField
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo VĐV, SĐT, mã đăng ký…"
          size="small"
          sx={{ maxWidth: 420 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: q ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setQ("")}>
                  <Clear fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
        />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ whiteSpace: "nowrap" }}
        >
          {deferredQ
            ? listLoading
              ? "Đang tìm…"
              : listError
              ? "Tìm kiếm lỗi!"
              : `Kết quả: ${regCount}`
            : ""}
        </Typography>
      </Stack>

      {listLoading ? (
        <CircularProgress />
      ) : listError ? (
        <Alert severity="error">
          {listError?.data?.message || listError?.error || "Lỗi tải danh sách"}
        </Alert>
      ) : regCount === 0 ? (
        <Typography color="text.secondary">Danh sách đăng ký trống!</Typography>
      ) : isMobile ? (
        /* ------- Mobile: Virtualized cards ------- */
        <Box sx={{ height: 560 }}>
          <Virtuoso
            data={listRegs}
            itemContent={(index, r) => (
              <MobileCard
                r={r}
                i={index}
                isSingles={isSingles}
                cap={cap}
                delta={delta}
                isLoggedIn={isLoggedIn}
                me={me}
                canManage={canManage}
                onOpenReplace={openReplace}
                onOpenPreview={openPreview}
                onOpenProfile={openProfileByPlayer}
                onTogglePayment={togglePayment}
                onCancel={handleCancel}
                onOpenComplaint={openComplaint}
                onOpenPayment={openPayment}
                onImgError={onImgError}
              />
            )}
            style={{ height: "100%" }}
            increaseViewportBy={{ top: 400, bottom: 800 }}
            itemKey={(index, r) => r._id}
          />
        </Box>
      ) : (
        /* ------- Desktop: Virtualized table (correct cells) ------- */
        <Box sx={{ mt: 1, height: 560 }}>
          <TableVirtuoso
            data={listRegs}
            components={VirtuosoTableComponents}
            fixedHeaderContent={() => (
              <TableRow>
                <TableCell sx={{ whiteSpace: "nowrap" }}>#</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>Mã đăng ký</TableCell>
                <TableCell>{isSingles ? "VĐV" : "VĐV 1"}</TableCell>
                {!isSingles && <TableCell>VĐV 2</TableCell>}
                <TableCell sx={{ whiteSpace: "nowrap" }}>Tổng điểm</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>
                  Thời gian tạo
                </TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>Lệ phí</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>Check-in</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap", minWidth: 200 }}>
                  Hành động
                </TableCell>
              </TableRow>
            )}
            itemContent={(index, r) => {
              const total = totalScoreOf(r, isSingles);
              const chip = totalChipStyle(total, cap, delta);
              const isOwner =
                isLoggedIn && String(r?.createdBy) === String(me?._id);

              return (
                <>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {index + 1}
                  </TableCell>

                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <CodeBadge
                      code={
                        r?.code ||
                        r?.shortCode ||
                        String(r?._id || "")
                          .slice(-5)
                          .toUpperCase()
                      }
                      withLabel={false}
                    />
                  </TableCell>

                  <TableCell>
                    <PlayerCell
                      player={r.player1}
                      onEdit={() => openReplace(r, "p1")}
                      canEdit={canManage}
                      onOpenPreview={openPreview}
                      onOpenProfile={openProfileByPlayer}
                      onImgError={onImgError}
                    />
                  </TableCell>

                  {!isSingles && (
                    <TableCell>
                      {r.player2 ? (
                        <PlayerCell
                          player={r.player2}
                          onEdit={() => openReplace(r, "p2")}
                          canEdit={canManage}
                          onOpenPreview={openPreview}
                          onOpenProfile={openProfileByPlayer}
                          onImgError={onImgError}
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
                    <Tooltip
                      arrow
                      title={`Tổng điểm trình (chốt lúc đăng ký): ${fmt3(
                        total
                      )} • ${chip.title}`}
                    >
                      <Chip
                        size="small"
                        icon={<Equalizer fontSize="small" />}
                        label={fmt3(total)}
                        color={chip.color}
                        variant="filled"
                        sx={{ whiteSpace: "nowrap" }}
                      />
                    </Tooltip>
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
                      onOpenComplaint={openComplaint}
                      onOpenPayment={openPayment}
                    />
                  </TableCell>
                </>
              );
            }}
            style={{ height: "100%" }}
            increaseViewportBy={{ top: 400, bottom: 800 }}
            itemKey={(index, r) => r._id}
          />
        </Box>
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
            src={safeSrc(imgPreview.src || PLACE)}
            alt={imgPreview.name || "player"}
            style={{
              width: "100%",
              maxHeight: "80vh",
              objectFit: "contain",
              borderRadius: 8,
            }}
            loading="lazy"
            decoding="async"
            onError={onImgError}
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

      {/* Dialog Khiếu nại */}
      <Dialog
        open={complaintDlg.open}
        onClose={closeComplaint}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Khiếu nại đăng ký</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Vui lòng mô tả chi tiết vấn đề của bạn với đăng ký này. BTC sẽ tiếp
            nhận và phản hồi.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={4}
            label="Nội dung khiếu nại"
            value={complaintDlg.text}
            onChange={(e) =>
              setComplaintDlg((s) => ({ ...s, text: e.target.value }))
            }
            placeholder="Ví dụ: Sai thông tin VĐV, sai điểm trình, muốn đổi khung giờ…"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeComplaint}>Đóng</Button>
          <Button
            onClick={submitComplaint}
            variant="contained"
            disabled={sendingComplaint || !complaintDlg.text.trim()}
          >
            {sendingComplaint ? "Đang gửi…" : "Gửi khiếu nại"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog Thanh toán QR */}
      <Dialog
        open={paymentDlg.open}
        onClose={closePayment}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Thanh toán lệ phí</DialogTitle>
        <DialogContent dividers sx={{ textAlign: "center" }}>
          {paymentDlg.reg ? (
            <>
              {(() => {
                const code = regCodeOf(paymentDlg.reg);
                const ph = maskPhone(
                  paymentDlg.reg?.player1?.phone ||
                    paymentDlg.reg?.player2?.phone ||
                    me?.phone ||
                    ""
                );
                return (
                  <Typography variant="body2" sx={{ mb: 1.5 }}>
                    {`Vui lòng quét QR để thanh toán cho mã đăng ký ${code}. SĐT xác nhận: ${ph}.`}
                  </Typography>
                );
              })()}

              {(() => {
                const url = safeSrc(qrImgUrlFor(paymentDlg.reg));
                if (!url) {
                  return (
                    <Alert severity="info" sx={{ textAlign: "left", mb: 1 }}>
                      Hiện chưa có mã QR thanh toán. Bạn có thể dùng mục{" "}
                      <b>Khiếu nại</b> để liên hệ BTC nhận hướng dẫn thanh toán.
                    </Alert>
                  );
                }
                return (
                  <>
                    <Box sx={{ display: "grid", placeItems: "center" }}>
                      <img
                        src={url}
                        alt="QR thanh toán"
                        style={{ width: 260, height: 260, borderRadius: 8 }}
                        loading="lazy"
                        decoding="async"
                        onError={onImgError}
                      />
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 1, display: "block" }}
                    >
                      Quét mã QR code ở trên để thanh toán phí đăng ký giải đấu.
                    </Typography>
                  </>
                );
              })()}
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          {!paymentDlg.reg || !safeSrc(qrImgUrlFor(paymentDlg.reg)) ? (
            <Button
              color="warning"
              variant="outlined"
              onClick={() =>
                setComplaintDlg({ open: true, reg: paymentDlg.reg, text: "" })
              }
              startIcon={<ReportProblem fontSize="small" />}
            >
              Khiếu nại
            </Button>
          ) : null}
          <Button onClick={closePayment}>Đóng</Button>
        </DialogActions>
      </Dialog>
    </RBContainer>
  );
}
