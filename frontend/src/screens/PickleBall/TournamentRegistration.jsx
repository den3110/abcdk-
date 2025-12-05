import { useState, useMemo, useEffect, useCallback, memo, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  InputAdornment,
  Container,
  Card,
  CardContent,
  Divider,
  alpha,
  Tooltip,
  Skeleton,
  Grid,
} from "@mui/material";
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
  Verified as VerifiedIcon,
  HourglassBottom as PendingIcon,
  AccessTimeFilled,
  SportsTennis,
  LocationOn,
  CalendarMonth,
  EmojiEvents,
  PersonAdd,
  CheckCircle,
  InfoOutlined,
} from "@mui/icons-material";
import DangerousSharpIcon from "@mui/icons-material/DangerousSharp";

import {
  useGetTournamentQuery,
  useGetRegistrationsQuery,
  useCreateRegInviteMutation,
  useManagerSetRegPaymentStatusMutation,
  useManagerDeleteRegistrationMutation,
  useManagerReplaceRegPlayerMutation,
  useCreateComplaintMutation,
  useSearchRegistrationsQuery,
  useCancelRegistrationMutation,
} from "../../slices/tournamentsApiSlice";
import { useGetMeScoreQuery } from "../../slices/usersApiSlice";
import PlayerSelector from "../../components/PlayerSelector";
import PublicProfileDialog from "../../components/PublicProfileDialog";
import { getFeeAmount } from "../../utils/fee";
import { useBotContext } from "../../hook/useBotContext";

/* ---------------- 1. CONSTANTS & HELPERS ---------------- */
const PLACE = "https://dummyimage.com/800x600/cccccc/ffffff&text=?";
const BRAND_COLOR = "#1976d2";
const CARD_RADIUS = 3;

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

  return {
    color: "success",
    title: `< ${fmt3(cap)} + ${fmt3(d)} (Hợp lệ)`,
  };
};

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
  const nn = pl?.nickName || pl?.nickname || pl?.user?.nickname || "";
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

const getScoreCap = (tour, isSingles) => {
  if (!tour) return 0;
  return isSingles
    ? Number(tour?.singleCap ?? tour?.scoreCap ?? 0)
    : Number(tour?.scoreCap ?? 0);
};

const getMaxDelta = (tour) =>
  Number(
    tour?.scoreGap ??
      tour?.maxDelta ??
      tour?.scoreTolerance ??
      tour?.tolerance ??
      0
  );

/* Logic HTTPS forcing */
const shouldForceHttps = (() => {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname || "";
  const isLocal =
    /(^localhost$)|(^127\.)|(^10\.)|(^192\.168\.)|(^172\.(1[6-9]|2\d|3[0-1])\.)|(\.local$)|(\.lan$)/i.test(
      h
    );
  return !isLocal;
})();

const toHttpsIfNeeded = (u) => {
  if (!shouldForceHttps || !u || typeof u !== "string") return u;
  try {
    if (u.startsWith("//")) return "https:" + u;
    if (!/^https?:\/\//i.test(u)) return u;
    const url = new URL(u);
    const isPrivate =
      /(^localhost$)|(^127\.)|(^10\.)|(^192\.168\.)|(^172\.(1[6-9]|2\d|3[0-1])\.)|(\.local$)|(\.lan$)/i.test(
        url.hostname
      );
    if (url.protocol === "http:" && !isPrivate) {
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

const maskPhone = (phone) => {
  if (!phone) return "*******???";
  const d = String(phone).replace(/\D/g, "");
  const tail = d.slice(-3) || "???";
  return "*******" + tail;
};

const normalizeNoAccent = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/* ---------------- 2. UI COMPONENTS ---------------- */

/* Badge KYC */
const kycMeta = (status) => {
  const s = String(status || "").toLowerCase();
  switch (s) {
    case "verified":
      return {
        icon: <VerifiedIcon fontSize="inherit" />,
        color: "info.main",
        tip: "Đã KYC",
      };
    case "pending":
      return {
        icon: <PendingIcon fontSize="inherit" />,
        color: "warning.main",
        tip: "Đang chờ KYC",
      };
    default:
      return {
        icon: <DangerousSharpIcon fontSize="inherit" />,
        color: "text.disabled",
        tip: "Chưa KYC",
      };
  }
};

const VerifyBadge = memo(({ status }) => {
  const { icon, color, tip } = kycMeta(status);
  return (
    <Tooltip title={tip} arrow>
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          color,
          ml: 0.5,
          fontSize: 18,
          verticalAlign: "middle",
        }}
      >
        {icon}
      </Box>
    </Tooltip>
  );
});

const kycOf = (pl) => pl?.cccdStatus || "unverified";

/* Lazy Avatar */
const LazyAvatar = memo(({ src, alt, size = 40, onClick, sx }) => {
  const [imgSrc, setImgSrc] = useState(PLACE);
  const imgRef = useRef(null);

  useEffect(() => {
    const targetSrc = safeSrc(src || PLACE);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          const img = new Image();
          img.src = targetSrc;
          img.onload = () => setImgSrc(targetSrc);
          img.onerror = () => setImgSrc(PLACE);
          observer.disconnect();
        }
      },
      { rootMargin: "50px" }
    );

    if (imgRef.current) observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, [src]);

  return (
    <Avatar
      ref={imgRef}
      src={imgSrc}
      alt={alt}
      onClick={onClick}
      sx={{
        width: size,
        height: size,
        border: `2px solid ${alpha("#fff", 0.8)}`,
        boxShadow: 2,
        cursor: onClick ? "zoom-in" : "default",
        ...sx,
      }}
    />
  );
});

/* Chips */
const PaymentChip = memo(({ status }) => {
  const isPaid = status === "Paid";
  return (
    <Chip
      size="small"
      label={isPaid ? "Đã Thanh toán" : "Chưa Thanh toán"}
      sx={{
        bgcolor: isPaid ? alpha("#2e7d32", 0.1) : alpha("#ed6c02", 0.1),
        color: isPaid ? "#1b5e20" : "#e65100",
        fontWeight: 600,
        fontSize: "0.7rem",
        height: 24,
      }}
    />
  );
});

const CheckinChip = memo(({ checkinAt }) => {
  if (!checkinAt) return null;
  return (
    <Chip
      size="small"
      icon={<CheckCircle sx={{ fontSize: "14px !important" }} />}
      label="Đã Check-in"
      color="info"
      variant="outlined"
      sx={{ fontSize: "0.7rem", height: 24 }}
    />
  );
});

/* Thống kê Card */
const StatCard = memo(({ icon, label, value, subValue }) => (
  <Paper
    elevation={0}
    sx={{
      p: { xs: 1.5, sm: 2 },
      height: "100%",
      borderRadius: 2,
      bgcolor: "background.paper",
      border: "1px solid",
      borderColor: "divider",
      transition: "all 0.2s",
      "&:hover": {
        transform: "translateY(-2px)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
      },
    }}
  >
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Box
        sx={{
          p: 1,
          borderRadius: "12px",
          bgcolor: alpha(BRAND_COLOR, 0.08),
          color: BRAND_COLOR,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          width: { xs: 32, sm: 40 },
          height: { xs: 32, sm: 40 },
        }}
      >
        {/* cho icon tự co theo box */}
        <Box sx={{ "& svg": { fontSize: { xs: 18, sm: 22 } } }}>{icon}</Box>
      </Box>

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            fontSize: { xs: "0.65rem", sm: "0.75rem" },
            lineHeight: 1.2,
            wordBreak: "break-word", // tránh lòi chữ
          }}
        >
          {label}
        </Typography>

        <Typography
          sx={{
            mt: 0.3,
            fontWeight: 700,
            color: "text.primary",
            fontSize: { xs: "1rem", sm: "1.25rem" },
            lineHeight: 1.1,
            wordBreak: "break-word",
          }}
        >
          {value}
        </Typography>

        {subValue && (
          <Typography
            variant="caption"
            sx={{
              mt: 0.3,
              color: "text.secondary",
              fontSize: { xs: "0.65rem", sm: "0.75rem" },
              display: "block",
              wordBreak: "break-word",
            }}
          >
            {subValue}
          </Typography>
        )}
      </Box>
    </Stack>
  </Paper>
));

/* Countdown */
const CountdownItem = ({ value, label }) => (
  <Box sx={{ textAlign: "center", minWidth: 48 }}>
    <Paper
      elevation={0}
      sx={{
        bgcolor: alpha("#fff", 0.15),
        color: "#fff",
        py: 0.5,
        px: 0.5,
        borderRadius: 1,
        backdropFilter: "blur(4px)",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <Typography variant="h6" fontWeight="bold" lineHeight={1}>
        {String(value).padStart(2, "0")}
      </Typography>
    </Paper>
    <Typography
      variant="caption"
      sx={{
        color: alpha("#fff", 0.8),
        fontSize: "0.65rem",
        mt: 0.5,
        display: "block",
        textTransform: "uppercase",
      }}
    >
      {label}
    </Typography>
  </Box>
);

/* HTML Preview */
const HtmlPreviewSection = ({ title, html }) => {
  const [open, setOpen] = useState(false);
  const processedHtml = useMemo(() => fixHtmlHttps(html), [html]);
  if (!html) return null;

  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Typography
            variant="subtitle1"
            fontWeight={700}
            display="flex"
            alignItems="center"
            gap={1}
          >
            <InfoOutlined fontSize="small" color="primary" /> {title}
          </Typography>
          <Button size="small" onClick={() => setOpen(true)}>
            Xem chi tiết
          </Button>
        </Stack>
        <Box
          sx={{
            mt: 1,
            maxHeight: 100,
            overflow: "hidden",
            position: "relative",
            typography: "body2",
            color: "text.secondary",
            maskImage:
              "linear-gradient(to bottom, black 60%, transparent 100%)",
          }}
          dangerouslySetInnerHTML={{ __html: processedHtml }}
        />
      </Paper>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent dividers>
          <Box
            dangerouslySetInnerHTML={{ __html: processedHtml }}
            sx={{
              "& img": { maxWidth: "100%", height: "auto", borderRadius: 1 },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Đóng</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

/* ---------------- 3. ROW & ITEM RENDERERS ---------------- */

const ActionButtons = memo(
  ({
    r,
    canManage,
    isOwner,
    onTogglePayment,
    onCancel,
    onOpenPayment,
    onOpenComplaint,
    busy,
  }) => (
    <Stack
      direction="row"
      spacing={0.5}
      justifyContent="flex-end"
      alignItems="center"
    >
      {canManage && (
        <Tooltip title="Đổi trạng thái thanh toán">
          <IconButton
            size="small"
            onClick={() => onTogglePayment(r)}
            color={r.payment?.status === "Paid" ? "default" : "success"}
            disabled={busy?.settingPayment}
          >
            {r.payment?.status === "Paid" ? (
              <MoneyOff fontSize="small" />
            ) : (
              <MonetizationOn fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      )}

      {/* --- Nút Thanh toán (Đã chuyển sang Button) --- */}
      <Tooltip title="Mã QR Thanh toán">
        <Button
          size="small"
          variant="text"
          startIcon={<QrCode fontSize="small" />}
          onClick={() => onOpenPayment(r)}
          sx={{
            color: "#1976d2",
            bgcolor: alpha("#1976d2", 0.05),
            textTransform: "none", // Giữ chữ thường, không viết hoa toàn bộ
            minWidth: "auto", // Để nút gọn gàng
            px: 1, // Padding ngang
          }}
        >
          Thanh toán
        </Button>
      </Tooltip>

      {/* --- Nút Khiếu nại (Đã chuyển sang Button) --- */}
      <Tooltip title="Khiếu nại">
        <Button
          size="small"
          variant="text"
          startIcon={<ReportProblem fontSize="small" />}
          onClick={() => onOpenComplaint(r)}
          sx={{
            color: "#ed6c02",
            bgcolor: alpha("#ed6c02", 0.05),
            textTransform: "none",
            minWidth: "auto",
            px: 1,
          }}
        >
          Khiếu nại
        </Button>
      </Tooltip>

      {(canManage || isOwner) && (
        <Tooltip title="Huỷ đăng ký">
          <IconButton
            size="small"
            color="error"
            onClick={() => onCancel(r)}
            disabled={busy?.deletingId === r._id}
            sx={{ bgcolor: alpha("#d32f2f", 0.05) }}
          >
            <DeleteOutline fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  )
);

const PlayerInfo = memo(
  ({ player, onEdit, canEdit, onOpenPreview, onOpenProfile }) => (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Box
        sx={{ position: "relative", cursor: "zoom-in" }}
        onClick={() => onOpenPreview(player?.avatar, displayName(player))}
      >
        <LazyAvatar src={player?.avatar} size={40} />
        {canEdit && (
          <Box
            sx={{
              position: "absolute",
              bottom: -6,
              right: -6,
              bgcolor: "background.paper",
              borderRadius: "50%",
              boxShadow: 2,
              cursor: "pointer",
              width: 22,
              height: 22,
              display: "grid",
              placeItems: "center",
              zIndex: 1,
              border: "1px solid #eee",
            }}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <EditOutlined sx={{ fontSize: 12, color: "primary.main" }} />
          </Box>
        )}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="body2"
          fontWeight={600}
          noWrap
          onClick={() => onOpenProfile(player)}
          sx={{
            cursor: "pointer",
            "&:hover": { color: "primary.main", textDecoration: "underline" },
            display: "flex",
            alignItems: "center",
          }}
        >
          {displayName(player)} <VerifyBadge status={kycOf(player)} />
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontFamily: "monospace" }}
          >
            {player?.phone || "—"}
          </Typography>
          <Chip
            label={fmt3(player?.score)}
            size="small"
            variant="outlined"
            sx={{ height: 16, fontSize: "0.65rem", borderRadius: 1 }}
          />
        </Stack>
      </Box>
    </Stack>
  )
);

/* Card dùng chung cho cả mobile + desktop */
const RegCard = memo(
  ({ r, index, isSingles, cap, delta, regCodeOf, ...props }) => {
    const total = totalScoreOf(r, isSingles);
    const chip = totalChipStyle(total, cap, delta);

    const colorMap = {
      default: "text.primary",
      success: "success.main",
      warning: "warning.main",
      error: "error.main",
    };

    return (
      <Card
        sx={{
          mb: 0,
          borderRadius: 3,
          border: "1px solid",
          borderColor: "divider",
          boxShadow: "none",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
          {/* Header */}
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            mb={2}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Box
                sx={{
                  bgcolor: "primary.main",
                  color: "#fff",
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12,
                  fontWeight: "bold",
                }}
              >
                {index + 1}
              </Box>
              <Typography
                variant="subtitle2"
                color="text.secondary"
                sx={{ fontFamily: "monospace" }}
              >
                #{regCodeOf(r)}
              </Typography>
              <CheckinChip checkinAt={r.checkinAt} />
            </Stack>
            <PaymentChip status={r.payment?.status} />
          </Stack>

          {/* Body */}
          <Stack spacing={2}>
            {/* Players */}
            <Box>
              <PlayerInfo
                player={r.player1}
                onEdit={() => props.onOpenReplace(r, "p1")}
                canEdit={props.canManage}
                {...props}
              />
              {!isSingles && r.player2 && (
                <Box mt={1.5}>
                  <PlayerInfo
                    player={r.player2}
                    onEdit={() => props.onOpenReplace(r, "p2")}
                    canEdit={props.canManage}
                    {...props}
                  />
                </Box>
              )}
              {!isSingles && !r.player2 && props.canManage && (
                <Button
                  size="small"
                  startIcon={<PersonAdd />}
                  onClick={() => props.onOpenReplace(r, "p2")}
                  sx={{ mt: 1, borderStyle: "dashed" }}
                  fullWidth
                  variant="outlined"
                >
                  Thêm VĐV 2
                </Button>
              )}
            </Box>

            <Divider sx={{ borderStyle: "dashed" }} />

            {/* Score + Actions */}
            <Stack
              direction={{ xs: "column", sm: "column" }}
              justifyContent="space-between"
              alignItems={{ xs: "stretch", sm: "left" }}
              spacing={2}
            >
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Tổng điểm
                </Typography>
                <Stack direction="row" alignItems="baseline" spacing={0.5}>
                  <Typography
                    variant="h6"
                    fontWeight={700}
                    color={colorMap[chip.color] || "text.primary"}
                    title={chip.title}
                  >
                    {fmt3(total)}
                  </Typography>
                  {cap > 0 && (
                    <Typography variant="caption">/ {fmt3(cap)}</Typography>
                  )}
                </Stack>
              </Box>
              <Box sx={{ flexShrink: 0 }}>
                <ActionButtons r={r} {...props} />
              </Box>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    );
  }
);

/* Skeleton card cho list */
const RegCardSkeleton = () => (
  <Card
    sx={{
      mb: 0,
      borderRadius: 3,
      border: "1px solid",
      borderColor: "divider",
      boxShadow: "none",
    }}
  >
    <CardContent sx={{ p: 2 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Skeleton variant="circular" width={24} height={24} />
          <Skeleton variant="text" width={60} />
        </Stack>
        <Skeleton variant="rounded" width={90} height={24} />
      </Stack>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Skeleton variant="circular" width={40} height={40} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="60%" />
            <Skeleton variant="text" width="40%" />
          </Box>
        </Stack>
        <Divider sx={{ borderStyle: "dashed" }} />
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box>
            <Skeleton variant="text" width={80} />
            <Skeleton variant="text" width={60} />
          </Box>
          <Skeleton variant="rounded" width={120} height={28} />
        </Stack>
      </Stack>
    </CardContent>
  </Card>
);

/* Hook lazy load */
function useLazyRender(totalItems, initialBatch = 20, batchSize = 20) {
  const [displayCount, setDisplayCount] = useState(initialBatch);
  const loaderRef = useRef(null);
  const observerRef = useRef(null);

  useEffect(() => {
    setDisplayCount(initialBatch);
  }, [totalItems, initialBatch]);

  useEffect(() => {
    const loader = loaderRef.current;
    if (!loader || displayCount >= totalItems) return;
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting)
          setDisplayCount((p) => Math.min(p + batchSize, totalItems));
      },
      { rootMargin: "200px" }
    );
    observerRef.current.observe(loader);
    return () => observerRef.current?.disconnect();
  }, [displayCount, totalItems, batchSize]);

  return { displayCount, loaderRef, hasMore: displayCount < totalItems };
}

/* ---------------- 4. MAIN PAGE COMPONENT ---------------- */
export default function TournamentRegistration() {
  const { id } = useParams();
  useBotContext({ tournamentId: id });

  /* Data Fetching */
  const { data: me, isLoading: meLoading } = useGetMeScoreQuery();
  const {
    data: tour,
    isLoading: tourLoading,
    error: tourErr,
  } = useGetTournamentQuery(id);
  const {
    data: regs = [],
    isLoading: regsLoading,
    refetch: refetchRegs,
  } = useGetRegistrationsQuery(id);

  /* Permissions */
  const isLoggedIn = !!me?._id;
  const isManager = useMemo(() => {
    if (!isLoggedIn || !tour) return false;
    if (String(tour.createdBy) === String(me?._id)) return true;
    if (Array.isArray(tour.managers))
      return tour.managers.some(
        (m) => String(m?.user ?? m) === String(me?._id)
      );
    return !!tour.isManager;
  }, [isLoggedIn, me, tour]);
  const isAdmin = !!(me?.isAdmin || me?.role === "admin");
  const canManage = isLoggedIn && (isManager || isAdmin);

  /* API Actions */
  const [createInvite, { isLoading: saving }] = useCreateRegInviteMutation();
  const [cancelReg] = useCancelRegistrationMutation();
  const [setPaymentStatus, { isLoading: settingPayment }] =
    useManagerSetRegPaymentStatusMutation();
  const [adminDeleteReg] = useManagerDeleteRegistrationMutation();
  const [replacePlayer] = useManagerReplaceRegPlayerMutation();
  const [createComplaint, { isLoading: sendingComplaint }] =
    useCreateComplaintMutation();

  /* Form States */
  const [p1, setP1] = useState(null);
  const [p2, setP2] = useState(null);
  const [msg, setMsg] = useState("");
  const [cancelingId, setCancelingId] = useState(null);

  /* Dialog States */
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
  const [complaintDlg, setComplaintDlg] = useState({
    open: false,
    reg: null,
    text: "",
  });
  const [paymentDlg, setPaymentDlg] = useState({ open: false, reg: null });
  const [profileDlg, setProfileDlg] = useState({ open: false, userId: null });

  /* Countdown */
  const [timeLeft, setTimeLeft] = useState(null);

  useEffect(() => {
    const raw = tour?.registrationDeadline || tour?.regDeadline;
    if (!raw) {
      // Không có deadline thì không hiển thị countdown / closed
      setTimeLeft(null);
      return;
    }
    const deadline = new Date(raw);

    const tick = () => {
      const diff = deadline.getTime() - new Date().getTime();
      if (diff <= 0) {
        setTimeLeft({ total: 0, d: 0, h: 0, m: 0, s: 0 });
      } else {
        setTimeLeft({
          total: diff,
          d: Math.floor(diff / (1000 * 60 * 60 * 24)),
          h: Math.floor((diff / (1000 * 60 * 60)) % 24),
          m: Math.floor((diff / 1000 / 60) % 60),
          s: Math.floor((diff / 1000) % 60),
        });
      }
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [tour?.registrationDeadline, tour?.regDeadline]);

  const isRegClosed = timeLeft?.total === 0 || timeLeft?.total < 0;
  // user thường thì khoá form, admin/manager vẫn mở
  const regLockedForUser = isRegClosed && !canManage;

  /* Search */
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 500);
    return () => clearTimeout(t);
  }, [q]);

  const {
    data: searchedRegs = [],
    isFetching: searching,
    refetch: refetchSearch,
  } = useSearchRegistrationsQuery({ id, q: debouncedQ }, { skip: !debouncedQ });

  const activeList = useMemo(
    () => (debouncedQ ? searchedRegs : regs),
    [debouncedQ, searchedRegs, regs]
  );

  const { displayCount, loaderRef, hasMore } = useLazyRender(activeList.length);
  const displayedItems = useMemo(
    () => activeList.slice(0, displayCount),
    [activeList, displayCount]
  );

  /* Derived Data */
  const evType = normType(tour?.eventType);
  const isSingles = evType === "single";
  const isDoubles = evType === "double";
  const cap = getScoreCap(tour, isSingles);
  const eachCap = Number(tour?.singleCap ?? 0);
  const delta = getMaxDelta(tour);
  const paidCount = activeList.filter(
    (r) => r.payment?.status === "Paid"
  ).length;
  const busy = useMemo(
    () => ({ settingPayment, deletingId: cancelingId }),
    [settingPayment, cancelingId]
  );

  const statsLoading = tourLoading || regsLoading;
  const listInitialLoading = regsLoading || (searching && !activeList.length);

  /* Helper Logic */
  const regCodeOf = useCallback(
    (r) =>
      r?.code ||
      r?.shortCode ||
      String(r?._id || "")
        .slice(-5)
        .toUpperCase(),
    []
  );

  const buildTourCode = useCallback((name) => {
    const clean = normalizeNoAccent(name || "").toUpperCase();
    if (!clean) return "";
    return clean
      .split(" ")
      .filter(Boolean)
      .map((t) => (/^\d/.test(t) ? t.match(/\d/)[0] : t[0]))
      .join("")
      .slice(0, 8);
  }, []);

  const qrImgUrlFor = useCallback(
    (r) => {
      const bank =
        tour?.bankShortName ||
        tour?.qrBank ||
        tour?.bankCode ||
        tour?.bank ||
        import.meta.env?.VITE_QR_BANK;
      const acc =
        tour?.bankAccountNumber ||
        tour?.qrAccount ||
        tour?.bankAccount ||
        import.meta.env?.VITE_QR_ACC;
      if (!bank || !acc) return null;

      const code = regCodeOf(r);
      const ph = maskPhone(
        r?.player1?.phone || r?.player2?.phone || me?.phone || ""
      );
      const tourCode = tour?.code;
      const des = normalizeNoAccent(
        `Ma giai ${tourCode} Ma dang ky ${code} SDT ${ph}`
      );
      const amount = getFeeAmount(tour, r);

      const params = new URLSearchParams({
        bank,
        acc,
        des,
        template: "compact",
      });
      if (amount > 0) params.set("amount", String(amount));
      return `https://qr.sepay.vn/img?${params.toString()}`;
    },
    [tour, me, id, regCodeOf, buildTourCode]
  );

  /* Handlers */
  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      if (regLockedForUser)
        return toast.info("Đã hết hạn đăng ký cho VĐV. Vui lòng liên hệ BTC.");
      if (!isLoggedIn) return toast.info("Vui lòng đăng nhập");
      const p1Id = isAdmin ? p1?._id : String(me?._id);

      if (!p1Id)
        return toast.error(isAdmin ? "Chọn VĐV 1" : "Lỗi thông tin của bạn");
      if (isDoubles && !p2?._id) return toast.error("Giải đôi cần 2 VĐV");

      try {
        await createInvite({
          tourId: id,
          message: msg,
          player1Id: p1Id,
          player2Id: p2?._id,
        }).unwrap();
        toast.success("Đăng ký thành công!");
        refetchRegs();
        setMsg("");
        setP2(null);
        if (isAdmin) setP1(null);
      } catch (err) {
        if (err?.status === 412) {
          toast.error("VĐV chưa xác thực KYC (CCCD). Vui lòng cập nhật hồ sơ.");
        } else {
          toast.error(err?.data?.message || "Lỗi đăng ký");
        }
      }
    },
    [
      regLockedForUser,
      isLoggedIn,
      isAdmin,
      isDoubles,
      p1,
      p2,
      msg,
      me,
      id,
      createInvite,
      refetchRegs,
    ]
  );

  const handleCancel = useCallback(
    async (r) => {
      if (!canManage && r?.payment?.status === "Paid")
        return toast.info("Đã đóng phí, vui lòng liên hệ BTC để huỷ");
      if (!window.confirm("Bạn chắc chắn muốn huỷ đăng ký này?")) return;
      setCancelingId(r._id);
      try {
        if (canManage) await adminDeleteReg(r._id).unwrap();
        else await cancelReg(r._id).unwrap();
        toast.success("Đã huỷ");
        refetchRegs();
        if (debouncedQ) refetchSearch();
      } catch (e) {
        toast.error(e?.data?.message || "Huỷ thất bại");
      } finally {
        setCancelingId(null);
      }
    },
    [
      canManage,
      adminDeleteReg,
      cancelReg,
      refetchRegs,
      debouncedQ,
      refetchSearch,
    ]
  );

  const togglePayment = useCallback(
    async (r) => {
      if (!canManage) return;
      try {
        const next = r?.payment?.status === "Paid" ? "Unpaid" : "Paid";
        await setPaymentStatus({ regId: r._id, status: next }).unwrap();
        toast.success("Đã cập nhật thanh toán");
        refetchRegs();
        if (debouncedQ) refetchSearch();
      } catch (e) {
        toast.error("Lỗi cập nhật");
      }
    },
    [canManage, setPaymentStatus, refetchRegs, debouncedQ, refetchSearch]
  );

  const submitReplace = useCallback(async () => {
    if (!newPlayer?._id || !replaceDlg.reg) return;
    try {
      await replacePlayer({
        regId: replaceDlg.reg._id,
        slot: replaceDlg.slot,
        userId: newPlayer._id,
      }).unwrap();
      toast.success("Đã thay VĐV");
      setReplaceDlg({ open: false, reg: null, slot: "p1" });
      setNewPlayer(null);
      refetchRegs();
      if (debouncedQ) refetchSearch();
    } catch (e) {
      toast.error(e?.data?.message || "Lỗi thay người");
    }
  }, [
    newPlayer,
    replaceDlg,
    replacePlayer,
    refetchRegs,
    debouncedQ,
    refetchSearch,
  ]);

  const submitComplaint = useCallback(async () => {
    if (!complaintDlg.text.trim()) return;
    try {
      await createComplaint({
        tournamentId: id,
        regId: complaintDlg.reg._id,
        content: complaintDlg.text,
      }).unwrap();
      toast.success("Đã gửi khiếu nại");
      setComplaintDlg({ open: false, reg: null, text: "" });
    } catch (e) {
      toast.error("Lỗi gửi khiếu nại");
    }
  }, [complaintDlg, createComplaint, id]);

  /* Dialog open/close handlers */
  const handleOpenPreview = useCallback((src, name) => {
    setImgPreview({ open: true, src, name });
  }, []);

  const handleClosePreview = useCallback(() => {
    setImgPreview({ open: false, src: "", name: "" });
  }, []);

  const handleOpenReplace = useCallback((reg, slot) => {
    setReplaceDlg({ open: true, reg, slot });
    setNewPlayer(null);
  }, []);

  const handleCloseReplace = useCallback(() => {
    setReplaceDlg({ open: false, reg: null, slot: "p1" });
    setNewPlayer(null);
  }, []);

  const handleOpenProfile = useCallback((pl) => {
    const uid = getUserId(pl);
    if (!uid) return;
    setProfileDlg({ open: true, userId: uid });
  }, []);

  const handleCloseProfile = useCallback(() => {
    setProfileDlg({ open: false, userId: null });
  }, []);

  const handleOpenPayment = useCallback((reg) => {
    setPaymentDlg({ open: true, reg });
  }, []);

  const handleClosePayment = useCallback(() => {
    setPaymentDlg({ open: false, reg: null });
  }, []);

  const handleOpenComplaint = useCallback((reg) => {
    setComplaintDlg({ open: true, reg, text: "" });
  }, []);

  const handleCloseComplaint = useCallback(() => {
    setComplaintDlg({ open: false, reg: null, text: "" });
  }, []);

  if (tourLoading && !tour)
    return (
      <Box sx={{ height: "80vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  if (tourErr || !tour)
    return (
      <Box p={3}>
        <Alert severity="error">Không tải được thông tin giải đấu</Alert>
      </Box>
    );

  return (
    <Box sx={{ bgcolor: "#f8fafc", minHeight: "100vh", pb: 6 }}>
      {/* --- 1. HERO BANNER --- */}
      <Box
        sx={{
          background: `linear-gradient(135deg, ${BRAND_COLOR} 0%, #0d47a1 100%)`,
          color: "white",
          pt: { xs: 4, md: 6 },
          pb: { xs: 8, md: 10 },
          position: "relative",
          overflow: "hidden",
          boxShadow: 3,
          zIndex: 1,
        }}
      >
        {/* Background decorations */}
        <Box
          sx={{
            position: "absolute",
            top: -50,
            right: -50,
            width: 300,
            height: 300,
            borderRadius: "50%",
            bgcolor: "white",
            opacity: 0.03,
          }}
        />
        <Box
          sx={{
            position: "absolute",
            bottom: -50,
            left: 50,
            width: 150,
            height: 150,
            borderRadius: "50%",
            bgcolor: "white",
            opacity: 0.05,
          }}
        />

        <Container maxWidth="xl">
          <Grid container spacing={4} alignItems="center">
            <Grid size={{ xs: 12, md: 7 }}>
              <Stack direction="row" spacing={1} mb={2}>
                <Chip
                  label={isSingles ? "Đơn" : "Đôi"}
                  size="small"
                  sx={{
                    bgcolor: "rgba(255,255,255,0.2)",
                    color: "white",
                    backdropFilter: "blur(4px)",
                    fontWeight: 700,
                  }}
                />
                <Chip
                  icon={<LocationOn sx={{ color: "white !important" }} />}
                  label={tour.location || "Đang cập nhật"}
                  size="small"
                  sx={{ bgcolor: "transparent", color: "white", pl: 0.5 }}
                />
              </Stack>
              <Typography
                variant="h3"
                fontWeight={800}
                sx={{
                  mb: 1.5,
                  fontSize: { xs: "1.75rem", md: "2.75rem" },
                  lineHeight: 1.1,
                }}
              >
                {tour.name}
              </Typography>
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ opacity: 0.9, typography: "subtitle1" }}
              >
                <CalendarMonth fontSize="small" />
                <span>
                  {new Date(tour.startDate).toLocaleDateString("vi-VN")}
                </span>
                <span>—</span>
                <span>
                  {new Date(tour.endDate).toLocaleDateString("vi-VN")}
                </span>
              </Stack>
            </Grid>

            <Grid
              size={{ xs: 12, md: 5 }}
              sx={{
                display: "flex",
                justifyContent: { xs: "flex-start", md: "flex-end" },
                mt: { xs: 3, md: 0 },
              }}
            >
              {timeLeft && !isRegClosed ? (
                <Box
                  sx={{
                    bgcolor: "rgba(0,0,0,0.2)",
                    p: 2.5,
                    borderRadius: 3,
                    backdropFilter: "blur(8px)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    minWidth: 260,
                  }}
                >
                  <Typography
                    variant="caption"
                    align="center"
                    display="block"
                    sx={{
                      mb: 1.5,
                      textTransform: "uppercase",
                      letterSpacing: 1.5,
                      opacity: 0.9,
                      fontWeight: 600,
                    }}
                  >
                    Đăng ký kết thúc sau
                  </Typography>
                  <Stack direction="row" spacing={2} justifyContent="center">
                    <CountdownItem value={timeLeft.d} label="Ngày" />
                    <CountdownItem value={timeLeft.h} label="Giờ" />
                    <CountdownItem value={timeLeft.m} label="Phút" />
                    <CountdownItem value={timeLeft.s} label="Giây" />
                  </Stack>
                </Box>
              ) : isRegClosed ? (
                <Chip
                  label="ĐÃ ĐÓNG CỔNG ĐĂNG KÝ"
                  color="error"
                  sx={{
                    fontWeight: "bold",
                    px: 2,
                    py: 3,
                    fontSize: "1rem",
                    borderRadius: 2,
                    border: "2px solid white",
                  }}
                />
              ) : null}
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* --- 2. STATS + CONTENT (OVERLAP BANNER) --- */}
      <Container
        maxWidth="xl"
        sx={{
          mt: { xs: -4, md: -6 },
          position: "relative",
          zIndex: 2,
        }}
      >
        {/* STATS CARDS */}
        <Grid container spacing={2} sx={{ mb: 4 }}>
          {statsLoading ? (
            Array.from({ length: 4 }).map((_, idx) => (
              <Grid key={idx} size={{ xs: 6, md: 3 }}>
                <Paper
                  elevation={0}
                  sx={{
                    p: 2,
                    height: "100%",
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Skeleton variant="circular" width={36} height={36} />
                    <Box sx={{ flex: 1 }}>
                      <Skeleton variant="text" width="60%" />
                      <Skeleton variant="text" width="40%" />
                    </Box>
                  </Stack>
                </Paper>
              </Grid>
            ))
          ) : (
            <>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatCard
                  icon={<EmojiEvents />}
                  label="Tổng điểm tối đa"
                  value={cap > 0 ? fmt3(cap) : "Không giới hạn"}
                  subValue={[
                    `Điểm mỗi VĐV: ${
                      eachCap > 0 ? fmt3(eachCap) : "Không giới hạn"
                    }`,
                    delta > 0 ? `Chênh lệch: ${fmt3(delta)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatCard
                  icon={<Groups />}
                  label="Đã đăng ký"
                  value={activeList.length}
                  subValue={isSingles ? "Vận động viên" : "Cặp đôi"}
                />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatCard
                  icon={<MonetizationOn />}
                  label="Đã thanh toán"
                  value={paidCount}
                  subValue={`${
                    activeList.length
                      ? Math.round((paidCount / activeList.length) * 100)
                      : 0
                  }% hoàn thành`}
                />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatCard
                  icon={<AccessTimeFilled />}
                  label="Trạng thái"
                  value={isRegClosed ? "Đã đóng" : "Đang mở"}
                  subValue={
                    isRegClosed
                      ? "Hẹn gặp bạn giải sau"
                      : "Đăng ký ngay hôm nay"
                  }
                />
              </Grid>
            </>
          )}
        </Grid>

        {/* CONTENT PREVIEW */}
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12 }}>
            {(tour.contactHtml || tour.contentHtml) && (
              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                {tour.contentHtml && (
                  <Box flex={1}>
                    <HtmlPreviewSection
                      title="Điều lệ & Nội dung"
                      html={tour.contentHtml}
                    />
                  </Box>
                )}
                {tour.contactHtml && (
                  <Box flex={1}>
                    <HtmlPreviewSection
                      title="Liên hệ BTC"
                      html={tour.contactHtml}
                    />
                  </Box>
                )}
              </Stack>
            )}
          </Grid>
        </Grid>

        {/* --- 3. MAIN GRID --- */}
        <Grid container spacing={3}>
          {/* LEFT: FORM */}
          <Grid size={{ xs: 12, lg: 4 }}>
            <Paper
              elevation={0}
              sx={{
                p: 3,
                borderRadius: CARD_RADIUS,
                border: "1px solid",
                borderColor: "divider",
                position: { xs: "static", lg: "sticky" },
                // trước: top: { lg: 20 },
                // đẩy xuống dưới header + chừa khoảng cách
                top: { lg: 88 }, // ~64px header + 24px margin, có thể chỉnh 80–96 tuỳ mắt
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1} mb={3}>
                <Box
                  sx={{
                    p: 1,
                    bgcolor: "primary.main",
                    borderRadius: 1,
                    color: "white",
                  }}
                >
                  <SportsTennis fontSize="small" />
                </Box>
                <Typography variant="h6" fontWeight={700}>
                  Đăng ký thi đấu
                </Typography>
              </Stack>

              {meLoading ? (
                <Skeleton variant="rounded" height={120} />
              ) : !isLoggedIn ? (
                <Alert
                  severity="info"
                  variant="outlined"
                  sx={{ borderRadius: 2 }}
                >
                  Vui lòng{" "}
                  <Link to="/login" style={{ fontWeight: "bold" }}>
                    đăng nhập
                  </Link>{" "}
                  để đăng ký.
                </Alert>
              ) : regLockedForUser ? (
                <Alert
                  severity="warning"
                  variant="filled"
                  sx={{ borderRadius: 2 }}
                >
                  Đã hết thời gian đăng ký cho VĐV. Vui lòng liên hệ BTC nếu cần
                  hỗ trợ thêm.
                </Alert>
              ) : (
                <form onSubmit={submit}>
                  {/* VĐV 1 */}
                  <Box mb={2.5}>
                    <Typography
                      variant="subtitle2"
                      gutterBottom
                      fontWeight={600}
                    >
                      Vận động viên 1 (Bạn)
                    </Typography>
                    {isAdmin ? (
                      <PlayerSelector
                        value={p1}
                        onChange={setP1}
                        eventType={tour.eventType}
                        label="VĐV 1"
                        placeholder="Tìm theo tên, SĐT..."
                      />
                    ) : (
                      <Card
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          display: "flex",
                          alignItems: "center",
                          gap: 2,
                          borderRadius: 2,
                          bgcolor: "#f8fafc",
                        }}
                      >
                        <Avatar
                          src={me?.avatar}
                          sx={{ width: 48, height: 48 }}
                        />

                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          {/* Hàng tên + badge KYC */}
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 0.5,
                              maxWidth: "100%",
                            }}
                          >
                            <Typography
                              fontWeight={700}
                              sx={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: "100%",
                              }}
                            >
                              {me?.nickname ||
                                me?.name ||
                                me?.fullName ||
                                "VĐV 1"}
                            </Typography>

                            {/* Badge KYC dính sát tên */}
                            <VerifyBadge status={me?.cccdStatus} />
                          </Box>

                          {/* Hàng điểm + SĐT */}
                          <Typography variant="caption" color="text.secondary">
                            Điểm:{" "}
                            {fmt3(
                              isSingles ? me?.score?.single : me?.score?.double
                            )}{" "}
                            • {me?.phone || "Chưa có SĐT"}
                          </Typography>
                        </Box>
                      </Card>
                    )}
                  </Box>

                  {/* VĐV 2 */}
                  {isDoubles && (
                    <Box mb={2.5}>
                      <Typography
                        variant="subtitle2"
                        gutterBottom
                        fontWeight={600}
                      >
                        Vận động viên 2 (Partner)
                      </Typography>
                      <PlayerSelector
                        value={p2}
                        onChange={setP2}
                        eventType={tour.eventType}
                        label="VĐV 2"
                        placeholder="Tìm theo tên, SĐT..."
                      />
                    </Box>
                  )}

                  <TextField
                    fullWidth
                    multiline
                    rows={2}
                    label="Lời nhắn cho BTC"
                    placeholder="Ví dụ: Xin ghép cặp, xin đánh trễ..."
                    size="small"
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    sx={{ mb: 3 }}
                  />

                  <Button
                    variant="contained"
                    fullWidth
                    size="large"
                    type="submit"
                    disabled={saving}
                    sx={{
                      py: 1.5,
                      borderRadius: 2,
                      fontWeight: 700,
                      boxShadow: "0 4px 14px rgba(25, 118, 210, 0.4)",
                      textTransform: "none",
                      fontSize: "1rem",
                    }}
                  >
                    {saving ? "Đang xử lý..." : "Gửi Đăng Ký Ngay"}
                  </Button>
                  <Typography
                    variant="caption"
                    align="center"
                    display="block"
                    sx={{ mt: 1.5, color: "text.secondary" }}
                  >
                    Bằng việc đăng ký, bạn đồng ý với điều lệ giải.
                  </Typography>
                </form>
              )}

              <Divider sx={{ my: 3 }} />

              <Stack spacing={1.5}>
                {canManage && (
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                    <Button
                      fullWidth
                      variant="contained"
                      color="secondary"
                      component={Link}
                      to={`/tournament/${id}/manage`}
                    >
                      Quản lý giải đấu
                    </Button>

                    {/* Nút Bốc thăm – căn giữa nội dung */}
                    <Button
                      fullWidth
                      variant="outlined"
                      component={Link}
                      to={`/tournament/${id}/draw`} // hoặc route bốc thăm của bạn
                      startIcon={<EmojiEvents />}
                      sx={{
                        borderRadius: 2,
                        justifyContent: "center", // 👈 căn giữa icon + text
                        textTransform: "none",
                      }}
                    >
                      Bốc thăm
                    </Button>
                  </Stack>
                )}

                {/* Xem sơ đồ thi đấu – cũng căn giữa */}
                <Button
                  startIcon={<Equalizer />}
                  component={Link}
                  to={`/tournament/${id}/bracket`}
                  fullWidth
                  variant="outlined"
                  sx={{
                    borderRadius: 2,
                    justifyContent: "center", // 👈 đổi từ flex-start thành center
                    textTransform: "none",
                  }}
                >
                  Xem Sơ đồ thi đấu
                </Button>

                <Button
                  startIcon={<CheckCircle />}
                  component={Link}
                  to={`/tournament/${id}/checkin`}
                  fullWidth
                  variant="outlined"
                  sx={{
                    borderRadius: 2,
                    justifyContent: "center", // cho đẹp đồng bộ luôn
                    textTransform: "none",
                  }}
                >
                  Check-in
                </Button>
              </Stack>
            </Paper>
          </Grid>

          {/* RIGHT: LIST */}
          <Grid size={{ xs: 12, lg: 8 }}>
            <Paper
              elevation={0}
              sx={{
                borderRadius: CARD_RADIUS,
                border: "1px solid",
                borderColor: "divider",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                minHeight: 600,
              }}
            >
              {/* Toolbar */}
              <Box
                sx={{
                  p: 2,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  display: "flex",
                  flexDirection: { xs: "column", sm: "row" },
                  gap: 2,
                  alignItems: "center",
                  justifyContent: "space-between",
                  bgcolor: "white",
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Typography variant="h6" fontWeight={700}>
                    Danh sách tham gia
                  </Typography>
                  <Chip
                    label={
                      regsLoading || searching
                        ? "Đang tải..."
                        : String(activeList.length)
                    }
                    color="primary"
                    size="small"
                    sx={{ fontWeight: "bold", height: 24 }}
                  />
                </Stack>
                <TextField
                  placeholder="Tìm tên, SĐT, mã..."
                  size="small"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                    endAdornment: q && (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setQ("")}>
                          <Clear fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  sx={{ width: { xs: "100%", sm: 320 } }}
                />
              </Box>

              {/* Content */}
              <Box sx={{ flex: 1, bgcolor: "#f8fafc" }}>
                {listInitialLoading ? (
                  <Box sx={{ p: 2 }}>
                    <Grid container spacing={2}>
                      {Array.from({ length: 4 }).map((_, idx) => (
                        <Grid key={idx} size={{ xs: 12, md: 6 }}>
                          <RegCardSkeleton />
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                ) : activeList.length === 0 ? (
                  <Box p={4} textAlign="center" color="text.secondary">
                    <Groups sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
                    <Typography>Chưa có đăng ký nào.</Typography>
                  </Box>
                ) : (
                  <Box sx={{ p: 2 }}>
                    <Grid container spacing={2}>
                      {displayedItems.map((r, i) => (
                        <Grid key={r._id} size={{ xs: 12, md: 6 }}>
                          <RegCard
                            r={r}
                            index={i}
                            isSingles={isSingles}
                            cap={cap}
                            delta={delta}
                            canManage={canManage}
                            isOwner={String(r.createdBy) === String(me?._id)}
                            onCancel={handleCancel}
                            onTogglePayment={togglePayment}
                            onOpenReplace={handleOpenReplace}
                            onOpenPreview={handleOpenPreview}
                            onOpenProfile={handleOpenProfile}
                            onOpenPayment={handleOpenPayment}
                            onOpenComplaint={handleOpenComplaint}
                            regCodeOf={regCodeOf}
                            busy={busy}
                          />
                        </Grid>
                      ))}
                      {hasMore && (
                        <Grid size={{ xs: 12 }}>
                          <Box
                            ref={loaderRef}
                            sx={{ p: 3, textAlign: "center" }}
                          >
                            <CircularProgress size={24} />
                          </Box>
                        </Grid>
                      )}
                    </Grid>
                  </Box>
                )}
              </Box>
            </Paper>
          </Grid>
        </Grid>
      </Container>

      {/* --- DIALOGS --- */}
      {/* 1. Image Preview */}
      <Dialog
        open={imgPreview.open}
        onClose={handleClosePreview}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ p: 2 }}>{imgPreview.name || "Ảnh VĐV"}</DialogTitle>
        <DialogContent
          sx={{
            p: 0,
            bgcolor: "black",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <img
            src={safeSrc(imgPreview.src || PLACE)}
            alt=""
            style={{
              maxWidth: "100%",
              maxHeight: "85vh",
              objectFit: "contain",
            }}
            onError={(e) => (e.currentTarget.src = PLACE)}
          />
        </DialogContent>
      </Dialog>

      {/* 2. Replace Player */}
      <Dialog
        open={replaceDlg.open}
        onClose={handleCloseReplace}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {replaceDlg.slot === "p2"
            ? "Thay đổi / Thêm VĐV 2"
            : "Thay đổi VĐV 1"}
        </DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            Chọn VĐV mới để thay thế vào vị trí này.
          </Alert>
          <PlayerSelector
            value={newPlayer}
            onChange={setNewPlayer}
            eventType={tour.eventType}
            label="Tìm kiếm VĐV..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseReplace}>Hủy</Button>
          <Button
            variant="contained"
            onClick={submitReplace}
            disabled={!newPlayer}
          >
            Lưu thay đổi
          </Button>
        </DialogActions>
      </Dialog>

      {/* 3. Complaint */}
      <Dialog
        open={complaintDlg.open}
        onClose={handleCloseComplaint}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Gửi khiếu nại / Hỗ trợ</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" gutterBottom color="text.secondary">
            Nội dung sẽ được gửi tới Ban Tổ Chức giải đấu.
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={4}
            placeholder="Nhập nội dung..."
            value={complaintDlg.text}
            onChange={(e) =>
              setComplaintDlg((s) => ({ ...s, text: e.target.value }))
            }
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseComplaint}>Đóng</Button>
          <Button
            variant="contained"
            onClick={submitComplaint}
            disabled={sendingComplaint}
          >
            {sendingComplaint ? "Đang gửi..." : "Gửi khiếu nại"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 4. QR Payment */}
      <Dialog
        open={paymentDlg.open}
        onClose={handleClosePayment}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Thanh toán lệ phí</DialogTitle>
        <DialogContent sx={{ textAlign: "center", pb: 4 }} dividers>
          {paymentDlg.reg && (
            <>
              <Typography variant="body2" mb={2}>
                Quét mã bên dưới để thanh toán cho mã ĐK:{" "}
                <b>{regCodeOf(paymentDlg.reg)}</b>
              </Typography>
              {qrImgUrlFor(paymentDlg.reg) ? (
                <Box
                  sx={{
                    p: 2,
                    border: "1px solid #eee",
                    borderRadius: 2,
                    display: "inline-block",
                  }}
                >
                  <img
                    src={qrImgUrlFor(paymentDlg.reg)}
                    alt="QR Code"
                    style={{ width: "100%", maxWidth: 250, display: "block" }}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                </Box>
              ) : (
                <Alert severity="warning">
                  BTC chưa cấu hình tài khoản ngân hàng.
                </Alert>
              )}
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
                mt={2}
              >
                Nội dung chuyển khoản đã được tạo tự động. Vui lòng không sửa
                đổi để hệ thống tự động cập nhật.
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            color="warning"
            onClick={() => {
              const r = paymentDlg.reg;
              handleClosePayment();
              handleOpenComplaint(r);
            }}
          >
            Báo lỗi / Khiếu nại
          </Button>
          <Button onClick={handleClosePayment}>Đóng</Button>
        </DialogActions>
      </Dialog>

      {/* 5. Public Profile */}
      <PublicProfileDialog
        open={profileDlg.open}
        userId={profileDlg.userId}
        onClose={handleCloseProfile}
      />
    </Box>
  );
}
