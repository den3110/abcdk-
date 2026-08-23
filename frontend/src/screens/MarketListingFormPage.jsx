// src/screens/MarketListingFormPage.jsx — đăng / sửa tin trên Chợ
import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Chip from "@mui/material/Chip";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import AddPhotoAlternateRoundedIcon from "@mui/icons-material/AddPhotoAlternateRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import VerifiedUserRoundedIcon from "@mui/icons-material/VerifiedUserRounded";
import { CATEGORIES, CONDITIONS, TYPES } from "../constants/market";
import {
  useCanPostQuery,
  useUploadMarketMediaMutation,
  useCreateListingMutation,
  useUpdateListingMutation,
  useGetListingQuery,
} from "../slices/marketApiSlice";

const EMPTY = {
  title: "",
  description: "",
  category: "shoes",
  condition: "good",
  type: "sell",
  price: "",
  negotiable: true,
  tradeFor: "",
  brand: "",
  size: "",
  color: "",
  images: [],
  location: { province: "", district: "" },
  contact: { phone: "", zalo: "", showPhone: false },
  tags: [],
};

export default function MarketListingFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const { data: canPostData, isLoading: canPostLoading } = useCanPostQuery();
  const { data: existing } = useGetListingQuery(id, { skip: !isEdit });
  const [uploadMedia, { isLoading: uploading }] = useUploadMarketMediaMutation();
  const [createListing, { isLoading: creating }] = useCreateListingMutation();
  const [updateListing, { isLoading: updating }] = useUpdateListingMutation();

  const [form, setForm] = useState(EMPTY);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    if (isEdit && existing) {
      setForm({
        title: existing.title || "",
        description: existing.description || "",
        category: existing.category || "other",
        condition: existing.condition || "good",
        type: existing.type || "sell",
        price: existing.price ? String(existing.price) : "",
        negotiable: existing.negotiable ?? true,
        tradeFor: existing.tradeFor || "",
        brand: existing.brand || "",
        size: existing.size || "",
        color: existing.color || "",
        images: existing.images || [],
        location: existing.location || { province: "", district: "" },
        contact: existing.contact || { phone: "", zalo: "", showPhone: false },
        tags: existing.tags || [],
      });
    }
  }, [isEdit, existing]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onPickFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (form.images.length + files.length > 12) {
      toast.info("Tối đa 12 ảnh");
      return;
    }
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    try {
      const res = await uploadMedia(fd).unwrap();
      set("images", [...form.images, ...(res.images || [])]);
    } catch (err) {
      toast.error(err?.data?.message || "Tải ảnh thất bại");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = (i) =>
    set("images", form.images.filter((_, idx) => idx !== i));

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !form.tags.includes(t) && form.tags.length < 12) {
      set("tags", [...form.tags, t]);
    }
    setTagInput("");
  };

  const submit = async () => {
    if (!form.title.trim()) return toast.info("Vui lòng nhập tiêu đề");
    if (!form.images.length) return toast.info("Vui lòng thêm ít nhất 1 ảnh");
    const payload = {
      ...form,
      price: Number(String(form.price).replace(/\D/g, "")) || 0,
    };
    try {
      if (isEdit) {
        await updateListing({ id, ...payload }).unwrap();
        toast.success("Đã cập nhật tin");
        navigate(`/marketplace/${id}`);
      } else {
        const created = await createListing(payload).unwrap();
        toast.success("Đăng tin thành công!");
        navigate(`/marketplace/${created._id}`);
      }
    } catch (err) {
      toast.error(err?.data?.message || "Có lỗi xảy ra");
    }
  };

  if (!isEdit && canPostLoading) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", minHeight: "50vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isEdit && canPostData && !canPostData.canPost) {
    return (
      <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
        <VerifiedUserRoundedIcon sx={{ fontSize: 64, color: "warning.main" }} />
        <Typography sx={{ fontWeight: 800, fontSize: 22, mt: 1 }}>
          Cần xác minh danh tính
        </Typography>
        <Typography sx={{ color: "text.secondary", mt: 1 }}>
          {canPostData.reason ||
            "Bạn cần xác minh CCCD/KYC trước khi đăng tin mua bán để đảm bảo an toàn giao dịch."}
        </Typography>
        <Button variant="contained" sx={{ mt: 3 }} onClick={() => navigate("/profile")}>
          Xác minh ngay
        </Button>
      </Container>
    );
  }

  const busy = creating || updating || uploading;

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography sx={{ fontWeight: 900, fontSize: 26, mb: 0.5 }}>
        {isEdit ? "Sửa tin đăng" : "Đăng tin mới"}
      </Typography>
      <Typography sx={{ color: "text.secondary", mb: 3 }}>
        Chợ PickleTour · Mua bán, trao đổi đồ pickleball
      </Typography>

      {/* Ảnh */}
      <Typography sx={{ fontWeight: 700, mb: 1 }}>
        Ảnh sản phẩm <Box component="span" sx={{ color: "error.main" }}>*</Box>{" "}
        <Box component="span" sx={{ color: "text.secondary", fontWeight: 400, fontSize: 13 }}>
          ({form.images.length}/12)
        </Box>
      </Typography>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 3 }}>
        {form.images.map((im, i) => (
          <Box key={i} sx={{ position: "relative", width: 96, height: 96 }}>
            <Box
              component="img"
              src={im.url || im}
              sx={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 2 }}
            />
            <IconButton
              size="small"
              onClick={() => removeImage(i)}
              sx={{
                position: "absolute",
                top: -8,
                right: -8,
                bgcolor: "error.main",
                color: "#fff",
                "&:hover": { bgcolor: "error.dark" },
              }}
            >
              <CloseRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
            {i === 0 && (
              <Chip
                label="Ảnh bìa"
                size="small"
                sx={{ position: "absolute", bottom: 4, left: 4, height: 18, fontSize: 10, bgcolor: "rgba(0,0,0,.65)", color: "#fff" }}
              />
            )}
          </Box>
        ))}
        {form.images.length < 12 && (
          <Box
            onClick={() => fileRef.current?.click()}
            sx={{
              width: 96,
              height: 96,
              border: "2px dashed",
              borderColor: "divider",
              borderRadius: 2,
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              color: "text.secondary",
              "&:hover": { borderColor: "primary.main", color: "primary.main" },
            }}
          >
            {uploading ? <CircularProgress size={22} /> : <AddPhotoAlternateRoundedIcon />}
          </Box>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={onPickFiles}
        />
      </Box>

      {/* Loại tin */}
      <Typography sx={{ fontWeight: 700, mb: 1 }}>Hình thức</Typography>
      <Box sx={{ display: "flex", gap: 1, mb: 3, flexWrap: "wrap" }}>
        {TYPES.map((t) => (
          <Chip
            key={t.key}
            label={`${t.emoji} ${t.label}`}
            onClick={() => set("type", t.key)}
            color={form.type === t.key ? "primary" : "default"}
            sx={{ fontWeight: 700 }}
          />
        ))}
      </Box>

      <TextField
        fullWidth
        label="Tiêu đề *"
        value={form.title}
        onChange={(e) => set("title", e.target.value)}
        placeholder="VD: Giày Nike Vapor Pro size 42, mới 95%"
        sx={{ mb: 2 }}
        inputProps={{ maxLength: 140 }}
      />

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, mb: 2 }}>
        <TextField
          select
          label="Danh mục"
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
        >
          {CATEGORIES.map((c) => (
            <MenuItem key={c.key} value={c.key}>
              {c.emoji} {c.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Tình trạng"
          value={form.condition}
          onChange={(e) => set("condition", e.target.value)}
        >
          {CONDITIONS.map((c) => (
            <MenuItem key={c.key} value={c.key}>
              {c.label}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {form.type !== "giveaway" && (
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, mb: 2, alignItems: "center" }}>
          <TextField
            label={form.type === "trade" ? "Giá tham khảo (₫)" : "Giá bán (₫)"}
            value={form.price}
            onChange={(e) =>
              set(
                "price",
                e.target.value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".")
              )
            }
            placeholder="0 = thương lượng"
          />
          <FormControlLabel
            control={
              <Switch
                checked={form.negotiable}
                onChange={(e) => set("negotiable", e.target.checked)}
              />
            }
            label="Có thể thương lượng"
          />
        </Box>
      )}

      {form.type === "trade" && (
        <TextField
          fullWidth
          label="Muốn đổi lấy gì?"
          value={form.tradeFor}
          onChange={(e) => set("tradeFor", e.target.value)}
          placeholder="VD: Vợt Joola Perseus, hoặc bù tiền"
          sx={{ mb: 2 }}
        />
      )}

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" }, mb: 2 }}>
        <TextField label="Thương hiệu" value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Nike, Joola…" />
        <TextField label="Size / Thông số" value={form.size} onChange={(e) => set("size", e.target.value)} placeholder="42, L, 8.0oz…" />
        <TextField label="Màu sắc" value={form.color} onChange={(e) => set("color", e.target.value)} />
      </Box>

      <TextField
        fullWidth
        multiline
        minRows={4}
        label="Mô tả chi tiết"
        value={form.description}
        onChange={(e) => set("description", e.target.value)}
        placeholder="Tình trạng, lý do bán, thời gian sử dụng, bảo hành…"
        sx={{ mb: 2 }}
      />

      {/* Tags */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: "flex", gap: 1, mb: 1, flexWrap: "wrap" }}>
          {form.tags.map((t) => (
            <Chip key={t} label={`#${t}`} onDelete={() => set("tags", form.tags.filter((x) => x !== t))} />
          ))}
        </Box>
        <TextField
          fullWidth
          size="small"
          label="Thêm thẻ (nhấn Enter)"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
        />
      </Box>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, mb: 2 }}>
        <TextField label="Tỉnh/Thành phố" value={form.location.province} onChange={(e) => set("location", { ...form.location, province: e.target.value })} />
        <TextField label="Quận/Huyện" value={form.location.district} onChange={(e) => set("location", { ...form.location, district: e.target.value })} />
      </Box>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
        <TextField label="Số điện thoại" value={form.contact.phone} onChange={(e) => set("contact", { ...form.contact, phone: e.target.value })} />
        <TextField label="Zalo" value={form.contact.zalo} onChange={(e) => set("contact", { ...form.contact, zalo: e.target.value })} />
      </Box>
      <FormControlLabel
        sx={{ mt: 1 }}
        control={
          <Switch
            checked={form.contact.showPhone}
            onChange={(e) => set("contact", { ...form.contact, showPhone: e.target.checked })}
          />
        }
        label="Hiển thị số điện thoại công khai"
      />

      <Alert severity="info" sx={{ my: 2 }}>
        Vui lòng đăng đúng đồ pickleball, mô tả trung thực. Tin vi phạm sẽ bị gỡ.
      </Alert>

      <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
        <Button onClick={() => navigate(-1)} disabled={busy}>
          Huỷ
        </Button>
        <Button variant="contained" size="large" onClick={submit} disabled={busy}>
          {busy ? "Đang lưu…" : isEdit ? "Lưu thay đổi" : "Đăng tin"}
        </Button>
      </Box>
    </Container>
  );
}
