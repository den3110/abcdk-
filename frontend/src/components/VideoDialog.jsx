// src/pages/admin/parts/VideoDialog.jsx
/* eslint-disable react/prop-types */
import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Typography,
} from "@mui/material";

const VideoDialog = React.memo(function VideoDialog({
  open,
  match,
  initialUrl = "",
  onCancel,
  onSave, // (url) => void
  saving = false,
  getMatchCode = (m) => m?.code || "—",
}) {
  const [url, setUrl] = useState(initialUrl);

  // reset khi mở dialog hoặc đổi trận
  useEffect(() => {
    if (open) setUrl(initialUrl || "");
  }, [open, initialUrl, match?._id]);

  const handleSave = () => onSave?.(url || "");

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth keepMounted>
      <DialogTitle>{match ? getMatchCode(match) : ""} — Link video</DialogTitle>
      <DialogContent dividers>
        <TextField
          autoFocus
          label="URL video (YouTube/Facebook/TikTok/M3U8…)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          fullWidth
          placeholder="https://…"
          inputProps={{ inputMode: "url" }}
        />
        <Typography variant="caption" color="text.secondary">
          Dán link live hoặc VOD. Để trống rồi Lưu để xoá link.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Huỷ</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          {saving ? "Đang lưu…" : url ? "Lưu link" : "Xoá link"}
        </Button>
      </DialogActions>
    </Dialog>
  );
});

export default VideoDialog;
