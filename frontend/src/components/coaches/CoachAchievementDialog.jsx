// components/coaches/CoachAchievementDialog.jsx
// Dialog HLV tự bổ sung 1 thành tích mới (pending, chờ admin duyệt).
import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { toast } from "react-toastify";
import { useCreateCoachAchievementMutation } from "../../slices/coachesApiSlice.js";

const LEVEL_LABEL = {
  national: "Quốc gia",
  regional: "Khu vực",
  local: "Địa phương",
  club: "CLB",
  other: "Khác",
};

export default function CoachAchievementDialog({ open, onClose, coachId }) {
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [level, setLevel] = useState("other");
  const [description, setDescription] = useState("");
  const [createMut, { isLoading }] = useCreateCoachAchievementMutation();

  const reset = () => {
    setTitle("");
    setYear("");
    setLevel("other");
    setDescription("");
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Vui lòng nhập tiêu đề");
      return;
    }
    try {
      await createMut({
        __coachId: coachId, // dùng cho invalidatesTags
        title: title.trim(),
        year: year ? Number(year) : undefined,
        level,
        description: description.trim(),
      }).unwrap();
      toast.success("Đã gửi thành tích — chờ admin duyệt");
      reset();
      onClose?.();
    } catch (err) {
      toast.error(err?.data?.message || "Gửi thất bại");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Bổ sung thành tích</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            Thành tích sẽ ở trạng thái <b>chờ duyệt</b>. Admin sẽ xem xét và
            duyệt trong thời gian sớm nhất.
          </Alert>
          <TextField
            label="Tên thành tích *"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            inputProps={{ maxLength: 200 }}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Năm"
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              inputProps={{ min: 1900, max: 2100 }}
              sx={{ width: 140 }}
            />
            <Select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              fullWidth
            >
              {Object.entries(LEVEL_LABEL).map(([k, v]) => (
                <MenuItem key={k} value={k}>
                  {v}
                </MenuItem>
              ))}
            </Select>
          </Stack>
          <TextField
            label="Mô tả (tuỳ chọn)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={3}
            inputProps={{ maxLength: 1000 }}
          />
          <Typography variant="caption" color="text.secondary">
            Gợi ý: mô tả rõ vai trò của bạn (HLV chính, đồng HLV), số học viên,
            và giải/nội dung cụ thể.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Huỷ</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={isLoading || !title.trim()}
        >
          {isLoading ? "Đang gửi..." : "Gửi"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
