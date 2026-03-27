/* eslint-disable react/prop-types, react/display-name */
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
  useManagerUpdateRegPlayerAvatarMutation,
  useCreateComplaintMutation,
  useSearchRegistrationsQuery,
  useCancelRegistrationMutation,
} from "../../slices/tournamentsApiSlice";
import { useGetMeScoreQuery } from "../../slices/usersApiSlice";
import { useUploadRealAvatarMutation } from "../../slices/uploadApiSlice";
import PlayerSelector from "../../components/PlayerSelector";
import PublicProfileDialog from "../../components/PublicProfileDialog";
import TeamTournamentRegistrationView from "../../components/teamTournament/TeamTournamentRegistrationView";
import { useLanguage } from "../../context/LanguageContext";
import { formatDate as formatLocaleDate } from "../../i18n/format";
import { getFeeAmount } from "../../utils/fee";
import { useBotContext } from "../../hook/useBotContext";
import SEOHead from "../../components/SEOHead";
import {
  getTournamentNameDisplayMode,
  getTournamentPlayerName,
} from "../../utils/tournamentName";

/* ---------------- 1. CONSTANTS & HELPERS ---------------- */
const PLACE = "https://dummyimage.com/800x600/cccccc/ffffff&text=?";
const BRAND_COLOR = "#1976d2";
const CARD_RADIUS = 3;
const MAX_AVATAR_FILE_SIZE = 10 * 1024 * 1024;

const totalChipStyle = (total, cap, delta, t) => {
  const hasCap = Number.isFinite(cap) && cap > 0;
  if (!hasCap || !Number.isFinite(total)) {
    return {
      color: "default",
      title: t("tournaments.registration.totalChip.unlimited"),
    };
  }

  const d = Number.isFinite(delta) && delta > 0 ? Number(delta) : 0;
  const threshold = cap + d;
  const EPS = 1e-6;

  if (total > threshold + EPS) {
    return {
      color: "error",
      title: t("tournaments.registration.totalChip.over", {
        cap: fmt3(cap),
        delta: fmt3(d),
      }),
    };
  }

  if (Math.abs(total - threshold) <= EPS) {
    return {
      color: "warning",
      title: t("tournaments.registration.totalChip.maxed", {
        cap: fmt3(cap),
        delta: fmt3(d),
      }),
    };
  }

  return {
    color: "success",
    title: t("tournaments.registration.totalChip.valid", {
      cap: fmt3(cap),
      delta: fmt3(d),
    }),
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

const displayName = (pl, displayMode = "nickname") => {
  return getTournamentPlayerName(pl, displayMode); /*
  if (!pl) return "—";
  return nn || pl.fullName || pl.name || pl.displayName || "—";
};

*/
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
      0,
  );

const toTimestamp = (value) => {
  if (!value) return null;
  const ts =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
};

const isTournamentFinished = (tour) => {
  if (!tour) return false;
  if (tour?.finishedAt) return true;
  if (String(tour?.status || "").toLowerCase() === "finished") return true;
  const endTs = toTimestamp(tour?.endAt || tour?.endDate);
  return endTs !== null && endTs < Date.now();
};

/* Logic HTTPS forcing */
const shouldForceHttps = (() => {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname || "";
  const isLocal =
    /(^localhost$)|(^127\.)|(^10\.)|(^192\.168\.)|(^172\.(1[6-9]|2\d|3[0-1])\.)|(\.local$)|(\.lan$)/i.test(
      h,
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
        url.hostname,
      );
    if (url.protocol === "http:" && !isPrivate) {
      url.protocol = "https:";
      return url.toString();
    }
  } catch {
    // ignore invalid URL parsing
  }
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
const kycMeta = (status, t) => {
  const s = String(status || "").toLowerCase();
  switch (s) {
    case "verified":
      return {
        icon: <VerifiedIcon fontSize="inherit" />,
        color: "info.main",
        tip: t("tournaments.registration.kyc.verified"),
      };
    case "pending":
      return {
        icon: <PendingIcon fontSize="inherit" />,
        color: "warning.main",
        tip: t("tournaments.registration.kyc.pending"),
      };
    default:
      return {
        icon: <DangerousSharpIcon fontSize="inherit" />,
        color: "text.disabled",
        tip: t("tournaments.registration.kyc.unverified"),
      };
  }
};

const VerifyBadge = memo(({ status }) => {
  const { t } = useLanguage();
  const { icon, color, tip } = kycMeta(status, t);
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
      { rootMargin: "50px" },
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
const PaymentChip = memo(({ status, isFreeTournament = false }) => {
  const { t } = useLanguage();
  if (isFreeTournament) {
    return (
      <Chip
        size="small"
        label={t("tournaments.registration.payment.free")}
        sx={{
          bgcolor: alpha("#0288d1", 0.1),
          color: "#01579b",
          fontWeight: 600,
          fontSize: "0.7rem",
          height: 24,
        }}
      />
    );
  }
  const isPaid = status === "Paid";
  return (
    <Chip
      size="small"
      label={
        isPaid
          ? t("tournaments.registration.payment.paid")
          : t("tournaments.registration.payment.unpaid")
      }
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
  const { t } = useLanguage();
  if (!checkinAt) return null;
  return (
    <Chip
      size="small"
      icon={<CheckCircle sx={{ fontSize: "14px !important" }} />}
      label={t("tournaments.registration.checkin.done")}
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
      sx={(theme) => ({
        bgcolor: alpha(theme.palette.primary.contrastText, 0.15),
        color: theme.palette.primary.contrastText,
        py: 0.5,
        px: 0.5,
        borderRadius: 1,
        backdropFilter: "blur(4px)",
        border: `1px solid ${alpha(theme.palette.primary.contrastText, 0.1)}`,
      })}
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

/** 🔹 Countdown tách riêng, tự quản state + interval, memo để không ảnh hưởng component khác */
const RegistrationCountdown = memo(({ deadline }) => {
  const { t } = useLanguage();
  const [timeLeft, setTimeLeft] = useState(null);

  useEffect(() => {
    if (!deadline) {
      setTimeLeft(null);
      return;
    }

    const d = typeof deadline === "string" ? new Date(deadline) : deadline;
    const target = d.getTime();
    if (!Number.isFinite(target)) {
      setTimeLeft(null);
      return;
    }

    const tick = () => {
      const diff = target - Date.now();
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
  }, [deadline]);

  if (!timeLeft || timeLeft.total <= 0) return null;

  return (
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
        {t("tournaments.registration.countdown.title")}
      </Typography>
      <Stack direction="row" spacing={2} justifyContent="center">
        <CountdownItem
          value={timeLeft.d}
          label={t("tournaments.registration.countdown.days")}
        />
        <CountdownItem
          value={timeLeft.h}
          label={t("tournaments.registration.countdown.hours")}
        />
        <CountdownItem
          value={timeLeft.m}
          label={t("tournaments.registration.countdown.minutes")}
        />
        <CountdownItem
          value={timeLeft.s}
          label={t("tournaments.registration.countdown.seconds")}
        />
      </Stack>
    </Box>
  );
});

/* HTML Preview */
const HtmlPreviewSection = ({ title, html }) => {
  const { t } = useLanguage();
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
            {t("tournaments.registration.previews.viewDetails")}
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
          <Button onClick={() => setOpen(false)}>
            {t("tournaments.registration.previews.close")}
          </Button>
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
    isFreeTournament,
    isOwner,
    onTogglePayment,
    onCancel,
    onOpenPayment,
    onOpenComplaint,
    busy,
  }) => (
    <ActionButtonsInner
      r={r}
      canManage={canManage}
      isFreeTournament={isFreeTournament}
      isOwner={isOwner}
      onTogglePayment={onTogglePayment}
      onCancel={onCancel}
      onOpenPayment={onOpenPayment}
      onOpenComplaint={onOpenComplaint}
      busy={busy}
    />
  ),
);

const ActionButtonsInner = ({
  r,
  canManage,
  isFreeTournament,
  isOwner,
  onTogglePayment,
  onCancel,
  onOpenPayment,
  onOpenComplaint,
  busy,
}) => {
  const { t } = useLanguage();

  return (
    <Stack
      direction="row"
      spacing={0.5}
      justifyContent="flex-end"
      alignItems="center"
    >
      {canManage && !isFreeTournament && (
        <Tooltip title={t("tournaments.registration.payment.toggleTooltip")}>
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

      {!isFreeTournament ? (
        <Tooltip title={t("tournaments.registration.payment.qrTooltip")}>
          <Button
            size="small"
            variant="text"
            startIcon={<QrCode fontSize="small" />}
            onClick={() => onOpenPayment(r)}
            sx={{
              color: "#1976d2",
              bgcolor: alpha("#1976d2", 0.05),
              textTransform: "none",
              minWidth: "auto",
              px: 1,
            }}
          >
            {t("tournaments.registration.actions.pay")}
          </Button>
        </Tooltip>
      ) : null}

      <Tooltip title={t("tournaments.registration.actions.complaint")}>
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
          {t("tournaments.registration.actions.complaint")}
        </Button>
      </Tooltip>

      {(canManage || isOwner) && (
        <Tooltip
          title={t("tournaments.registration.actions.cancelRegistration")}
        >
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
  );
};

const PlayerInfo = memo(
  ({
    player,
    avatarSrc,
    canEditAvatar,
    canReplacePlayer,
    onOpenAvatarEdit,
    onReplacePlayer,
    onOpenPreview,
    onOpenProfile,
    displayMode,
  }) => {
    const { t } = useLanguage();
    const canEditPlayerAvatar = canEditAvatar && !!getUserId(player);

    return (
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box
          sx={{ position: "relative", cursor: "zoom-in" }}
          onClick={() =>
            onOpenPreview(
              avatarSrc || player?.avatar,
              displayName(player, displayMode),
            )
          }
        >
          <LazyAvatar src={avatarSrc || player?.avatar} size={40} />
          {canEditPlayerAvatar && (
            <Tooltip title={t("tournaments.registration.actions.editAvatar")}>
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
                  onOpenAvatarEdit();
                }}
              >
                <EditOutlined sx={{ fontSize: 12, color: "primary.main" }} />
              </Box>
            </Tooltip>
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
            {displayName(player, displayMode)}{" "}
            <VerifyBadge status={kycOf(player)} />
          </Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ xs: "flex-start", sm: "center" }}
            sx={{ mt: 0.4 }}
          >
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
            {canReplacePlayer && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<PersonAdd fontSize="small" />}
                onClick={onReplacePlayer}
                sx={{
                  minWidth: "auto",
                  px: 1,
                  py: 0.25,
                  borderRadius: 2,
                  textTransform: "none",
                  ml: { sm: "auto" },
                }}
              >
                {t("tournaments.registration.actions.replacePlayer")}
              </Button>
            )}
          </Stack>
        </Box>
      </Stack>
    );
  },
);

/* Card dùng chung cho cả mobile + desktop */
const RegCard = memo(
  ({ r, index, isSingles, cap, delta, regCodeOf, ...props }) => {
    const { t } = useLanguage();
    const total = totalScoreOf(r, isSingles);
    const chip = totalChipStyle(total, cap, delta, t);

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
            <PaymentChip
              status={r.payment?.status}
              isFreeTournament={props.isFreeTournament}
            />
          </Stack>

          {/* Body */}
          <Stack spacing={2}>
            {/* Players */}
            <Box>
              <PlayerInfo
                player={r.player1}
                avatarSrc={props.getPlayerAvatar(r.player1)}
                canEditAvatar={props.canEditAvatar}
                canReplacePlayer={props.canReplacePlayer}
                onOpenAvatarEdit={() =>
                  props.onOpenAvatarEdit(r, "p1", r.player1)
                }
                onReplacePlayer={() => props.onOpenReplace(r, "p1")}
                onOpenPreview={props.onOpenPreview}
                onOpenProfile={props.onOpenProfile}
                displayMode={props.displayMode}
              />
              {!isSingles && r.player2 && (
                <Box mt={1.5}>
                  <PlayerInfo
                    player={r.player2}
                    avatarSrc={props.getPlayerAvatar(r.player2)}
                    canEditAvatar={props.canEditAvatar}
                    canReplacePlayer={props.canReplacePlayer}
                    onOpenAvatarEdit={() =>
                      props.onOpenAvatarEdit(r, "p2", r.player2)
                    }
                    onReplacePlayer={() => props.onOpenReplace(r, "p2")}
                    onOpenPreview={props.onOpenPreview}
                    onOpenProfile={props.onOpenProfile}
                    displayMode={props.displayMode}
                  />
                </Box>
              )}
              {!isSingles && !r.player2 && props.canReplacePlayer && (
                <Button
                  size="small"
                  startIcon={<PersonAdd />}
                  onClick={() => props.onOpenReplace(r, "p2")}
                  sx={{ mt: 1, borderStyle: "dashed" }}
                  fullWidth
                  variant="outlined"
                >
                  {t("tournaments.registration.list.addPlayer2")}
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
                  {t("tournaments.registration.list.totalScore")}
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
  },
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

/* ---------------- 4. MAIN PAGE COMPONENT ---------------- */
export default function TournamentRegistration() {
  const { id } = useParams();
  useBotContext({ tournamentId: id });
  const { locale, t } = useLanguage();

  /* Data Fetching */
  const { data: me, isLoading: meLoading } = useGetMeScoreQuery();
  const {
    data: tour,
    isLoading: tourLoading,
    error: tourErr,
  } = useGetTournamentQuery(id);
  const displayMode = getTournamentNameDisplayMode(tour);
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
        (m) => String(m?.user ?? m) === String(me?._id),
      );
    return !!tour.isManager;
  }, [isLoggedIn, me, tour]);
  const isAdmin = !!(
    me?.isAdmin ||
    me?.role === "admin" ||
    (Array.isArray(me?.roles) && me.roles.includes("admin"))
  );
  const canManage = isLoggedIn && (isManager || isAdmin);
  const canEditAvatar =
    isLoggedIn && (isAdmin || (isManager && !isTournamentFinished(tour)));
  const canReplacePlayer =
    isLoggedIn && (isAdmin || (isManager && !isTournamentFinished(tour)));

  /* API Actions */
  const [createInvite, { isLoading: saving }] = useCreateRegInviteMutation();
  const [cancelReg] = useCancelRegistrationMutation();
  const [setPaymentStatus, { isLoading: settingPayment }] =
    useManagerSetRegPaymentStatusMutation();
  const [adminDeleteReg] = useManagerDeleteRegistrationMutation();
  const [replacePlayer] = useManagerReplaceRegPlayerMutation();
  const [createComplaint, { isLoading: sendingComplaint }] =
    useCreateComplaintMutation();
  const [updateRegPlayerAvatar] = useManagerUpdateRegPlayerAvatarMutation();
  const [uploadAvatar] = useUploadRealAvatarMutation();

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
  const [avatarDlg, setAvatarDlg] = useState({
    open: false,
    reg: null,
    slot: "p1",
    player: null,
  });
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarOverrides, setAvatarOverrides] = useState({});

  /* Countdown */
  /* Countdown / Registration deadline */
  const rawDeadline = tour?.registrationDeadline || tour?.regDeadline;

  // chỉ toggle 1 lần tại thời điểm hết hạn, không re-render mỗi giây
  const [isRegClosed, setIsRegClosed] = useState(() => {
    if (!rawDeadline) return false;
    const d = new Date(rawDeadline);
    const ts = d.getTime();
    if (!Number.isFinite(ts)) return false;
    return ts <= Date.now();
  });

  useEffect(() => {
    if (!rawDeadline) {
      setIsRegClosed(false);
      return;
    }
    const d = new Date(rawDeadline);
    const ts = d.getTime();
    if (!Number.isFinite(ts)) {
      setIsRegClosed(false);
      return;
    }

    const now = Date.now();
    if (ts <= now) {
      setIsRegClosed(true);
      return;
    }

    setIsRegClosed(false);
    const timer = setTimeout(() => setIsRegClosed(true), ts - now);
    return () => clearTimeout(timer);
  }, [rawDeadline]);

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
    [debouncedQ, searchedRegs, regs],
  );

  const displayedItems = useMemo(() => activeList, [activeList]);

  /* Derived Data */
  const evType = normType(tour?.eventType);
  const isSingles = evType === "single";
  const isDoubles = evType === "double";
  const isFreeTournament = tour?.isFreeRegistration === true;
  const cap = getScoreCap(tour, isSingles);
  const eachCap = Number(tour?.singleCap ?? 0);
  const delta = getMaxDelta(tour);
  const paidCount = activeList.filter(
    (r) => r.payment?.status === "Paid",
  ).length;
  const busy = useMemo(
    () => ({ settingPayment, deletingId: cancelingId }),
    [settingPayment, cancelingId],
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
    [],
  );

  const getPlayerAvatar = useCallback(
    (player) => {
      const userId = getUserId(player);
      return (userId && avatarOverrides[userId]) || player?.avatar || "";
    },
    [avatarOverrides],
  );

  const qrImgUrlFor = useCallback(
    (r) => {
      if (tour?.isFreeRegistration === true) return null;
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
        r?.player1?.phone || r?.player2?.phone || me?.phone || "",
      );
      const tourCode = tour?.code;
      const des = normalizeNoAccent(
        `Ma giai ${tourCode} Ma dang ky ${code} SDT ${ph}`,
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
    [tour, me, regCodeOf],
  );

  /* Handlers */
  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      if (regLockedForUser)
        return toast.info(
          t("tournaments.registration.toasts.registrationClosed"),
        );
      if (!isLoggedIn)
        return toast.info(t("tournaments.registration.toasts.loginRequired"));
      const p1Id = isAdmin ? p1?._id : String(me?._id);

      if (!p1Id)
        return toast.error(
          isAdmin
            ? t("tournaments.registration.toasts.selectPlayer1")
            : t("tournaments.registration.toasts.ownInfoError"),
        );
      if (isDoubles && !p2?._id)
        return toast.error(t("tournaments.registration.toasts.doublesNeedTwo"));

      try {
        await createInvite({
          tourId: id,
          message: msg,
          player1Id: p1Id,
          player2Id: p2?._id,
        }).unwrap();
        toast.success(t("tournaments.registration.toasts.registrationSuccess"));
        refetchRegs();
        setMsg("");
        setP2(null);
        if (isAdmin) setP1(null);
      } catch (err) {
        if (err?.status === 412) {
          toast.error(t("tournaments.registration.toasts.kycRequired"));
        } else {
          toast.error(
            err?.data?.message ||
              t("tournaments.registration.toasts.registrationError"),
          );
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
      t,
    ],
  );

  const handleCancel = useCallback(
    async (r) => {
      if (!canManage && !isFreeTournament && r?.payment?.status === "Paid")
        return toast.info(
          t("tournaments.registration.toasts.paidContactOrganizer"),
        );
      if (!window.confirm(t("tournaments.registration.toasts.cancelConfirm")))
        return;
      setCancelingId(r._id);
      try {
        if (canManage) await adminDeleteReg(r._id).unwrap();
        else await cancelReg(r._id).unwrap();
        toast.success(t("tournaments.registration.toasts.cancelSuccess"));
        refetchRegs();
        if (debouncedQ) refetchSearch();
      } catch (e) {
        toast.error(
          e?.data?.message || t("tournaments.registration.toasts.cancelError"),
        );
      } finally {
        setCancelingId(null);
      }
    },
    [
      canManage,
      isFreeTournament,
      adminDeleteReg,
      cancelReg,
      refetchRegs,
      debouncedQ,
      refetchSearch,
      t,
    ],
  );

  const togglePayment = useCallback(
    async (r) => {
      if (!canManage || isFreeTournament) return;
      try {
        const next = r?.payment?.status === "Paid" ? "Unpaid" : "Paid";
        await setPaymentStatus({ regId: r._id, status: next }).unwrap();
        toast.success(t("tournaments.registration.toasts.paymentUpdated"));
        refetchRegs();
        if (debouncedQ) refetchSearch();
      } catch (e) {
        toast.error(t("tournaments.registration.toasts.paymentError"));
      }
    },
    [
      canManage,
      isFreeTournament,
      setPaymentStatus,
      refetchRegs,
      debouncedQ,
      refetchSearch,
      t,
    ],
  );

  const submitReplace = useCallback(async () => {
    if (!canReplacePlayer) return;
    if (!newPlayer?._id || !replaceDlg.reg) return;
    try {
      await replacePlayer({
        regId: replaceDlg.reg._id,
        slot: replaceDlg.slot,
        userId: newPlayer._id,
      }).unwrap();
      toast.success(t("tournaments.registration.toasts.replaceSuccess"));
      setReplaceDlg({ open: false, reg: null, slot: "p1" });
      setNewPlayer(null);
      refetchRegs();
      if (debouncedQ) refetchSearch();
    } catch (e) {
      toast.error(
        e?.data?.message || t("tournaments.registration.toasts.replaceError"),
      );
    }
  }, [
    newPlayer,
    replaceDlg,
    replacePlayer,
    canReplacePlayer,
    refetchRegs,
    debouncedQ,
    refetchSearch,
    t,
  ]);

  const submitComplaint = useCallback(async () => {
    if (!complaintDlg.text.trim()) return;
    try {
      await createComplaint({
        tournamentId: id,
        regId: complaintDlg.reg._id,
        content: complaintDlg.text,
      }).unwrap();
      toast.success(t("tournaments.registration.toasts.complaintSuccess"));
      setComplaintDlg({ open: false, reg: null, text: "" });
    } catch (e) {
      toast.error(t("tournaments.registration.toasts.complaintError"));
    }
  }, [complaintDlg, createComplaint, id, t]);

  /* Dialog open/close handlers */
  const handleOpenPreview = useCallback((src, name) => {
    setImgPreview({ open: true, src, name });
  }, []);

  const handleClosePreview = useCallback(() => {
    setImgPreview({ open: false, src: "", name: "" });
  }, []);

  const handleOpenReplace = useCallback(
    (reg, slot) => {
      if (!canReplacePlayer) return;
      setReplaceDlg({ open: true, reg, slot });
      setNewPlayer(null);
    },
    [canReplacePlayer],
  );

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

  const handleOpenPayment = useCallback(
    (reg) => {
      if (isFreeTournament) return;
      setPaymentDlg({ open: true, reg });
    },
    [isFreeTournament],
  );

  const handleClosePayment = useCallback(() => {
    setPaymentDlg({ open: false, reg: null });
  }, []);

  const clearAvatarSelection = useCallback(() => {
    setAvatarPreviewUrl((prev) => {
      if (typeof prev === "string" && prev.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return "";
    });
    setAvatarFile(null);
  }, []);

  const handleOpenAvatarEdit = useCallback(
    (reg, slot, player) => {
      if (!canEditAvatar || !getUserId(player)) return;
      clearAvatarSelection();
      setAvatarSaving(false);
      setAvatarDlg({
        open: true,
        reg,
        slot,
        player: { ...player, avatar: getPlayerAvatar(player) },
      });
    },
    [canEditAvatar, clearAvatarSelection, getPlayerAvatar],
  );

  const handleCloseAvatarEdit = useCallback(() => {
    if (avatarSaving) return;
    clearAvatarSelection();
    setAvatarDlg({ open: false, reg: null, slot: "p1", player: null });
  }, [avatarSaving, clearAvatarSelection]);

  useEffect(() => {
    return () => {
      if (
        typeof avatarPreviewUrl === "string" &&
        avatarPreviewUrl.startsWith("blob:")
      ) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  const handleAvatarFileChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_AVATAR_FILE_SIZE) {
        toast.error(t("tournaments.registration.toasts.avatarTooLarge"));
        e.target.value = "";
        return;
      }

      setAvatarPreviewUrl((prev) => {
        if (typeof prev === "string" && prev.startsWith("blob:")) {
          URL.revokeObjectURL(prev);
        }
        return URL.createObjectURL(file);
      });
      setAvatarFile(file);
      e.target.value = "";
    },
    [t],
  );

  const submitAvatarUpdate = useCallback(async () => {
    if (!avatarDlg.reg?._id || !avatarDlg.slot || !avatarFile) return;

    setAvatarSaving(true);
    try {
      let avatarUrl = "";
      try {
        const uploaded = await uploadAvatar(avatarFile).unwrap();
        avatarUrl = String(uploaded?.url || "").trim();
      } catch (e) {
        throw new Error(
          e?.data?.message ||
            t("tournaments.registration.toasts.avatarUploadFailed"),
        );
      }
      if (!avatarUrl) {
        throw new Error(
          t("tournaments.registration.toasts.avatarUploadFailed"),
        );
      }

      await updateRegPlayerAvatar({
        regId: avatarDlg.reg._id,
        slot: avatarDlg.slot,
        avatar: avatarUrl,
      }).unwrap();

      const targetUserId = getUserId(avatarDlg.player);
      if (targetUserId) {
        const cacheBustedUrl = `${avatarUrl}${avatarUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
        setAvatarOverrides((prev) => ({
          ...prev,
          [targetUserId]: cacheBustedUrl,
        }));
      }

      toast.success(t("tournaments.registration.toasts.avatarUpdateSuccess"));
      clearAvatarSelection();
      setAvatarDlg({ open: false, reg: null, slot: "p1", player: null });
      refetchRegs();
      if (debouncedQ) refetchSearch();
    } catch (e) {
      toast.error(
        e?.data?.message ||
          e?.message ||
          t("tournaments.registration.toasts.avatarUpdateError"),
      );
    } finally {
      setAvatarSaving(false);
    }
  }, [
    avatarDlg,
    avatarFile,
    uploadAvatar,
    updateRegPlayerAvatar,
    t,
    clearAvatarSelection,
    refetchRegs,
    debouncedQ,
    refetchSearch,
  ]);

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
        <Alert severity="error">
          {t("tournaments.registration.errorLoadTournament")}
        </Alert>
      </Box>
    );

  if (String(tour?.tournamentMode || "").toLowerCase() === "team") {
    return (
      <TeamTournamentRegistrationView
        tournamentId={id}
        tour={tour}
        me={me}
        canManage={canManage}
        isAdmin={isAdmin}
      />
    );
  }

  return (
    <Box sx={{ bgcolor: "background.default", minHeight: "100vh", pb: 6 }}>
      <SEOHead
        title={t("tournaments.registration.seoTitle", {
          name: tour?.name || t("tournaments.registration.seoFallbackName"),
        })}
        description={t("tournaments.registration.seoDescription", {
          name: tour?.name || t("tournaments.registration.seoFallbackName"),
        })}
        path={`/tournament/${id}/register`}
      />
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
            bgcolor: alpha("#fff", 0.03), // Decorative element - very low opacity OK
          }}
        />
        <Box
          sx={(theme) => ({
            position: "absolute",
            bottom: -50,
            left: 50,
            width: 150,
            height: 150,
            borderRadius: "50%",
            bgcolor: theme.palette.primary.contrastText,
            opacity: 0.05,
          })}
        />

        <Container maxWidth="xl">
          <Grid container spacing={4} alignItems="center">
            <Grid size={{ xs: 12, md: 7 }}>
              <Stack direction="row" spacing={1} mb={2}>
                <Chip
                  label={
                    isSingles
                      ? t("tournaments.registration.eventSingles")
                      : t("tournaments.registration.eventDoubles")
                  }
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
                  label={
                    tour.location ||
                    t("tournaments.registration.locationFallback")
                  }
                  size="small"
                  sx={{
                    bgcolor: "transparent",
                    color: "primary.contrastText",
                    pl: 0.5,
                  }}
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
                <span>{formatLocaleDate(tour.startDate, locale)}</span>
                <span>{t("tournaments.registration.dateRangeSeparator")}</span>
                <span>{formatLocaleDate(tour.endDate, locale)}</span>
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
              {rawDeadline && !isRegClosed ? (
                <RegistrationCountdown deadline={rawDeadline} />
              ) : isRegClosed ? (
                <Chip
                  label={t("tournaments.registration.registrationClosedChip")}
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
                  label={t("tournaments.registration.stats.maxScore")}
                  value={
                    cap > 0
                      ? fmt3(cap)
                      : t("tournaments.registration.unlimited")
                  }
                  subValue={[
                    t("tournaments.registration.stats.playerScore", {
                      value:
                        eachCap > 0
                          ? fmt3(eachCap)
                          : t("tournaments.registration.unlimited"),
                    }),
                    delta > 0
                      ? t("tournaments.registration.stats.delta", {
                          value: fmt3(delta),
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatCard
                  icon={<Groups />}
                  label={t("tournaments.registration.stats.registered")}
                  value={activeList.length}
                  subValue={
                    isSingles
                      ? t("tournaments.registration.stats.participants")
                      : t("tournaments.registration.stats.teams")
                  }
                />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatCard
                  icon={<MonetizationOn />}
                  label={
                    isFreeTournament
                      ? t("tournaments.registration.stats.fee")
                      : t("tournaments.registration.stats.paid")
                  }
                  value={
                    isFreeTournament
                      ? t("tournaments.registration.stats.freeValue")
                      : paidCount
                  }
                  subValue={
                    isFreeTournament
                      ? t("tournaments.registration.stats.freeHint")
                      : t("tournaments.registration.stats.completion", {
                          value: activeList.length
                            ? Math.round((paidCount / activeList.length) * 100)
                            : 0,
                        })
                  }
                />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatCard
                  icon={<AccessTimeFilled />}
                  label={t("tournaments.registration.stats.status")}
                  value={
                    isRegClosed
                      ? t("tournaments.registration.stats.closed")
                      : t("tournaments.registration.stats.open")
                  }
                  subValue={
                    isRegClosed
                      ? t("tournaments.registration.stats.nextTime")
                      : t("tournaments.registration.stats.registerToday")
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
                      title={t("tournaments.registration.previews.rulesTitle")}
                      html={tour.contentHtml}
                    />
                  </Box>
                )}
                {tour.contactHtml && (
                  <Box flex={1}>
                    <HtmlPreviewSection
                      title={t(
                        "tournaments.registration.previews.contactTitle",
                      )}
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
                  {t("tournaments.registration.form.title")}
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
                  {t("tournaments.registration.form.loginPrefix")}{" "}
                  <Link to="/login" style={{ fontWeight: "bold" }}>
                    {t("tournaments.registration.form.loginLink")}
                  </Link>{" "}
                  {t("tournaments.registration.form.loginSuffix")}
                </Alert>
              ) : regLockedForUser ? (
                <Alert
                  severity="warning"
                  variant="filled"
                  sx={{ borderRadius: 2 }}
                >
                  {t("tournaments.registration.form.locked")}
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
                      {t("tournaments.registration.form.player1Title")}
                    </Typography>
                    {isAdmin ? (
                      <PlayerSelector
                        value={p1}
                        onChange={setP1}
                        eventType={tour.eventType}
                        label={t("tournaments.registration.form.player1Label")}
                        placeholder={t(
                          "tournaments.registration.form.playerSearchPlaceholder",
                        )}
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
                          bgcolor: "background.paper",
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
                              {displayName(me, displayMode) ||
                                t(
                                  "tournaments.registration.form.player1Fallback",
                                )}
                            </Typography>

                            {/* Badge KYC dính sát tên */}
                            <VerifyBadge status={me?.cccdStatus} />
                          </Box>

                          {/* Hàng điểm + SĐT */}
                          <Typography variant="caption" color="text.secondary">
                            {t("tournaments.registration.form.scorePrefix")}{" "}
                            {fmt3(
                              isSingles ? me?.score?.single : me?.score?.double,
                            )}{" "}
                            •{" "}
                            {me?.phone ||
                              t("tournaments.registration.form.noPhone")}
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
                        {t("tournaments.registration.form.player2Title")}
                      </Typography>
                      <PlayerSelector
                        value={p2}
                        onChange={setP2}
                        eventType={tour.eventType}
                        label={t("tournaments.registration.form.player2Label")}
                        placeholder={t(
                          "tournaments.registration.form.playerSearchPlaceholder",
                        )}
                      />
                    </Box>
                  )}

                  <TextField
                    fullWidth
                    multiline
                    rows={2}
                    label={t("tournaments.registration.form.noteLabel")}
                    placeholder={t(
                      "tournaments.registration.form.notePlaceholder",
                    )}
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
                    {saving
                      ? t("tournaments.registration.form.submitting")
                      : t("tournaments.registration.form.submit")}
                  </Button>
                  <Typography
                    variant="caption"
                    align="center"
                    display="block"
                    sx={{ mt: 1.5, color: "text.secondary" }}
                  >
                    {t("tournaments.registration.form.agreement")}
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
                      {t("tournaments.registration.actions.manageTournament")}
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
                      {t("tournaments.registration.actions.draw")}
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
                  {t("tournaments.registration.actions.bracket")}
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
                  {t("tournaments.registration.actions.checkin")}
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
                  bgcolor: "background.paper",
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Typography variant="h6" fontWeight={700}>
                    {t("tournaments.registration.list.title")}
                  </Typography>
                  <Chip
                    label={
                      regsLoading || searching
                        ? t("tournaments.registration.list.loading")
                        : String(activeList.length)
                    }
                    color="primary"
                    size="small"
                    sx={{ fontWeight: "bold", height: 24 }}
                  />
                </Stack>
                <TextField
                  placeholder={t(
                    "tournaments.registration.list.searchPlaceholder",
                  )}
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
              <Box sx={{ flex: 1, bgcolor: "background.default" }}>
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
                    <Typography>
                      {t("tournaments.registration.list.empty")}
                    </Typography>
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
                            canEditAvatar={canEditAvatar}
                            canReplacePlayer={canReplacePlayer}
                            isOwner={String(r.createdBy) === String(me?._id)}
                            onCancel={handleCancel}
                            onTogglePayment={togglePayment}
                            onOpenReplace={handleOpenReplace}
                            onOpenAvatarEdit={handleOpenAvatarEdit}
                            onOpenPreview={handleOpenPreview}
                            onOpenProfile={handleOpenProfile}
                            onOpenPayment={handleOpenPayment}
                            onOpenComplaint={handleOpenComplaint}
                            getPlayerAvatar={getPlayerAvatar}
                            displayMode={displayMode}
                            isFreeTournament={isFreeTournament}
                            regCodeOf={regCodeOf}
                            busy={busy}
                          />
                        </Grid>
                      ))}
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
        <DialogTitle sx={{ p: 2 }}>
          {imgPreview.name ||
            t("tournaments.registration.dialogs.imageFallback")}
        </DialogTitle>
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
            ? t("tournaments.registration.dialogs.replaceTitlePlayer2")
            : t("tournaments.registration.dialogs.replaceTitlePlayer1")}
        </DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t("tournaments.registration.dialogs.replaceInfo")}
          </Alert>
          <PlayerSelector
            value={newPlayer}
            onChange={setNewPlayer}
            eventType={tour.eventType}
            label={t("tournaments.registration.dialogs.replaceSearch")}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseReplace}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={submitReplace}
            disabled={!newPlayer || !canReplacePlayer}
          >
            {t("tournaments.registration.dialogs.saveChanges")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={avatarDlg.open}
        onClose={handleCloseAvatarEdit}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {t("tournaments.registration.dialogs.avatarTitle", {
            name: displayName(avatarDlg.player, displayMode),
          })}
        </DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t("tournaments.registration.dialogs.avatarInfo")}
          </Alert>
          <Stack spacing={2} alignItems="center">
            <Avatar
              src={safeSrc(
                avatarPreviewUrl || avatarDlg.player?.avatar || PLACE,
              )}
              alt={displayName(avatarDlg.player, displayMode)}
              sx={{ width: 112, height: 112, boxShadow: 3 }}
              imgProps={{
                onError: (e) => {
                  e.currentTarget.src = PLACE;
                },
              }}
            />
            <Typography variant="body2" color="text.secondary" align="center">
              {avatarFile?.name ||
                t("tournaments.registration.dialogs.avatarCurrent")}
            </Typography>
            <Button
              component="label"
              variant="outlined"
              disabled={avatarSaving}
            >
              {t("tournaments.registration.dialogs.avatarChooseFile")}
              <input
                hidden
                type="file"
                accept="image/*"
                onChange={handleAvatarFileChange}
              />
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAvatarEdit} disabled={avatarSaving}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={submitAvatarUpdate}
            disabled={!avatarFile || avatarSaving}
          >
            {avatarSaving
              ? t("tournaments.registration.dialogs.avatarSaving")
              : t("tournaments.registration.dialogs.avatarSave")}
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
        <DialogTitle>
          {t("tournaments.registration.dialogs.complaintTitle")}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" gutterBottom color="text.secondary">
            {t("tournaments.registration.dialogs.complaintInfo")}
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={4}
            placeholder={t(
              "tournaments.registration.dialogs.complaintPlaceholder",
            )}
            value={complaintDlg.text}
            onChange={(e) =>
              setComplaintDlg((s) => ({ ...s, text: e.target.value }))
            }
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseComplaint}>
            {t("common.actions.close")}
          </Button>
          <Button
            variant="contained"
            onClick={submitComplaint}
            disabled={sendingComplaint}
          >
            {sendingComplaint
              ? t("tournaments.registration.dialogs.complaintSending")
              : t("tournaments.registration.dialogs.complaintSubmit")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 4. QR Payment */}
      <Dialog
        open={paymentDlg.open && !isFreeTournament}
        onClose={handleClosePayment}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {t("tournaments.registration.dialogs.paymentTitle")}
        </DialogTitle>
        <DialogContent sx={{ textAlign: "center", pb: 4 }} dividers>
          {paymentDlg.reg && (
            <>
              <Typography variant="body2" mb={2}>
                {t("tournaments.registration.dialogs.paymentIntro", {
                  code: regCodeOf(paymentDlg.reg),
                })}
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
                  {t("tournaments.registration.dialogs.paymentNoBank")}
                </Alert>
              )}
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
                mt={2}
              >
                {t("tournaments.registration.dialogs.paymentNote")}
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
            {t("tournaments.registration.dialogs.paymentReport")}
          </Button>
          <Button onClick={handleClosePayment}>
            {t("common.actions.close")}
          </Button>
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
