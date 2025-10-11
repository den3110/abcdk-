// components/admin/matches/MatchRowActions.jsx
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  Stack,
  IconButton,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

import { useCreateFacebookLiveForMatchMutation } from "../slices/adminMatchLiveApiSlice.js";

export default function MatchRowActions({ match }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);

  const [createLive, { isLoading }] = useCreateFacebookLiveForMatchMutation();

  const prefillFromMatch = () => {
    const fb = match?.facebookLive || {};
    // Nếu BE đã lưu sẵn các trường server_url/stream_key/permalink_url thì dùng lại
    const hasAny =
      fb.server_url ||
      fb.stream_key ||
      fb.permalink_url ||
      fb.secure_stream_url;
    if (hasAny) {
      setData((prev) => ({
        // ưu tiên state cũ nếu đã có (để không mất overlay_url do BE không lưu)
        ...(prev || {}),
        server_url: fb.server_url || (prev && prev.server_url) || "",
        stream_key: fb.stream_key || (prev && prev.stream_key) || "",
        // nếu chỉ có secure_stream_url mà không tách sẵn, cứ hiển thị thô để user copy (OBS vẫn hiểu)
        secure_stream_url:
          fb.secure_stream_url || (prev && prev.secure_stream_url) || "",
        permalink_url: fb.permalink_url || (prev && prev.permalink_url) || "",
        overlay_url: (prev && prev.overlay_url) || "", // fallback nếu BE chưa lưu overlay_url
      }));
    }
  };

  const handleLive = async () => {
    try {
      const res = await createLive(match._id).unwrap();
      setData(res);
      setOpen(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenPopupOnly = () => {
    // chỉ mở popup, không gọi API; cố gắng điền dữ liệu từ match.facebookLive nếu có
    if (!data) prefillFromMatch();
    setOpen(true);
  };

  const copy = (v) => navigator.clipboard.writeText(v || "");

  return (
    <>
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          startIcon={<LiveTvIcon />}
          disabled={isLoading}
          onClick={handleLive}
          variant="outlined"
        >
          {isLoading ? "Đang tạo…" : "LIVE"}
        </Button>

        <Button
          size="small"
          startIcon={<InfoOutlinedIcon />}
          onClick={handleOpenPopupOnly}
          variant="text"
          title="Mở popup LIVE (không tạo mới)"
        >
          Mở popup LIVE
        </Button>
      </Stack>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Facebook LIVE (Match #{match?.code || match?._id.slice(-5)})
        </DialogTitle>
        <DialogContent>
          {data && (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              {/* Nếu có secure_stream_url nhưng không có server_url/stream_key, vẫn hiển thị riêng để copy nhanh */}
              {data.secure_stream_url &&
                !(data.server_url || data.stream_key) && (
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <TextField
                      fullWidth
                      label="Secure Stream URL (RTMPS)"
                      value={data.secure_stream_url}
                      InputProps={{ readOnly: true }}
                    />
                    <IconButton onClick={() => copy(data.secure_stream_url)}>
                      <ContentCopyIcon />
                    </IconButton>
                  </Stack>
                )}

              {data.server_url && (
                <Stack direction="row" alignItems="center" spacing={1}>
                  <TextField
                    fullWidth
                    label="Server URL (RTMPS)"
                    value={data.server_url || ""}
                    InputProps={{ readOnly: true }}
                  />
                  <IconButton onClick={() => copy(data.server_url)}>
                    <ContentCopyIcon />
                  </IconButton>
                </Stack>
              )}

              {data.stream_key && (
                <Stack direction="row" alignItems="center" spacing={1}>
                  <TextField
                    fullWidth
                    label="Stream Key"
                    value={data.stream_key || ""}
                    InputProps={{ readOnly: true }}
                  />
                  <IconButton onClick={() => copy(data.stream_key)}>
                    <ContentCopyIcon />
                  </IconButton>
                </Stack>
              )}

              <Stack direction="row" alignItems="center" spacing={1}>
                <TextField
                  fullWidth
                  label="Overlay URL (Browser Source)"
                  value={data.overlay_url || ""}
                  InputProps={{ readOnly: true }}
                />
                <IconButton onClick={() => copy(data.overlay_url)}>
                  <ContentCopyIcon />
                </IconButton>
              </Stack>

              {data.permalink_url && (
                <Stack direction="row" spacing={1}>
                  <Button
                    startIcon={<OpenInNewIcon />}
                    href={data.permalink_url}
                    target="_blank"
                  >
                    Mở trang Live
                  </Button>
                  {data.studio_url && (
                    <Button
                      startIcon={<OpenInNewIcon />}
                      href={data.studio_url}
                      target="_blank"
                    >
                      Mở Studio (Web)
                    </Button>
                  )}
                </Stack>
              )}
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
