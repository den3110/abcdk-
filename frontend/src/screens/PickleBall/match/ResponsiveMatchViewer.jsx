import React from "react";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useSelector } from "react-redux";
import { Close as CloseIcon } from "@mui/icons-material";
import { useLiveMatch } from "../../../hook/useLiveMatch";
import {
  useGetMatchPublicQuery,
  useListTournamentBracketsQuery,
} from "../../../slices/tournamentsApiSlice";
import MatchContent from "./MatchContent";

/* ===== Helpers: tính số vòng & mã trận theo V/T ===== */
const ceilPow2 = (n) => Math.pow(2, Math.ceil(Math.log2(Math.max(1, n || 1))));
const estimateRoundsForBracket = (b) => {
  // Ưu tiên rounds đã config
  const fromMeta =
    Number(b?.ko?.rounds) ||
    Number(b?.drawRounds) ||
    Number(b?.meta?.maxRounds) ||
    Number(b?.rounds);
  if (fromMeta) return Math.max(1, fromMeta);

  // Ước lượng theo drawSize (nếu có)
  const ds =
    Number(b?.config?.drawSize) ||
    Number(b?.meta?.drawSize) ||
    Number(b?.size) ||
    0;
  if (ds >= 2) {
    const scale = ceilPow2(ds);
    return Math.ceil(Math.log2(scale));
  }
  return 1;
};

const computeBaseRoundStart = (brackets, currentBracketId) => {
  if (!Array.isArray(brackets) || !currentBracketId) return 1;
  let base = 1;
  for (const b of brackets) {
    const bid = String(b?._id || "");
    if (!bid) continue;
    if (bid === String(currentBracketId)) break;

    const type = String(b?.type || "");
    if (type === "group") {
      // Vòng bảng coi như chiếm V1
      base += 1;
    } else if (type === "po") {
      const mr = Number(b?.config?.maxRounds) || 1;
      base += Math.max(1, mr);
    } else if (type === "ko" || type === "roundElim") {
      base += estimateRoundsForBracket(b);
    }
  }
  return base;
};

const makeMatchCode = (m, brackets) => {
  if (!m) return "";
  const tournamentId =
    m?.tournament?._id || m?.tournament || m?.tournamentId || null;
  const currentBracketId = m?.bracket?._id || m?.bracket || null;

  // baseRoundStart sẽ là 1 nếu chưa có brackets
  const baseRoundStart = computeBaseRoundStart(
    brackets || [],
    currentBracketId
  );

  const roundIdx = Number.isFinite(Number(m?.round)) ? Number(m.round) : 1;
  const orderOneBased = Number.isFinite(Number(m?.order))
    ? Number(m.order) + 1
    : 1;

  const displayRound = baseRoundStart + (roundIdx - 1);
  return `V${displayRound}-T${orderOneBased}`;
};

/* ===== Responsive viewer: Drawer/Dialog ===== */
function ResponsiveMatchViewer({ open, matchId, onClose }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { userInfo } = useSelector((s) => s.auth || {});
  const token = userInfo?.token;

  // Match (public) + live overlay
  const { data: base, isLoading } = useGetMatchPublicQuery(matchId, {
    skip: !matchId || !open,
  });
  const { loading: liveLoading, data: live } = useLiveMatch(
    open ? matchId : null,
    token
  );
  const m = live || base;
  const status = m?.status || "scheduled";

  // Lấy tournamentId để fetch brackets (tính offset V)
  const tournamentId =
    (base?.tournament?._id ||
      base?.tournament ||
      live?.tournament?._id ||
      live?.tournament) ??
    null;

  const { data: brackets = [] } = useListTournamentBracketsQuery(tournamentId, {
    skip: !tournamentId,
  });

  const code = m ? makeMatchCode(m, brackets) : "";

  const StatusChip = (
    <Chip
      size="small"
      sx={{ ml: 1 }}
      label={
        status === "live"
          ? "Đang diễn ra"
          : status === "finished"
          ? "Hoàn thành"
          : "Dự kiến"
      }
      color={
        status === "live"
          ? "warning"
          : status === "finished"
          ? "success"
          : "default"
      }
    />
  );

  if (isMobile) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        keepMounted
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            height: "92vh",
            maxHeight: "100vh",
            minHeight: "80vh",
          },
        }}
      >
        <Box
          sx={{
            p: 2,
            pt: 1.25,
            maxWidth: 1000,
            mx: "auto",
            width: "100%",
            pb: 6,
          }}
        >
          <Box
            sx={{
              width: 36,
              height: 4,
              bgcolor: "text.disabled",
              borderRadius: 2,
              mx: "auto",
              mb: 1.25,
            }}
          />
          <Box sx={{ position: "relative", pb: 1 }}>
            <Typography variant="h6">
              Trận đấu • {code}
              {StatusChip}
            </Typography>
            <IconButton
              onClick={onClose}
              sx={{ position: "absolute", right: -6, top: -6 }}
            >
              <CloseIcon />
            </IconButton>
          </Box>

          <Box sx={{ overflowY: "auto", pr: { md: 1 }, pb: 1 }}>
            <MatchContent
              m={m}
              isLoading={isLoading}
              liveLoading={liveLoading}
            />
          </Box>
        </Box>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pr: 6 }}>
        Trận đấu • {code}
        {StatusChip}
        <IconButton
          onClick={onClose}
          sx={{ position: "absolute", right: 12, top: 10 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <MatchContent m={m} isLoading={isLoading} liveLoading={liveLoading} />
      </DialogContent>
    </Dialog>
  );
}

export default ResponsiveMatchViewer;
