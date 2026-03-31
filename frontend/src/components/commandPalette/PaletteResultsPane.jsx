import { Fragment, memo } from "react";
import PropTypes from "prop-types";
import {
  alpha,
  Box,
  Chip,
  Divider,
  List,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import { SearchRounded } from "@mui/icons-material";

import PaletteResultPreview from "./PaletteResultPreview.jsx";
import PaletteResultRow from "./PaletteResultRow.jsx";
import { paletteItemShape } from "./shared.jsx";

const groupShape = PropTypes.shape({
  key: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  items: PropTypes.arrayOf(paletteItemShape).isRequired,
});

const PaletteResultsPane = memo(function PaletteResultsPane({
  hasSearchIntent,
  results,
  discoveryGroups,
  selectedIndex,
  selectedItem,
  selectedItemIsPinned,
  emptySuggestedPrompts,
  itemRefs,
  resultsScrollRef,
  isDark,
  onScroll,
  onHoverSelect,
  onActivateItem,
  onSelectPrompt,
  onTogglePin,
  onCopyLink,
  onOpenLink,
  t,
}) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr",
          md: "minmax(0, 1.22fr) minmax(380px, 430px)",
        },
        minHeight: 0,
        flex: 1,
        overflow: "hidden",
      }}
    >
      <Box
        ref={resultsScrollRef}
        onScroll={onScroll}
        sx={{
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          scrollbarGutter: "stable",
          px: { xs: 1, md: 1.5 },
          py: 1,
        }}
      >
        {hasSearchIntent ? (
          results.length ? (
            <List disablePadding>
              {results.map((item, index) => (
                <Box
                  key={item.id}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                >
                  <PaletteResultRow
                    item={item}
                    selected={index === selectedIndex}
                    onMouseEnter={() => onHoverSelect(index)}
                    onClick={() => onActivateItem(item)}
                    t={t}
                  />
                </Box>
              ))}
            </List>
          ) : (
            <Stack
              spacing={1.25}
              alignItems="center"
              justifyContent="center"
              sx={{ minHeight: 320, textAlign: "center", px: 3 }}
            >
              <Box
                sx={{
                  width: 68,
                  height: 68,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  color: "primary.main",
                }}
              >
                <SearchRounded sx={{ fontSize: 34 }} />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {t("commandPalette.empty.title")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("commandPalette.empty.body")}
              </Typography>
              {emptySuggestedPrompts.length ? (
                <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                  {emptySuggestedPrompts.map((prompt) => (
                    <Chip
                      key={prompt}
                      clickable
                      variant="outlined"
                      label={prompt}
                      onClick={() => onSelectPrompt(prompt)}
                    />
                  ))}
                </Stack>
              ) : null}
            </Stack>
          )
        ) : (
          <Stack spacing={1.75}>
            {discoveryGroups.map((group, groupIndex) => (
              <Fragment key={group.key}>
                {groupIndex > 0 ? <Divider /> : null}
                <Box sx={{ px: 0.75, pt: groupIndex === 0 ? 0.75 : 0 }}>
                  <Typography
                    variant="overline"
                    color="text.secondary"
                    sx={{ fontWeight: 800, letterSpacing: "0.08em" }}
                  >
                    {group.label}
                  </Typography>
                  <List disablePadding sx={{ mt: 0.5 }}>
                    {group.items.map((item, localIndex) => {
                      const flatIndex =
                        discoveryGroups
                          .slice(0, groupIndex)
                          .reduce((total, current) => total + current.items.length, 0) +
                        localIndex;

                      return (
                        <Box
                          key={item.id}
                          ref={(node) => {
                            itemRefs.current[flatIndex] = node;
                          }}
                        >
                          <PaletteResultRow
                            item={item}
                            selected={flatIndex === selectedIndex}
                            onMouseEnter={() => onHoverSelect(flatIndex)}
                            onClick={() => onActivateItem(item)}
                            t={t}
                          />
                        </Box>
                      );
                    })}
                  </List>
                </Box>
              </Fragment>
            ))}
          </Stack>
        )}
      </Box>

      <Box
        sx={{
          display: { xs: "none", md: "block" },
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          scrollbarGutter: "stable",
          borderLeft: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
          p: 2,
          bgcolor: alpha(theme.palette.background.paper, isDark ? 0.36 : 0.72),
        }}
      >
        <PaletteResultPreview
          item={selectedItem}
          t={t}
          isPinned={selectedItemIsPinned}
          onTogglePin={onTogglePin}
          onCopyLink={onCopyLink}
          onOpenInNewTab={onOpenLink}
        />
      </Box>
    </Box>
  );
});

PaletteResultsPane.propTypes = {
  hasSearchIntent: PropTypes.bool,
  results: PropTypes.arrayOf(paletteItemShape),
  discoveryGroups: PropTypes.arrayOf(groupShape),
  selectedIndex: PropTypes.number,
  selectedItem: paletteItemShape,
  selectedItemIsPinned: PropTypes.bool,
  emptySuggestedPrompts: PropTypes.arrayOf(PropTypes.string),
  itemRefs: PropTypes.shape({ current: PropTypes.any }).isRequired,
  resultsScrollRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  isDark: PropTypes.bool,
  onScroll: PropTypes.func,
  onHoverSelect: PropTypes.func.isRequired,
  onActivateItem: PropTypes.func.isRequired,
  onSelectPrompt: PropTypes.func.isRequired,
  onTogglePin: PropTypes.func,
  onCopyLink: PropTypes.func,
  onOpenLink: PropTypes.func,
  t: PropTypes.func.isRequired,
};

PaletteResultsPane.defaultProps = {
  hasSearchIntent: false,
  results: [],
  discoveryGroups: [],
  selectedIndex: 0,
  selectedItem: null,
  selectedItemIsPinned: false,
  emptySuggestedPrompts: [],
  isDark: false,
  onScroll: undefined,
  onTogglePin: undefined,
  onCopyLink: undefined,
  onOpenLink: undefined,
};

export default PaletteResultsPane;
