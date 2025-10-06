/* eslint-disable react/prop-types */
import React, { useState } from "react";
import {
  Stack,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Button,
  TextField,
  Box,
  Chip,
} from "@mui/material";
import { toast } from "react-toastify";
import {
  useListAnnouncementsQuery,
  useCreateAnnouncementMutation,
  useUpdateAnnouncementMutation,
  useDeleteAnnouncementMutation,
} from "../../slices/clubsApiSlice";

const getApiErrMsg = (e) =>
  e?.data?.message ||
  e?.error ||
  (typeof e?.data === "string" ? e.data : "Có lỗi xảy ra.");

export default function ClubAnnouncements({ club, canManage }) {
  const clubId = club?._id;
  const { data, isLoading, isFetching, refetch } = useListAnnouncementsQuery(
    { id: clubId },
    { skip: !clubId }
  );
  const [createA, { isLoading: creating }] = useCreateAnnouncementMutation();
  const [updateA] = useUpdateAnnouncementMutation();
  const [deleteA] = useDeleteAnnouncementMutation();

  // ✨ NEW: tiêu đề + nội dung
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const items = (data?.items || [])
    .slice()
    .sort(
      (a, b) =>
        (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
        new Date(b.createdAt) - new Date(a.createdAt)
    );

  const submit = async () => {
    if (!content.trim() && !title.trim()) {
      return toast.info("Nhập tối thiểu tiêu đề hoặc nội dung.");
    }

    // ✨ NEW: fallback tiêu đề nếu bỏ trống
    const autoTitle =
      title.trim() || content.trim().split("\n")[0].slice(0, 80) || "Thông báo";

    try {
      await createA({
        id: clubId,
        title: autoTitle,
        content: content.trim(),
      }).unwrap();

      setTitle("");
      setContent("");
      toast.success("Đã đăng thông báo");
      refetch();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  const togglePin = async (post) => {
    try {
      await updateA({
        id: clubId,
        postId: post._id,
        pinned: !post.pinned,
      }).unwrap();
      toast.success(!post.pinned ? "Đã ghim bài" : "Đã bỏ ghim");
      refetch();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  const remove = async (post) => {
    if (!window.confirm("Xoá thông báo này?")) return;
    try {
      await deleteA({ id: clubId, postId: post._id }).unwrap();
      toast.success("Đã xoá");
      refetch();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  return (
    <Stack spacing={2}>
      {canManage && (
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Stack spacing={1.5}>
              {/* ✨ NEW: ô tiêu đề */}
              <TextField
                label="Tiêu đề"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ví dụ: Thông báo lịch sinh hoạt tuần này…"
              />
              <TextField
                label="Nội dung"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                multiline
                minRows={3}
                placeholder="Chi tiết thông báo…"
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  disabled={creating}
                  onClick={submit}
                >
                  Đăng
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      {(isLoading || isFetching) && (
        <Typography color="text.secondary">Đang tải bảng tin…</Typography>
      )}

      {items.map((p) => (
        <Card key={p._id} variant="outlined" sx={{ borderRadius: 3 }}>
          <CardHeader
            title={p.title || "Thông báo"}
            subheader={new Date(p.createdAt).toLocaleString()}
            action={
              p.pinned ? (
                <Chip size="small" color="primary" label="Đã ghim" />
              ) : null
            }
          />
          <CardContent>
            {!!p.content && (
              <Typography sx={{ mb: 1.5 }}>{p.content}</Typography>
            )}
            {canManage && (
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => togglePin(p)}>
                  {p.pinned ? "Bỏ ghim" : "Ghim bài"}
                </Button>
                <Button size="small" color="error" onClick={() => remove(p)}>
                  Xoá
                </Button>
              </Stack>
            )}
          </CardContent>
        </Card>
      ))}

      {!isLoading && !isFetching && items.length === 0 && (
        <Box sx={{ color: "text.secondary" }}>
          <Typography>Chưa có thông báo nào.</Typography>
        </Box>
      )}
    </Stack>
  );
}
