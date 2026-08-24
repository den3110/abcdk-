import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import CampaignIcon from "@mui/icons-material/Campaign";
import { useSendGlobalBroadcastMutation } from "../../slices/broadcastApiSlice";

export default function BroadcastPage() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState("all");
  const [platform, setPlatform] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const [sendBroadcast, { isLoading }] = useSendGlobalBroadcastMutation();

  const canSend = title.trim().length > 0 && body.trim().length > 0 && !isLoading;

  const onSend = async () => {
    setError("");
    setResult(null);
    try {
      const payload = {
        scope,
        title: title.trim(),
        body: body.trim(),
      };
      if (url.trim()) payload.url = url.trim();
      if (platform) payload.platform = platform;
      const res = await sendBroadcast(payload).unwrap();
      setResult(res);
      // Xoá nội dung sau khi gửi thành công để tránh gửi trùng.
      setTitle("");
      setBody("");
      setUrl("");
    } catch (e) {
      setError(
        e?.data?.message || e?.error || "Gửi thông báo thất bại. Vui lòng thử lại."
      );
    }
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <CampaignIcon />
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Gửi thông báo (Broadcast)
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Gửi thông báo đẩy (push notification) tới toàn bộ người dùng đã cài ứng
        dụng. Hãy kiểm tra kỹ nội dung trước khi gửi — thao tác này không thể thu
        hồi.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2.5, maxWidth: 640 }}>
        <Stack spacing={2}>
          <TextField
            label="Tiêu đề"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            required
            inputProps={{ maxLength: 120 }}
            helperText={`${title.length}/120`}
          />
          <TextField
            label="Nội dung"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            fullWidth
            required
            multiline
            minRows={3}
            inputProps={{ maxLength: 500 }}
            helperText={`${body.length}/500`}
          />
          <TextField
            label="Link mở khi bấm (tuỳ chọn)"
            placeholder="https://... hoặc /tournament/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            fullWidth
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="scope-label">Phạm vi</InputLabel>
              <Select
                labelId="scope-label"
                label="Phạm vi"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <MenuItem value="all">Tất cả thiết bị</MenuItem>
                <MenuItem value="subscribers">
                  Chỉ người đã đăng ký nhận (global)
                </MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="platform-label">Nền tảng</InputLabel>
              <Select
                labelId="platform-label"
                label="Nền tảng"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
              >
                <MenuItem value="">Tất cả</MenuItem>
                <MenuItem value="ios">iOS</MenuItem>
                <MenuItem value="android">Android</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          {error ? <Alert severity="error">{error}</Alert> : null}
          {result ? (
            <Alert severity="success">
              Đã đưa vào hàng đợi gửi. Mã đợt gửi: {result.dispatchId || "—"}{" "}
              (trạng thái: {result.status || "queued"}).
            </Alert>
          ) : null}

          <Box>
            <Button
              variant="contained"
              startIcon={
                isLoading ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <SendIcon />
                )
              }
              disabled={!canSend}
              onClick={onSend}
            >
              {isLoading ? "Đang gửi…" : "Gửi thông báo"}
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
