// components/coaches/CoachApplicationDialog.jsx
// Form đăng ký làm Huấn luyện viên. Cho user điền headline/experience/
// specialties + list thành tích proposed. Admin sẽ duyệt.
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "react-toastify";
import { useApplyToBeCoachMutation } from "../../slices/coachesApiSlice.js";

const EMPTY_ACH = { title: "", year: "", level: "other", description: "" };
const LEVEL_LABEL = {
  national: "Quốc gia",
  regional: "Khu vực",
  local: "Địa phương",
  club: "CLB",
  other: "Khác",
};

export default function CoachApplicationDialog({ open, onClose, onSubmitted }) {
  const [headline, setHeadline] = useState("");
  const [experienceYears, setExperienceYears] = useState("");
  const [specialtyInput, setSpecialtyInput] = useState("");
  const [specialties, setSpecialties] = useState([]);
  const [hourlyRate, setHourlyRate] = useState("");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [achievements, setAchievements] = useState([{ ...EMPTY_ACH }]);
  const [apply, { isLoading }] = useApplyToBeCoachMutation();

  const addSpecialty = () => {
    const s = specialtyInput.trim();
    if (!s || specialties.includes(s)) return;
    setSpecialties([...specialties, s]);
    setSpecialtyInput("");
  };
  const removeSpecialty = (s) =>
    setSpecialties(specialties.filter((x) => x !== s));

  const updateAch = (idx, patch) =>
    setAchievements(
      achievements.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
    );
  const addAch = () => setAchievements([...achievements, { ...EMPTY_ACH }]);
  const removeAch = (idx) =>
    setAchievements(achievements.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (!headline.trim()) {
      toast.error("Vui lòng nhập tiêu đề (headline)");
      return;
    }
    const cleanedAch = achievements
      .filter((a) => a.title.trim())
      .map((a) => ({
        title: a.title.trim(),
        year: a.year ? Number(a.year) : undefined,
        level: a.level || "other",
        description: a.description?.trim() || "",
      }));
    try {
      await apply({
        headline: headline.trim(),
        experienceYears: Number(experienceYears) || 0,
        specialties,
        hourlyRate: Number(hourlyRate) || 0,
        bio: bio.trim(),
        phone: phone.trim(),
        note: note.trim(),
        achievements: cleanedAch,
      }).unwrap();
      toast.success("Đã gửi đơn đăng ký — chờ admin duyệt");
      onSubmitted?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.data?.message || "Gửi đơn thất bại");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Đăng ký làm Huấn luyện viên</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            Điền thông tin đầy đủ để admin duyệt. Sau khi được duyệt, hồ sơ của
            bạn sẽ xuất hiện trong danh sách HLV công khai.
          </Alert>

          <TextField
            label="Headline (giới thiệu ngắn) *"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            inputProps={{ maxLength: 200 }}
            helperText="VD: 'HLV Pickleball 8 năm kinh nghiệm, chuyên chấm trình 3.0-4.5'"
            fullWidth
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Số năm kinh nghiệm"
              type="number"
              value={experienceYears}
              onChange={(e) => setExperienceYears(e.target.value)}
              inputProps={{ min: 0, max: 100 }}
              fullWidth
            />
            <TextField
              label="Giá / giờ (VNĐ, không bắt buộc)"
              type="number"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              inputProps={{ min: 0 }}
              fullWidth
            />
            <TextField
              label="Số điện thoại liên hệ"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              fullWidth
            />
          </Stack>

          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
              Chuyên môn (specialties)
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              {specialties.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  onDelete={() => removeSpecialty(s)}
                  size="small"
                />
              ))}
              {specialties.length === 0 && (
                <Typography variant="caption" color="text.secondary">
                  Chưa có
                </Typography>
              )}
            </Stack>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                value={specialtyInput}
                onChange={(e) => setSpecialtyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSpecialty();
                  }
                }}
                placeholder="VD: 'Kỹ thuật đôi', 'Chấm trình 3.0-4.0'…"
                fullWidth
              />
              <Button variant="outlined" onClick={addSpecialty} size="small">
                Thêm
              </Button>
            </Stack>
          </Box>

          <TextField
            label="Giới thiệu thêm (bio)"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            multiline
            minRows={3}
            inputProps={{ maxLength: 2000 }}
          />

          <Box>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 1 }}
            >
              <Typography variant="body2" fontWeight={700}>
                Thành tích đã đạt được
              </Typography>
              <Button
                startIcon={<Plus size={16} />}
                size="small"
                onClick={addAch}
              >
                Thêm thành tích
              </Button>
            </Stack>
            <Stack spacing={1.5}>
              {achievements.map((a, idx) => (
                <Box
                  key={idx}
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    border: 1,
                    borderColor: "divider",
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <Stack spacing={1} flex={1}>
                      <TextField
                        size="small"
                        label="Tên thành tích"
                        value={a.title}
                        onChange={(e) =>
                          updateAch(idx, { title: e.target.value })
                        }
                        fullWidth
                      />
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <TextField
                          size="small"
                          label="Năm"
                          type="number"
                          value={a.year}
                          onChange={(e) =>
                            updateAch(idx, { year: e.target.value })
                          }
                          inputProps={{ min: 1900, max: 2100 }}
                          sx={{ width: { xs: "100%", sm: 120 } }}
                        />
                        <Select
                          size="small"
                          value={a.level || "other"}
                          onChange={(e) =>
                            updateAch(idx, { level: e.target.value })
                          }
                          sx={{ width: { xs: "100%", sm: 180 } }}
                        >
                          {Object.entries(LEVEL_LABEL).map(([k, v]) => (
                            <MenuItem key={k} value={k}>
                              {v}
                            </MenuItem>
                          ))}
                        </Select>
                      </Stack>
                      <TextField
                        size="small"
                        label="Mô tả (tuỳ chọn)"
                        value={a.description}
                        onChange={(e) =>
                          updateAch(idx, { description: e.target.value })
                        }
                        multiline
                        minRows={1}
                        maxRows={3}
                      />
                    </Stack>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => removeAch(idx)}
                      disabled={achievements.length === 1}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </Stack>
                </Box>
              ))}
            </Stack>
          </Box>

          <TextField
            label="Ghi chú gửi admin (tuỳ chọn)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            minRows={2}
            inputProps={{ maxLength: 1000 }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Huỷ</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={isLoading || !headline.trim()}
        >
          {isLoading ? "Đang gửi..." : "Gửi đơn"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
