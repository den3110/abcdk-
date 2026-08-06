// components/mlp/MlpConfigDialog.jsx
// Dialog cấu hình MLP: roster limits, slots, scoring rules, DreamBreaker.
import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { toast } from "react-toastify";
import { useUpdateMlpConfigMutation } from "../../slices/mlpApiSlice.js";

const GENDER_LABEL = {
  any: "Bất kỳ",
  male: "Toàn nam",
  female: "Toàn nữ",
  mixed: "Đôi hỗn hợp (1 nam + 1 nữ)",
};

const clampInt = (v, min, max) => {
  const n = parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
};

const DEFAULT_SLOT = {
  key: "S",
  label: "",
  matchType: "double",
  genderRule: "any",
};

export default function MlpConfigDialog({ open, onClose, tour, onSaved }) {
  const [minRoster, setMinRoster] = useState(4);
  const [maxRoster, setMaxRoster] = useState(8);
  const [slots, setSlots] = useState([]);
  const [pointsToWin, setPointsToWin] = useState(21);
  const [winByTwo, setWinByTwo] = useState(true);
  const [capMode, setCapMode] = useState("none");
  const [capPoints, setCapPoints] = useState("");
  const [rallyScoring, setRallyScoring] = useState(true);
  const [dbEnabled, setDbEnabled] = useState(true);
  const [dbPointsToWin, setDbPointsToWin] = useState(21);
  const [dbRotate, setDbRotate] = useState(4);
  const [dbWinByTwo, setDbWinByTwo] = useState(false);
  const [update, { isLoading }] = useUpdateMlpConfigMutation();

  useEffect(() => {
    if (!open) return;
    const cfg = tour?.mlpConfig || {};
    setMinRoster(clampInt(cfg.minRosterSize ?? 4, 1, 30));
    setMaxRoster(clampInt(cfg.maxRosterSize ?? 8, 1, 30));
    setSlots(
      Array.isArray(cfg.slots) && cfg.slots.length
        ? cfg.slots.map((s) => ({
            key: s.key,
            label: s.label || "",
            matchType: s.matchType || "double",
            genderRule: s.genderRule || "any",
          }))
        : [
            { key: "WD", label: "Đôi nữ", matchType: "double", genderRule: "female" },
            { key: "MD", label: "Đôi nam", matchType: "double", genderRule: "male" },
            { key: "XD1", label: "Đôi hỗn hợp 1", matchType: "double", genderRule: "mixed" },
            { key: "XD2", label: "Đôi hỗn hợp 2", matchType: "double", genderRule: "mixed" },
          ],
    );
    setPointsToWin(Number(cfg.pointsToWin) || 21);
    setWinByTwo(cfg.winByTwo !== false);
    setCapMode(cfg.cap?.mode || "none");
    setCapPoints(
      cfg.cap?.points != null && cfg.cap.points !== ""
        ? String(cfg.cap.points)
        : "",
    );
    setRallyScoring(cfg.rallyScoring !== false);
    const db = cfg.dreamBreaker || {};
    setDbEnabled(db.enabled !== false);
    setDbPointsToWin(Number(db.pointsToWin) || 21);
    setDbRotate(Number(db.rotationEveryPoints) || 4);
    setDbWinByTwo(!!db.winByTwo);
  }, [open, tour?.mlpConfig]);

  const updateSlot = (idx, patch) =>
    setSlots(slots.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const addSlot = () =>
    setSlots([...slots, { ...DEFAULT_SLOT, key: `S${slots.length + 1}` }]);
  const removeSlot = (idx) => setSlots(slots.filter((_, i) => i !== idx));
  const moveSlot = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= slots.length) return;
    const copy = [...slots];
    [copy[idx], copy[j]] = [copy[j], copy[idx]];
    setSlots(copy);
  };

  const handleSave = async () => {
    if (minRoster > maxRoster) {
      toast.error("Roster min không được lớn hơn max");
      return;
    }
    if (slots.length === 0) {
      toast.error("Phải có ít nhất 1 slot");
      return;
    }
    const keys = new Set();
    for (const s of slots) {
      const k = String(s.key || "").trim();
      if (!k) {
        toast.error("Tất cả slot phải có key");
        return;
      }
      if (keys.has(k.toLowerCase())) {
        toast.error(`Trùng key slot: ${k}`);
        return;
      }
      keys.add(k.toLowerCase());
    }
    const cap =
      capMode === "none"
        ? { mode: "none", points: null }
        : {
            mode: capMode,
            points: clampInt(capPoints, pointsToWin + 1, 99),
          };
    try {
      await update({
        tourId: tour?._id,
        minRosterSize: minRoster,
        maxRosterSize: maxRoster,
        slots: slots.map((s, i) => ({ ...s, order: i })),
        pointsToWin,
        winByTwo,
        cap,
        rallyScoring,
        dreamBreaker: {
          enabled: dbEnabled,
          pointsToWin: dbPointsToWin,
          rotationEveryPoints: dbRotate,
          winByTwo: dbWinByTwo,
        },
      }).unwrap();
      toast.success("Đã lưu cấu hình MLP");
      onSaved?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.data?.message || "Lưu thất bại");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Cấu hình MLP</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            MLP (Major League Pickleball) — team vs team, mỗi trận có nhiều
            sub-match (slot). Cộng dồn số slot thắng để xác định team thắng dual.
            Hoà → DreamBreaker (rotating singles tới {dbPointsToWin} điểm).
          </Alert>

          {/* Roster */}
          <Typography variant="body2" fontWeight={800} sx={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
            Roster team
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              size="small"
              label="Roster tối thiểu"
              type="number"
              value={minRoster}
              onChange={(e) => setMinRoster(clampInt(e.target.value, 1, 30))}
              inputProps={{ min: 1, max: 30 }}
              fullWidth
            />
            <TextField
              size="small"
              label="Roster tối đa"
              type="number"
              value={maxRoster}
              onChange={(e) => setMaxRoster(clampInt(e.target.value, 1, 30))}
              inputProps={{ min: 1, max: 30 }}
              fullWidth
            />
          </Stack>

          <Divider />

          {/* Slots */}
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" fontWeight={800} sx={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
              Sub-matches (slots) — {slots.length}
            </Typography>
            <Button size="small" startIcon={<Plus size={14} />} onClick={addSlot}>
              Thêm slot
            </Button>
          </Stack>
          <Stack spacing={1.5}>
            {slots.map((s, idx) => (
              <Box
                key={idx}
                sx={{
                  p: 1.5,
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 2,
                }}
              >
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <IconButton size="small" disabled sx={{ cursor: "grab" }}>
                    <GripVertical size={16} />
                  </IconButton>
                  <Stack spacing={1} flex={1}>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                      <TextField
                        size="small"
                        label="Key"
                        value={s.key}
                        onChange={(e) =>
                          updateSlot(idx, { key: e.target.value.slice(0, 20) })
                        }
                        sx={{ width: { xs: "100%", sm: 100 } }}
                      />
                      <TextField
                        size="small"
                        label="Tên hiển thị"
                        value={s.label}
                        onChange={(e) =>
                          updateSlot(idx, { label: e.target.value })
                        }
                        fullWidth
                      />
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                      <Select
                        size="small"
                        value={s.matchType}
                        onChange={(e) =>
                          updateSlot(idx, { matchType: e.target.value })
                        }
                        sx={{ width: { xs: "100%", sm: 150 } }}
                      >
                        <MenuItem value="single">Đơn</MenuItem>
                        <MenuItem value="double">Đôi</MenuItem>
                      </Select>
                      <Select
                        size="small"
                        value={s.genderRule}
                        onChange={(e) =>
                          updateSlot(idx, { genderRule: e.target.value })
                        }
                        fullWidth
                      >
                        {Object.entries(GENDER_LABEL).map(([k, v]) => (
                          <MenuItem key={k} value={k}>
                            {v}
                          </MenuItem>
                        ))}
                      </Select>
                    </Stack>
                  </Stack>
                  <Stack spacing={0.5}>
                    <IconButton
                      size="small"
                      onClick={() => moveSlot(idx, -1)}
                      disabled={idx === 0}
                    >
                      ▲
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => moveSlot(idx, 1)}
                      disabled={idx === slots.length - 1}
                    >
                      ▼
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => removeSlot(idx)}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </Stack>
                </Stack>
              </Box>
            ))}
          </Stack>

          <Divider />

          {/* Scoring */}
          <Typography variant="body2" fontWeight={800} sx={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
            Luật tính điểm (cho mọi sub-match)
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Select
              size="small"
              value={pointsToWin}
              onChange={(e) => setPointsToWin(Number(e.target.value))}
              fullWidth
            >
              <MenuItem value={11}>Chạm 11</MenuItem>
              <MenuItem value={15}>Chạm 15</MenuItem>
              <MenuItem value={21}>Chạm 21</MenuItem>
            </Select>
            <FormControlLabel
              control={
                <Switch
                  checked={winByTwo}
                  onChange={(e) => setWinByTwo(e.target.checked)}
                />
              }
              label="Cách 2"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={rallyScoring}
                  onChange={(e) => setRallyScoring(e.target.checked)}
                />
              }
              label="Rally scoring"
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <Select
              size="small"
              value={capMode}
              onChange={(e) => setCapMode(e.target.value)}
              fullWidth
            >
              <MenuItem value="none">Không cap</MenuItem>
              <MenuItem value="hard">Cap cứng</MenuItem>
              <MenuItem value="soft">Cap mềm</MenuItem>
            </Select>
            {capMode !== "none" && (
              <TextField
                size="small"
                label="Điểm cap"
                type="number"
                value={capPoints}
                onChange={(e) => setCapPoints(e.target.value)}
                inputProps={{ min: pointsToWin + 1, max: 99 }}
                sx={{ width: 140 }}
              />
            )}
          </Stack>

          <Divider />

          {/* DreamBreaker */}
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" fontWeight={800} sx={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
              DreamBreaker (tiebreaker singles)
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={dbEnabled}
                  onChange={(e) => setDbEnabled(e.target.checked)}
                />
              }
              label="Bật"
            />
          </Stack>
          {dbEnabled && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                size="small"
                label="Điểm tới"
                type="number"
                value={dbPointsToWin}
                onChange={(e) =>
                  setDbPointsToWin(clampInt(e.target.value, 1, 99))
                }
                sx={{ width: 120 }}
              />
              <TextField
                size="small"
                label="Rotate mỗi N điểm"
                type="number"
                value={dbRotate}
                onChange={(e) => setDbRotate(clampInt(e.target.value, 1, 21))}
                sx={{ width: 160 }}
                helperText="MLP chuẩn = 4"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={dbWinByTwo}
                    onChange={(e) => setDbWinByTwo(e.target.checked)}
                  />
                }
                label="Cách 2 (MLP chuẩn = tắt)"
              />
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isLoading}>
          Huỷ
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={isLoading}>
          {isLoading ? "Đang lưu..." : "Lưu cấu hình"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

MlpConfigDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  tour: PropTypes.object,
  onSaved: PropTypes.func,
};
