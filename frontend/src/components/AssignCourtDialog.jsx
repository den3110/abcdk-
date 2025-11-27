// src/pages/admin/parts/AssignCourtDialog.jsx
/* eslint-disable react/prop-types */
import React, { useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Chip,
  Typography,
  Divider,
} from "@mui/material";
import {
  Stadium as StadiumIcon,
  AssignmentTurnedIn as AssignIcon,
  Clear as ClearIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";

import { useAdminListCourtsQuery } from "../slices/adminCourtApiSlice";
import {
  useAdminAssignMatchToCourtMutation,
  useAdminClearMatchCourtMutation,
} from "../slices/tournamentsApiSlice";

/** Helper: hiển thị mã trận */
const matchCode = (m) => {
  if (!m) return "—";
  if (m.code) return m.code;
  const r = Number.isFinite(m?.globalRound)
    ? m.globalRound
    : Number.isFinite(m?.round)
    ? m.round
    : "?";
  const t = Number.isFinite(m?.order) ? m.order + 1 : undefined;
  return `V${r}${t ? `-T${t}` : ""}`;
};

/**
 * Chuẩn hoá "key" nhận diện 1 đội trong 1 side của match.
 * Dựa trên Registration / team / bộ đôi player.
 */
const getSideKey = (side) => {
  if (!side) return null;

  // Registration / reg / pair object
  const regId =
    side.registration?._id ||
    side.registration ||
    side.reg?._id ||
    side.reg ||
    side._id ||
    side.id;
  if (regId) return `reg:${regId}`;

  // Team id
  const teamId = side.teamId || side.team?._id || side.team?.id;
  if (teamId) return `team:${teamId}`;

  // Fallback: 2 player tạo thành key
  const p1 = side.player1?._id || side.player1?.id;
  const p2 = side.player2?._id || side.player2?.id;
  if (p1 || p2) {
    return `pair:${[p1, p2].filter(Boolean).join("-")}`;
  }

  return null;
};

/** Lấy toàn bộ key đội trong một match (2 side) */
const getMatchTeamKeys = (m) => {
  if (!m) return [];
  const keys = [];

  const a = m.pairA || m.teamA || m.sideA || m.regA || m.a || m.home || m.team1;
  const b = m.pairB || m.teamB || m.sideB || m.regB || m.b || m.away || m.team2;

  const ka = getSideKey(a);
  const kb = getSideKey(b);
  if (ka) keys.push(ka);
  if (kb) keys.push(kb);

  return keys;
};

/** Lấy tên hiển thị đội từ side */
const buildSideName = (side) => {
  if (!side) return "Đội này";

  const label = side.label || side.teamName || side.name || side.code;
  if (label) return label;

  const pickName = (p) =>
    p &&
    (p.shortName || p.nickname || p.nickName || p.fullName || p.name || null);

  const p1 = pickName(side.player1);
  const p2 = pickName(side.player2);

  if (p1 && p2) return `${p1} / ${p2}`;
  if (p1) return p1;
  if (p2) return p2;

  return "Đội này";
};

function AssignCourtDialog({ open, tournamentId, match, onClose, onAssigned }) {
  // Lấy danh sách sân theo giải, refetch mỗi lần mở dialog
  const {
    data: courts = [],
    isLoading,
    isFetching,
  } = useAdminListCourtsQuery(
    { tid: tournamentId },
    {
      skip: !open || !tournamentId,
      refetchOnMountOrArgChange: true,
    }
  );

  const [assign, { isLoading: assigning }] =
    useAdminAssignMatchToCourtMutation();
  const [clearCourt, { isLoading: clearing }] =
    useAdminClearMatchCourtMutation();

  // Dialog confirm khi có conflict
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingCourt, setPendingCourt] = useState(null);

  // Phân loại sân trống / đang dùng
  const courtsByStatus = useMemo(() => {
    const idle = [];
    const busy = [];
    (courts || []).forEach((c) => (c.currentMatch ? busy : idle).push(c));
    return { idle, busy };
  }, [courts]);

  // Các đội trong trận hiện tại
  const currentMatchTeamKeys = useMemo(
    () => new Set(getMatchTeamKeys(match)),
    [match]
  );

  /**
   * Tìm conflict:
   * Nếu bất kỳ đội nào trong trận hiện tại đang xuất hiện ở court.currentMatch của sân khác
   * => ghi nhận để cảnh báo & dùng cho dialog confirm.
   */
  const conflictItems = useMemo(() => {
    if (!match || !currentMatchTeamKeys.size) return [];

    const result = [];

    (courts || []).forEach((court) => {
      const cm = court.currentMatch;
      if (!cm) return;

      // Bỏ qua chính trận này nếu đang gán trên sân
      if (cm._id && match._id && String(cm._id) === String(match._id)) {
        return;
      }

      const cmTeamKeys = getMatchTeamKeys(cm);
      if (!cmTeamKeys.length) return;

      const overlapped = cmTeamKeys.some((k) => currentMatchTeamKeys.has(k));
      if (!overlapped) return;

      const teamNames = [];

      const collectIfOverlap = (side) => {
        if (!side) return;
        const key = getSideKey(side);
        if (!key || !currentMatchTeamKeys.has(key)) return;
        const name = buildSideName(side);
        if (!teamNames.includes(name)) {
          teamNames.push(name);
        }
      };

      collectIfOverlap(
        cm.pairA ||
          cm.teamA ||
          cm.sideA ||
          cm.regA ||
          cm.a ||
          cm.home ||
          cm.team1
      );
      collectIfOverlap(
        cm.pairB ||
          cm.teamB ||
          cm.sideB ||
          cm.regB ||
          cm.b ||
          cm.away ||
          cm.team2
      );

      if (teamNames.length) {
        result.push({
          courtName: court.name || court.label || "Sân",
          matchCode: cm.code || matchCode(cm),
          teamNames,
        });
      }
    });

    return result;
  }, [courts, match, currentMatchTeamKeys]);

  const hasTeamConflict = conflictItems.length > 0;

  // Thực hiện assign thật sự
  const doAssign = async (court) => {
    if (!match?._id || !court?._id) return;
    try {
      await assign({
        tid: tournamentId,
        matchId: match._id,
        courtId: court._id,
      }).unwrap();
      toast.success(`Đã gán ${matchCode(match)} → ${court.name}`);
      setConfirmOpen(false);
      setPendingCourt(null);
      onAssigned?.();
      onClose?.();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Gán sân thất bại");
    }
  };

  // Click "Gán sân này"
  const handleAssignClick = (court) => {
    if (!match?._id) return;

    if (hasTeamConflict) {
      // Có đội đang ở sân khác: mở dialog confirm đẹp
      setPendingCourt(court);
      setConfirmOpen(true);
      return;
    }

    // Không conflict: gán luôn
    doAssign(court);
  };

  const handleClear = async () => {
    if (!match?._id) return;
    try {
      await clearCourt({
        tid: tournamentId,
        matchId: match._id,
      }).unwrap();
      toast.success("Đã bỏ gán sân");
      onAssigned?.();
      onClose?.()
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Gỡ sân thất bại");
    }
  };

  // ID sân đang gán (hỗ trợ cả object & string)
  const linkedCourtId =
    (match?.court && (match.court._id || match.court)) || null;

  const loading = (isLoading || isFetching) && open;

  const handleCloseConfirm = () => {
    if (assigning) return;
    setConfirmOpen(false);
    setPendingCourt(null);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" keepMounted>
        <DialogTitle>
          <Stack direction="row" alignItems="center" spacing={1}>
            <StadiumIcon fontSize="small" />
            <span>Gán sân — {match ? matchCode(match) : "—"}</span>
          </Stack>
        </DialogTitle>

        <DialogContent dividers sx={{ pb: 1.5 }}>
          {!open ? null : loading ? (
            <Box textAlign="center" py={3}>
              <CircularProgress size={24} />
            </Box>
          ) : (courts?.length || 0) === 0 ? (
            <Typography color="text.secondary">
              Chưa có sân nào cho <b>giải</b> này.
            </Typography>
          ) : (
            <Box>
              {/* Đang gán sân cho match này */}
              {linkedCourtId && (
                <Paper variant="outlined" sx={{ p: 1.25, mb: 2 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                  >
                    <Chip
                      size="small"
                      color="secondary"
                      variant="outlined"
                      label={`Đang gán: ${
                        match?.court?.name || match?.court?.label || ""
                      }`}
                    />
                    <Chip
                      size="small"
                      color="error"
                      variant="outlined"
                      icon={<ClearIcon />}
                      label={clearing ? "Đang gỡ…" : "Bỏ gán sân"}
                      onClick={handleClear}
                      disabled={clearing}
                    />
                    {linkedCourtId && (
                      <Chip
                        size="small"
                        variant="outlined"
                        icon={<OpenInNewIcon />}
                        label="Mở overlay"
                        component="a"
                        href={`/overlay/score?matchId=${match?._id}`}
                        clickable
                      />
                    )}
                  </Stack>
                </Paper>
              )}

              {/* Cảnh báo conflict: chỉ hiển thị, không chặn */}
              {hasTeamConflict && (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.25,
                    mb: 2,
                    borderColor: "error.main",
                  }}
                >
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle2" color="error">
                      Cảnh báo: Có đội trong trận này đang được gán ở sân khác
                    </Typography>
                    {conflictItems.map((c, idx) => (
                      <Typography key={idx} variant="body2" color="error">
                        {c.teamNames.join(", ")} đang được gán ở sân{" "}
                        <b>{c.courtName}</b> (trận {c.matchCode}). Nếu bạn tiếp
                        tục gán sân khác, hệ thống sẽ hỏi xác nhận.
                      </Typography>
                    ))}
                  </Stack>
                </Paper>
              )}

              {/* Sân trống */}
              <Typography
                variant="subtitle2"
                color="text.secondary"
                sx={{ mb: 1 }}
              >
                Sân trống ({courtsByStatus.idle.length})
              </Typography>
              <Grid container spacing={1}>
                {courtsByStatus.idle.map((c) => (
                  <Grid
                    key={c._id}
                    item
                    size={{ xs: 12, md: 6, lg: 4 }} // ⬅️ đổi từ xs/md/lg
                  >
                    <Paper variant="outlined" sx={{ p: 1.25 }}>
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <Typography fontWeight={600}>{c.name}</Typography>
                        <Chip size="small" variant="outlined" label="Trống" />
                      </Stack>
                      <Stack
                        direction="row"
                        flexWrap="wrap"
                        columnGap={1}
                        rowGap={1}
                        mt={1}
                      >
                        <Chip
                          size="small"
                          color="secondary"
                          icon={<AssignIcon />}
                          label={assigning ? "Đang gán…" : "Gán sân này"}
                          onClick={
                            assigning ? undefined : () => handleAssignClick(c)
                          }
                          disabled={assigning}
                        />
                      </Stack>
                    </Paper>
                  </Grid>
                ))}
              </Grid>

              {/* Sân đang dùng */}
              {courtsByStatus.busy.length > 0 && (
                <>
                  <Divider sx={{ my: 1.5 }} />
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    sx={{ mb: 1 }}
                  >
                    Sân đang dùng ({courtsByStatus.busy.length})
                  </Typography>
                  <Grid container spacing={1}>
                    {courtsByStatus.busy.map((c) => (
                      <Grid
                        key={c._id}
                        item
                        size={{ xs: 12, md: 6, lg: 4 }} // ⬅️ đổi từ xs/md/lg
                      >
                        <Paper variant="outlined" sx={{ p: 1.25 }}>
                          <Stack
                            direction="row"
                            justifyContent="space-between"
                            alignItems="center"
                          >
                            <Typography fontWeight={600}>{c.name}</Typography>
                            <Chip
                              size="small"
                              variant="outlined"
                              label="Đang dùng"
                            />
                          </Stack>
                          {c.currentMatch && (
                            <Typography variant="body2" mt={0.5}>
                              Trận:{" "}
                              {c.currentMatch.code || matchCode(c.currentMatch)}
                            </Typography>
                          )}
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                </>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose}>Đóng</Button>
        </DialogActions>
      </Dialog>

      {/* Dialog confirm conflict khi gán sân */}
      <Dialog
        open={confirmOpen}
        onClose={handleCloseConfirm}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Cảnh báo trùng đội ở nhiều sân</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            <Typography variant="body2">
              Một hoặc nhiều đội trong trận <b>{matchCode(match)}</b> đang được
              gán ở sân khác:
            </Typography>
            {conflictItems.map((c, idx) => (
              <Paper
                key={idx}
                variant="outlined"
                sx={{ p: 1, borderColor: "error.main" }}
              >
                <Typography variant="body2" color="error">
                  {c.teamNames.join(", ")} — sân <b>{c.courtName}</b> (trận{" "}
                  {c.matchCode})
                </Typography>
              </Paper>
            ))}
            <Typography variant="body2">
              Nếu tiếp tục, trận <b>{matchCode(match)}</b>
              {pendingCourt
                ? ` sẽ được gán vào sân ${pendingCourt.name}.`
                : " sẽ được gán vào sân đã chọn."}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Hãy đảm bảo bạn muốn đội đó chơi ở nhiều sân / nhiều trận đồng
              thời hoặc đã xử lý lại lịch phù hợp.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseConfirm} disabled={assigning}>
            Hủy
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={!pendingCourt || assigning}
            onClick={() => pendingCourt && doAssign(pendingCourt)}
          >
            {assigning ? "Đang gán..." : "Tiếp tục gán"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default React.memo(AssignCourtDialog);
