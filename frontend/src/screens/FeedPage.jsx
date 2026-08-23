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
  Pencil,
  Pin,
  Trophy,
  X as XIcon,
  ChevronRight,
  Share2,
  ArrowLeft,
  Bookmark,
  BarChart3,
} from "lucide-react";
import { useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";

import SEOHead from "../components/SEOHead.jsx";
import {
  useListFeedQuery,
  useGetFeedPostQuery,
  useCreateFeedPostMutation,
  useDeleteFeedPostMutation,
  useUpdateFeedPostMutation,
  useReactFeedPostMutation,
  useShareFeedPostMutation,
  useSaveFeedPostMutation,
  useVoteFeedPollMutation,
  useUploadFeedMediaMutation,
  useListFeedCommentsQuery,
  useCreateFeedCommentMutation,
  useDeleteFeedCommentMutation,
  useReactFeedCommentMutation,
  useReportFeedPostMutation,
  useReportFeedCommentMutation,
} from "../slices/feedApiSlice.js";
import { ReactorsDialog } from "../components/feed/ReactorsDialog.jsx";
import { FeedMediaLightbox } from "../components/feed/FeedMediaLightbox.jsx";
import MentionText from "../components/feed/MentionText.jsx";
import ScoreBadges from "../components/feed/ScoreBadges.jsx";
import MentionAutocomplete from "../components/feed/MentionAutocomplete.jsx";
import TournamentPickerDialog from "../components/feed/TournamentPickerDialog.jsx";
import FriendSuggestionsCard from "../components/feed/FriendSuggestionsCard.jsx";
import TournamentBubbleCard from "../components/feed/TournamentBubbleCard.jsx";
import { CONDITION_MAP, formatPrice } from "../constants/market";
import { PLAY_STATUS, formatPlayTime, skillLabel } from "../constants/play";

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
function GuestBanner({ onLogin }) {
  return (
    <Card sx={{ borderRadius: 3, mb: 2, p: 2 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Đăng nhập để đăng bài, bình luận, thả cảm xúc
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Bạn vẫn có thể xem bảng tin mà không cần đăng nhập.
          </Typography>
        </Box>
        <Button variant="contained" onClick={onLogin}>
          Đăng nhập
        </Button>
      </Stack>
    </Card>
  );
}

// Guard mọi thao tác cần đăng nhập trên FeedPage. Trả true nếu OK.
function useRequireLogin(me) {
  const nav = useNavigate();
  return useCallback(() => {
    if (me) return true;
    const yes = window.confirm(
      "Bạn cần đăng nhập để thực hiện thao tác này. Chuyển tới trang đăng nhập?"
    );
    if (yes) nav("/login");
    return false;
  }, [me, nav]);
}

function Composer({ me, onPosted }) {
  const [content, setContent] = useState("");
  const [media, setMedia] = useState([]);
  const [posting, setPosting] = useState(false);
  const [linkedTournament, setLinkedTournament] = useState(null);
  const [tournamentPickerOpen, setTournamentPickerOpen] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState([]);
  const [poll, setPoll] = useState(null); // {question, options:[""], multi}
  const fileRef = useRef(null);
  const [uploadMedia] = useUploadFeedMediaMutation();
  const [createPost] = useCreateFeedPostMutation();

  const pollValid =
    poll &&
    poll.options.filter((o) => o.trim()).length >= 2;
  const canPost =
    (content.trim() || media.length || linkedTournament || pollValid) &&
    !posting;

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
        poll: pollValid
          ? {
              question: poll.question,
              multi: poll.multi,
              options: poll.options.filter((o) => o.trim()),
            }
          : undefined,
      }).unwrap();
      setContent("");
      setMedia([]);
      setLinkedTournament(null);
      setSelectedMentions([]);
      setPoll(null);
      onPosted?.();
    } catch (err) {
      toast.error(err?.data?.message || "Đăng thất bại");
    } finally {
      setPosting(false);
    }
  };

  return (
    <Card sx={{ borderRadius: 3, mb: 2, overflow: "hidden", maxWidth: "100%" }}>
      <CardContent sx={{ px: { xs: 1.5, sm: 2 }, overflow: "hidden" }}>
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
            {poll && (
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  border: "1px solid",
                  borderColor: "divider",
                  bgcolor: "action.hover",
                }}
              >
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    📊 Bình chọn
                  </Typography>
                  <IconButton size="small" onClick={() => setPoll(null)}>
                    <XIcon size={16} />
                  </IconButton>
                </Stack>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Câu hỏi bình chọn (VD: Ai vô địch?)"
                  value={poll.question}
                  onChange={(e) =>
                    setPoll((p) => ({ ...p, question: e.target.value }))
                  }
                  sx={{ mb: 1 }}
                />
                <Stack spacing={1}>
                  {poll.options.map((opt, i) => (
                    <TextField
                      key={i}
                      fullWidth
                      size="small"
                      placeholder={`Lựa chọn ${i + 1}`}
                      value={opt}
                      onChange={(e) =>
                        setPoll((p) => {
                          const options = [...p.options];
                          options[i] = e.target.value;
                          return { ...p, options };
                        })
                      }
                      InputProps={{
                        endAdornment:
                          poll.options.length > 2 ? (
                            <IconButton
                              size="small"
                              onClick={() =>
                                setPoll((p) => ({
                                  ...p,
                                  options: p.options.filter((_, j) => j !== i),
                                }))
                              }
                            >
                              <XIcon size={14} />
                            </IconButton>
                          ) : null,
                      }}
                    />
                  ))}
                </Stack>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                  {poll.options.length < 10 && (
                    <Button
                      size="small"
                      onClick={() =>
                        setPoll((p) => ({ ...p, options: [...p.options, ""] }))
                      }
                    >
                      + Thêm lựa chọn
                    </Button>
                  )}
                  <Box flex={1} />
                  <Button
                    size="small"
                    variant={poll.multi ? "contained" : "outlined"}
                    onClick={() => setPoll((p) => ({ ...p, multi: !p.multi }))}
                  >
                    {poll.multi ? "Chọn nhiều: Bật" : "Chọn nhiều: Tắt"}
                  </Button>
                </Stack>
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
              <Tooltip title="Tạo bình chọn">
                <IconButton
                  size="small"
                  onClick={() =>
                    setPoll((p) =>
                      p ? p : { question: "", options: ["", ""], multi: false }
                    )
                  }
                  sx={{ color: "#7C3AED" }}
                >
                  <BarChart3 size={20} />
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
  const requireLogin = useRequireLogin(me);
  const [reply, setReply] = useState("");
  const [replyTarget, setReplyTarget] = useState(null); // top-level comment id
  const [commentMedia, setCommentMedia] = useState([]);
  const [uploadingComment, setUploadingComment] = useState(false);
  const [reactorsOpen, setReactorsOpen] = useState(null); // {kind, id}
  const [justRepliedTo, setJustRepliedTo] = useState(null);
  const fileInputRef = useRef(null);
  const submittingRef = useRef(false);
  const { data, isFetching } = useListFeedCommentsQuery({ postId });
  const [createComment] = useCreateFeedCommentMutation();
  const [deleteComment] = useDeleteFeedCommentMutation();
  const [reportComment] = useReportFeedCommentMutation();
  const [uploadMedia] = useUploadFeedMediaMutation();

  const pickCommentMedia = async (e) => {
    const files = Array.from(e.target?.files || []);
    if (!files.length) return;
    if (!requireLogin()) return;
    if (commentMedia.length + files.length > 4) {
      toast.error("Mỗi bình luận tối đa 4 ảnh/video.");
      return;
    }
    setUploadingComment(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const res = await uploadMedia(fd).unwrap();
      setCommentMedia((prev) =>
        [...prev, ...(res.media || [])].slice(0, 4)
      );
    } catch (err) {
      toast.error(err?.data?.message || "Upload thất bại");
    } finally {
      setUploadingComment(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const submit = async (parent = null) => {
    if (submittingRef.current) return;
    const content = reply;
    if (!content?.trim() && commentMedia.length === 0) return;
    if (!requireLogin()) return;
    submittingRef.current = true;
    try {
      await createComment({
        postId,
        content: content.trim(),
        parent,
        media: commentMedia,
      }).unwrap();
      setReply("");
      setCommentMedia([]);
      setTimeout(() => setReply(""), 30);
      setReplyTarget(null);
      // Đánh dấu để CommentItem tự expand + refetch reply list ngay, tránh
      // phải load lại trang mới thấy phản hồi vừa gửi.
      if (parent) {
        setJustRepliedTo(String(parent));
        setTimeout(() => setJustRepliedTo(null), 4000);
      }
    } catch (err) {
      toast.error(err?.data?.message || "Không gửi được");
    } finally {
      submittingRef.current = false;
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
            onOpenReactors={(cid) =>
              setReactorsOpen({ kind: "comment", id: cid })
            }
            justRepliedTo={justRepliedTo}
          />
        ))}
      </Stack>
      {commentMedia.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mt: 1, ml: 5, flexWrap: "wrap" }}>
          {commentMedia.map((m, i) => (
            <Box
              key={i}
              sx={{
                position: "relative",
                width: 56,
                height: 56,
                borderRadius: 1,
                overflow: "hidden",
                bgcolor: "action.hover",
              }}
            >
              {m.type === "image" ? (
                <img
                  src={m.url}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <Box
                  sx={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: "#111",
                    color: "#fff",
                  }}
                >
                  <Video size={18} />
                </Box>
              )}
              <IconButton
                size="small"
                onClick={() =>
                  setCommentMedia((prev) => prev.filter((_, j) => j !== i))
                }
                sx={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bgcolor: "rgba(0,0,0,0.5)",
                  color: "#fff",
                  p: 0.25,
                  "&:hover": { bgcolor: "rgba(0,0,0,0.7)" },
                }}
              >
                <XIcon size={10} />
              </IconButton>
            </Box>
          ))}
        </Stack>
      )}
      <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ mt: 1.5 }}>
        <Avatar src={me?.avatar || ""} sx={{ width: 32, height: 32 }}>
          {authorName(me)[0]?.toUpperCase()}
        </Avatar>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={pickCommentMedia}
        />
        <IconButton
          size="small"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingComment || commentMedia.length >= 4}
        >
          <ImagePlus size={18} />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <MentionAutocomplete
            value={reply}
            onChange={setReply}
            placeholder={
              replyTarget ? "Viết phản hồi (gõ @ để nhắc bạn)…" : "Viết bình luận (gõ @ để nhắc bạn)…"
            }
            multiline
            minRows={1}
            maxRows={4}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(replyTarget);
              }
            }}
          />
        </Box>
        <IconButton
          color="primary"
          onClick={() => submit(replyTarget)}
          disabled={
            (!reply.trim() && commentMedia.length === 0) || uploadingComment
          }
        >
          <Send size={18} />
        </IconButton>
        {replyTarget && (
          <Button size="small" onClick={() => setReplyTarget(null)}>
            Huỷ
          </Button>
        )}
      </Stack>
      <ReactorsDialog
        open={!!reactorsOpen}
        onClose={() => setReactorsOpen(null)}
        commentId={reactorsOpen?.kind === "comment" ? reactorsOpen.id : null}
      />
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
  onOpenReactors,
  justRepliedTo,
}) {
  // Auto-expand phản hồi nếu comment đã có sẵn — đồng bộ hành vi với mobile
  // (bản cũ mặc định collapse khiến user phải click "Xem N phản hồi" mỗi lần
  // xem chi tiết).
  const [showReplies, setShowReplies] = useState(
    Number(comment?.replyCount || 0) > 0
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reactComment] = useReactFeedCommentMutation();
  const requireLogin = useRequireLogin(me);
  // Vừa reply comment này → force expand + refetch để hiện phản hồi mới
  // ngay, không phải reload trang.
  useEffect(() => {
    if (
      justRepliedTo &&
      String(justRepliedTo) === String(comment._id) &&
      !showReplies
    ) {
      setShowReplies(true);
    }
  }, [justRepliedTo, comment._id, showReplies]);
  const { data: replies, refetch: refetchReplies } = useListFeedCommentsQuery(
    showReplies ? { postId, parent: comment._id } : undefined,
    { skip: !showReplies }
  );
  useEffect(() => {
    if (
      justRepliedTo &&
      String(justRepliedTo) === String(comment._id) &&
      showReplies
    ) {
      const t = setTimeout(() => {
        try {
          refetchReplies?.();
        } catch {}
      }, 50);
      return () => clearTimeout(t);
    }
  }, [justRepliedTo, comment._id, showReplies, refetchReplies]);
  const canDelete =
    canModerate || String(comment.author?._id) === String(me?._id);
  const myReaction = comment.myReaction || null;
  const reactionCount = comment.reactionCount || 0;
  const doReact = async (type) => {
    setPickerOpen(false);
    if (!requireLogin()) return;
    try {
      await reactComment({ cid: String(comment._id), type }).unwrap();
    } catch (err) {
      toast.error(err?.data?.message || "Không thực hiện được");
    }
  };

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
          {(comment.content || comment.mentions?.length > 0) && (
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
          )}
          {!comment.content && !(comment.mentions?.length > 0) && (
            <Typography
              variant="body2"
              fontWeight={600}
              component="a"
              href={comment.author?._id ? `/profile/${comment.author._id}` : undefined}
              sx={{
                color: "inherit",
                textDecoration: "none",
                display: "inline-block",
                ml: 1,
              }}
            >
              {authorName(comment.author)}
            </Typography>
          )}
          {Array.isArray(comment.media) && comment.media.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
              {comment.media.map((m, i) => (
                <Box
                  key={i}
                  sx={{
                    borderRadius: 2,
                    overflow: "hidden",
                    maxWidth: 220,
                    maxHeight: 220,
                    bgcolor: "action.hover",
                  }}
                >
                  {m.type === "image" ? (
                    <img
                      src={m.url}
                      alt=""
                      style={{
                        maxWidth: 220,
                        maxHeight: 220,
                        display: "block",
                        cursor: "pointer",
                      }}
                      onClick={() => window.open(m.url, "_blank")}
                    />
                  ) : (
                    <video
                      src={m.url}
                      controls
                      style={{ maxWidth: 220, maxHeight: 220 }}
                    />
                  )}
                </Box>
              ))}
            </Stack>
          )}
          <Stack
            direction="row"
            spacing={2}
            alignItems="center"
            sx={{ mt: 0.5, ml: 1, position: "relative" }}
          >
            <Typography variant="caption" color="text.secondary">
              {fmtTime(comment.createdAt)}
            </Typography>
            <Box
              onMouseEnter={() => setPickerOpen(true)}
              onMouseLeave={() => setPickerOpen(false)}
              sx={{ position: "relative" }}
            >
              <Typography
                variant="caption"
                sx={{
                  cursor: "pointer",
                  fontWeight: 600,
                  color: myReaction ? "primary.main" : "text.secondary",
                }}
                onClick={() => doReact(myReaction ? myReaction : "like")}
              >
                {myReaction
                  ? `${REACTION_EMOJI[myReaction] || "👍"} Đã thích`
                  : "Thích"}
              </Typography>
              {pickerOpen && (
                <Box
                  sx={{
                    position: "absolute",
                    top: -40,
                    left: 0,
                    display: "flex",
                    bgcolor: "background.paper",
                    borderRadius: 999,
                    boxShadow: 3,
                    px: 1,
                    py: 0.5,
                    zIndex: 10,
                  }}
                >
                  {Object.entries(REACTION_EMOJI).map(([t, e]) => (
                    <Box
                      key={t}
                      onClick={() => doReact(t)}
                      sx={{
                        cursor: "pointer",
                        fontSize: 22,
                        px: 0.5,
                        transition: "transform 0.15s",
                        "&:hover": { transform: "scale(1.3)" },
                      }}
                    >
                      {e}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
            <Typography
              variant="caption"
              sx={{ cursor: "pointer", fontWeight: 600 }}
              onClick={onReply}
            >
              Trả lời
            </Typography>
            {reactionCount > 0 && onOpenReactors && (
              <Typography
                variant="caption"
                sx={{ cursor: "pointer", color: "text.secondary" }}
                onClick={() => onOpenReactors(String(comment._id))}
              >
                👍 {reactionCount}
              </Typography>
            )}
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
                  onOpenReactors={onOpenReactors}
                  justRepliedTo={justRepliedTo}
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
function PollBlock({ poll, onVote }) {
  const total = poll.totalVotes || 0;
  const closed = poll.closesAt && new Date(poll.closesAt) < new Date();
  return (
    <Box
      sx={{
        mt: 1.5,
        p: 1.5,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "action.hover",
      }}
    >
      {poll.question && (
        <Typography sx={{ fontWeight: 700, mb: 1 }}>{poll.question}</Typography>
      )}
      <Stack spacing={1}>
        {poll.options.map((o) => {
          const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
          return (
            <Box
              key={o.id}
              onClick={() => !closed && onVote(o.id)}
              sx={{
                position: "relative",
                borderRadius: 1.5,
                border: "1px solid",
                borderColor: o.voted ? "primary.main" : "divider",
                overflow: "hidden",
                cursor: closed ? "default" : "pointer",
                bgcolor: "background.paper",
              }}
            >
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  width: `${pct}%`,
                  bgcolor: o.voted ? "primary.light" : "action.selected",
                  opacity: 0.5,
                  transition: "width .3s",
                }}
              />
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ position: "relative", px: 1.25, py: 0.75 }}
              >
                <Typography variant="body2" sx={{ fontWeight: o.voted ? 700 : 500 }}>
                  {o.voted ? "✓ " : ""}
                  {o.text}
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  {pct}% · {o.votes}
                </Typography>
              </Stack>
            </Box>
          );
        })}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
        {total} lượt bình chọn{closed ? " · đã đóng" : ""}
        {poll.multi ? " · chọn nhiều" : ""}
      </Typography>
    </Box>
  );
}

function SharedMatchCard({ sm, nav }) {
  const winA = sm.winner === "A";
  const winB = sm.winner === "B";
  return (
    <Box
      onClick={() => sm.matchId && nav(`/matches/${sm.matchId}`)}
      sx={{
        mt: 1.5,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        overflow: "hidden",
        cursor: sm.matchId ? "pointer" : "default",
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 0.75,
          bgcolor: "primary.main",
          color: "primary.contrastText",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <span>🏓</span>
        <Typography variant="caption" sx={{ fontWeight: 700 }} noWrap>
          {sm.tournamentName || "Kết quả trận đấu"}
          {sm.code ? ` · ${sm.code}` : ""}
        </Typography>
      </Box>
      <Stack
        direction="row"
        alignItems="center"
        sx={{ px: 1.5, py: 1.25, gap: 1 }}
      >
        <Typography
          sx={{ flex: 1, fontWeight: winA ? 800 : 500, textAlign: "left", color: winA ? "success.main" : "text.primary" }}
        >
          {sm.teamA || "Đội A"}
        </Typography>
        <Box sx={{ px: 1.5, py: 0.5, borderRadius: 1.5, bgcolor: "action.selected", minWidth: 78, textAlign: "center" }}>
          <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1 }}>
            {sm.scoreA} – {sm.scoreB}
          </Typography>
          {(sm.setsA || sm.setsB) ? (
            <Typography variant="caption" color="text.secondary">
              Sets {sm.setsA}–{sm.setsB}
            </Typography>
          ) : null}
        </Box>
        <Typography
          sx={{ flex: 1, fontWeight: winB ? 800 : 500, textAlign: "right", color: winB ? "success.main" : "text.primary" }}
        >
          {sm.teamB || "Đội B"}
        </Typography>
      </Stack>
    </Box>
  );
}

function SharedListingCard({ sl, nav }) {
  const go = () => sl.listingId && nav(`/marketplace/${sl.listingId}`);
  const cond = CONDITION_MAP[sl.condition];
  const sold = sl.status === "sold";
  const ctaLabel = sold
    ? "Đã bán"
    : sl.type === "trade"
    ? "Xem / Đổi"
    : sl.type === "giveaway"
    ? "Nhận ngay"
    : "Mua ngay";
  return (
    <Box
      onClick={go}
      sx={{
        mt: 1.5,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        overflow: "hidden",
        display: "flex",
        cursor: sl.listingId ? "pointer" : "default",
        transition: "border-color .2s",
        "&:hover": { borderColor: "primary.main" },
      }}
    >
      <Box
        sx={{
          width: 118,
          minWidth: 118,
          height: 118,
          bgcolor: "action.hover",
          position: "relative",
        }}
      >
        {sl.image ? (
          <Box
            component="img"
            src={sl.image}
            alt={sl.title}
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: sold ? "grayscale(.6)" : "none",
            }}
          />
        ) : (
          <Box sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 34 }}>
            🛍️
          </Box>
        )}
      </Box>
      <Box sx={{ p: 1.25, flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.4 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <span style={{ fontSize: 13 }}>🛍️</span>
          <Typography variant="caption" sx={{ fontWeight: 700, color: "primary.main" }}>
            Sản phẩm trên Chợ
          </Typography>
        </Box>
        <Typography
          sx={{
            fontWeight: 700,
            fontSize: 14,
            lineHeight: 1.3,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {sl.title || "Sản phẩm"}
        </Typography>
        <Typography sx={{ color: "primary.main", fontWeight: 900, fontSize: 16 }}>
          {formatPrice(sl.price, sl.type)}
        </Typography>
        <Box sx={{ mt: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography variant="caption" color="text.secondary" noWrap>
            {[cond?.label, sl.province].filter(Boolean).join(" · ")}
          </Typography>
          <Box
            sx={{
              px: 1.5,
              py: 0.5,
              borderRadius: 999,
              bgcolor: sold ? "action.disabledBackground" : "primary.main",
              color: sold ? "text.disabled" : "#fff",
              fontWeight: 700,
              fontSize: 12.5,
              whiteSpace: "nowrap",
            }}
          >
            {ctaLabel}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function SharedPlayCard({ sp, nav }) {
  const go = () => sp.playId && nav(`/play/${sp.playId}`);
  const st = PLAY_STATUS[sp.status] || PLAY_STATUS.open;
  const slotsLeft = Math.max(0, (sp.slots || 0) - (sp.acceptedCount || 0));
  return (
    <Box
      onClick={go}
      sx={{
        mt: 1.5,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        overflow: "hidden",
        cursor: sp.playId ? "pointer" : "default",
        "&:hover": { borderColor: "#16a34a" },
      }}
    >
      <Box sx={{ px: 1.5, py: 0.75, bgcolor: "#16a34a", color: "#fff", display: "flex", alignItems: "center", gap: 1 }}>
        <span>🏓</span>
        <Typography variant="caption" sx={{ fontWeight: 700, flex: 1 }} noWrap>
          Kèo giao lưu · Tìm bạn đánh
        </Typography>
        <Box sx={{ px: 1, py: 0.2, borderRadius: 1, bgcolor: "rgba(255,255,255,.25)", fontSize: 11, fontWeight: 700 }}>
          {st.label}
        </Box>
      </Box>
      <Box sx={{ p: 1.5 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15 }}>
          {sp.title || sp.courtName || "Kèo pickleball"}
        </Typography>
        <Typography sx={{ fontSize: 13, color: "text.secondary", mt: 0.5 }}>
          🕒 {formatPlayTime(sp.playAt)}
        </Typography>
        <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
          📍 {[sp.courtName, sp.province].filter(Boolean).join(", ") || "—"}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 1, gap: 1 }}>
          <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
            {skillLabel(sp.skillMin, sp.skillMax)} · thiếu {slotsLeft} người
          </Typography>
          <Box sx={{ px: 1.5, py: 0.5, borderRadius: 999, bgcolor: sp.status === "open" ? "#16a34a" : "action.disabledBackground", color: sp.status === "open" ? "#fff" : "text.disabled", fontWeight: 700, fontSize: 12.5 }}>
            {sp.status === "open" ? "Tham gia" : "Xem kèo"}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function PostCard({ post, me, defaultShowComments = false }) {
  const nav = useNavigate();
  const [react] = useReactFeedPostMutation();
  const [deletePost] = useDeleteFeedPostMutation();
  const [updatePost] = useUpdateFeedPostMutation();
  const [editOpen, setEditOpen] = useState(false);
  const [editContent, setEditContent] = useState(post.content || "");
  const [reportPost] = useReportFeedPostMutation();
  const [sharePost] = useShareFeedPostMutation();
  const [savePost] = useSaveFeedPostMutation();
  const [votePoll] = useVoteFeedPollMutation();
  const [saved, setSaved] = useState(!!post.saved);
  const [poll, setPoll] = useState(post.poll || null);
  useEffect(() => setSaved(!!post.saved), [post.saved]);
  useEffect(() => setPoll(post.poll || null), [post.poll]);

  const handleToggleSave = async () => {
    const next = !saved;
    setSaved(next);
    try {
      await savePost({ id: post._id, save: next }).unwrap();
      toast.success(next ? "Đã lưu bài viết" : "Đã bỏ lưu");
    } catch {
      setSaved(!next);
      toast.error("Thao tác thất bại");
    }
  };

  const handleVote = async (optId) => {
    if (!poll) return;
    if (poll.closesAt && new Date(poll.closesAt) < new Date()) {
      toast.info("Bình chọn đã đóng");
      return;
    }
    // optimistic
    const optionIds = poll.multi
      ? poll.options
          .filter((o) => (o.id === optId ? !o.voted : o.voted))
          .map((o) => o.id)
      : [optId];
    try {
      const r = await votePoll({ id: post._id, optionIds }).unwrap();
      if (r?.poll) setPoll(r.poll);
    } catch {
      toast.error("Bình chọn thất bại");
    }
  };

  const [showComments, setShowComments] = useState(defaultShowComments);
  const [menuAnchor, setMenuAnchor] = useState(false);
  const [postReactorsOpen, setPostReactorsOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const isMine = String(post.author?._id) === String(me?._id);
  const canModerate = isMine || isAdminRole(me);

  const handleShare = async () => {
    const url = `${window.location.origin}/feed/post/${post._id}`;
    const shareData = {
      title:
        (post.author?.nickname || post.author?.name || "Bài viết") +
        " · PickleTour",
      text: (post.content || "").slice(0, 200),
      url,
    };
    let sharedOk = false;
    try {
      if (navigator.share && navigator.canShare?.(shareData) !== false) {
        await navigator.share(shareData);
        sharedOk = true;
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Đã sao chép liên kết bài viết");
        sharedOk = true;
      }
    } catch (err) {
      // AbortError khi user huỷ share sheet — không toast lỗi
      if (err?.name !== "AbortError") {
        try {
          await navigator.clipboard.writeText(url);
          toast.success("Đã sao chép liên kết bài viết");
          sharedOk = true;
        } catch {
          toast.error("Không chia sẻ được. Hãy copy URL trên thanh địa chỉ.");
        }
      }
    }
    if (sharedOk) {
      sharePost(post._id).catch(() => {});
    }
  };

  const requireLogin = useRequireLogin(me);
  const handleReact = async (type) => {
    if (!requireLogin()) return;
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
    <Card sx={{ borderRadius: 3, mb: 2, overflow: "hidden", maxWidth: "100%" }}>
      <CardContent sx={{ px: { xs: 1.5, sm: 2 }, overflow: "hidden" }}>
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
          <TournamentBubbleCard tour={post.linkedTournament} variant="feed" />
        )}
        {post.sharedMatch && <SharedMatchCard sm={post.sharedMatch} nav={nav} />}
        {post.sharedListing && <SharedListingCard sl={post.sharedListing} nav={nav} />}
        {post.sharedPlay && <SharedPlayCard sp={post.sharedPlay} nav={nav} />}
        {poll && <PollBlock poll={poll} onVote={handleVote} />}
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
                onClick={() => setLightboxIndex(i)}
                sx={{
                  bgcolor: "action.hover",
                  borderRadius: 2,
                  overflow: "hidden",
                  maxHeight: 480,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  position: "relative",
                }}
              >
                {m.type === "image" ? (
                  <img
                    src={m.url}
                    alt=""
                    style={{ width: "100%", height: "auto", display: "block" }}
                  />
                ) : (
                  <>
                    <video
                      src={m.url}
                      style={{
                        width: "100%",
                        maxHeight: 480,
                        pointerEvents: "none",
                      }}
                      preload="metadata"
                    />
                    <Box
                      sx={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        bgcolor: "rgba(0,0,0,0.25)",
                        color: "#fff",
                        fontSize: 48,
                      }}
                    >
                      ▶
                    </Box>
                  </>
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
          sx={{ mt: 1, color: "text.secondary", fontSize: 13, flexWrap: "wrap" }}
        >
          <Box
            component="span"
            onClick={() =>
              (post.reactionCount || 0) > 0 && setPostReactorsOpen(true)
            }
            sx={{
              cursor: (post.reactionCount || 0) > 0 ? "pointer" : "default",
              "&:hover": {
                textDecoration:
                  (post.reactionCount || 0) > 0 ? "underline" : "none",
              },
            }}
          >
            {post.reactionCount || 0} lượt cảm xúc
          </Box>
          <span>{post.commentCount || 0} bình luận</span>
          {(post.shareCount || 0) > 0 && (
            <span>{post.shareCount} lượt chia sẻ</span>
          )}
        </Stack>

        <Divider sx={{ my: 1 }} />

        <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }} useFlexGap>
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
            startIcon={<Share2 size={16} />}
            onClick={handleShare}
            sx={{ textTransform: "none", color: "text.secondary" }}
          >
            Chia sẻ
          </Button>
          <Button
            size="small"
            startIcon={<Bookmark size={16} fill={saved ? "currentColor" : "none"} />}
            onClick={handleToggleSave}
            sx={{
              textTransform: "none",
              color: saved ? "primary.main" : "text.secondary",
              fontWeight: saved ? 700 : 400,
            }}
          >
            {saved ? "Đã lưu" : "Lưu"}
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

        {/* Preview 2 bình luận gần nhất — chỉ hiện khi thread chưa mở */}
        {!showComments && post.recentComments?.length > 0 && (
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {post.recentComments.map((c) => (
              <Stack
                key={c._id}
                direction="row"
                spacing={1}
                alignItems="flex-start"
              >
                <Avatar
                  src={c.author?.avatar || ""}
                  sx={{
                    width: 28,
                    height: 28,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                  onClick={() =>
                    c.author?._id && nav(`/profile/${c.author._id}`)
                  }
                >
                  {authorName(c.author)[0]?.toUpperCase()}
                </Avatar>
                <Box
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    bgcolor: "action.hover",
                    borderRadius: 2,
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  <Typography
                    variant="caption"
                    fontWeight={700}
                    sx={{
                      cursor: "pointer",
                      "&:hover": { textDecoration: "underline" },
                    }}
                    onClick={() =>
                      c.author?._id && nav(`/profile/${c.author._id}`)
                    }
                  >
                    {authorName(c.author)}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ wordBreak: "break-word" }}
                  >
                    <MentionText
                      content={c.content}
                      mentions={c.mentions}
                    />
                  </Typography>
                </Box>
              </Stack>
            ))}
            {(post.commentCount || 0) > post.recentComments.length && (
              <Button
                size="small"
                onClick={() => setShowComments(true)}
                sx={{
                  textTransform: "none",
                  alignSelf: "flex-start",
                  color: "text.secondary",
                  fontWeight: 600,
                  fontSize: 12,
                  ml: 4.5,
                }}
              >
                Xem thêm {post.commentCount - post.recentComments.length} bình
                luận
              </Button>
            )}
          </Stack>
        )}

        {showComments && (
          <CommentThread postId={post._id} me={me} canModerate={canModerate} />
        )}
      </CardContent>
      <ReactorsDialog
        open={postReactorsOpen}
        onClose={() => setPostReactorsOpen(false)}
        postId={postReactorsOpen ? String(post._id) : null}
      />
      <FeedMediaLightbox
        open={lightboxIndex >= 0}
        onClose={() => setLightboxIndex(-1)}
        post={post}
        initialIndex={Math.max(0, lightboxIndex)}
        sidebar={
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              overflow: "hidden",
            }}
          >
            <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Avatar
                  src={post.author?.avatar || ""}
                  sx={{ width: 40, height: 40, cursor: "pointer" }}
                  onClick={() =>
                    post.author?._id && nav(`/profile/${post.author._id}`)
                  }
                >
                  {authorName(post.author)[0]?.toUpperCase()}
                </Avatar>
                <Box flex={1} minWidth={0}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    {authorName(post.author)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {fmtTime(post.createdAt)}
                  </Typography>
                </Box>
              </Stack>
              {post.content && (
                <Box sx={{ mt: 1.5 }}>
                  <MentionText
                    content={post.content}
                    mentions={post.mentions}
                  />
                </Box>
              )}
              <Stack
                direction="row"
                spacing={3}
                sx={{
                  mt: 1.5,
                  color: "text.secondary",
                  fontSize: 13,
                }}
              >
                <Box
                  component="span"
                  onClick={() =>
                    (post.reactionCount || 0) > 0 &&
                    setPostReactorsOpen(true)
                  }
                  sx={{
                    cursor:
                      (post.reactionCount || 0) > 0 ? "pointer" : "default",
                  }}
                >
                  {post.reactionCount || 0} cảm xúc
                </Box>
                <span>{post.commentCount || 0} bình luận</span>
              </Stack>
              <Divider sx={{ my: 1 }} />
              <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                <ReactionBar post={post} onReact={handleReact} />
                <Button
                  size="small"
                  startIcon={<Share2 size={16} />}
                  onClick={handleShare}
                  sx={{
                    textTransform: "none",
                    color: "text.secondary",
                  }}
                >
                  Chia sẻ
                </Button>
              </Stack>
            </Box>
            <Box sx={{ flex: 1, overflowY: "auto", px: 2, py: 1 }}>
              <CommentThread
                postId={post._id}
                me={me}
                canModerate={canModerate}
              />
            </Box>
          </Box>
        }
      />

      <Dialog open={menuAnchor} onClose={() => setMenuAnchor(false)}>
        <DialogTitle>Tuỳ chọn</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ minWidth: 240 }}>
            {isMine && (
              <Button
                startIcon={<Pencil size={16} />}
                onClick={() => {
                  setMenuAnchor(false);
                  setEditContent(post.content || "");
                  setEditOpen(true);
                }}
              >
                Sửa bài viết
              </Button>
            )}
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

      {/* Sửa bài viết */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>Sửa bài viết</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            minRows={3}
            autoFocus
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            placeholder="Nội dung bài viết…"
            sx={{ mt: 1 }}
          />
          {(post.sharedListing || post.sharedPlay || post.sharedMatch) && (
            <Typography sx={{ mt: 1, fontSize: 12.5, color: "text.secondary" }}>
              * Phần đính kèm (sản phẩm/kèo/trận) được giữ nguyên.
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditOpen(false)}>Huỷ</Button>
          <Button
            variant="contained"
            onClick={async () => {
              try {
                await updatePost({ id: post._id, content: editContent }).unwrap();
                toast.success("Đã cập nhật bài viết");
                setEditOpen(false);
              } catch (e) {
                toast.error(e?.data?.message || "Cập nhật thất bại");
              }
            }}
          >
            Lưu
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

/* ─────────── FeedPage ─────────── */
export default function FeedPage() {
  const me = useSelector((s) => s.auth?.userInfo);
  const navigate = useNavigate();
  const { postId } = useParams();
  const [tagFilter, setTagFilter] = useState("");
  const [cursor, setCursor] = useState(null);
  const singlePostQ = useGetFeedPostQuery(postId, { skip: !postId });
  const { data, isFetching, refetch } = useListFeedQuery(
    {
      tag: tagFilter || undefined,
      cursor,
      limit: 10,
    },
    { skip: !!postId },
  );
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

  // Guest xem được feed nhưng khi thao tác thì bị bounce sang /login qua
  // requireLogin() helper (xem PostCard / CommentThread).

  // Single-post view (/feed/post/:postId)
  if (postId) {
    const singlePost = singlePostQ.data;
    const singleAuthorName =
      singlePost?.author?.nickname ||
      singlePost?.author?.name ||
      "Bài viết";
    return (
      <Box
        sx={{
          maxWidth: 720,
          width: "100%",
          mx: "auto",
          px: { xs: 1, md: 2 },
          py: 2,
          overflowX: "hidden",
        }}
      >
        <SEOHead
          title={`${singleAuthorName} · Bảng tin | Pickletour`}
          description={
            (singlePost?.content || "").slice(0, 160) ||
            "Bài viết trên Bảng tin PickleTour"
          }
          ogImage={
            singlePost?.media?.find((m) => m.type === "image")?.url ||
            singlePost?.author?.avatar
          }
          path={`/feed/post/${postId}`}
        />
        <Button
          startIcon={<ArrowLeft size={16} />}
          onClick={() => navigate("/feed")}
          sx={{ textTransform: "none", mb: 1.5 }}
        >
          Về Bảng tin
        </Button>
        {singlePostQ.isLoading && (
          <Box textAlign="center" py={4}>
            <CircularProgress />
          </Box>
        )}
        {singlePostQ.error && (
          <Box textAlign="center" py={4} color="text.secondary">
            Không tìm thấy bài viết hoặc bài đã bị xoá.
          </Box>
        )}
        {singlePost && (
          <PostCard post={singlePost} me={me} defaultShowComments />
        )}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        maxWidth: 1200,
        width: "100%",
        mx: "auto",
        px: { xs: 1, md: 2 },
        py: 2,
        overflowX: "hidden",
      }}
    >
      <SEOHead
        title="Bảng tin | Pickletour"
        description="Chia sẻ khoảnh khắc, video, thảo luận trong cộng đồng Pickleball."
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0,1fr)", md: "minmax(0,1fr) 320px" },
          gap: { xs: 0, md: 3 },
          alignItems: "start",
        }}
      >
        {/* Feed column */}
        <Box
          sx={{
            maxWidth: { xs: "100%", md: 680 },
            width: "100%",
            minWidth: 0,
            mx: { xs: "auto", md: 0 },
            ml: { md: "auto" },
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 2 }}
          >
            <Typography variant="h5" fontWeight={800}>
              Bảng tin
            </Typography>
            <Select
              size="small"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              displayEmpty
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">Tất cả hashtag</MenuItem>
              <MenuItem value="pickleball">#pickleball</MenuItem>
              <MenuItem value="highlight">#highlight</MenuItem>
              <MenuItem value="training">#training</MenuItem>
            </Select>
          </Stack>

          {me ? (
            <Composer me={me} onPosted={handleRefresh} />
          ) : (
            <GuestBanner onLogin={() => navigate("/login")} />
          )}

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
              sx={{
                textAlign: "center",
                color: "text.secondary",
                py: 2,
                fontSize: 12,
              }}
            >
              — Đã xem hết bài viết —
            </Typography>
          )}
          <Box ref={sentinelRef} sx={{ height: 1 }} />
        </Box>

        {/* Right sidebar — chỉ hiện trên desktop */}
        <Box
          sx={{
            display: { xs: "none", md: "block" },
            width: "100%",
          }}
        >
          <FriendSuggestionsCard />
        </Box>
      </Box>
    </Box>
  );
}
