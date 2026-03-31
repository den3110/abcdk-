import { memo } from "react";
import PropTypes from "prop-types";
import {
  alpha,
  Chip,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import { AutoAwesomeRounded } from "@mui/icons-material";

import { PaletteIconBadge, paletteItemShape } from "./shared.jsx";

const PaletteResultRow = memo(function PaletteResultRow({
  item,
  selected,
  onMouseEnter,
  onClick,
  t,
}) {
  const scopeLabel = t(`commandPalette.scopes.${item.scope}`);

  return (
    <ListItemButton
      selected={selected}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      sx={{
        borderRadius: 2.75,
        alignItems: "flex-start",
        px: 1.25,
        py: 1.1,
        mb: 0.5,
        border: "1px solid transparent",
        "&.Mui-selected": {
          borderColor: (theme) => alpha(theme.palette.primary.main, 0.22),
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
        },
      }}
    >
      <ListItemIcon sx={{ minWidth: 48, mt: 0.25 }}>
        <PaletteIconBadge iconKey={item.iconKey} color={item.color || "#1759cf"} />
      </ListItemIcon>
      <ListItemText
        sx={{ minWidth: 0, my: 0 }}
        primary={
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            justifyContent="space-between"
            useFlexGap
            flexWrap="wrap"
            sx={{ minWidth: 0 }}
          >
            <Typography
              variant="body1"
              sx={{
                fontWeight: 700,
                minWidth: 0,
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.title}
            </Typography>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
              {item.isAiPrimary ? (
                <Chip
                  size="small"
                  icon={<AutoAwesomeRounded sx={{ fontSize: 16 }} />}
                  label={t("commandPalette.badges.ai")}
                  sx={{
                    height: 22,
                    fontWeight: 800,
                    bgcolor: (theme) => alpha(theme.palette.secondary.main, 0.14),
                    color: "secondary.main",
                  }}
                />
              ) : null}
              {item.isPinned ? (
                <Chip
                  size="small"
                  label={t("commandPalette.badges.pinned")}
                  sx={{
                    height: 22,
                    fontWeight: 700,
                    bgcolor: (theme) => alpha(theme.palette.warning.main, 0.16),
                    color: "warning.dark",
                  }}
                />
              ) : null}
              {item.isSuggested ? (
                <Chip
                  size="small"
                  label={t("commandPalette.badges.suggested")}
                  sx={{
                    height: 22,
                    fontWeight: 700,
                    bgcolor: (theme) => alpha(theme.palette.success.main, 0.14),
                    color: "success.dark",
                  }}
                />
              ) : null}
              {item.isRecent ? (
                <Chip
                  size="small"
                  label={t("commandPalette.badges.recent")}
                  sx={{ height: 22, fontWeight: 700 }}
                />
              ) : null}
              {item.isContextual ? (
                <Chip
                  size="small"
                  label={t("commandPalette.badges.context")}
                  sx={{
                    height: 22,
                    fontWeight: 700,
                    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                    color: "primary.main",
                  }}
                />
              ) : (
                <Chip
                  size="small"
                  label={scopeLabel}
                  sx={{ height: 22, fontWeight: 700 }}
                />
              )}
            </Stack>
          </Stack>
        }
        secondary={
          <Stack spacing={0.4} sx={{ mt: 0.5 }}>
            {item.subtitle ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  display: "-webkit-box",
                  WebkitLineClamp: 1,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {item.subtitle}
              </Typography>
            ) : null}
            {item.description ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {item.description}
              </Typography>
            ) : null}
          </Stack>
        }
      />
    </ListItemButton>
  );
});

PaletteResultRow.propTypes = {
  item: paletteItemShape.isRequired,
  selected: PropTypes.bool.isRequired,
  onMouseEnter: PropTypes.func.isRequired,
  onClick: PropTypes.func.isRequired,
  t: PropTypes.func.isRequired,
};

export default PaletteResultRow;
