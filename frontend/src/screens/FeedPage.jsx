// screens/FeedPage.jsx — Bảng tin (feed) cho web.
// Dùng MUI + RTK Query. UI tối giản, tương thích cả v1 lẫn Astryx v2
// (v2 wrap trong ShadowFrame ở SiteNav, ta chỉ render nội dung).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  MoreHorizontal,
  ImagePlus,
  Video,
  Send,
  Heart,
  MessageCircle,
  Flag,
  Trash2,
  Pin,
  Trophy,
  X as XIcon,
  ChevronRight,
} from "lucide-react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import SEOHead from "../components/SEOHead.jsx";
import {
  useListFeedQuery,
  useCreateFeedPostMutation,
  useDeleteFeedPostMutation,
  useReactFeedPostMutation,
  useUploadFeedMediaMutation,
  useListFeedCommentsQuery,
  useCreateFeedCommentMutation,
  useDeleteFeedCommentMutation,
  useReportFeedPostMutation,
  useReportFeedCommentMutation,
} from "../slices/feedApiSlice.js";
import MentionText from "../components/feed/MentionText.jsx";
import ScoreBadges from "../components/feed/ScoreBadges.jsx";
import MentionAutocomplete from "../components/feed/MentionAutocomplete.jsx";
import TournamentPickerDialog from "../components/feed/TournamentPickerDialog.jsx";

/* ─────────── constants ─────────── */
const REACTION_EMOJI = {
  like: "👍",
  love: "❤️",
  haha: "😆",
  wow: "😮",
  sad: "😢",
  angry: "😡",
};
const REACTION_LABEL = {
  like: "Thích",
  love: "Yêu",
  haha: "Haha",
  wow: "Wow",
  sad: "Buồn",
  angry: "Giận",
};
const REPORT_REASONS = [
  ["spam", "Spam"],
  ["harassment", "Quấy rối"],
  ["hate", "Ngôn từ thù ghét"],
  ["nudity", "Nội dung khiêu dâm"],
  ["violence", "Bạo lực"],
  ["misinformation", "Sai lệch thông tin"],
  ["impersonation", "Mạo danh"],
  ["other", "Khác"],
];

/* ─────────── helpers ─────────── */
const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "vừa xong";
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} ngày trước`;
  return d.toLocaleDateString("vi-VN");
};

const authorName = (u) => u?.nickname || u?.name || "Người dùng";
const isAdminRole = (u) => u?.role === "admin" || u?.role === "superAdmin";

/* ─────────── Composer ─────────── */
function Composer({ me, onPosted }) {
  const [content, setContent] = useState("");
  const [media, setMedia] = useState([]);
  const [posting, setPosting] = useState(false);
  const [linkedTournament, setLinkedTournament] = useState(null);
  const [tournamentPickerOpen, setTournamentPickerOpen] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState([]);
  const fileRef = useRef(null);
  const [uploadMedia] = useUploadFeedMediaMutation();
  const [createPost] = useCreateFeedPostMutation();

  const canPost = (content.trim() || media.length || linkedTournament) && !posting;

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 10);
    if (!files.length) return;
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    try {
      const res = await uploadMedia(fd).unwrap();
      setMedia((prev) => [...prev, ...(res.media || [])].slice(0, 10));
    } catch (err) {
      toast.error(err?.data?.message || "Upload thất bại");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!canPost) return;
    setPosting(true);
    const stillPresent = selectedMentions
      .filter((m) => content.includes(`@${m.display}`))
      .map((m) => m._id);
    try {
      await createPost({
        content: content.trim(),
        media,
        linkedTournament: linkedTournament?._id || null,
        mentions: stillPresent,
      }).unwrap();
      setContent("");
      setMedia([]);
      setLinkedTournament(null);
      setSelectedMentions([]);
      onPosted?.();
    } catch (err) {
      toast.error(err?.data?.message || "Đăng thất bại");
    } finally {
      setPosting(false);
    }
  };

  return (
    <Card sx={{ borderRadius: 3, mb: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Avatar src={me?.avatar || ""} sx={{ width: 44, height: 44 }}>
            {authorName(me)[0]?.toUpperCase()}
          </Avatar>
          <Stack flex={1} spacing={1}>
            <MentionAutocomplete
              value={content}
              onChange={setContent}
              onPickMention={(u) =>
                setSelectedMentions((prev) =>
                  prev.some((m) => m._id === String(u._id))
                    ? prev
                    : [
                        ...prev,
                        { _id: String(u._id), display: u.nickname || u.name },
                      ]
                )
              }
              placeholder={`${authorName(me)} ơi, bạn muốn chia sẻ gì? (gõ @ để nhắc bạn)`}
            />
            {linkedTournament && (
              <Chip
                icon={<Trophy size={14} />}
                label={linkedTournament.name}
                onDelete={() => setLinkedTournament(null)}
                deleteIcon={<XIcon size={14} />}
                sx={{
                  alignSelf: "flex-start",
                  bgcolor: "#FFF7ED",
                  color: "#B45309",
                  fontWeight: 600,
                  border: 1,
                  borderColor: "#FED7AA",
                }}
              />
            )}
            {media.length > 0 && (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(100px,1fr))",
                  gap: 1,
                }}
              >
                {media.map((m, i) => (
                  <Box
                    key={i}
                    sx={{
                      position: "relative",
                      borderRadius: 2,
                      overflow: "hidden",
                      bgcolor: "action.hover",
                      aspectRatio: "1",
                    }}
                  >
                    {m.type === "image" ? (
                      <img
                        src={m.url}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <video
                        src={m.url}
                        muted
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    )}
                    <IconButton
                      size="small"
                      onClick={() =>
                        setMedia((prev) => prev.filter((_, j) => j !== i))
                      }
                      sx={{
                        position: "absolute",
                        top: 2,
                        right: 2,
                        bgcolor: "rgba(0,0,0,.6)",
                        color: "white",
                        "&:hover": { bgcolor: "rgba(0,0,0,.8)" },
                        p: 0.5,
                      }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            )}
            <Stack direction="row" alignItems="center" spacing={1}>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime"
                multiple
                hidden
                onChange={handleFiles}
              />
              <Tooltip title="Thêm ảnh/video (tối đa 10 file, 50MB/file)">
                <IconButton
                  size="small"
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus size={20} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Gắn giải đấu">
                <IconButton
                  size="small"
                  onClick={() => setTournamentPickerOpen(true)}
                  sx={{ color: "#F59E0B" }}
                >
                  <Trophy size={20} />
                </IconButton>
              </Tooltip>
              <Box flex={1} />
              <Button
                variant="contained"
                startIcon={<Send size={16} />}
                onClick={submit}
                disabled={!canPost}
              >
                {posting ? "Đang đăng…" : "Đăng"}
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </CardContent>
      <TournamentPickerDialog
        open={tournamentPickerOpen}
        onClose={() => setTournamentPickerOpen(false)}
        onPick={(t) => {
          setLinkedTournament(t);
          setTournamentPickerOpen(false);
        }}
      />
    </Card>
  );
}

/* ─────────── ReactionBar ─────────── */
function ReactionBar({ post, onReact }) {
  const [open, setOpen] = useState(false);
  const current = post.myReaction;
  return (
    <Box sx={{ position: "relative", display: "inline-block" }}>
      <Button
        size="small"
        startIcon={current ? <span style={{ fontSize: 18 }}>{REACTION_EMOJI[current]}</span> : <Heart size={16} />}
        onClick={() => onReact(current || "like")}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        sx={{ textTransform: "none", color: current ? "primary.main" : "text.secondary" }}
      >
        {current ? REACTION_LABEL[current] : "Thích"}
      </Button>
      {open && (
        <Box
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          sx={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            bgcolor: "background.paper",
            boxShadow: 3,
            borderRadius: 3,
            p: 0.5,
            display: "flex",
            gap: 0.5,
            zIndex: 10,
          }}
        >
          {Object.entries(REACTION_EMOJI).map(([k, e]) => (
            <IconButton
              key={k}
              size="small"
              onClick={() => {
                onReact(k);
                setOpen(false);
              }}
              title={REACTION_LABEL[k]}
              sx={{ fontSize: 22 }}
            >
              <span>{e}</span>
            </IconButton>
          ))}
        </Box>
      )}
    </Box>
  );
}

/* ─────────── CommentThread ─────────── */
function CommentThread({ postId, me, canModerate }) {
  const [reply, setReply] = useState("");
  const [replyTarget, setReplyTarget] = useState(null); // top-level comment id
  const { data, isFetching } = useListFeedCommentsQuery({ postId });
  const [createComment] = useCreateFeedCommentMutation();
  const [deleteComment] = useDeleteFeedCommentMutation();
  const [reportComment] = useReportFeedCommentMutation();

  const submit = async (parent = null) => {
    const content = parent ? reply : reply;
    if (!content?.trim()) return;
    try {
      await createComment({ postId, content: content.trim(), parent }).unwrap();
      setReply("");
      setReplyTarget(null);
    } catch (err) {
      toast.error(err?.data?.message || "Không gửi được");
    }
  };

  const handleReport = async (cid) => {
    const reason = window.prompt(
      "Lý do (spam/harassment/hate/nudity/violence/misinformation/impersonation/other):",
      "spam"
    );
    if (!reason) return;
    try {
      await reportComment({ cid, reason }).unwrap();
      toast.success("Đã gửi báo cáo");
    } catch (err) {
      toast.error(err?.data?.message || "Không gửi được");
    }
  };

  const handleDelete = async (cid) => {
    if (!window.confirm("Xoá bình luận này?")) return;
    try {
      await deleteComment(cid).unwrap();
    } catch (err) {
      toast.error(err?.data?.message || "Xoá thất bại");
    }
  };

  return (
    <Box sx={{ pt: 1 }}>
      {isFetching && <CircularProgress size={16} />}
      <Stack spacing={1}>
        {(data?.items || []).map((c) => (
          <CommentItem
            key={c._id}
            comment={c}
            postId={postId}
            me={me}
            canModerate={canModerate}
            onReply={() => setReplyTarget(c._id)}
            onDelete={handleDelete}
            onReport={handleReport}
          />
        ))}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ mt: 1.5 }}>
        <Avatar src={me?.avatar || ""} sx={{ width: 32, height: 32 }}>
          {authorName(me)[0]?.toUpperCase()}
        </Avatar>
        <TextField
          size="small"
          fullWidth
          placeholder={
            replyTarget ? "Viết phản hồi…" : "Viết bình luận…"
          }
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(replyTarget);
            }
          }}
        />
        <IconButton
          color="primary"
          onClick={() => submit(replyTarget)}
          disabled={!reply.trim()}
        >
          <Send size={18} />
        </IconButton>
        {replyTarget && (
          <Button size="small" onClick={() => setReplyTarget(null)}>
            Huỷ
          </Button>
        )}
      </Stack>
    </Box>
  );
}

function CommentItem({
  comment,
  postId,
  me,
  canModerate,
  onReply,
  onDelete,
  onReport,
}) {
  const [showReplies, setShowReplies] = useState(false);
  const { data: replies } = useListFeedCommentsQuery(
    showReplies ? { postId, parent: comment._id } : undefined,
    { skip: !showReplies }
  );
  const canDelete =
    canModerate || String(comment.author?._id) === String(me?._id);

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Avatar
          src={comment.author?.avatar || ""}
          sx={{ width: 32, height: 32, cursor: "pointer" }}
          component="a"
          href={comment.author?._id ? `/profile/${comment.author._id}` : undefined}
        >
          {authorName(comment.author)[0]?.toUpperCase()}
        </Avatar>
        <Box flex={1}>
          <Box
            sx={{ bgcolor: "action.hover", borderRadius: 2, px: 1.5, py: 0.75 }}
          >
            <Typography
              variant="body2"
              fontWeight={600}
              component="a"
              href={comment.author?._id ? `/profile/${comment.author._id}` : undefined}
              sx={{
                color: "inherit",
                textDecoration: "none",
                "&:hover": { textDecoration: "underline" },
              }}
            >
              {authorName(comment.author)}
            </Typography>
            <MentionText
              content={comment.content}
              mentions={comment.mentions}
              sx={{ display: "block", fontSize: "0.875rem" }}
            />
          </Box>
          <Stack direction="row" spacing={2} sx={{ mt: 0.5, ml: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {fmtTime(comment.createdAt)}
            </Typography>
            <Typography
              variant="caption"
              sx={{ cursor: "pointer", fontWeight: 600 }}
              onClick={onReply}
            >
              Trả lời
            </Typography>
            {canDelete && (
              <Typography
                variant="caption"
                sx={{ cursor: "pointer", color: "error.main" }}
                onClick={() => onDelete(comment._id)}
              >
                Xoá
              </Typography>
            )}
            <Typography
              variant="caption"
              sx={{ cursor: "pointer", color: "text.secondary" }}
              onClick={() => onReport(comment._id)}
            >
              Báo cáo
            </Typography>
            {comment.replyCount > 0 && (
              <Typography
                variant="caption"
                sx={{ cursor: "pointer", fontWeight: 600 }}
                onClick={() => setShowReplies((v) => !v)}
              >
                {showReplies
                  ? "Ẩn phản hồi"
                  : `Xem ${comment.replyCount} phản hồi`}
              </Typography>
            )}
          </Stack>
          {showReplies && (
            <Stack spacing={1} sx={{ mt: 1, pl: 3 }}>
              {(replies?.items || []).map((r) => (
                <CommentItem
                  key={r._id}
                  comment={r}
                  postId={postId}
                  me={me}
                  canModerate={canModerate}
                  onReply={onReply}
                  onDelete={onDelete}
                  onReport={onReport}
                />
              ))}
            </Stack>
          )}
        </Box>
      </Stack>
    </Box>
  );
}

/* ─────────── PostCard ─────────── */
function PostCard({ post, me }) {
  const nav = useNavigate();
  const [react] = useReactFeedPostMutation();
  const [deletePost] = useDeleteFeedPostMutation();
  const [reportPost] = useReportFeedPostMutation();
  const [showComments, setShowComments] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(false);
  const isMine = String(post.author?._id) === String(me?._id);
  const canModerate = isMine || isAdminRole(me);

  const handleReact = async (type) => {
    try {
      await react({ id: post._id, type }).unwrap();
    } catch (err) {
      toast.error(err?.data?.message || "Không thực hiện được");
    }
  };
  const handleDelete = async () => {
    if (!window.confirm("Xoá bài viết này?")) return;
    try {
      await deletePost(post._id).unwrap();
      toast.success("Đã xoá");
    } catch (err) {
      toast.error(err?.data?.message || "Xoá thất bại");
    }
  };
  const handleReport = async () => {
    const reason = window.prompt(
      "Lý do (spam/harassment/hate/nudity/violence/misinformation/impersonation/other):",
      "spam"
    );
    if (!reason) return;
    try {
      await reportPost({ id: post._id, reason }).unwrap();
      toast.success("Đã gửi báo cáo");
    } catch (err) {
      toast.error(err?.data?.message || "Báo cáo thất bại");
    }
  };

  return (
    <Card sx={{ borderRadius: 3, mb: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Avatar
            src={post.author?.avatar || ""}
            sx={{ width: 44, height: 44, cursor: "pointer" }}
            onClick={() =>
              post.author?._id && nav(`/profile/${post.author._id}`)
            }
          >
            {authorName(post.author)[0]?.toUpperCase()}
          </Avatar>
          <Box flex={1} minWidth={0}>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
              <Typography
                variant="subtitle2"
                fontWeight={700}
                sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
                onClick={() =>
                  post.author?._id && nav(`/profile/${post.author._id}`)
                }
              >
                {authorName(post.author)}
              </Typography>
              <ScoreBadges
                single={post.author?.score?.single}
                double={post.author?.score?.double}
              />
              {post.isPinned && (
                <Chip size="small" icon={<Pin size={12} />} label="Ghim" sx={{ height: 20 }} />
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {fmtTime(post.createdAt)}
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => setMenuAnchor(true)}>
            <MoreHorizontal size={20} />
          </IconButton>
        </Stack>

        {post.content && (
          <Box sx={{ mt: 1.5 }}>
            <MentionText content={post.content} mentions={post.mentions} />
          </Box>
        )}
        {post.tags?.length > 0 && (
          <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: "wrap" }}>
            {post.tags.map((t) => (
              <Chip key={t} size="small" label={`#${t}`} variant="outlined" />
            ))}
          </Stack>
        )}
        {post.linkedTournament && (
          <Card
            variant="outlined"
            sx={{
              mt: 1.5,
              cursor: "pointer",
              bgcolor: "#FFFBEB",
              borderColor: "#FDE68A",
              "&:hover": { bgcolor: "#FEF3C7" },
            }}
            onClick={() => nav(`/tournament/${post.linkedTournament._id}`)}
          >
            <Stack direction="row" spacing={1.2} alignItems="center" sx={{ p: 1.2 }}>
              {post.linkedTournament.image ? (
                <Avatar src={post.linkedTournament.image} variant="rounded" />
              ) : (
                <Avatar variant="rounded" sx={{ bgcolor: "#FEF3C7" }}>
                  <Trophy size={18} color="#F59E0B" />
                </Avatar>
              )}
              <Box flex={1} minWidth={0}>
                <Typography
                  variant="caption"
                  fontWeight={800}
                  sx={{ color: "#B45309", letterSpacing: 0.5 }}
                >
                  GIẢI ĐẤU
                </Typography>
                <Typography variant="body2" fontWeight={700} noWrap>
                  {post.linkedTournament.name}
                </Typography>
              </Box>
              <ChevronRight size={18} color="#94A3B8" />
            </Stack>
          </Card>
        )}
        {post.media?.length > 0 && (
          <Box
            sx={{
              mt: 1.5,
              display: "grid",
              gridTemplateColumns:
                post.media.length === 1 ? "1fr" : "repeat(2, 1fr)",
              gap: 1,
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            {post.media.slice(0, 4).map((m, i) => (
              <Box
                key={i}
                sx={{
                  bgcolor: "action.hover",
                  borderRadius: 2,
                  overflow: "hidden",
                  maxHeight: 480,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {m.type === "image" ? (
                  <img
                    src={m.url}
                    alt=""
                    style={{ width: "100%", height: "auto", display: "block" }}
                  />
                ) : (
                  <video
                    src={m.url}
                    controls
                    style={{ width: "100%", maxHeight: 480 }}
                  />
                )}
              </Box>
            ))}
            {post.media.length > 4 && (
              <Box
                sx={{
                  gridColumn: "span 2",
                  textAlign: "center",
                  color: "text.secondary",
                  py: 1,
                }}
              >
                +{post.media.length - 4} nội dung khác
              </Box>
            )}
          </Box>
        )}

        <Stack
          direction="row"
          spacing={3}
          sx={{ mt: 1, color: "text.secondary", fontSize: 13 }}
        >
          <span>{post.reactionCount || 0} lượt cảm xúc</span>
          <span>{post.commentCount || 0} bình luận</span>
        </Stack>

        <Divider sx={{ my: 1 }} />

        <Stack direction="row" spacing={1}>
          <ReactionBar post={post} onReact={handleReact} />
          <Button
            size="small"
            startIcon={<MessageCircle size={16} />}
            onClick={() => setShowComments((v) => !v)}
            sx={{ textTransform: "none", color: "text.secondary" }}
          >
            Bình luận
          </Button>
          <Button
            size="small"
            startIcon={<Flag size={16} />}
            onClick={handleReport}
            sx={{ textTransform: "none", color: "text.secondary" }}
          >
            Báo cáo
          </Button>
        </Stack>

        {showComments && (
          <CommentThread postId={post._id} me={me} canModerate={canModerate} />
        )}
      </CardContent>

      <Dialog open={menuAnchor} onClose={() => setMenuAnchor(false)}>
        <DialogTitle>Tuỳ chọn</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ minWidth: 240 }}>
            {canModerate && (
              <Button
                startIcon={<Trash2 size={16} />}
                color="error"
                onClick={() => {
                  setMenuAnchor(false);
                  handleDelete();
                }}
              >
                Xoá bài viết
              </Button>
            )}
            <Button
              startIcon={<Flag size={16} />}
              onClick={() => {
                setMenuAnchor(false);
                handleReport();
              }}
            >
              Báo cáo
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMenuAnchor(false)}>Đóng</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

/* ─────────── FeedPage ─────────── */
export default function FeedPage() {
  const me = useSelector((s) => s.auth?.userInfo);
  const navigate = useNavigate();
  const [tagFilter, setTagFilter] = useState("");
  const [cursor, setCursor] = useState(null);
  const { data, isFetching, refetch } = useListFeedQuery({
    tag: tagFilter || undefined,
    cursor,
    limit: 10,
  });
  const hasMore = Boolean(data?.hasMore);
  const nextCursor = data?.nextCursor;
  const sentinelRef = useRef(null);

  // Reset cursor khi đổi tag filter
  useEffect(() => {
    setCursor(null);
  }, [tagFilter]);

  const handleRefresh = useCallback(() => {
    setCursor(null);
    refetch();
  }, [refetch]);

  const loadMore = useCallback(() => {
    if (isFetching || !hasMore || !nextCursor || nextCursor === cursor) return;
    setCursor(nextCursor);
  }, [isFetching, hasMore, nextCursor, cursor]);

  // IntersectionObserver để trigger loadMore khi sentinel vào viewport
  useEffect(() => {
    if (!sentinelRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "600px" }
    );
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [loadMore]);

  if (!me) {
    return (
      <Box sx={{ maxWidth: 640, mx: "auto", p: 3, textAlign: "center" }}>
        <Typography variant="h5" gutterBottom>
          Bảng tin
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Đăng nhập để xem và đăng bài lên Bảng tin.
        </Typography>
        <Button variant="contained" onClick={() => navigate("/login")}>
          Đăng nhập
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 680, mx: "auto", p: 2 }}>
      <SEOHead
        title="Bảng tin | Pickletour"
        description="Chia sẻ khoảnh khắc, video, thảo luận trong cộng đồng Pickleball."
      />
      <Typography variant="h5" fontWeight={800} sx={{ mb: 2 }}>
        Bảng tin
      </Typography>

      <Composer me={me} onPosted={handleRefresh} />

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center">
        <Typography variant="body2" color="text.secondary">
          Lọc theo hashtag:
        </Typography>
        <Select
          size="small"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          displayEmpty
        >
          <MenuItem value="">Tất cả</MenuItem>
          <MenuItem value="pickleball">#pickleball</MenuItem>
          <MenuItem value="highlight">#highlight</MenuItem>
          <MenuItem value="training">#training</MenuItem>
        </Select>
      </Stack>

      {isFetching && !data && (
        <Box textAlign="center" py={4}>
          <CircularProgress />
        </Box>
      )}
      {data?.items?.length === 0 && (
        <Box textAlign="center" py={4} color="text.secondary">
          Chưa có bài viết. Hãy là người đầu tiên chia sẻ 👋
        </Box>
      )}
      {(data?.items || []).map((p) => (
        <PostCard key={p._id} post={p} me={me} />
      ))}
      {isFetching && cursor && (
        <Box textAlign="center" py={2}>
          <CircularProgress size={24} />
        </Box>
      )}
      {!hasMore && (data?.items?.length || 0) > 0 && (
        <Typography
          sx={{ textAlign: "center", color: "text.secondary", py: 2, fontSize: 12 }}
        >
          — Đã xem hết bài viết —
        </Typography>
      )}
      <Box ref={sentinelRef} sx={{ height: 1 }} />
    </Box>
  );
}
