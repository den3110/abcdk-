// src/components/market/StarRating.jsx — hiển thị / chọn số sao
import Box from "@mui/material/Box";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import StarHalfRoundedIcon from "@mui/icons-material/StarHalfRounded";
import StarOutlineRoundedIcon from "@mui/icons-material/StarOutlineRounded";

export default function StarRating({ value = 0, size = 18, onChange, color = "#f59e0b" }) {
  const interactive = typeof onChange === "function";
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((i) => {
        const full = value >= i;
        const half = !full && value >= i - 0.5;
        const Icon = full ? StarRoundedIcon : half ? StarHalfRoundedIcon : StarOutlineRoundedIcon;
        return (
          <Icon
            key={i}
            onClick={interactive ? () => onChange(i) : undefined}
            sx={{
              fontSize: size,
              color: full || half ? color : "text.disabled",
              cursor: interactive ? "pointer" : "default",
            }}
          />
        );
      })}
    </Box>
  );
}
