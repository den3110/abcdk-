import { Avatar } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";

/**
 * Reusable placeholder avatar — uses MUI Person icon, respects theme.
 *
 * @param {string}  [src]    - Avatar image URL (renders normal Avatar if truthy)
 * @param {number}  [size]   - Width & height in px (default 40)
 * @param {object}  [sx]     - Extra MUI sx overrides
 * @param {object}  rest     - Forwarded to MUI <Avatar>
 */
export default function PlaceholderAvatar({ src, size = 40, sx, ...rest }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  if (src) {
    return (
      <Avatar
        src={src}
        sx={{ width: size, height: size, ...sx }}
        {...rest}
      />
    );
  }

  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        bgcolor: isDark ? alpha("#ffffff", 0.08) : alpha("#000000", 0.06),
        color: isDark ? alpha("#ffffff", 0.32) : alpha("#000000", 0.26),
        ...sx,
      }}
      {...rest}
    >
      <PersonRoundedIcon sx={{ fontSize: size * 0.55 }} />
    </Avatar>
  );
}

/** Constant for legacy code that needs a fallback string (e.g. onError handlers) */
PlaceholderAvatar.FALLBACK_SRC = "";
