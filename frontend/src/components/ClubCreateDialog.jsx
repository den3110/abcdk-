// src/components/ClubCreateDialog.jsx
/* eslint-disable react/prop-types */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Stack,
  Button,
  MenuItem,
  Chip,
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Avatar,
  LinearProgress,
  Grid,
  Switch,
  FormControlLabel,
} from "@mui/material";
import PhotoCamera from "@mui/icons-material/PhotoCamera";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import { toast } from "react-toastify";

import {
  useCreateClubMutation,
  useUpdateClubMutation,
} from "../slices/clubsApiSlice";
import { useUploadAvatarMutation } from "../slices/uploadApiSlice";

// ====== Options ======
const SPORT_OPTIONS = ["pickleball"];

const VN_PROVINCES = [
  "An Giang",
  "Bà Rịa - Vũng Tàu",
  "Bắc Giang",
  "Bắc Kạn",
  "Bạc Liêu",
  "Bắc Ninh",
  "Bến Tre",
  "Bình Dương",
  "Bình Định",
  "Bình Phước",
  "Bình Thuận",
  "Cà Mau",
  "Cần Thơ",
  "Cao Bằng",
  "Đà Nẵng",
  "Đắk Lắk",
  "Đắk Nông",
  "Điện Biên",
  "Đồng Nai",
  "Đồng Tháp",
  "Gia Lai",
  "Hà Giang",
  "Hà Nam",
  "Hà Nội",
  "Hà Tĩnh",
  "Hải Dương",
  "Hải Phòng",
  "Hậu Giang",
  "Hòa Bình",
  "Hưng Yên",
  "Khánh Hòa",
  "Kiên Giang",
  "Kon Tum",
  "Lai Châu",
  "Lâm Đồng",
  "Lạng Sơn",
  "Lào Cai",
  "Long An",
  "Nam Định",
  "Nghệ An",
  "Ninh Bình",
  "Ninh Thuận",
  "Phú Thọ",
  "Phú Yên",
  "Quảng Bình",
  "Quảng Nam",
  "Quảng Ngãi",
  "Quảng Ninh",
  "Quảng Trị",
  "Sóc Trăng",
  "Sơn La",
  "Tây Ninh",
  "Thái Bình",
  "Thái Nguyên",
  "Thanh Hóa",
  "Thừa Thiên Huế",
  "Tiền Giang",
  "TP. Hồ Chí Minh",
  "Trà Vinh",
  "Tuyên Quang",
  "Vĩnh Long",
  "Vĩnh Phúc",
  "Yên Bái",
];

// Hiển thị CLB
const VISIBILITY_OPTIONS = ["public", "private", "hidden"];
const VISIBILITY_LABELS = {
  public: "Công khai",
  private: "Riêng tư",
  hidden: "Ẩn (không hiển thị)",
};
const VISIBILITY_HINTS = {
  public:
    "Ai cũng tìm thấy & xem trang CLB. Quyền tham gia phụ thuộc chính sách gia nhập.",
  private:
    "Người lạ không xem được chi tiết (chỉ thấy giới thiệu cơ bản). Thành viên xem đầy đủ.",
  hidden:
    "CLB không xuất hiện trong tìm kiếm/danh sách. Chỉ người được mời mới biết & tham gia.",
};

// Chính sách gia nhập
const JOIN_POLICY_OPTIONS = ["open", "approval", "invite_only"];
const JOIN_POLICY_LABELS = {
  open: "Tự do (không cần duyệt)",
  approval: "Duyệt tham gia",
  invite_only: "Chỉ mời",
};
const JOIN_POLICY_HINTS = {
  open: "Bất kỳ ai cũng có thể vào CLB ngay.",
  approval: "Người xin gia nhập sẽ chờ quản trị duyệt.",
  invite_only: "Chỉ thành viên quản trị mời trực tiếp.",
};

// Quyền xem danh sách thành viên
const MEMBER_VIS_OPTIONS = [
  { value: "admins", label: "Chỉ quản trị (Owner/Admin)" },
  { value: "members", label: "Thành viên CLB" },
  { value: "public", label: "Mọi người" },
];

// ====== Helpers ======
function extractErrorMessage(err) {
  if (!err) return "Đã xảy ra lỗi không xác định";
  if (typeof err === "string") return err;
  if (err?.data?.message) return err.data.message;
  if (Array.isArray(err?.data?.errors) && err.data.errors.length > 0) {
    return err.data.errors.map((e) => e.message || e).join(", ");
  }
  if (err?.error) return err.error;
  if (err?.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return "Đã xảy ra lỗi";
  }
}

// ràng buộc hợp lệ giữa visibility ↔ joinPolicy
function getAllowedJoinPolicies(visibility) {
  if (visibility === "hidden") return ["invite_only"];
  if (visibility === "private") return ["approval", "invite_only"];
  return ["open", "approval", "invite_only"]; // public
}

// ràng buộc visibility ↔ memberVisibility
function getAllowedMemberVis(visibility) {
  if (visibility === "hidden") return ["admins"];
  if (visibility === "private") return ["admins", "members"];
  return ["admins", "members", "public"]; // public
}

function validateImageFile(file) {
  const maxSize = 5 * 1024 * 1024; // 5MB
  const okTypes = ["image/png", "image/jpeg", "image/webp", "image/avif"];
  if (!okTypes.includes(file.type))
    return "Chỉ chấp nhận PNG, JPEG, WEBP, AVIF.";
  if (file.size > maxSize) return "Dung lượng ảnh tối đa 5MB.";
  return null;
}

// đôi khi backend trả res khác nhau, thử lấy url an toàn
const pickUrl = (res) =>
  res?.url || res?.secure_url || res?.data?.url || res?.Location || "";

// ====== Component ======
export default function ClubCreateDialog({ open, onClose, initial }) {
  const [form, setForm] = useState(() => ({
    name: initial?.name || "",
    description: initial?.description || "",
    sportTypes: initial?.sportTypes || ["pickleball"],
    visibility: initial?.visibility || "public",
    joinPolicy: initial?.joinPolicy || "approval",
    memberVisibility: initial?.memberVisibility || "admins",
    showRolesToMembers: !!initial?.showRolesToMembers,
    province: initial?.province || "",
    city: initial?.city || "",
    shortCode: initial?.shortCode || "",
    logoUrl: initial?.logoUrl || "",
    coverUrl: initial?.coverUrl || "",
  }));

  useEffect(() => {
    if (!open) return;
    setForm({
      name: initial?.name || "",
      description: initial?.description || "",
      sportTypes: initial?.sportTypes || ["pickleball"],
      visibility: initial?.visibility || "public",
      joinPolicy: initial?.joinPolicy || "approval",
      memberVisibility: initial?.memberVisibility || "admins",
      showRolesToMembers: !!initial?.showRolesToMembers,
      province: initial?.province || "",
      city: initial?.city || "",
      shortCode: initial?.shortCode || "",
      logoUrl: initial?.logoUrl || "",
      coverUrl: initial?.coverUrl || "",
    });
  }, [open, initial]);

  const isEdit = !!initial?._id;
  const [createClub, { isLoading: creating }] = useCreateClubMutation();
  const [updateClub, { isLoading: updating }] = useUpdateClubMutation();

  const [uploadAvatar, { isLoading: uploading }] = useUploadAvatarMutation();

  const logoInputRef = useRef(null);
  const coverInputRef = useRef(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [coverPreview, setCoverPreview] = useState(null);

  useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [logoPreview, coverPreview]);

  const handlePickLogo = () => logoInputRef.current?.click();
  const handlePickCover = () => coverInputRef.current?.click();

  const doUpload = async (file, field) => {
    const err = validateImageFile(file);
    if (err) return toast.error(err);

    // preview local
    const localUrl = URL.createObjectURL(file);
    if (field === "logoUrl") {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      setLogoPreview(localUrl);
    } else {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
      setCoverPreview(localUrl);
    }

    try {
      const res = await uploadAvatar(file).unwrap();
      const url = pickUrl(res);
      if (!url) return toast.error("Upload thất bại: server không trả URL.");
      setForm((f) => ({ ...f, [field]: url }));
      toast.success("Tải ảnh thành công!");
    } catch (e) {
      toast.error(`Upload lỗi: ${extractErrorMessage(e)}`);
    }
  };

  const onLogoFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    doUpload(file, "logoUrl");
    e.target.value = "";
  };
  const onCoverFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    doUpload(file, "coverUrl");
    e.target.value = "";
  };

  // Ràng buộc policy theo visibility
  const allowedJoinPolicies = useMemo(
    () => getAllowedJoinPolicies(form.visibility),
    [form.visibility]
  );
  useEffect(() => {
    if (!allowedJoinPolicies.includes(form.joinPolicy)) {
      setForm((f) => ({ ...f, joinPolicy: allowedJoinPolicies[0] }));
    }
  }, [allowedJoinPolicies, form.joinPolicy]);

  const allowedMemberVis = useMemo(
    () => getAllowedMemberVis(form.visibility),
    [form.visibility]
  );
  useEffect(() => {
    if (!allowedMemberVis.includes(form.memberVisibility)) {
      setForm((f) => ({ ...f, memberVisibility: allowedMemberVis[0] }));
    }
  }, [allowedMemberVis, form.memberVisibility]);

  const canSubmit = useMemo(() => form.name.trim().length >= 3, [form.name]);

  const onSubmit = async () => {
    if (uploading) return toast.info("Đang tải ảnh, vui lòng đợi xíu…");
    const body = { ...form };
    const loadingId = toast.loading(
      isEdit ? "Đang lưu CLB..." : "Đang tạo CLB..."
    );

    try {
      const res = isEdit
        ? await updateClub({ id: initial._id, ...body }).unwrap()
        : await createClub(body).unwrap();

      toast.update(loadingId, {
        render:
          res?.message ||
          (isEdit ? "Đã lưu CLB thành công" : "Tạo CLB thành công"),
        type: "success",
        isLoading: false,
        autoClose: 2500,
        closeOnClick: true,
      });
      onClose?.(true);
    } catch (err) {
      toast.update(loadingId, {
        render: `Lỗi: ${extractErrorMessage(err)}`,
        type: "error",
        isLoading: false,
        autoClose: 4000,
        closeOnClick: true,
      });
    }
  };

  const logoSrc = logoPreview || form.logoUrl || "";
  const coverSrc = coverPreview || form.coverUrl || "";

  return (
    <Dialog
      open={open}
      onClose={() => onClose?.(false)}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>{isEdit ? "Sửa CLB" : "Tạo CLB"}</DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {/* Tên + mô tả */}
          <TextField
            label="Tên CLB"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            helperText="Tối thiểu 3 ký tự."
          />
          <TextField
            label="Mô tả"
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            multiline
            minRows={3}
            placeholder="Giới thiệu ngắn gọn về CLB của bạn…"
          />

          {/* Hình ảnh */}
          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            {uploading && <LinearProgress />}
            <CardHeader
              title="Hình ảnh CLB"
              subheader="Tải ảnh từ máy hoặc dán URL"
            />
            <CardContent>
              {/* Ảnh bìa */}
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Ảnh bìa
              </Typography>
              <Box
                sx={{
                  position: "relative",
                  width: "100%",
                  borderRadius: 2,
                  overflow: "hidden",
                  bgcolor: "background.default",
                  border: "1px dashed",
                  borderColor: "divider",
                  mb: 2,
                  // Responsive: bớt to trên mobile
                  aspectRatio: { xs: "4 / 3", sm: "16 / 9" },
                  maxHeight: { xs: 220, sm: 260, md: 300 },
                }}
              >
                {coverSrc ? (
                  <Box
                    component="img"
                    alt="Cover"
                    src={coverSrc}
                    sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <Box
                    sx={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "text.secondary",
                      fontSize: 14,
                    }}
                  >
                    Ảnh bìa (tỷ lệ 16:9, ≤ 5MB)
                  </Box>
                )}
              </Box>

              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                sx={{ mb: 2 }}
              >
                <Button
                  variant="outlined"
                  startIcon={<PhotoCamera />}
                  onClick={handlePickCover}
                >
                  Chọn ảnh bìa
                </Button>
                {coverSrc && (
                  <Button
                    color="error"
                    startIcon={<DeleteOutline />}
                    onClick={() => {
                      if (coverPreview) URL.revokeObjectURL(coverPreview);
                      setCoverPreview(null);
                      setForm((f) => ({ ...f, coverUrl: "" }));
                    }}
                  >
                    Gỡ ảnh bìa
                  </Button>
                )}
              </Stack>

              <TextField
                label="Cover URL"
                value={form.coverUrl}
                onChange={(e) =>
                  setForm((f) => ({ ...f, coverUrl: e.target.value }))
                }
                fullWidth
                size="small"
                placeholder="Dán URL ảnh bìa (tuỳ chọn)…"
                sx={{ mb: 3 }}
              />

              {/* Logo */}
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Logo
              </Typography>
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{ mb: 1.5 }}
              >
                <Avatar
                  src={logoSrc || undefined}
                  alt="Logo"
                  sx={{
                    width: 72,
                    height: 72,
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                />
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  sx={{ flex: 1 }}
                >
                  <Button
                    variant="outlined"
                    startIcon={<PhotoCamera />}
                    onClick={handlePickLogo}
                  >
                    Chọn logo
                  </Button>
                  {logoSrc && (
                    <Button
                      color="error"
                      startIcon={<DeleteOutline />}
                      onClick={() => {
                        if (logoPreview) URL.revokeObjectURL(logoPreview);
                        setLogoPreview(null);
                        setForm((f) => ({ ...f, logoUrl: "" }));
                      }}
                    >
                      Gỡ logo
                    </Button>
                  )}
                </Stack>
              </Stack>

              <TextField
                label="Logo URL"
                value={form.logoUrl}
                onChange={(e) =>
                  setForm((f) => ({ ...f, logoUrl: e.target.value }))
                }
                fullWidth
                size="small"
                placeholder="Dán URL logo (tuỳ chọn)…"
              />

              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 1 }}
              >
                Gợi ý: Logo vuông (1:1). Ảnh bìa ≥ 1280×720, dung lượng ≤ 5MB.
              </Typography>
            </CardContent>
          </Card>

          {/* Cấu hình hiển thị & quyền */}
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <TextField
                select
                label="Hiển thị"
                value={form.visibility}
                onChange={(e) =>
                  setForm((f) => ({ ...f, visibility: e.target.value }))
                }
                fullWidth
                helperText={VISIBILITY_HINTS[form.visibility]}
              >
                {VISIBILITY_OPTIONS.map((v) => (
                  <MenuItem key={v} value={v}>
                    {VISIBILITY_LABELS[v]}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                select
                label="Chính sách gia nhập"
                value={form.joinPolicy}
                onChange={(e) =>
                  setForm((f) => ({ ...f, joinPolicy: e.target.value }))
                }
                fullWidth
                helperText={JOIN_POLICY_HINTS[form.joinPolicy]}
              >
                {JOIN_POLICY_OPTIONS.map((jp) => (
                  <MenuItem
                    key={jp}
                    value={jp}
                    disabled={!allowedJoinPolicies.includes(jp)}
                  >
                    {JOIN_POLICY_LABELS[jp]}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid item xs={12} md={7}>
              <TextField
                select
                label="Ai được xem danh sách thành viên"
                value={form.memberVisibility}
                onChange={(e) =>
                  setForm((f) => ({ ...f, memberVisibility: e.target.value }))
                }
                fullWidth
                helperText="Ẩn/Hiện danh sách thành viên theo chế độ CLB."
              >
                {MEMBER_VIS_OPTIONS.map((opt) => (
                  <MenuItem
                    key={opt.value}
                    value={opt.value}
                    disabled={!allowedMemberVis.includes(opt.value)}
                  >
                    {opt.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid
              item
              xs={12}
              md={5}
              sx={{ display: "flex", alignItems: "center" }}
            >
              <FormControlLabel
                control={
                  <Switch
                    checked={!!form.showRolesToMembers}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        showRolesToMembers: e.target.checked,
                      }))
                    }
                  />
                }
                label="Hiện nhãn Admin/Owner cho thành viên"
              />
            </Grid>
          </Grid>

          {form.visibility === "hidden" && (
            <Typography variant="caption" color="text.secondary">
              * Ở chế độ <strong>Ẩn</strong>, CLB sẽ <strong>chỉ mời</strong>;
              danh sách thành viên chỉ quản trị xem được.
            </Typography>
          )}

          {/* Môn thể thao */}
          <TextField
            select
            SelectProps={{
              multiple: true,
              renderValue: (sel) => (
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  {sel.map((s) => (
                    <Chip key={s} label={s} />
                  ))}
                </Box>
              ),
            }}
            label="Môn thể thao"
            value={form.sportTypes}
            onChange={(e) =>
              setForm((f) => ({ ...f, sportTypes: e.target.value }))
            }
          >
            {SPORT_OPTIONS.map((v) => (
              <MenuItem key={v} value={v}>
                {v}
              </MenuItem>
            ))}
          </TextField>

          {/* Địa chỉ */}
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <TextField
                select
                label="Tỉnh/Thành"
                value={form.province}
                onChange={(e) =>
                  setForm((f) => ({ ...f, province: e.target.value }))
                }
                fullWidth
              >
                <MenuItem value="">— Chọn tỉnh/thành —</MenuItem>
                {VN_PROVINCES.map((p) => (
                  <MenuItem key={p} value={p}>
                    {p}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Quận/Huyện"
                value={form.city}
                onChange={(e) =>
                  setForm((f) => ({ ...f, city: e.target.value }))
                }
                fullWidth
                placeholder="VD: Quận 1, TP. Thủ Đức…"
              />
            </Grid>
          </Grid>

          {/* Mã ngắn */}
          <TextField
            label="Mã ngắn (Short code)"
            value={form.shortCode}
            onChange={(e) =>
              setForm((f) => ({ ...f, shortCode: e.target.value }))
            }
            placeholder="VD: PBC, HN-PB…"
          />
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={() => onClose?.(false)}>Huỷ</Button>
        <Button
          variant="contained"
          disabled={!canSubmit || creating || updating || uploading}
          onClick={onSubmit}
        >
          {isEdit ? "Lưu" : "Tạo"}
        </Button>
      </DialogActions>

      {/* input file ẩn */}
      <input
        ref={coverInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        hidden
        onChange={onCoverFileChange}
      />
      <input
        ref={logoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        hidden
        onChange={onLogoFileChange}
      />
    </Dialog>
  );
}
