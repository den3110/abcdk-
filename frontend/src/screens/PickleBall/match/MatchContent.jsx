import { Alert, Box, Chip, CircularProgress, Divider, Stack, Link as MuiLink, Button, Paper, Typography, TextField, Table, TableHead, TableRow, TableCell, TableBody, } from "@mui/material";
import { useSelector } from "react-redux";
import {
  Close as CloseIcon,
  EmojiEvents as TrophyIcon,
  PlayCircle as PlayIcon,
  ContentCopy as ContentCopyIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import { depLabel, pairLabelWithNick, seedLabel } from "../TournamentBracket";

/* ===================== Match viewer utils ===================== */
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
    console.log(e);
    alert(e);
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

function sumPoints(gameScores) {
  let a = 0,
    b = 0;
  for (const g of gameScores || []) {
    a += Number(g?.a ?? 0);
    b += Number(g?.b ?? 0);
  }
  return { a, b };
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

  const streams = extractStreams(m);
  const status = m?.status || "scheduled";
  const gamesWon = countGamesWon(m?.gameScores);
  const yt = streams.find((s) => ytEmbed(s.url));
  const ytSrc = ytEmbed(yt?.url);

  if (isLoading || liveLoading) {
    return (
      <Box py={4} textAlign="center">
        <CircularProgress />
      </Box>
    );
  }
  if (!m) return <Alert severity="error">Không tải được dữ liệu trận.</Alert>;

  const overlayUrl =
    m?._id && typeof window !== "undefined" && window?.location?.origin
      ? `${window.location.origin}/overlay/score?matchId=${m._id}&theme=dark&size=md&showSets=1`
      : "";

  return (
    <Stack spacing={2}>
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
              target="_blank"
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
              {m?.pairA
                ? pairLabelWithNick(m.pairA, m?.tournament?.eventType)
                : m?.previousA
                ? depLabel(m.previousA)
                : seedLabel(m?.seedA)}
            </Typography>
          </Box>
          <Box textAlign="center" minWidth={140}>
            {m?.status === "live" && (
              <Typography variant="caption" color="text.secondary">
                Ván hiện tại
              </Typography>
            )}
            <Typography variant="h4" fontWeight={800}>
              {lastGameScore(m?.gameScores).a} –{" "}
              {lastGameScore(m?.gameScores).b}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sets: {countGamesWon(m?.gameScores).A} –{" "}
              {countGamesWon(m?.gameScores).B}
            </Typography>
          </Box>
          <Box flex={1} textAlign={{ xs: "left", sm: "right" }}>
            <Typography variant="body2" color="text.secondary">
              Đội B
            </Typography>
            <Typography variant="h6">
              {m?.pairB
                ? pairLabelWithNick(m.pairB, m?.tournament?.eventType)
                : m?.previousB
                ? depLabel(m.previousB)
                : seedLabel(m?.seedB)}
            </Typography>
          </Box>
        </Stack>

        {!!m?.gameScores?.length && (
          <Table size="small" sx={{ mt: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>Set</TableCell>
                <TableCell align="center">A</TableCell>
                <TableCell align="center">B</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {m.gameScores.map((g, idx) => (
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
          <Chip size="small" label={`Best of: ${m.rules?.bestOf ?? 3}`} />
          <Chip
            size="small"
            label={`Điểm thắng: ${m.rules?.pointsToWin ?? 11}`}
          />
          {m.rules?.winByTwo && <Chip size="small" label="Phải chênh 2" />}
          {m.referee?.name && (
            <Chip size="small" label={`Trọng tài: ${m.referee.name}`} />
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

export default MatchContent;
