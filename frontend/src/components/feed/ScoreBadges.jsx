// 2 chip Đơn (blue) + Đôi (pink) hiện cạnh tên user
import { Chip, Stack } from "@mui/material";

const fmt = (v) => (v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, ""));

export default function ScoreBadges({ single, double, size = "small" }) {
  const s = Number(single || 0);
  const d = Number(double || 0);
  if (!s && !d) return null;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {s > 0 && (
        <Chip
          label={`Đơn ${fmt(s)}`}
          size={size}
          sx={{
            height: 20,
            fontSize: 11,
            fontWeight: 800,
            backgroundColor: "#DBEAFE",
            color: "#1D4ED8",
            "& .MuiChip-label": { px: 0.75 },
          }}
        />
      )}
      {d > 0 && (
        <Chip
          label={`Đôi ${fmt(d)}`}
          size={size}
          sx={{
            height: 20,
            fontSize: 11,
            fontWeight: 800,
            backgroundColor: "#FCE7F3",
            color: "#BE185D",
            "& .MuiChip-label": { px: 0.75 },
          }}
        />
      )}
    </Stack>
  );
}
