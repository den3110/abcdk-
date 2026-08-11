// components/mlp/MlpResetDialog.jsx
// Dialog reset dữ liệu MLP để test lại. Checkboxes cho scope + gõ tên
// giải để xác nhận (chống bấm nhầm).
import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { toast } from "react-toastify";
import { useResetMlpTournamentMutation } from "../../slices/mlpApiSlice";

export default function MlpResetDialog({ open, onClose, tour, onReset }) {
  const [scopeDuals, setScopeDuals] = useState(true);
  const [scopeStandings, setScopeStandings] = useState(true);
  const [scopePools, setScopePools] = useState(true);
  const [scopeRating, setScopeRating] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [reset, { isLoading }] = useResetMlpTournamentMutation();

  useEffect(() => {
    if (open) {
      setScopeDuals(true);
      setScopeStandings(true);
      setScopePools(true);
      setScopeRating(false);
      setConfirmName("");
    }
  }, [open]);

  const targetName = String(tour?.name || "").trim();
  const nameOk = confirmName.trim() === targetName;
  const anyScope = scopeDuals || scopeStandings || scopePools || scopeRating;

  const handleReset = async () => {
    if (!nameOk) {
      toast.error("Tên giải chưa khớp");
      return;
    }
    if (!anyScope) {
      toast.error("Chọn ít nhất 1 mục để reset");
      return;
    }
    try {
      const r = await reset({
        tid: tour._id,
        scope: {
          duals: scopeDuals,
          standings: scopeStandings,
          pools: scopePools,
          ratingChanges: scopeRating,
        },
        confirmName: confirmName.trim(),
      }).unwrap();
      const s = r.summary || {};
      toast.success(
        `Đã reset: ${s.dualsDeleted || 0} dual, ${s.matchDocsDeleted || 0} match doc, ${s.teamsReset || 0} team, ${s.poolsCleared || 0} pool assignment${
          scopeRating ? `, ${s.ratingChangesDeleted || 0} rating change` : ""
        }`,
      );
      onReset?.(r);
      onClose?.();
    } catch (err) {
      toast.error(err?.data?.message || "Reset thất bại");
    }
  };

  return (
    <Dialog open={open} onClose={isLoading ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ color: "error.main", fontWeight: 900 }}>
        ⚠️ Reset giải MLP
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="warning" sx={{ borderRadius: 2 }}>
            Thao tác này KHÔNG THỂ HOÀN TÁC. Dữ liệu sẽ bị xoá vĩnh viễn theo
            phạm vi bạn chọn.
          </Alert>

          <Typography variant="body2" fontWeight={800}>
            Phạm vi reset
          </Typography>
          <Stack spacing={0.5}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={scopeDuals}
                  onChange={(e) => setScopeDuals(e.target.checked)}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={700}>
                    Xoá toàn bộ dual matches
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Xoá tất cả trận đấu MLP (vòng bảng + knockout) và Match docs
                    liên quan. Trọng tài sẽ không thấy trận nào.
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={scopeStandings}
                  onChange={(e) => setScopeStandings(e.target.checked)}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={700}>
                    Reset BXH về 0
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Wins / Losses / SlotsFor / PointsFor... của mọi team quay
                    về 0. Team vẫn giữ nguyên (không xoá).
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={scopePools}
                  onChange={(e) => setScopePools(e.target.checked)}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={700}>
                    Xoá bốc thăm chia bảng
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Clear poolKey/poolIndex/seed của mọi team. drawStatus =
                    idle. Cần bốc thăm lại trước khi sinh vòng bảng.
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={scopeRating}
                  onChange={(e) => setScopeRating(e.target.checked)}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={700} color="warning.main">
                    Xoá RatingChange log (⚠ không revert điểm trình VĐV)
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Xoá bản ghi lịch sử điểm trình cho giải này. Điểm trình
                    hiện tại của VĐV KHÔNG bị hoàn lại — cần cẩn thận. Dùng
                    khi bạn chắc chắn muốn xoá log audit.
                  </Typography>
                </Box>
              }
            />
          </Stack>

          <Alert severity="error" sx={{ borderRadius: 2 }}>
            KHÔNG bị đụng: Teams (vẫn còn), MLP config (slots, DreamBreaker,
            groupStage settings), thông tin giải. Chỉ xoá dữ liệu ĐÁ THI ĐẤU.
          </Alert>

          <Box>
            <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
              Gõ chính xác tên giải để xác nhận:
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontFamily: "monospace",
                bgcolor: "grey.100",
                p: 1,
                borderRadius: 1,
                mb: 1,
              }}
            >
              {targetName || "(giải chưa có tên)"}
            </Typography>
            <TextField
              size="small"
              fullWidth
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder="Gõ tên giải để xác nhận"
              error={confirmName.length > 0 && !nameOk}
              helperText={
                confirmName.length > 0 && !nameOk
                  ? "Tên chưa khớp"
                  : "Tên phải khớp chính xác (có phân biệt hoa/thường)"
              }
            />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isLoading}>
          Huỷ
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={handleReset}
          disabled={isLoading || !nameOk || !anyScope}
        >
          {isLoading ? "Đang reset..." : "🔥 Reset giải"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

MlpResetDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  tour: PropTypes.object,
  onReset: PropTypes.func,
};
