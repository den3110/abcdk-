// MatchContent.jsx
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Link as MuiLink,
  Button,
  Paper,
  Typography,
  TextField,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material";
import { useSelector } from "react-redux";
import {
  PlayCircle as PlayIcon,
  ContentCopy as ContentCopyIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import { depLabel, pairLabelWithNick, seedLabel } from "../TournamentBracket";

/* ===================== Hooks chống nháy ===================== */
// luôn gọi hook, đừng đặt trong biểu thức điều kiện
function useDelayedFlag(flag, ms = 250) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let t;
    if (flag) t = setTimeout(() => setShow(true), ms);
    else setShow(false);
    return () => clearTimeout(t);
  }, [flag, ms]);
  return show;
}

// Throttle render: gộp socket updates trong khoảng interval (ms)
function useThrottledStable(
  value,
  { interval = 280, isEqual = (a, b) => a === b } = {}
) {
  const [display, setDisplay] = useState(value ?? null);
  const latestRef = useRef(value);
  const timerRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    latestRef.current = value;

    // Lần đầu: hiển thị ngay
    if (!mountedRef.current) {
      mountedRef.current = true;
      setDisplay(value ?? null);
      return;
    }

    if (isEqual(value, display)) return;

    // Có cập nhật mới -> chờ đến nhịp flush (không hiển thị indicator)
    if (timerRef.current) return;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setDisplay(latestRef.current ?? null);
    }, interval);
  }, [value, display, interval, isEqual]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return display;
}

/* ============ Helpers ============ */
function ytEmbed(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") && u.searchParams.get("v")) {
      return `https://www.youtube.com/embed/${u.searchParams.get("v")}`;
    }
    if (u.hostname === "youtu.be") {
      return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    }
  } catch (e) {
    console.warn(e);
  }
  return null;
}
function extractStreams(m) {
  const arr = [];
  const raw =
    m?.streams ||
    m?.meta?.streams ||
    (m?.videoUrl ? [{ label: "YouTube", url: m.videoUrl }] : []);
  for (const s of raw || []) {
    if (s?.url) arr.push({ label: s.label || "Link", url: s.url });
  }
  return arr;
}
function lastGameScore(gameScores) {
  if (!Array.isArray(gameScores) || !gameScores.length) return { a: 0, b: 0 };
  return gameScores[gameScores.length - 1] || { a: 0, b: 0 };
}
function countGamesWon(gameScores) {
  let A = 0,
    B = 0;
  for (const g of gameScores || []) {
    if ((g?.a ?? 0) > (g?.b ?? 0)) A++;
    else if ((g?.b ?? 0) > (g?.a ?? 0)) B++;
  }
  return { A, B };
}

// So sánh tối giản các field ảnh hưởng UI để bỏ qua cập nhật không cần thiết
function isMatchEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a._id !== b._id) return false;
  if (a.status !== b.status) return false;

  const ra = a.rules || {};
  const rb = b.rules || {};
  if ((ra.bestOf ?? 3) !== (rb.bestOf ?? 3)) return false;
  if ((ra.pointsToWin ?? 11) !== (rb.pointsToWin ?? 11)) return false;
  if ((ra.winByTwo ?? false) !== (rb.winByTwo ?? false)) return false;

  const gsA = JSON.stringify(a.gameScores || []);
  const gsB = JSON.stringify(b.gameScores || []);
  if (gsA !== gsB) return false;

  const saA = a.seedA ?? null;
  const saB = b.seedA ?? null;
  const sbA = a.seedB ?? null;
  const sbB = b.seedB ?? null;

  const paA = a.pairA?._id ?? a.pairA ?? null;
  const paB = b.pairA?._id ?? b.pairA ?? null;
  const pbA = a.pairB?._id ?? a.pairB ?? null;
  const pbB = b.pairB?._id ?? b.pairB ?? null;

  return saA === saB && sbA === sbB && paA === paB && pbA === pbB;
}

/* ===== Shared content for Match viewer ===== */
function MatchContent({ m, isLoading, liveLoading }) {
  const { userInfo } = useSelector((s) => s.auth || {});
  const userId =
    userInfo?._id || userInfo?.id || userInfo?.userId || userInfo?.uid;

  const roleStr = String(userInfo?.role || "").toLowerCase();
  const roles = new Set(
    [...(userInfo?.roles || []), ...(userInfo?.permissions || [])]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase())
  );

  const isAdmin = !!(
    userInfo?.isAdmin ||
    roleStr === "admin" ||
    roles.has("admin") ||
    roles.has("superadmin") ||
    roles.has("tournament:admin")
  );

  const tour =
    m?.tournament && typeof m.tournament === "object" ? m.tournament : null;

  const ownerId =
    (tour?.owner &&
      (tour.owner._id || tour.owner.id || tour.owner.userId || tour.owner)) ||
    (tour?.createdBy &&
      (tour.createdBy._id ||
        tour.createdBy.id ||
        tour.createdBy.userId ||
        tour.createdBy)) ||
    (tour?.organizer &&
      (tour.organizer._id ||
        tour.organizer.id ||
        tour.organizer.userId ||
        tour.organizer)) ||
    null;

  const managerIds = new Set(
    [
      ...(tour?.managers || []),
      ...(tour?.organizers || []),
      ...(tour?.staff || []),
      ...(tour?.moderators || []),
    ]
      .map((u) =>
        typeof u === "string"
          ? u
          : u?._id || u?.id || u?.userId || u?.uid || u?.email
      )
      .filter(Boolean)
  );

  const canManageFlag =
    m?.permissions?.canManage ||
    tour?.permissions?.canManage ||
    userInfo?.permissions?.includes?.("tournament:manage");

  const isManager = !!(
    tour &&
    userId &&
    (managerIds.has(userId) || ownerId === userId || canManageFlag)
  );

  const canSeeOverlay = isAdmin || isManager;

  /* ==== Chống nháy: throttle + KHÔNG hiển thị progress khi cập nhật ==== */
  const mm = useThrottledStable(m, {
    interval: 280, // chỉnh 250–400ms theo cảm nhận
    isEqual: isMatchEqual,
  });

  // ✅ luôn gọi hook; kết hợp điều kiện sau
  const initialPending = Boolean(isLoading || liveLoading);
  const initialDelayPassed = useDelayedFlag(initialPending, 250);
  const showInitialSpinner = !mm && initialDelayPassed;

  if (showInitialSpinner) {
    return (
      <Box py={4} textAlign="center">
        <CircularProgress />
      </Box>
    );
  }
  if (!mm) return <Alert severity="error">Không tải được dữ liệu trận.</Alert>;

  const streams = extractStreams(mm);
  const status = mm?.status || "scheduled";
  const gamesWon = countGamesWon(mm?.gameScores);
  const yt = streams.find((s) => ytEmbed(s.url));
  const ytSrc = ytEmbed(yt?.url);

  const overlayUrl =
    mm?._id && typeof window !== "undefined" && window?.location?.origin
      ? `${window.location.origin}/overlay/score?matchId=${mm._id}&theme=dark&size=md&showSets=1`
      : "";

  return (
    <Stack spacing={2} sx={{ position: "relative" }}>
      {/* KHÔNG LinearProgress/Chip -> không gây layout shift/pop-up rung */}

      {status === "live" ? (
        ytSrc ? (
          <Box sx={{ position: "relative", pt: "56.25%" }}>
            <iframe
              src={ytSrc}
              title="Live"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              style={{
                position: "absolute",
                inset: 0,
                border: 0,
                width: "100%",
                height: "100%",
              }}
            />
          </Box>
        ) : (
          <Alert icon={<PlayIcon />} severity="info">
            Trận đang live.{" "}
            {streams.length
              ? "Chọn link bên dưới để xem trực tiếp."
              : "Chưa có link phát trực tiếp."}
          </Alert>
        )
      ) : (
        <Alert icon={<PlayIcon />} severity="info">
          {status === "scheduled"
            ? "Trận chưa diễn ra. "
            : "Trận đã kết thúc. "}
          {streams.length
            ? "Bạn có thể mở liên kết xem video:"
            : "Chưa có liên kết video."}
        </Alert>
      )}

      {streams.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap">
          {streams.map((s, i) => (
            <Button
              key={i}
              variant="outlined"
              size="small"
              component={MuiLink}
              href={s.url}
              target={"_blank"}
              rel="noreferrer"
              underline="none"
            >
              {s.label}
            </Button>
          ))}
        </Stack>
      )}

      {overlayUrl && canSeeOverlay && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Overlay tỉ số trực tiếp
            </Typography>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              alignItems={{ xs: "stretch", sm: "center" }}
            >
              <TextField
                size="small"
                fullWidth
                value={overlayUrl}
                InputProps={{ readOnly: true }}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ContentCopyIcon />}
                  onClick={() => navigator.clipboard.writeText(overlayUrl)}
                >
                  Copy link
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  startIcon={<OpenInNewIcon />}
                  component={MuiLink}
                  href={overlayUrl}
                  target="_blank"
                  rel="noreferrer"
                  underline="none"
                  sx={{ color: "white !important" }}
                >
                  Mở overlay
                </Button>
              </Stack>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Mẹo: dán link này vào OBS/StreamYard (Browser Source) để hiển thị
              tỉ số ở góc màn hình.
            </Typography>
          </Stack>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography fontWeight={700} gutterBottom>
          Điểm số
        </Typography>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems="center"
        >
          <Box flex={1}>
            <Typography variant="body2" color="text.secondary">
              Đội A
            </Typography>
            <Typography variant="h6">
              {mm?.pairA
                ? pairLabelWithNick(mm.pairA, mm?.tournament?.eventType)
                : mm?.previousA
                ? depLabel(mm.previousA)
                : seedLabel(mm?.seedA)}
            </Typography>
          </Box>
          <Box textAlign="center" minWidth={140}>
            {mm?.status === "live" && (
              <Typography variant="caption" color="text.secondary">
                Ván hiện tại
              </Typography>
            )}
            <Typography variant="h4" fontWeight={800}>
              {lastGameScore(mm?.gameScores).a} –{" "}
              {lastGameScore(mm?.gameScores).b}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sets: {gamesWon.A} – {gamesWon.B}
            </Typography>
          </Box>
          <Box flex={1} textAlign={{ xs: "left", sm: "right" }}>
            <Typography variant="body2" color="text.secondary">
              Đội B
            </Typography>
            <Typography variant="h6">
              {mm?.pairB
                ? pairLabelWithNick(mm.pairB, mm?.tournament?.eventType)
                : mm?.previousB
                ? depLabel(mm.previousB)
                : seedLabel(mm?.seedB)}
            </Typography>
          </Box>
        </Stack>

        {!!mm?.gameScores?.length && (
          <Table size="small" sx={{ mt: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>Set</TableCell>
                <TableCell align="center">A</TableCell>
                <TableCell align="center">B</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mm.gameScores.map((g, idx) => (
                <TableRow key={idx}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell align="center">{g.a ?? 0}</TableCell>
                  <TableCell align="center">{g.b ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Divider sx={{ my: 2 }} />
        <Stack direction="row" spacing={2} flexWrap="wrap">
          <Chip size="small" label={`Best of: ${mm.rules?.bestOf ?? 3}`} />
          <Chip
            size="small"
            label={`Điểm thắng: ${mm.rules?.pointsToWin ?? 11}`}
          />
          {mm.rules?.winByTwo && <Chip size="small" label="Phải chênh 2" />}
          {mm.referee?.name && (
            <Chip size="small" label={`Trọng tài: ${mm.referee.name}`} />
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

export default MatchContent;
