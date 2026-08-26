/* eslint-disable react/prop-types */
import React, { useState } from "react";
import {
  Stack,
  Box,
  Button,
  Typography,
  IconButton,
  Dialog,
  Skeleton,
} from "@mui/material";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import CloseIcon from "@mui/icons-material/Close";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  useListPhotosQuery,
  useAddPhotosMutation,
  useDeletePhotoMutation,
} from "../../slices/clubsApiSlice";
import { useUploadAvatarMutation } from "../../slices/uploadApiSlice";

const getApiErrMsg = (e) =>
  e?.data?.message ||
  e?.error ||
  (typeof e?.data === "string" ? e.data : "Có lỗi xảy ra.");

export default function ClubGallery({ club, canManage }) {
  const clubId = club?._id;
  const isMember = !!club?._my?.isMember;
  const authIdA = useSelector((s) => s.auth?.userInfo?._id);
  const authIdB = useSelector((s) => s.user?.userInfo?._id);
  const authUserId = authIdA ?? authIdB ?? null;

  const { data, isLoading } = useListPhotosQuery(
    { id: clubId },
    { skip: !clubId },
  );
  const [uploadAvatar, { isLoading: uploading }] = useUploadAvatarMutation();
  const [addPhotos] = useAddPhotosMutation();
  const [deletePhoto] = useDeletePhotoMutation();
  const [preview, setPreview] = useState(null);

  const items = data?.items || [];

  const onPick = async (e) => {
    const files = [...(e.target.files || [])].slice(0, 10);
    e.target.value = "";
    if (!files.length) return;
    try {
      const urls = [];
      for (const f of files) {
        const res = await uploadAvatar(f).unwrap();
        const url =
          res?.url || res?.secure_url || res?.data?.url || res?.Location || "";
        if (url) urls.push(url);
      }
      if (urls.length) {
        await addPhotos({ id: clubId, photos: urls.map((u) => ({ url: u })) }).unwrap();
        toast.success(`Đã thêm ${urls.length} ảnh`);
      } else toast.error("Tải ảnh thất bại.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const remove = async (p) => {
    if (!window.confirm("Xoá ảnh này?")) return;
    try {
      await deletePhoto({ id: clubId, photoId: p._id }).unwrap();
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  return (
    <Stack spacing={2}>
      {isMember && (
        <Box>
          <Button
            variant="contained"
            component="label"
            startIcon={<PhotoLibraryIcon />}
            disabled={uploading}
          >
            {uploading ? "Đang tải…" : "Thêm ảnh"}
            <input hidden type="file" accept="image/*" multiple onChange={onPick} />
          </Button>
        </Box>
      )}

      {isLoading ? (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 1 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" sx={{ pt: "100%" }} />
          ))}
        </Box>
      ) : items.length === 0 ? (
        <Box sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
          <PhotoLibraryIcon sx={{ fontSize: 40, opacity: 0.5 }} />
          <Typography sx={{ mt: 1 }}>Chưa có ảnh nào.</Typography>
        </Box>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 1 }}>
          {items.map((p) => {
            const canDel =
              String(p.uploadedBy?._id) === String(authUserId) || canManage;
            return (
              <Box
                key={p._id}
                sx={{ position: "relative", pt: "100%", borderRadius: 2, overflow: "hidden", bgcolor: "action.hover" }}
              >
                <Box
                  component="img"
                  src={p.url}
                  alt={p.caption || ""}
                  onClick={() => setPreview(p.url)}
                  sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }}
                />
                {canDel && (
                  <IconButton
                    size="small"
                    onClick={() => remove(p)}
                    sx={{ position: "absolute", top: 4, right: 4, bgcolor: "rgba(0,0,0,.5)", color: "#fff", "&:hover": { bgcolor: "rgba(0,0,0,.7)" } }}
                  >
                    <DeleteOutline fontSize="inherit" />
                  </IconButton>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <Dialog open={!!preview} onClose={() => setPreview(null)} maxWidth="lg">
        <Box sx={{ position: "relative", bgcolor: "#000" }}>
          <IconButton
            onClick={() => setPreview(null)}
            sx={{ position: "absolute", top: 8, right: 8, color: "#fff", bgcolor: "rgba(255,255,255,.15)" }}
          >
            <CloseIcon />
          </IconButton>
          {preview && (
            <Box
              component="img"
              src={preview}
              alt=""
              sx={{ display: "block", maxWidth: "90vw", maxHeight: "85vh" }}
            />
          )}
        </Box>
      </Dialog>
    </Stack>
  );
}
