// components/feed/ReactorsDialog.jsx — dialog xem ai đã thả cảm xúc cho
// bài viết hoặc bình luận, tab lọc theo type kiểu Facebook.
import React, { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  useLazyListPostReactorsQuery,
  useLazyListCommentReactorsQuery,
} from "../../slices/feedApiSlice.js";

const EMOJI = {
  like: "👍",
  love: "❤️",
  haha: "😂",
  wow: "😮",
  sad: "😢",
  angry: "😡",
};
const LABEL = {
  like: "Thích",
  love: "Yêu thích",
  haha: "Haha",
  wow: "Wow",
  sad: "Buồn",
  angry: "Phẫn nộ",
};
const ORDER = ["like", "love", "haha", "wow", "sad", "angry"];

export function ReactorsDialog({ open, onClose, postId, commentId }) {
  const nav = useNavigate();
  const [triggerPost, postRes] = useLazyListPostReactorsQuery();
  const [triggerComment, commentRes] = useLazyListCommentReactorsQuery();
  const [activeTab, setActiveTab] = useState("all");

  useEffect(() => {
    if (!open) return;
    setActiveTab("all");
    if (postId) triggerPost({ postId });
    else if (commentId) triggerComment({ cid: commentId });
  }, [open, postId, commentId, triggerPost, triggerComment]);

  const data = postId ? postRes.data : commentRes.data;
  const isLoading = postId ? postRes.isFetching : commentRes.isFetching;
  const countByType = data?.countByType || {};
  const items = data?.items || [];
  const filtered = useMemo(
    () =>
      activeTab === "all"
        ? items
        : items.filter((r) => r.type === activeTab),
    [items, activeTab]
  );
  const availableTypes = ORDER.filter((t) => (countByType[t] || 0) > 0);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: "flex", alignItems: "center", pb: 1 }}>
        <Typography variant="h6" flex={1}>
          Cảm xúc
        </Typography>
        <IconButton onClick={onClose} size="small">
          <X size={18} />
        </IconButton>
      </DialogTitle>
      <Box sx={{ px: 3, pb: 1, borderBottom: 1, borderColor: "divider" }}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          <Chip
            label={`Tất cả ${data?.total || 0}`}
            color={activeTab === "all" ? "primary" : "default"}
            onClick={() => setActiveTab("all")}
            variant={activeTab === "all" ? "filled" : "outlined"}
            size="small"
          />
          {availableTypes.map((t) => (
            <Chip
              key={t}
              label={`${EMOJI[t]} ${countByType[t] || 0}`}
              color={activeTab === t ? "primary" : "default"}
              onClick={() => setActiveTab(t)}
              variant={activeTab === t ? "filled" : "outlined"}
              size="small"
            />
          ))}
        </Stack>
      </Box>
      <DialogContent sx={{ px: 1, py: 0 }}>
        {isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
            Chưa có ai thả cảm xúc
          </Box>
        ) : (
          <List sx={{ py: 0 }}>
            {filtered.map((r, i) => {
              const u = r.user || {};
              const name = u.nickname || u.name || "Người dùng";
              return (
                <ListItemButton
                  key={String(u._id || i)}
                  onClick={() => {
                    if (u._id) {
                      onClose();
                      nav(`/profile/${u._id}`);
                    }
                  }}
                >
                  <ListItemAvatar sx={{ position: "relative" }}>
                    <Avatar src={u.avatar || ""}>
                      {name[0]?.toUpperCase()}
                    </Avatar>
                    <Box
                      sx={{
                        position: "absolute",
                        bottom: 2,
                        right: 14,
                        bgcolor: "background.paper",
                        borderRadius: "50%",
                        width: 20,
                        height: 20,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid",
                        borderColor: "divider",
                        fontSize: 12,
                      }}
                    >
                      {EMOJI[r.type] || "👍"}
                    </Box>
                  </ListItemAvatar>
                  <ListItemText
                    primary={name}
                    secondary={LABEL[r.type] || r.type}
                  />
                </ListItemButton>
              );
            })}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}
