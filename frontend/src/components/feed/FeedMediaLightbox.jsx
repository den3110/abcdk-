// components/feed/FeedMediaLightbox.jsx — modal fullscreen kiểu Facebook:
// media bên trái (contain, đen), sidebar phải hiển thị header + content + stats
// + reaction bar + comment thread. Swipe/chevron chuyển ảnh.
import React, { useEffect, useState } from "react";
import {
  Avatar,
  Box,
  Dialog,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
  Chip,
} from "@mui/material";
import {
  ChevronLeft,
  ChevronRight,
  X as XIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const authorName = (u) => u?.nickname || u?.name || "Người dùng";

export function FeedMediaLightbox({
  open,
  onClose,
  post,
  initialIndex = 0,
  sidebar,
}) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const [index, setIndex] = useState(initialIndex);
  const nav = useNavigate();
  const media = post?.media || [];
  const item = media[index];

  useEffect(() => {
    if (open) setIndex(initialIndex);
  }, [open, initialIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        setIndex((i) => Math.min(media.length - 1, i + 1));
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, media.length, onClose]);

  if (!post) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      PaperProps={{
        sx: { bgcolor: "#000", overflow: "hidden" },
      }}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          height: "100vh",
          width: "100vw",
        }}
      >
        {/* Media pane */}
        <Box
          sx={{
            flex: 1,
            position: "relative",
            bgcolor: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            minHeight: { xs: "50vh", md: "auto" },
          }}
        >
          {/* Close button */}
          <IconButton
            onClick={onClose}
            sx={{
              position: "absolute",
              top: 16,
              left: 16,
              bgcolor: "rgba(0,0,0,0.55)",
              color: "#fff",
              zIndex: 20,
              "&:hover": { bgcolor: "rgba(0,0,0,0.75)" },
            }}
          >
            <XIcon size={20} />
          </IconButton>

          {/* Author minimal on media pane */}
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{
              position: "absolute",
              top: 16,
              left: 64,
              zIndex: 20,
              color: "#fff",
            }}
          >
            <Avatar
              src={post.author?.avatar || ""}
              sx={{
                width: 32,
                height: 32,
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.4)",
              }}
              onClick={() => {
                if (post.author?._id) {
                  onClose();
                  nav(`/profile/${post.author._id}`);
                }
              }}
            >
              {authorName(post.author)[0]?.toUpperCase()}
            </Avatar>
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{ color: "#fff", cursor: "pointer" }}
              onClick={() => {
                if (post.author?._id) {
                  onClose();
                  nav(`/profile/${post.author._id}`);
                }
              }}
            >
              {authorName(post.author)}
            </Typography>
          </Stack>

          {/* Media */}
          {item?.type === "image" ? (
            <img
              src={item.url}
              alt=""
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
              }}
            />
          ) : item?.type === "video" ? (
            <video
              src={item.url}
              controls
              autoPlay
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
              }}
            />
          ) : null}

          {/* Prev/Next */}
          {media.length > 1 && (
            <>
              <IconButton
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0}
                sx={{
                  position: "absolute",
                  left: 16,
                  top: "50%",
                  transform: "translateY(-50%)",
                  bgcolor: "rgba(0,0,0,0.55)",
                  color: "#fff",
                  zIndex: 20,
                  "&:hover": { bgcolor: "rgba(0,0,0,0.75)" },
                  "&.Mui-disabled": {
                    color: "rgba(255,255,255,0.25)",
                    bgcolor: "rgba(0,0,0,0.3)",
                  },
                }}
              >
                <ChevronLeft size={22} />
              </IconButton>
              <IconButton
                onClick={() =>
                  setIndex((i) => Math.min(media.length - 1, i + 1))
                }
                disabled={index >= media.length - 1}
                sx={{
                  position: "absolute",
                  right: 16,
                  top: "50%",
                  transform: "translateY(-50%)",
                  bgcolor: "rgba(0,0,0,0.55)",
                  color: "#fff",
                  zIndex: 20,
                  "&:hover": { bgcolor: "rgba(0,0,0,0.75)" },
                  "&.Mui-disabled": {
                    color: "rgba(255,255,255,0.25)",
                    bgcolor: "rgba(0,0,0,0.3)",
                  },
                }}
              >
                <ChevronRight size={22} />
              </IconButton>
              {/* Index chip */}
              <Chip
                label={`${index + 1} / ${media.length}`}
                size="small"
                sx={{
                  position: "absolute",
                  top: 16,
                  right: 16,
                  bgcolor: "rgba(0,0,0,0.6)",
                  color: "#fff",
                  zIndex: 20,
                }}
              />
            </>
          )}
        </Box>

        {/* Sidebar pane */}
        <Box
          sx={{
            width: { xs: "100%", md: 380 },
            maxWidth: { md: 380 },
            bgcolor: "background.paper",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {sidebar}
        </Box>
      </Box>
    </Dialog>
  );
}
