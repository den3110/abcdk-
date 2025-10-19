import React from "react";
import {
  Card,
  Box,
  Stack,
  Typography,
  Chip,
  Button,
  IconButton,
  Tooltip,
  Divider,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import YouTubeIcon from "@mui/icons-material/YouTube";
import FacebookIcon from "@mui/icons-material/Facebook";
import VideocamIcon from "@mui/icons-material/Videocam";

function timeAgo(date) {
  if (!date) return "";
  const d = new Date(date);
  const diff = Math.max(0, Date.now() - d.getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s trước`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h trước`;
  const day = Math.floor(hr / 24);
  return `${day}d trước`;
}

const providerMeta = (provider) => {
  switch (provider) {
    case "youtube":
      return { label: "YouTube", icon: <YouTubeIcon />, color: "error" }; // đỏ hợp mắt
    case "facebook":
      return { label: "Facebook", icon: <FacebookIcon />, color: "primary" }; // xanh MUI gần brand
    default:
      return {
        label: provider || "Stream",
        icon: <VideocamIcon />,
        color: "secondary",
      };
  }
};

const byPriority = (a, b) => {
  const order = { youtube: 1, facebook: 2 };
  const pa = order[a.provider] || 99;
  const pb = order[b.provider] || 99;
  return pa - pb;
};

export default function LiveMatchCard({ item }) {
  const m = item?.match || {};
  const sessionsAll = Array.isArray(item?.sessions) ? item.sessions : [];

  // Chỉ quan tâm phiên đã verify
  const sessions = sessionsAll
    .filter((s) => s.platformVerified && s.watchUrl)
    .sort(byPriority);
  const primary = sessions[0] || null;
  const secondary = sessions.slice(1);

  const isLive = sessions.length > 0;
  const hasAny = sessionsAll.length > 0;

  const copy = async (txt) => {
    try {
      await navigator.clipboard.writeText(txt);
    } catch {}
  };

  const bullet = (
    <Box component="span" sx={{ mx: 1, color: "text.disabled" }}>
      •
    </Box>
  );

  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 2,
        overflow: "hidden",
        "&:hover": { boxShadow: 3, borderColor: "divider" },
      }}
    >
      {/* Header gọn */}
      <Box sx={{ p: 2, pb: 1.5 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
        >
          <Typography variant="subtitle1" fontWeight={700} noWrap>
            {m.labelKey || m.code || "Match"}
          </Typography>

          {/* Chip trạng thái */}
          {isLive ? (
            <Chip
              label="LIVE"
              color="error"
              size="small"
              sx={{ fontWeight: 700 }}
            />
          ) : hasAny ? (
            <Chip label="Chuẩn bị" color="warning" size="small" />
          ) : (
            <Chip label="-" size="small" variant="outlined" />
          )}
        </Stack>

        {/* Meta ngắn gọn */}
        <Typography
          variant="body2"
          color="text.secondary"
          noWrap
          sx={{ mt: 0.5 }}
        >
          {m.status ? `Trạng thái: ${m.status}` : "-"}
          {m.courtLabel && (
            <>
              {bullet}Sân: {m.courtLabel}
            </>
          )}
          {m.updatedAt && (
            <>
              {bullet}Cập nhật {timeAgo(m.updatedAt)}
            </>
          )}
        </Typography>
      </Box>

      <Divider />

      {/* Nội dung: CTA chính + nút phụ */}
      <Box
        sx={{
          p: 2,
          pt: 1.5,
          display: "flex",
          flexDirection: "column",
          gap: 1.25,
        }}
      >
        {/* Nút chính */}
        {primary ? (
          <Stack direction="row" alignItems="center" spacing={1}>
            <Button
              fullWidth
              variant="contained"
              color={providerMeta(primary.provider).color}
              startIcon={providerMeta(primary.provider).icon}
              endIcon={<OpenInNewIcon />}
              href={primary.watchUrl}
              target="_blank"
              rel="noreferrer"
              sx={{ textTransform: "none", fontWeight: 700 }}
            >
              Xem trên {providerMeta(primary.provider).label}
            </Button>

            <Tooltip title="Copy link">
              <IconButton
                color="default"
                onClick={() => copy(primary.watchUrl)}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Chưa có phiên live đã xác minh.
          </Typography>
        )}

        {/* Nút phụ (nếu có nhiều platform) */}
        {secondary.length > 0 && (
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {secondary.map((s, i) => {
              const meta = providerMeta(s.provider);
              return (
                <Button
                  key={i}
                  variant="outlined"
                  color={meta.color}
                  startIcon={meta.icon}
                  href={s.watchUrl}
                  target="_blank"
                  rel="noreferrer"
                  size="small"
                  sx={{ textTransform: "none" }}
                >
                  {meta.label}
                </Button>
              );
            })}
          </Stack>
        )}
      </Box>
    </Card>
  );
}
