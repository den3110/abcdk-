// components/MatchSettingsDialog.jsx
// Dialog chỉnh set-rules cho 1 trận: bestOf, pointsToWin, winByTwo, cap.
// Gửi PATCH /api/matches/:matchId/update qua useUpdateMatchSettingsMutation.
import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import { toast } from "react-toastify";
import { useUpdateMatchSettingsMutation } from "../slices/matchesApiSlice";

const CAP_MODES = [
  { value: "none", label: "Không có cap (chỉ theo cách 2)" },
  { value: "hard", label: "Cap cứng — dừng ngay khi chạm cap" },
  { value: "soft", label: "Cap mềm — cần cách 2, nhưng tối đa tới cap" },
];

const clampInt = (v, min, max) => {
  const n = parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
};

export default function MatchSettingsDialog({ open, onClose, match, onSaved }) {
  const [bestOf, setBestOf] = useState(1);
  const [pointsToWin, setPointsToWin] = useState(11);
  const [winByTwo, setWinByTwo] = useState(true);
  const [capMode, setCapMode] = useState("none");
  const [capPoints, setCapPoints] = useState("");
  const [timeoutPerGame, setTimeoutPerGame] = useState(2);
  const [timeoutMinutes, setTimeoutMinutes] = useState(1);
  const [medicalTimeouts, setMedicalTimeouts] = useState(1);
  const [updateSettings, { isLoading }] = useUpdateMatchSettingsMutation();

  useEffect(() => {
    if (!open) return;
    const r = match?.rules || {};
    setBestOf(Number(r.bestOf) || 1);
    setPointsToWin(Number(r.pointsToWin) || 11);
    setWinByTwo(r.winByTwo !== false);
    setCapMode(r.cap?.mode || "none");
    setCapPoints(
      r.cap?.points != null && r.cap.points !== "" ? String(r.cap.points) : "",
    );
    setTimeoutPerGame(clampInt(match?.timeoutPerGame ?? 2, 0, 10));
    setTimeoutMinutes(clampInt(match?.timeoutMinutes ?? 1, 0, 10));
    setMedicalTimeouts(clampInt(match?.medicalTimeouts ?? 1, 0, 10));
  }, [
    open,
    match?.rules,
    match?.timeoutPerGame,
    match?.timeoutMinutes,
    match?.medicalTimeouts,
  ]);

  const canSave = !isLoading && [11, 15, 21].includes(Number(pointsToWin));

  const handleSave = async () => {
    const cap =
      capMode === "none"
        ? { mode: "none", points: null }
        : {
            mode: capMode,
            points: clampInt(capPoints, Number(pointsToWin) + 1, 99),
          };
    if (capMode !== "none" && !cap.points) {
      toast.error("Vui lòng nhập điểm cap");
      return;
    }
    if (capMode !== "none" && cap.points <= Number(pointsToWin)) {
      toast.error("Điểm cap phải lớn hơn điểm chạm");
      return;
    }
    try {
      await updateSettings({
        matchId: match?._id,
        bestOf: Number(bestOf),
        pointsToWin: Number(pointsToWin),
        winByTwo: Boolean(winByTwo),
        cap,
        timeoutPerGame: clampInt(timeoutPerGame, 0, 10),
        timeoutMinutes: clampInt(timeoutMinutes, 0, 10),
        medicalTimeouts: clampInt(medicalTimeouts, 0, 10),
      }).unwrap();
      toast.success("Đã lưu cài đặt trận");
      onSaved?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.data?.message || err?.error || "Lưu thất bại");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Cài đặt trận đấu</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            Thay đổi luật tính điểm cho trận này. VD: <b>chạm 15, cách 2, cap 18</b> →
            điểm chạm = 15, cách 2 = bật, cap mềm = 18.
          </Alert>

          {/* BestOf */}
          <FormControl>
            <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
              Số set thi đấu (BO)
            </Typography>
            <Select
              size="small"
              value={bestOf}
              onChange={(e) => setBestOf(Number(e.target.value))}
            >
              <MenuItem value={1}>BO1 — 1 set</MenuItem>
              <MenuItem value={3}>BO3 — 2/3 set</MenuItem>
              <MenuItem value={5}>BO5 — 3/5 set</MenuItem>
            </Select>
          </FormControl>

          <Divider />

          {/* Points to win */}
          <FormControl>
            <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
              Điểm chạm (pointsToWin)
            </Typography>
            <Select
              size="small"
              value={pointsToWin}
              onChange={(e) => setPointsToWin(Number(e.target.value))}
            >
              <MenuItem value={11}>Chạm 11</MenuItem>
              <MenuItem value={15}>Chạm 15</MenuItem>
              <MenuItem value={21}>Chạm 21</MenuItem>
            </Select>
          </FormControl>

          {/* Win by two */}
          <FormControlLabel
            control={
              <Switch
                checked={winByTwo}
                onChange={(e) => setWinByTwo(e.target.checked)}
              />
            }
            label={
              <Typography variant="body2">
                <b>Cách 2</b> — phải hơn đối thủ ít nhất 2 điểm mới thắng set
              </Typography>
            }
          />

          <Divider />

          {/* Cap */}
          <FormControl>
            <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
              Cap điểm (điểm dừng tối đa)
            </Typography>
            <Select
              size="small"
              value={capMode}
              onChange={(e) => setCapMode(e.target.value)}
            >
              {CAP_MODES.map((m) => (
                <MenuItem key={m.value} value={m.value}>
                  {m.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {capMode !== "none" && (
            <TextField
              size="small"
              label="Điểm cap"
              type="number"
              value={capPoints}
              onChange={(e) => setCapPoints(e.target.value)}
              inputProps={{ min: Number(pointsToWin) + 1, max: 99 }}
              helperText={`Phải > ${pointsToWin}. VD: chạm ${pointsToWin} + cap ${
                Number(pointsToWin) + 3
              }.`}
              InputProps={{
                endAdornment: <InputAdornment position="end">điểm</InputAdornment>,
              }}
            />
          )}

          <Divider />
          <Typography
            variant="caption"
            fontWeight={700}
            sx={{
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "text.secondary",
            }}
          >
            Timeout & y tế
          </Typography>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              size="small"
              label="Số lượt timeout / đội / set"
              type="number"
              value={timeoutPerGame}
              onChange={(e) =>
                setTimeoutPerGame(clampInt(e.target.value, 0, 10))
              }
              inputProps={{ min: 0, max: 10 }}
              fullWidth
              helperText="Mỗi đội có bao nhiêu timeout / set"
            />
            <TextField
              size="small"
              label="Số phút / timeout"
              type="number"
              value={timeoutMinutes}
              onChange={(e) =>
                setTimeoutMinutes(clampInt(e.target.value, 0, 10))
              }
              inputProps={{ min: 0, max: 10 }}
              fullWidth
              InputProps={{
                endAdornment: <InputAdornment position="end">phút</InputAdornment>,
              }}
              helperText="Thời gian tối đa 1 timeout"
            />
            <TextField
              size="small"
              label="Số lượt nghỉ y tế / trận"
              type="number"
              value={medicalTimeouts}
              onChange={(e) =>
                setMedicalTimeouts(clampInt(e.target.value, 0, 10))
              }
              inputProps={{ min: 0, max: 10 }}
              fullWidth
              helperText="Tổng số lần nghỉ y tế cả 2 đội"
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isLoading}>
          Huỷ
        </Button>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={!canSave}
        >
          {isLoading ? "Đang lưu..." : "Lưu cài đặt"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

MatchSettingsDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  match: PropTypes.object,
  onSaved: PropTypes.func,
};
