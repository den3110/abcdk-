/* eslint-disable react/prop-types */
import React from "react";
import PropTypes from "prop-types";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Drawer,
  Box,
  Stack,
  IconButton,
  Divider,
  Typography,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import { Close as CloseIcon } from "@mui/icons-material";

/**
 * ResponsiveModal
 * - Desktop (>= md): MUI Dialog
 * - Mobile (< md): MUI Drawer (mặc định anchor="bottom")
 *
 * Props chính:
 *  - open, onClose
 *  - title (ReactNode), subtitle (ReactNode), icon (ReactNode)
 *  - actions (ReactNode | ReactNode[])
 *  - maxWidth ("xs"|"sm"|"md"|"lg"|"xl") — chỉ áp dụng cho Dialog
 *  - anchor ("bottom"|"right"|"left"|"top") — chỉ áp dụng cho Drawer
 *  - mobileBreakpoint (string MUI, mặc định "md")
 *  - keepMounted (bool, default true)
 *  - paperSx (sx để override Paper cả Dialog/Drawer)
 *  - dialogProps / drawerProps / headerProps / contentProps / actionsProps (pass-through)
 *  - showCloseIcon (bool)
 */
export default function ResponsiveModal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  actions,
  children,

  maxWidth = "md",
  anchor = "bottom",
  mobileBreakpoint = "md",
  keepMounted = true,
  showCloseIcon = true,

  paperSx,
  dialogProps = {},
  drawerProps = {},
  headerProps = {},
  contentProps = {},
  actionsProps = {},
  zIndex,
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down(mobileBreakpoint));
  const rootZIndex =
    typeof zIndex === "number" ? zIndex : (theme.zIndex?.modal ?? 1300) + 10;
  if (isMobile) {
    // MOBILE — Drawer
    const drawerPaperSx = {
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      maxHeight: "85vh",
      width: anchor === "bottom" || anchor === "top" ? "100vw" : "86vw",
      display: "flex",
      flexDirection: "column",
      ...paperSx,
      ...(drawerProps?.PaperProps?.sx || {}),
    };

    return (
      <Drawer
        anchor={anchor}
        open={!!open}
        onClose={onClose}
        sx={{ zIndex: rootZIndex, ...(drawerProps?.sx || {}) }}
        {...drawerProps}
        PaperProps={{
          ...drawerProps.PaperProps,
          sx: drawerPaperSx,
        }}
        ModalProps={{
          ...(drawerProps?.ModalProps || {}),
          // 👇 giữ Backdrop dưới content
          BackdropProps: {
            ...(drawerProps?.ModalProps?.BackdropProps || {}),
            sx: {
              zIndex: -1,
              ...(drawerProps?.ModalProps?.BackdropProps?.sx || {}),
            },
          },
        }}
      >
        {/* Header */}
        <Box
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            px: 2,
            py: 1.25,
            bgcolor: "background.paper",
          }}
          {...headerProps}
        >
          <Stack direction="row" alignItems="center" spacing={1.25}>
            {icon ? (
              <Box sx={{ display: "flex", alignItems: "center" }}>{icon}</Box>
            ) : null}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {typeof title === "string" ? (
                <Typography variant="h6" noWrap title={title}>
                  {title}
                </Typography>
              ) : (
                title
              )}
              {subtitle ? (
                typeof subtitle === "string" ? (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    noWrap
                    title={subtitle}
                  >
                    {subtitle}
                  </Typography>
                ) : (
                  subtitle
                )
              ) : null}
            </Box>
            {showCloseIcon && (
              <IconButton edge="end" onClick={onClose} aria-label="close">
                <CloseIcon />
              </IconButton>
            )}
          </Stack>
          <Divider sx={{ mt: 1 }} />
        </Box>

        {/* Content (scrollable) */}
        <Box
          sx={{
            px: 2,
            py: 1.5,
            overflow: "auto",
            flex: 1,
            minHeight: 0,
          }}
          {...contentProps}
        >
          {children}
        </Box>

        {/* Actions (sticky bottom) */}
        {actions ? (
          <Box
            sx={{
              px: 2,
              py: 1,
              borderTop: 1,
              borderColor: "divider",
              position: "sticky",
              bottom: 0,
              bgcolor: "background.paper",
            }}
            {...actionsProps}
          >
            <Stack
              direction="row"
              spacing={1}
              justifyContent="flex-end"
              alignItems="center"
            >
              {Array.isArray(actions) ? actions : [actions]}
            </Stack>
          </Box>
        ) : null}
      </Drawer>
    );
  }

  // DESKTOP — Dialog
  const dialogPaperSx = {
    ...paperSx,
    ...(dialogProps?.PaperProps?.sx || {}),
  };

  return (
    <Dialog
      open={!!open}
      onClose={onClose}
      fullWidth
      maxWidth={maxWidth}
      keepMounted={keepMounted}
      sx={{ zIndex: rootZIndex, ...(dialogProps?.sx || {}) }}
      {...dialogProps}
      PaperProps={{
        ...dialogProps.PaperProps,
        sx: dialogPaperSx,
      }}
      // 👇 giữ Backdrop dưới content
      BackdropProps={{
        ...(dialogProps?.BackdropProps || {}),
        sx: {
          zIndex: -1,
          ...(dialogProps?.BackdropProps?.sx || {}),
        },
      }}
    >
      <DialogTitle {...headerProps}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          {icon ? (
            <Box sx={{ display: "flex", alignItems: "center" }}>{icon}</Box>
          ) : null}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {typeof title === "string" ? (
              <Typography variant="h6" noWrap title={title}>
                {title}
              </Typography>
            ) : (
              title
            )}
            {subtitle ? (
              typeof subtitle === "string" ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  noWrap
                  title={subtitle}
                >
                  {subtitle}
                </Typography>
              ) : (
                subtitle
              )
            ) : null}
          </Box>
          {showCloseIcon && (
            <IconButton edge="end" onClick={onClose} aria-label="close">
              <CloseIcon />
            </IconButton>
          )}
        </Stack>
      </DialogTitle>

      <DialogContent dividers {...contentProps}>
        {children}
      </DialogContent>

      {actions ? (
        <DialogActions {...actionsProps}>
          {Array.isArray(actions) ? actions : [actions]}
        </DialogActions>
      ) : null}
    </Dialog>
  );
}

ResponsiveModal.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
  title: PropTypes.oneOfType([PropTypes.node, PropTypes.string]),
  subtitle: PropTypes.oneOfType([PropTypes.node, PropTypes.string]),
  icon: PropTypes.node,
  actions: PropTypes.oneOfType([
    PropTypes.node,
    PropTypes.arrayOf(PropTypes.node),
  ]),
  maxWidth: PropTypes.oneOf(["xs", "sm", "md", "lg", "xl", false]),
  anchor: PropTypes.oneOf(["bottom", "right", "left", "top"]),
  mobileBreakpoint: PropTypes.string,
  keepMounted: PropTypes.bool,
  showCloseIcon: PropTypes.bool,
  paperSx: PropTypes.object,
  dialogProps: PropTypes.object,
  drawerProps: PropTypes.object,
  headerProps: PropTypes.object,
  contentProps: PropTypes.object,
  actionsProps: PropTypes.object,
  zIndex: PropTypes.number,
};
