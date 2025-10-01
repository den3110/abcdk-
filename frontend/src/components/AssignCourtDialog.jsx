// src/pages/admin/parts/AssignCourtDialog.jsx
/* eslint-disable react/prop-types */
import React, { useMemo } from "react";
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

/**
 * ĐỔI các hook dưới đây nếu tên khác trong project của bạn.
 */
import {
  useAdminListCourtsQuery,
//   useAdminUpsertCourtsMutation, // không dùng ở đây nhưng để sẵn nếu bạn muốn mở rộng
} from "../slices/adminCourtApiSlice";
import {
  useAdminAssignMatchToCourtMutation,
  useAdminClearMatchCourtMutation,
} from "../slices/tournamentsApiSlice";

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

function AssignCourtDialog({ open, tournamentId, match, onClose, onAssigned }) {
  const bracketId = match?.bracket?._id || match?.bracket || "";

  // chỉ load khi mở dialog & có bracket
  const { data: courts = [], isLoading } = useAdminListCourtsQuery(
    { tid: tournamentId, bracket: bracketId },
    { skip: !open || !tournamentId || !bracketId }
  );

  const [assign, { isLoading: assigning }] =
    useAdminAssignMatchToCourtMutation();
  const [clearCourt, { isLoading: clearing }] =
    useAdminClearMatchCourtMutation();

  const courtsByStatus = useMemo(() => {
    const idle = [];
    const busy = [];
    (courts || []).forEach((c) => (c.currentMatch ? busy : idle).push(c));
    return { idle, busy };
  }, [courts]);

  const handleAssign = async (court) => {
    if (!match?._id) return;
    try {
      await assign({
        tid: tournamentId,
        matchId: match._id,
        courtId: court._id,
      }).unwrap();
      toast.success(`Đã gán ${matchCode(match)} → ${court.name}`);
      onAssigned?.();
      onClose?.();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Gán sân thất bại");
    }
  };

  const handleClear = async () => {
    if (!match?._id) return;
    try {
      await clearCourt({ tid: tournamentId, matchId: match._id }).unwrap();
      toast.success("Đã bỏ gán sân");
      onAssigned?.();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Gỡ sân thất bại");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" keepMounted>
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1}>
          <StadiumIcon fontSize="small" />
          <span>Gán sân — {match ? matchCode(match) : "—"}</span>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ pb: 1.5 }}>
        {!open ? null : isLoading ? (
          <Box textAlign="center" py={3}>
            <CircularProgress size={24} />
          </Box>
        ) : (courts?.length || 0) === 0 ? (
          <Typography color="text.secondary">
            Chưa có sân nào cho bracket này.
          </Typography>
        ) : (
          <Box>
            {match?.court?._id && (
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
                    label={`Đang gán: ${match?.court?.name || ""}`}
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
                  {match?.court?._id && (
                    <Chip
                      size="small"
                      variant="outlined"
                      icon={<OpenInNewIcon />}
                      label="Mở overlay"
                      component="a"
                      href={`/overlay?court=${match.court._id}`}
                      clickable
                    />
                  )}
                </Stack>
              </Paper>
            )}

            <Typography
              variant="subtitle2"
              color="text.secondary"
              sx={{ mb: 1 }}
            >
              Sân trống ({courtsByStatus.idle.length})
            </Typography>
            <Grid container spacing={1}>
              {courtsByStatus.idle.map((c) => (
                <Grid key={c._id} item xs={12} md={6} lg={4}>
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
                        onClick={() => handleAssign(c)}
                        disabled={assigning}
                      />
                    </Stack>
                  </Paper>
                </Grid>
              ))}
            </Grid>

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
                    <Grid key={c._id} item xs={12} md={6} lg={4}>
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
  );
}

export default React.memo(AssignCourtDialog);
