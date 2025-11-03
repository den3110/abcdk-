import { useState, useMemo, useEffect, useCallback, memo, useRef } from "react";
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
  TableContainer,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  InputAdornment,
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
  Verified as VerifiedIcon,
  HourglassBottom as PendingIcon,
  Block as RejectedIcon,
  HelpOutline as UnverifiedIcon,
} from "@mui/icons-material";
import DangerousSharpIcon from "@mui/icons-material/DangerousSharp";

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

const getScoreCap = (tour, isSingles) => {
  if (!tour) return 0;
  return isSingles
    ? Number(tour?.singleCap ?? tour?.scoreCap ?? 0)
    : Number(tour?.scoreCap ?? 0);
};

const getMaxDelta = (tour) => {
  return Number(
    tour?.scoreGap ??
      tour?.maxDelta ??
      tour?.scoreTolerance ??
      tour?.tolerance ??
      0
  );
};

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

/* ====== HTTPS forcing helpers ====== */
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

/* ==================== Badge KYC ==================== */
const kycMeta = (status) => {
  const s = String(status || "").toLowerCase();
  switch (s) {
    case "verified":
      return {
        icon: <VerifiedIcon fontSize="inherit" />,
        color: "success.main",
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

// Optimized: Remove Tooltip, use title attribute
const VerifyBadge = memo(({ status, sx }) => {
  const { icon, color, tip } = kycMeta(status);
  return (
    <Box
      component="span"
      title={tip}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        lineHeight: 0,
        ml: 0.5,
        color,
        fontSize: 18,
        verticalAlign: "middle",
        ...sx,
      }}
    >
      {icon}
    </Box>
  );
});

const kycOf = (pl) => pl?.cccdStatus || "unverified";

/* ==================== Lazy Loading Avatar ==================== */
const LazyAvatar = memo(({ src, alt, size = 36, onClick, sx }) => {
  const [imgSrc, setImgSrc] = useState(PLACE);
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    const targetSrc = safeSrc(src || PLACE);

    // Use IntersectionObserver for lazy loading
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const img = new Image();
            img.src = targetSrc;
            img.onload = () => {
              setImgSrc(targetSrc);
              setIsLoaded(true);
            };
            img.onerror = () => {
              setImgSrc(PLACE);
              setIsLoaded(true);
            };
            observer.disconnect();
          }
        });
      },
      { rootMargin: "50px" }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

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
        opacity: isLoaded ? 1 : 0.5,
        transition: "opacity 0.2s",
        cursor: onClick ? "zoom-in" : "default",
        ...sx,
      }}
    />
  );
});

/* ==================== Memoized Chips - Optimized ==================== */
const PaymentChip = memo(({ status, paidAt }) => {
  const isPaid = status === "Paid";
  const title = isPaid
    ? `Đã thanh toán: ${paidAt ? new Date(paidAt).toLocaleString() : ""}`
    : "Chưa thanh toán";

  return (
    <Chip
      size="small"
      color={isPaid ? "success" : "default"}
      label={isPaid ? "Đã Thanh toán" : "Chưa Thanh toán"}
      title={title}
      sx={{ whiteSpace: "nowrap" }}
    />
  );
});

const CheckinChip = memo(({ checkinAt }) => {
  const ok = !!checkinAt;
  const title = ok
    ? `Đã check-in: ${new Date(checkinAt).toLocaleString()}`
    : "Chưa check-in";

  return (
    <Chip
      size="small"
      color={ok ? "info" : "default"}
      label={ok ? "Đã Check-in" : "Chưa Check-in"}
      title={title}
      sx={{ whiteSpace: "nowrap" }}
    />
  );
});

const CodeBadge = memo(({ code, withLabel = true }) => {
  const text = withLabel ? `Mã: ${code}` : String(code);
  return (
    <Chip
      size="small"
      variant="outlined"
      label={text}
      sx={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
    />
  );
});

const StatItem = memo(({ icon, label, value, hint }) => {
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
});

const SelfPlayerReadonly = memo(({ me, isSingles }) => {
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
        <LazyAvatar src={me?.avatar || PLACE} alt={display} size={40} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" noWrap title={display}>
            {display}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {me?.phone || "—"}
          </Typography>
        </Box>
        <Chip
          size="small"
          variant="outlined"
          icon={<Equalizer fontSize="small" />}
          label={fmt3(scoreVal ?? 0)}
          title={`Điểm ${isSingles ? "đơn" : "đôi"} hiện tại`}
          sx={{ whiteSpace: "nowrap" }}
        />
      </Stack>
    </Box>
  );
});

/* ==================== Optimized Action Cell - No Tooltips ==================== */
const ActionCell = memo(
  ({
    r,
    canManage,
    isOwner,
    onTogglePayment,
    onCancel,
    onOpenComplaint,
    onOpenPayment,
    busy,
  }) => {
    const paymentTitle =
      r.payment?.status === "Paid"
        ? "Đánh dấu CHƯA thanh toán"
        : "Xác nhận ĐÃ thanh toán";

    return (
      <Stack
        direction="row"
        spacing={0.5}
        sx={{
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}
      >
        {canManage && (
          <IconButton
            size="small"
            onClick={() => onTogglePayment(r)}
            disabled={busy?.settingPayment}
            title={paymentTitle}
          >
            {r.payment?.status === "Paid" ? (
              <MoneyOff sx={{ fontSize: 18 }} />
            ) : (
              <MonetizationOn sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        )}

        <IconButton
          size="small"
          color="primary"
          onClick={() => onOpenPayment(r)}
          title="Thanh toán QR"
          sx={{
            bgcolor: "primary.main",
            color: "white",
            "&:hover": { bgcolor: "primary.dark" },
          }}
        >
          <QrCode sx={{ fontSize: 18 }} />
        </IconButton>

        <IconButton
          size="small"
          color="warning"
          onClick={() => onOpenComplaint(r)}
          title="Gửi khiếu nại"
          sx={{
            bgcolor: "warning.main",
            color: "white",
            "&:hover": { bgcolor: "warning.dark" },
          }}
        >
          <ReportProblem sx={{ fontSize: 18 }} />
        </IconButton>

        {(canManage || isOwner) && (
          <IconButton
            size="small"
            color="error"
            onClick={() => onCancel(r)}
            disabled={busy?.deletingId === r._id}
            title={canManage ? "Huỷ cặp đấu" : "Huỷ đăng ký"}
          >
            <DeleteOutline sx={{ fontSize: 18 }} />
          </IconButton>
        )}
      </Stack>
    );
  }
);

/* ==================== Optimized Player Cell ==================== */
const PlayerCell = memo(
  ({ player, onEdit, canEdit, onOpenPreview, onOpenProfile }) => {
    const handleAvatarClick = useCallback(() => {
      onOpenPreview(player?.avatar || PLACE, displayName(player));
    }, [player, onOpenPreview]);

    const handleProfileClick = useCallback(() => {
      onOpenProfile(player);
    }, [player, onOpenProfile]);

    const handleEdit = useCallback(() => {
      onEdit();
    }, [onEdit]);

    return (
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        sx={{ minWidth: 0 }}
      >
        <Box
          onClick={handleAvatarClick}
          sx={{
            borderRadius: "50%",
            overflow: "hidden",
            lineHeight: 0,
            cursor: "zoom-in",
            flexShrink: 0,
          }}
        >
          <LazyAvatar
            src={player?.avatar || PLACE}
            alt={displayName(player)}
            size={36}
          />
        </Box>

        <Box
          sx={{
            minWidth: 0,
            flex: 1,
            cursor: getUserId(player) ? "pointer" : "default",
          }}
          onClick={handleProfileClick}
          title="Xem hồ sơ"
        >
          <Typography
            variant="body2"
            noWrap
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.25,
              fontSize: { xs: "0.875rem", lg: "0.875rem" },
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {displayName(player)}
            </span>
            <VerifyBadge status={kycOf(player)} />
          </Typography>
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            sx={{ mt: 0.25 }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ fontSize: "0.7rem" }}
            >
              {player?.phone}
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              icon={<Equalizer sx={{ fontSize: 12 }} />}
              label={fmt3(player?.score ?? 0)}
              sx={{
                height: 18,
                fontSize: "0.65rem",
                "& .MuiChip-icon": { ml: 0.5, mr: -0.25 },
                "& .MuiChip-label": { px: 0.5 },
              }}
            />
          </Stack>
        </Box>

        {canEdit && (
          <IconButton
            size="small"
            onClick={handleEdit}
            sx={{ flexShrink: 0 }}
            title="Thay VĐV"
          >
            <EditOutlined sx={{ fontSize: 18 }} />
          </IconButton>
        )}
      </Stack>
    );
  }
);

/* ==================== Enhanced Lazy Rendering Hook ==================== */
function useLazyRender(totalItems, initialBatch = 30, batchSize = 20) {
  const [displayCount, setDisplayCount] = useState(initialBatch);
  const loaderRef = useRef(null);
  const observerRef = useRef(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    setDisplayCount(initialBatch);
  }, [totalItems, initialBatch]);

  useEffect(() => {
    const loader = loaderRef.current;
    if (!loader || displayCount >= totalItems) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && displayCount < totalItems) {
          // Debounce loading to prevent too many updates
          if (timeoutRef.current) clearTimeout(timeoutRef.current);

          timeoutRef.current = setTimeout(() => {
            setDisplayCount((prev) => Math.min(prev + batchSize, totalItems));
          }, 100);
        }
      },
      { rootMargin: "200px" }
    );

    observerRef.current.observe(loader);

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [displayCount, totalItems, batchSize]);

  return { displayCount, loaderRef, hasMore: displayCount < totalItems };
}

/* ==================== Optimized Desktop Row ==================== */
const DesktopTableRow = memo(
  ({
    r,
    index,
    isSingles,
    cap,
    delta,
    canManage,
    isOwner,
    onTogglePayment,
    onCancel,
    onOpenComplaint,
    onOpenPayment,
    onOpenReplace,
    onOpenPreview,
    onOpenProfile,
    busy,
    regCodeOf,
  }) => {
    const total = useMemo(() => totalScoreOf(r, isSingles), [r, isSingles]);
    const chipStyle = useMemo(
      () => totalChipStyle(total, cap, delta),
      [total, cap, delta]
    );

    const handleReplaceP1 = useCallback(
      () => onOpenReplace(r, "p1"),
      [r, onOpenReplace]
    );
    const handleReplaceP2 = useCallback(
      () => onOpenReplace(r, "p2"),
      [r, onOpenReplace]
    );

    return (
      <TableRow hover>
        <TableCell sx={{ whiteSpace: "nowrap", py: 1, px: { xs: 0.5, md: 1 } }}>
          <Typography
            variant="body2"
            sx={{ fontSize: { xs: "0.75rem", md: "0.875rem" } }}
          >
            {index + 1}
          </Typography>
        </TableCell>

        <TableCell sx={{ whiteSpace: "nowrap", py: 1, px: { xs: 0.5, md: 1 } }}>
          <CodeBadge code={regCodeOf(r)} withLabel={false} />
        </TableCell>

        <TableCell
          sx={{
            py: 1,
            px: { xs: 0.5, md: 1 },
            minWidth: { xs: 140, sm: 180, md: 200 },
          }}
        >
          <PlayerCell
            player={r.player1}
            onEdit={handleReplaceP1}
            canEdit={canManage}
            onOpenPreview={onOpenPreview}
            onOpenProfile={onOpenProfile}
          />
        </TableCell>

        {!isSingles && (
          <TableCell
            sx={{
              py: 1,
              px: { xs: 0.5, md: 1 },
              minWidth: { xs: 140, sm: 180, md: 200 },
            }}
          >
            {r.player2 ? (
              <PlayerCell
                player={r.player2}
                onEdit={handleReplaceP2}
                canEdit={canManage}
                onOpenPreview={onOpenPreview}
                onOpenProfile={onOpenProfile}
              />
            ) : canManage ? (
              <Button
                size="small"
                variant="outlined"
                onClick={handleReplaceP2}
                sx={{ fontSize: "0.75rem", py: 0.25, px: 0.75 }}
              >
                + VĐV 2
              </Button>
            ) : (
              <Typography color="text.secondary">—</Typography>
            )}
          </TableCell>
        )}

        <TableCell sx={{ whiteSpace: "nowrap", py: 1, px: { xs: 0.5, md: 1 } }}>
          <Chip
            size="small"
            icon={<Equalizer sx={{ fontSize: 14 }} />}
            label={fmt3(total)}
            color={chipStyle.color}
            variant="filled"
            title={`Tổng điểm: ${fmt3(total)} • ${chipStyle.title}`}
            sx={{
              whiteSpace: "nowrap",
              height: 24,
              fontSize: "0.75rem",
              "& .MuiChip-icon": { ml: 0.5, mr: -0.25 },
            }}
          />
        </TableCell>

        <TableCell
          sx={{
            py: 1,
            px: { xs: 0.5, md: 1 },
            display: { xs: "none", lg: "table-cell" },
          }}
        >
          <Typography variant="caption" sx={{ fontSize: "0.75rem" }}>
            {new Date(r.createdAt).toLocaleString("vi-VN", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Typography>
        </TableCell>

        <TableCell sx={{ py: 1, px: { xs: 0.5, md: 1 } }}>
          <Stack spacing={0.5}>
            <PaymentChip
              status={r.payment?.status}
              paidAt={r.payment?.paidAt}
            />
            <CheckinChip checkinAt={r.checkinAt} />
          </Stack>
        </TableCell>

        <TableCell sx={{ whiteSpace: "nowrap", py: 1, px: { xs: 0.5, md: 1 } }}>
          <ActionCell
            r={r}
            canManage={canManage}
            isOwner={isOwner}
            onTogglePayment={onTogglePayment}
            onCancel={onCancel}
            onOpenComplaint={onOpenComplaint}
            onOpenPayment={onOpenPayment}
            busy={busy}
          />
        </TableCell>
      </TableRow>
    );
  }
);

/* ==================== Optimized Mobile Card ==================== */
const MobileCard = memo(
  ({
    r,
    index,
    isSingles,
    cap,
    delta,
    canManage,
    isOwner,
    onTogglePayment,
    onCancel,
    onOpenComplaint,
    onOpenPayment,
    onOpenReplace,
    onOpenPreview,
    onOpenProfile,
    busy,
    regCodeOf,
    playersOfReg,
  }) => {
    const total = useMemo(() => totalScoreOf(r, isSingles), [r, isSingles]);
    const chipStyle = useMemo(
      () => totalChipStyle(total, cap, delta),
      [total, cap, delta]
    );
    const players = useMemo(() => playersOfReg(r), [r, playersOfReg]);

    return (
      <Paper sx={{ p: 2 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <CodeBadge code={regCodeOf(r)} />
          <Typography variant="caption" color="text.secondary">
            #{index + 1}
          </Typography>
        </Stack>

        {players.map((pl, idx) => (
          <Stack
            key={`${pl?.phone || pl?.fullName || idx}`}
            direction="row"
            spacing={1}
            alignItems="center"
            mt={1}
          >
            <Box
              onClick={() =>
                onOpenPreview(pl?.avatar || PLACE, displayName(pl))
              }
              sx={{
                borderRadius: "50%",
                overflow: "hidden",
                lineHeight: 0,
                cursor: "zoom-in",
              }}
            >
              <LazyAvatar
                src={pl?.avatar || PLACE}
                alt={displayName(pl)}
                size={40}
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
              <Typography
                variant="body2"
                noWrap
                sx={{ display: "flex", alignItems: "center", gap: 0.25 }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {displayName(pl)}
                </span>
                <VerifyBadge status={kycOf(pl)} />
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {pl?.phone || ""}
              </Typography>
            </Box>

            <Chip
              size="small"
              variant="outlined"
              icon={<Equalizer fontSize="small" />}
              label={fmt3(pl?.score ?? 0)}
              title="Điểm trình"
              sx={{ whiteSpace: "nowrap" }}
            />

            {canManage && (
              <IconButton
                size="small"
                onClick={() => onOpenReplace(r, idx === 0 ? "p1" : "p2")}
                title={`Thay ${idx === 0 ? "VĐV 1" : "VĐV 2"}`}
              >
                <EditOutlined fontSize="small" />
              </IconButton>
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
          <Typography variant="body2">Tổng:</Typography>
          <Chip
            size="small"
            icon={<Equalizer fontSize="small" />}
            label={fmt3(total)}
            color={chipStyle.color}
            variant="filled"
            title={`Tổng điểm: ${fmt3(total)} • ${chipStyle.title}`}
            sx={{ whiteSpace: "nowrap" }}
          />
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
            busy={busy}
          />
        </Box>
      </Paper>
    );
  }
);

/* ==================== Optimized Search Field ==================== */
const SearchField = memo(({ value, onChange, onClear }) => (
  <TextField
    value={value}
    onChange={onChange}
    placeholder="Tìm theo VĐV, SĐT, mã đăng ký…"
    size="small"
    sx={{ maxWidth: 420 }}
    InputProps={{
      startAdornment: (
        <InputAdornment position="start">
          <Search fontSize="small" />
        </InputAdornment>
      ),
      endAdornment: value ? (
        <InputAdornment position="end">
          <IconButton size="small" onClick={onClear}>
            <Clear fontSize="small" />
          </IconButton>
        </InputAdornment>
      ) : null,
    }}
  />
));

/* ==================== Main Component ==================== */
export default function TournamentRegistration() {
  const { id } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const { data: me, isLoading: meLoading, error: meErr } = useGetMeScoreQuery();
  const isLoggedIn = !!me?._id;

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

  const [createInvite, { isLoading: saving }] = useCreateRegInviteMutation();
  const [cancelReg] = useCancelRegistrationMutation();
  const [setPaymentStatus, { isLoading: settingPayment }] =
    useManagerSetRegPaymentStatusMutation();
  const [adminDeleteReg] = useManagerDeleteRegistrationMutation();
  const [replacePlayer, { isLoading: replacing }] =
    useManagerReplaceRegPlayerMutation();
  const [createComplaint, { isLoading: sendingComplaint }] =
    useCreateComplaintMutation();

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
  const [complaintDlg, setComplaintDlg] = useState({
    open: false,
    reg: null,
    text: "",
  });
  const [paymentDlg, setPaymentDlg] = useState({ open: false, reg: null });
  const [profileDlg, setProfileDlg] = useState({ open: false, userId: null });

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  // Increased debounce delay for better performance
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 500);
    return () => clearTimeout(t);
  }, [q]);

  const {
    data: searchedRegs = [],
    isLoading: searching,
    isFetching: searchingFetching,
    error: searchErr,
  } = useSearchRegistrationsQuery({ id, q: debouncedQ }, { skip: !debouncedQ });

  // Memoized values
  const evType = useMemo(() => normType(tour?.eventType), [tour]);
  const isSingles = evType === "single";
  const isDoubles = evType === "double";
  const cap = useMemo(() => getScoreCap(tour, isSingles), [tour, isSingles]);
  const delta = useMemo(() => getMaxDelta(tour), [tour]);

  const isManager = useMemo(() => {
    if (!isLoggedIn || !tour) return false;
    if (String(tour.createdBy) === String(me._id)) return true;
    if (Array.isArray(tour.managers)) {
      return tour.managers.some((m) => String(m?.user ?? m) === String(me._id));
    }
    return !!tour.isManager;
  }, [isLoggedIn, me, tour]);

  const isAdmin = useMemo(
    () =>
      !!(
        me?.isAdmin ||
        me?.role === "admin" ||
        (Array.isArray(me?.roles) && me.roles.includes("admin"))
      ),
    [me]
  );

  const canManage = isLoggedIn && (isManager || isAdmin);

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

  const overallRegCount = regs?.length ?? 0;
  const paidCount = useMemo(
    () => (regs || []).filter((r) => r?.payment?.status === "Paid").length,
    [regs]
  );

  const searchingActive = !!debouncedQ;
  const listRegs = searchingActive ? searchedRegs || [] : regs || [];
  const regCount = listRegs?.length ?? 0;
  const listLoading = searchingActive
    ? searching || searchingFetching
    : regsLoading;
  const listError = searchingActive ? searchErr : regsErr;

  // Enhanced lazy rendering with smaller initial batch
  const { displayCount, loaderRef, hasMore } = useLazyRender(regCount, 30, 20);

  const playersOfReg = useCallback(
    (r) => [r?.player1, r?.player2].filter(Boolean),
    []
  );

  const disableSubmit =
    saving ||
    meLoading ||
    !isLoggedIn ||
    (isAdmin ? !p1 || (isDoubles && !p2) : isDoubles && !p2);

  const formatDate = useCallback(
    (d) => (d ? new Date(d).toLocaleDateString() : ""),
    []
  );

  const formatRange = useCallback(
    (a, b) => {
      const A = formatDate(a);
      const B = formatDate(b);
      if (A && B) return `${A} – ${B}`;
      return A || B || "—";
    },
    [formatDate]
  );

  // Memoized callbacks
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
      createInvite,
      id,
      me,
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

  const openPreview = useCallback(
    (src, name) =>
      setImgPreview({ open: true, src: safeSrc(src), name: name || "" }),
    []
  );

  const closePreview = useCallback(
    () => setImgPreview({ open: false, src: "", name: "" }),
    []
  );

  const openProfileByPlayer = useCallback((pl) => {
    const uid = getUserId(pl);
    if (uid) setProfileDlg({ open: true, userId: uid });
    else toast.info("Không tìm thấy userId của VĐV này.");
  }, []);

  const closeProfileDlg = useCallback(
    () => setProfileDlg({ open: false, userId: null }),
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
  }, [tour]);

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
    [getQrProviderConfig, regCodeOf, maskPhone, normalizeNoAccent, me, id, tour]
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

    if (!content) {
      toast.info("Vui lòng nhập nội dung khiếu nại.");
      return;
    }
    if (!regId) {
      toast.error("Không tìm thấy mã đăng ký để gửi khiếu nại.");
      return;
    }
    if (!isLoggedIn) {
      toast.info("Vui lòng đăng nhập để gửi khiếu nại.");
      return;
    }

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

  const handleSearchChange = useCallback((e) => setQ(e.target.value), []);
  const handleSearchClear = useCallback(() => setQ(""), []);

  // Memoized busy state
  const busy = useMemo(
    () => ({
      settingPayment,
      deletingId: cancelingId,
    }),
    [settingPayment, cancelingId]
  );

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

      {/* Tournament Info */}
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

      {/* Login notice */}
      {meLoading
        ? null
        : !isLoggedIn && (
            <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
              <Alert severity="info">
                Bạn chưa đăng nhập. Hãy đăng nhập để thực hiện đăng ký.
              </Alert>
            </Paper>
          )}

      {/* Registration Form */}
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
              <SelfPlayerReadonly me={me} isSingles={isSingles} />
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

      {/* Content/Contact */}
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
                dangerouslySetInnerHTML={{
                  __html: fixHtmlHttps(tour.contactHtml),
                }}
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
                dangerouslySetInnerHTML={{
                  __html: fixHtmlHttps(tour.contentHtml),
                }}
              />
            </Box>
          )}
        </Box>
      )}

      {/* Management area */}
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

      {/* Registration List */}
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
        <SearchField
          value={q}
          onChange={handleSearchChange}
          onClear={handleSearchClear}
        />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ whiteSpace: "nowrap" }}
        >
          {debouncedQ
            ? listLoading
              ? "Đang tìm…"
              : listError
              ? "Tìm kiếm lỗi!"
              : `Kết quả: ${regCount}`
            : ""}
        </Typography>
      </Stack>

      {listLoading ? (
        <Box sx={{ textAlign: "center", py: 3 }}>
          <CircularProgress />
        </Box>
      ) : listError ? (
        <Alert severity="error">
          {listError?.data?.message || listError?.error || "Lỗi tải danh sách"}
        </Alert>
      ) : regCount === 0 ? (
        <Typography color="text.secondary">Danh sách đăng ký trống!</Typography>
      ) : isMobile ? (
        <Stack spacing={2}>
          {listRegs.slice(0, displayCount).map((r, i) => {
            const isOwner =
              isLoggedIn && String(r?.createdBy) === String(me?._id);
            return (
              <MobileCard
                key={r._id}
                r={r}
                index={i}
                isSingles={isSingles}
                cap={cap}
                delta={delta}
                canManage={canManage}
                isOwner={isOwner}
                onTogglePayment={togglePayment}
                onCancel={handleCancel}
                onOpenComplaint={openComplaint}
                onOpenPayment={openPayment}
                onOpenReplace={openReplace}
                onOpenPreview={openPreview}
                onOpenProfile={openProfileByPlayer}
                busy={busy}
                regCodeOf={regCodeOf}
                playersOfReg={playersOfReg}
              />
            );
          })}
          {hasMore && (
            <Box ref={loaderRef} sx={{ textAlign: "center", py: 2 }}>
              <CircularProgress size={20} />
              <Typography
                variant="caption"
                sx={{ ml: 1 }}
                color="text.secondary"
              >
                Đang tải thêm... ({displayCount}/{regCount})
              </Typography>
            </Box>
          )}
        </Stack>
      ) : (
        // Desktop table with lazy loading
        <Paper variant="outlined" sx={{ mt: 1 }}>
          <TableContainer sx={{ maxHeight: 600, overflow: "auto" }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell
                    sx={{
                      whiteSpace: "nowrap",
                      py: 1,
                      px: { xs: 0.5, md: 1 },
                      fontWeight: 600,
                    }}
                  >
                    #
                  </TableCell>
                  <TableCell
                    sx={{
                      whiteSpace: "nowrap",
                      py: 1,
                      px: { xs: 0.5, md: 1 },
                      fontWeight: 600,
                    }}
                  >
                    Mã ĐK
                  </TableCell>
                  <TableCell
                    sx={{ py: 1, px: { xs: 0.5, md: 1 }, fontWeight: 600 }}
                  >
                    {isSingles ? "VĐV" : "VĐV 1"}
                  </TableCell>
                  {!isSingles && (
                    <TableCell
                      sx={{ py: 1, px: { xs: 0.5, md: 1 }, fontWeight: 600 }}
                    >
                      VĐV 2
                    </TableCell>
                  )}
                  <TableCell
                    sx={{
                      whiteSpace: "nowrap",
                      py: 1,
                      px: { xs: 0.5, md: 1 },
                      fontWeight: 600,
                    }}
                  >
                    Điểm
                  </TableCell>
                  <TableCell
                    sx={{
                      whiteSpace: "nowrap",
                      py: 1,
                      px: { xs: 0.5, md: 1 },
                      fontWeight: 600,
                      display: { xs: "none", lg: "table-cell" },
                    }}
                  >
                    Thời gian
                  </TableCell>
                  <TableCell
                    sx={{
                      whiteSpace: "nowrap",
                      py: 1,
                      px: { xs: 0.5, md: 1 },
                      fontWeight: 600,
                    }}
                  >
                    Trạng thái
                  </TableCell>
                  <TableCell
                    sx={{
                      whiteSpace: "nowrap",
                      py: 1,
                      px: { xs: 0.5, md: 1 },
                      fontWeight: 600,
                      textAlign: "right",
                    }}
                  >
                    Hành động
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {listRegs.slice(0, displayCount).map((r, i) => {
                  const isOwner =
                    isLoggedIn && String(r?.createdBy) === String(me?._id);
                  return (
                    <DesktopTableRow
                      key={r._id}
                      r={r}
                      index={i}
                      isSingles={isSingles}
                      cap={cap}
                      delta={delta}
                      canManage={canManage}
                      isOwner={isOwner}
                      onTogglePayment={togglePayment}
                      onCancel={handleCancel}
                      onOpenComplaint={openComplaint}
                      onOpenPayment={openPayment}
                      onOpenReplace={openReplace}
                      onOpenPreview={openPreview}
                      onOpenProfile={openProfileByPlayer}
                      busy={busy}
                      regCodeOf={regCodeOf}
                    />
                  );
                })}

                {hasMore && (
                  <TableRow ref={loaderRef}>
                    <TableCell
                      colSpan={isSingles ? 8 : 9}
                      sx={{ textAlign: "center", py: 2 }}
                    >
                      <CircularProgress size={20} />
                      <Typography
                        variant="caption"
                        sx={{ ml: 1 }}
                        color="text.secondary"
                      >
                        Đang tải thêm... ({displayCount}/{regCount})
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Dialogs */}
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
            onError={(e) => (e.currentTarget.src = PLACE)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closePreview}>Đóng</Button>
        </DialogActions>
      </Dialog>

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

      <PublicProfileDialog
        open={profileDlg.open}
        onClose={closeProfileDlg}
        userId={profileDlg.userId}
      />

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
                      <b>Khiếu nại</b> để liên hệ Ban tổ chức (BTC) nhận hướng
                      dẫn thanh toán.
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
                        onError={(e) => (e.currentTarget.src = PLACE)}
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
              onClick={() => {
                setComplaintDlg({ open: true, reg: paymentDlg.reg, text: "" });
              }}
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
