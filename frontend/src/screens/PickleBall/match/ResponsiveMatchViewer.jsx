import { Box, Chip, Dialog, DialogContent, DialogTitle, Drawer, IconButton, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useLiveMatch } from "../../../hook/useLiveMatch";
import { useGetMatchPublicQuery } from "../../../slices/tournamentsApiSlice";
import { useSelector } from "react-redux";
import {
  Close as CloseIcon,
} from "@mui/icons-material";
import MatchContent from "./MatchContent";

/* ===== Responsive viewer: Drawer/Dialog ===== */
function ResponsiveMatchViewer({ open, matchId, onClose }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { userInfo } = useSelector((s) => s.auth || {});
  const token = userInfo?.token;

  const { data: base, isLoading } = useGetMatchPublicQuery(matchId, {
    skip: !matchId || !open,
  });
  const { loading: liveLoading, data: live } = useLiveMatch(
    open ? matchId : null,
    token
  );
  const m = live || base;
  const status = m?.status || "scheduled";

  if (isMobile) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        keepMounted
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            height: "92vh",
            maxHeight: "100vh",
            minHeight: "80vh",
          },
        }}
      >
        <Box
          sx={{
            p: 2,
            pt: 1.25,
            maxWidth: 1000,
            mx: "auto",
            width: "100%",
            pb: 6,
          }}
        >
          <Box
            sx={{
              width: 36,
              height: 4,
              bgcolor: "text.disabled",
              borderRadius: 2,
              mx: "auto",
              mb: 1.25,
            }}
          />
          <Box sx={{ position: "relative", pb: 1 }}>
            <Typography variant="h6">
              Trận đấu • {m ? `R${m.round || 1} #${m.order ?? 0}` : ""}
              <Chip
                size="small"
                sx={{ ml: 1 }}
                label={
                  status === "live"
                    ? "Đang diễn ra"
                    : status === "finished"
                    ? "Hoàn thành"
                    : "Dự kiến"
                }
                color={
                  status === "live"
                    ? "warning"
                    : status === "finished"
                    ? "success"
                    : "default"
                }
              />
            </Typography>
            <IconButton
              onClick={onClose}
              sx={{ position: "absolute", right: -6, top: -6 }}
            >
              <CloseIcon />
            </IconButton>
          </Box>

          <Box sx={{ overflowY: "auto", pr: { md: 1 }, pb: 1 }}>
            <MatchContent
              m={m}
              isLoading={isLoading}
              liveLoading={liveLoading}
            />
          </Box>
        </Box>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pr: 6 }}>
        Trận đấu • {m ? `R${m.round || 1} #${m.order ?? 0}` : ""}
        <Chip
          size="small"
          sx={{ ml: 1 }}
          label={
            status === "live"
              ? "Đang diễn ra"
              : status === "finished"
              ? "Hoàn thành"
              : "Dự kiến"
          }
          color={
            status === "live"
              ? "warning"
              : status === "finished"
              ? "success"
              : "default"
          }
        />
        <IconButton
          onClick={onClose}
          sx={{ position: "absolute", right: 12, top: 10 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <MatchContent m={m} isLoading={isLoading} liveLoading={liveLoading} />
      </DialogContent>
    </Dialog>
  );
}


export default ResponsiveMatchViewer