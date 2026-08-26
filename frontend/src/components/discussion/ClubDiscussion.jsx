/* eslint-disable react/prop-types */
import React, { useState } from "react";
import {
  Stack,
  Card,
  CardContent,
  CardHeader,
  Avatar,
  Typography,
  Button,
  TextField,
  Box,
  IconButton,
  Divider,
  Link,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import FavoriteIcon from "@mui/icons-material/Favorite";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import SendIcon from "@mui/icons-material/Send";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import ForumIcon from "@mui/icons-material/Forum";
import ImageOutlined from "@mui/icons-material/ImageOutlined";
import CloseIcon from "@mui/icons-material/Close";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import dayjs from "dayjs";
import {
  useListPostsQuery,
  useCreatePostMutation,
  useDeletePostMutation,
  useReactPostMutation,
  useListPostCommentsQuery,
  useCreatePostCommentMutation,
  useDeletePostCommentMutation,
} from "../../slices/clubsApiSlice";
import { useUploadAvatarMutation } from "../../slices/uploadApiSlice";

const getApiErrMsg = (e) =>
  e?.data?.message ||
  e?.error ||
  (typeof e?.data === "string" ? e.data : "Có lỗi xảy ra.");
const fmt = (s) => dayjs(s).format("HH:mm, DD/MM/YYYY");

function Comments({ clubId, postId, isMember, canManage, authUserId }) {
  const { data, isFetching } = useListPostCommentsQuery({ id: clubId, postId });
  const [createComment, { isLoading }] = useCreatePostCommentMutation();
  const [delComment] = useDeletePostCommentMutation();
  const [text, setText] = useState("");
  const comments = data?.items || [];

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      await createComment({ id: clubId, postId, content: t }).unwrap();
      setText("");
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };
  const remove = async (c) => {
    try {
      await delComment({ id: clubId, postId, commentId: c._id }).unwrap();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  return (
    <>
      <Divider sx={{ my: 1.5 }} />
      <Stack spacing={1.25}>
        {isFetching && comments.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            Đang tải bình luận…
          </Typography>
        ) : (
          comments.map((c) => {
            const canDel =
              String(c.author?._id) === String(authUserId) || canManage;
            return (
              <Stack key={c._id} direction="row" spacing={1.25} alignItems="flex-start">
                <Avatar
                  src={c.author?.avatar}
                  sx={{ width: 30, height: 30 }}
                />
                <Box
                  sx={{
                    flex: 1,
                    bgcolor: "action.hover",
                    borderRadius: 2,
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Link
                      component={RouterLink}
                      to={`/user/${c.author?._id}`}
                      underline="hover"
                      sx={{ fontWeight: 700, fontSize: "0.85rem" }}
                    >
                      {c.author?.nickname || c.author?.fullName || "Người dùng"}
                    </Link>
                    <Typography variant="caption" color="text.secondary">
                      {fmt(c.createdAt)}
                    </Typography>
                    {canDel && (
                      <IconButton
                        size="small"
                        sx={{ ml: "auto" }}
                        onClick={() => remove(c)}
                      >
                        <DeleteOutline fontSize="inherit" />
                      </IconButton>
                    )}
                  </Stack>
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                    {c.content}
                  </Typography>
                </Box>
              </Stack>
            );
          })
        )}
        {isMember && (
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              fullWidth
              placeholder="Viết bình luận…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <Button variant="contained" disabled={isLoading} onClick={submit}>
              <SendIcon fontSize="small" />
            </Button>
          </Stack>
        )}
      </Stack>
    </>
  );
}

function PostCard({ clubId, post, isMember, canManage, authUserId }) {
  const [react] = useReactPostMutation();
  const [delPost] = useDeletePostMutation();
  const [showComments, setShowComments] = useState(false);
  const canDelete =
    String(post.author?._id) === String(authUserId) || canManage;

  const doReact = async () => {
    try {
      await react({ id: clubId, postId: post._id }).unwrap();
    } catch (e) {
      if (e?.status === 401) toast.warn("Bạn cần đăng nhập.");
      else toast.error(getApiErrMsg(e));
    }
  };
  const doDelete = async () => {
    if (!window.confirm("Xoá bài viết này?")) return;
    try {
      await delPost({ id: clubId, postId: post._id }).unwrap();
      toast.success("Đã xoá bài viết");
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardHeader
        avatar={<Avatar src={post.author?.avatar} />}
        title={post.author?.nickname || post.author?.fullName || "Người dùng"}
        subheader={
          fmt(post.createdAt) +
          (post.visibility === "members" ? " · Chỉ thành viên" : "")
        }
        action={
          canDelete ? (
            <IconButton onClick={doDelete}>
              <DeleteOutline />
            </IconButton>
          ) : null
        }
      />
      <CardContent sx={{ pt: 0 }}>
        {!!post.content && (
          <Typography sx={{ whiteSpace: "pre-wrap", mb: 1 }}>
            {post.content}
          </Typography>
        )}
        {!!post.imageUrl && (
          <Box
            component="img"
            src={post.imageUrl}
            alt=""
            sx={{ maxWidth: "100%", borderRadius: 2, display: "block", mb: 1 }}
          />
        )}
        <Stack direction="row" spacing={2} alignItems="center">
          <Button
            size="small"
            color={post.myReaction ? "error" : "inherit"}
            startIcon={
              post.myReaction ? <FavoriteIcon /> : <FavoriteBorderIcon />
            }
            disabled={!isMember}
            onClick={doReact}
          >
            {post.reactionCount || 0}
          </Button>
          <Button
            size="small"
            color="inherit"
            startIcon={<ChatBubbleOutlineIcon />}
            onClick={() => setShowComments((v) => !v)}
          >
            {post.commentCount || 0}
          </Button>
        </Stack>
        {showComments && (
          <Comments
            clubId={clubId}
            postId={post._id}
            isMember={isMember}
            canManage={canManage}
            authUserId={authUserId}
          />
        )}
      </CardContent>
    </Card>
  );
}

export default function ClubDiscussion({ club, canManage }) {
  const clubId = club?._id;
  const isMember = !!club?._my?.isMember;
  const authIdA = useSelector((s) => s.auth?.userInfo?._id);
  const authIdB = useSelector((s) => s.user?.userInfo?._id);
  const authUserId = authIdA ?? authIdB ?? null;

  const { data, isLoading, isFetching } = useListPostsQuery(
    { id: clubId },
    { skip: !clubId },
  );
  const [createPost, { isLoading: posting }] = useCreatePostMutation();
  const [uploadAvatar, { isLoading: uploadingImg }] = useUploadAvatarMutation();
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const items = data?.items || [];

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const res = await uploadAvatar(file).unwrap();
      const url =
        res?.url || res?.secure_url || res?.data?.url || res?.Location || "";
      if (url) setImageUrl(url);
      else toast.error("Tải ảnh thất bại.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  const submit = async () => {
    if (!content.trim() && !imageUrl.trim())
      return toast.info("Nhập nội dung hoặc thêm ảnh.");
    try {
      await createPost({
        id: clubId,
        content,
        imageUrl: imageUrl.trim() || undefined,
      }).unwrap();
      setContent("");
      setImageUrl("");
      toast.success("Đã đăng bài");
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  return (
    <Stack spacing={2}>
      {isMember ? (
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <TextField
              fullWidth
              multiline
              minRows={2}
              placeholder="Chia sẻ điều gì đó với câu lạc bộ…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            {imageUrl && (
              <Box sx={{ position: "relative", mt: 1.5, display: "inline-block" }}>
                <Box
                  component="img"
                  src={imageUrl}
                  alt=""
                  sx={{ maxWidth: "100%", maxHeight: 260, borderRadius: 2, display: "block" }}
                />
                <IconButton
                  size="small"
                  onClick={() => setImageUrl("")}
                  sx={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    bgcolor: "rgba(0,0,0,.6)",
                    color: "#fff",
                    "&:hover": { bgcolor: "rgba(0,0,0,.75)" },
                  }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            )}
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button variant="contained" disabled={posting || uploadingImg} onClick={submit}>
                Đăng bài
              </Button>
              <Button
                component="label"
                startIcon={<ImageOutlined />}
                disabled={uploadingImg}
              >
                {uploadingImg ? "Đang tải…" : "Ảnh"}
                <input hidden type="file" accept="image/*" onChange={onPickImage} />
              </Button>
            </Stack>
          </CardContent>
        </Card>
      ) : (
        <Typography color="text.secondary">
          Tham gia câu lạc bộ để đăng bài và bình luận.
        </Typography>
      )}

      {(isLoading || isFetching) && (
        <Typography color="text.secondary">Đang tải thảo luận…</Typography>
      )}

      {items.map((p) => (
        <PostCard
          key={p._id}
          clubId={clubId}
          post={p}
          isMember={isMember}
          canManage={canManage}
          authUserId={authUserId}
        />
      ))}

      {!isLoading && !isFetching && items.length === 0 && (
        <Box sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
          <ForumIcon sx={{ fontSize: 40, opacity: 0.5 }} />
          <Typography sx={{ mt: 1 }}>Chưa có bài viết nào.</Typography>
        </Box>
      )}
    </Stack>
  );
}
