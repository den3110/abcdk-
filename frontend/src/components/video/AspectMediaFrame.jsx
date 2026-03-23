/* eslint-disable react/prop-types, react-refresh/only-export-components */
import { Box } from "@mui/material";

const supportsAspectRatio =
  typeof CSS !== "undefined" && typeof CSS.supports === "function"
    ? CSS.supports("aspect-ratio", "1 / 1")
    : false;

export function resolveAspectRatio(value, fallback = 16 / 9) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    const direct = Number(normalized);
    if (Number.isFinite(direct) && direct > 0) {
      return direct;
    }

    const match = normalized.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
    if (match) {
      const width = Number(match[1]);
      const height = Number(match[2]);
      if (width > 0 && height > 0) {
        return width / height;
      }
    }
  }

  return fallback;
}

export default function AspectMediaFrame({
  ratio = 16 / 9,
  children,
  sx,
  borderRadius = 1,
  bgcolor = "black",
}) {
  const resolvedRatio = resolveAspectRatio(ratio);
  const paddingTop = resolvedRatio > 0 ? (1 / resolvedRatio) * 100 : 56.25;

  return (
    <Box
      sx={[
        {
          position: "relative",
          width: "100%",
          ...(supportsAspectRatio
            ? { aspectRatio: `${resolvedRatio}` }
            : { pt: `${paddingTop}%` }),
          bgcolor,
          borderRadius,
          overflow: "hidden",
        },
        sx,
      ]}
    >
      <Box sx={{ position: "absolute", inset: 0 }}>{children}</Box>
    </Box>
  );
}
