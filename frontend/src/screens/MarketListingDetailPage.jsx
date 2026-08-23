// src/screens/MarketListingDetailPage.jsx — chi tiết tin trên Chợ
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";
import FavoriteBorderRoundedIcon from "@mui/icons-material/FavoriteBorderRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import LocalOfferRoundedIcon from "@mui/icons-material/LocalOfferRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import {
  CATEGORY_MAP,
  CONDITION_MAP,
  TYPE_MAP,
  STATUS_MAP,
  STATUSES,
  formatPrice,
  timeAgo,
} from "../constants/market";
import {
  useGetListingQuery,
  useToggleSaveListingMutation,
  useCreateOfferMutation,
  useUpdateListingStatusMutation,
  useDeleteListingMutation,
  useListListingOffersQuery,
  useRespondOfferMutation,
} from "../slices/marketApiSlice";

function OffersManager({ listingId }) {
  const { data, isLoading } = useListListingOffersQuery(listingId);
  const [respond, { isLoading: responding }] = useRespondOfferMutation();
  if (isLoading)
    return <CircularProgress size={22} sx={{ mt: 1 }} />;
  const offers = data?.items || [];
  if (!offers.length)
    return (
      <Typography sx={{ color: "text.secondary", fontSize: 14, mt: 1 }}>
        Chưa có đề nghị nào.
      </Typography>
    );
  const act = async (offerId, action) => {
    try {
      await respond({ offerId, action, listingId }).unwrap();
      toast.success(action === "accept" ? "Đã chấp nhận" : "Đã từ chối");
    } catch {
      toast.error("Thao tác thất bại");
    }
  };
  return (
    <Box sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 1 }}>
      {offers.map((o) => (
        <Box
          key={o._id}
          sx={{
            p: 1.25,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Avatar src={o.buyer?.avatar} sx={{ width: 32, height: 32 }}>
            {(o.buyer?.name || "?").charAt(0)}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14 }}>
              {o.buyer?.nickname || o.buyer?.name}{" "}
              <Box component="span" sx={{ color: "primary.main", fontWeight: 800 }}>
                · {formatPrice(o.amount, "sell")}
              </Box>
            </Typography>
            {o.message && (
              <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
                “{o.message}”
              </Typography>
            )}
          </Box>
          {o.status === "pending" ? (
            <Box sx={{ display: "flex", gap: 0.5 }}>
              <Button
                size="small"
                variant="contained"
                disabled={responding}
                onClick={() => act(o._id, "accept")}
              >
                Nhận
              </Button>
              <Button
                size="small"
                color="inherit"
                disabled={responding}
                onClick={() => act(o._id, "reject")}
              >
                Từ chối
              </Button>
            </Box>
          ) : (
            <Chip
              size="small"
              label={
                o.status === "accepted"
                  ? "Đã nhận"
                  : o.status === "rejected"
                  ? "Đã từ chối"
                  : "Đã huỷ"
              }
              color={o.status === "accepted" ? "success" : "default"}
            />
          )}
        </Box>
      ))}
    </Box>
  );
}

export default function MarketListingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const { data: item, isLoading, refetch } = useGetListingQuery(id);
  const [toggleSave] = useToggleSaveListingMutation();
  const [createOffer, { isLoading: offering }] = useCreateOfferMutation();
  const [updateStatus] = useUpdateListingStatusMutation();
  const [deleteListing] = useDeleteListingMutation();

  const [activeImg, setActiveImg] = useState(0);
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerAmount, setOfferAmount] = useState("");
  const [offerMsg, setOfferMsg] = useState("");
  const [showContact, setShowContact] = useState(false);

  if (isLoading)
    return (
      <Box sx={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  if (!item)
    return (
      <Box sx={{ textAlign: "center", py: 10 }}>
        <Typography>Không tìm thấy tin đăng.</Typography>
        <Button onClick={() => navigate("/marketplace")} sx={{ mt: 2 }}>
          Về Chợ
        </Button>
      </Box>
    );

  const cond = CONDITION_MAP[item.condition];
  const cat = CATEGORY_MAP[item.category];
  const type = TYPE_MAP[item.type];
  const status = STATUS_MAP[item.status];
  const images = item.images?.length ? item.images : [];
  const mainImg = images[activeImg]?.url || images[activeImg] || "";

  const onSave = async () => {
    if (!userInfo) return navigate("/login");
    try {
      await toggleSave(item._id).unwrap();
      refetch();
    } catch {
      toast.error("Không lưu được");
    }
  };

  const submitOffer = async () => {
    try {
      await createOffer({
        id: item._id,
        amount: Number(String(offerAmount).replace(/\D/g, "")) || 0,
        message: offerMsg,
      }).unwrap();
      toast.success("Đã gửi đề nghị tới người bán");
      setOfferOpen(false);
      setOfferAmount("");
      setOfferMsg("");
    } catch (e) {
      toast.error(e?.data?.message || "Gửi đề nghị thất bại");
    }
  };

  const changeStatus = async (s) => {
    try {
      await updateStatus({ id: item._id, status: s }).unwrap();
      toast.success("Đã cập nhật trạng thái");
      refetch();
    } catch {
      toast.error("Cập nhật thất bại");
    }
  };

  const onDelete = async () => {
    if (!window.confirm("Xoá tin đăng này?")) return;
    try {
      await deleteListing(item._id).unwrap();
      toast.success("Đã xoá");
      navigate("/marketplace/mine");
    } catch {
      toast.error("Xoá thất bại");
    }
  };

  const specs = [
    cat && { label: "Danh mục", value: `${cat.emoji} ${cat.label}` },
    cond && { label: "Tình trạng", value: cond.label },
    item.brand && { label: "Thương hiệu", value: item.brand },
    item.size && { label: "Size / Thông số", value: item.size },
    item.color && { label: "Màu sắc", value: item.color },
  ].filter(Boolean);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Button
        startIcon={<ArrowBackRoundedIcon />}
        onClick={() => navigate("/marketplace")}
        sx={{ mb: 2 }}
      >
        Chợ PickleTour
      </Button>

      <Box
        sx={{
          display: "grid",
          gap: 3,
          gridTemplateColumns: { xs: "1fr", md: "1.15fr 1fr" },
          alignItems: "start",
        }}
      >
        {/* Gallery */}
        <Box>
          <Box
            sx={{
              position: "relative",
              borderRadius: 3,
              overflow: "hidden",
              bgcolor: "action.hover",
              pt: "75%",
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            {mainImg ? (
              <Box
                component="img"
                src={mainImg}
                alt={item.title}
                sx={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  bgcolor: "#000",
                }}
              />
            ) : (
              <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 64 }}>
                {cat?.emoji}
              </Box>
            )}
            {item.status !== "available" && (
              <Chip
                label={status?.label}
                sx={{
                  position: "absolute",
                  top: 12,
                  left: 12,
                  fontWeight: 800,
                  color: "#fff",
                  bgcolor: status?.color,
                }}
              />
            )}
          </Box>
          {images.length > 1 && (
            <Box sx={{ display: "flex", gap: 1, mt: 1, overflowX: "auto" }}>
              {images.map((im, i) => (
                <Box
                  key={i}
                  component="img"
                  src={im.url || im}
                  onClick={() => setActiveImg(i)}
                  sx={{
                    width: 72,
                    height: 72,
                    objectFit: "cover",
                    borderRadius: 2,
                    cursor: "pointer",
                    border: "2px solid",
                    borderColor: i === activeImg ? "primary.main" : "transparent",
                  }}
                />
              ))}
            </Box>
          )}
        </Box>

        {/* Info */}
        <Box>
          {type && item.type !== "sell" && (
            <Chip
              size="small"
              label={`${type.emoji} ${type.label}`}
              sx={{ fontWeight: 700, color: "#fff", bgcolor: type.color, mb: 1 }}
            />
          )}
          <Typography sx={{ fontWeight: 800, fontSize: { xs: 20, md: 26 }, lineHeight: 1.25 }}>
            {item.title}
          </Typography>
          <Typography sx={{ fontWeight: 900, fontSize: { xs: 26, md: 32 }, color: "primary.main", mt: 1 }}>
            {formatPrice(item.price, item.type)}
            {item.negotiable && item.type === "sell" && item.price > 0 && (
              <Box component="span" sx={{ fontSize: 14, color: "text.secondary", fontWeight: 600, ml: 1 }}>
                · Có thương lượng
              </Box>
            )}
          </Typography>
          {item.type === "trade" && item.tradeFor && (
            <Typography sx={{ mt: 0.5, fontSize: 14, color: "text.secondary" }}>
              Muốn đổi: <b>{item.tradeFor}</b>
            </Typography>
          )}

          <Box sx={{ display: "flex", gap: 2, mt: 1.5, color: "text.secondary", flexWrap: "wrap" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <PlaceOutlinedIcon sx={{ fontSize: 18 }} />
              <Typography sx={{ fontSize: 14 }}>
                {item.location?.province || "—"}
                {item.location?.district ? `, ${item.location.district}` : ""}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <VisibilityOutlinedIcon sx={{ fontSize: 18 }} />
              <Typography sx={{ fontSize: 14 }}>{item.views || 0} lượt xem</Typography>
            </Box>
            <Typography sx={{ fontSize: 14 }}>· {timeAgo(item.createdAt)}</Typography>
          </Box>

          {/* Actions */}
          {item.isOwner ? (
            <Box sx={{ mt: 2.5 }}>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1.5 }}>
                <Typography sx={{ fontWeight: 700 }}>Trạng thái:</Typography>
                <Select
                  size="small"
                  value={item.status}
                  onChange={(e) => changeStatus(e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <MenuItem key={s.key} value={s.key}>
                      {s.label}
                    </MenuItem>
                  ))}
                </Select>
              </Box>
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button
                  variant="outlined"
                  startIcon={<EditRoundedIcon />}
                  onClick={() => navigate(`/marketplace/${item._id}/edit`)}
                >
                  Sửa tin
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteOutlineRoundedIcon />}
                  onClick={onDelete}
                >
                  Xoá
                </Button>
              </Box>
              <Divider sx={{ my: 2 }} />
              <Typography sx={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 0.5 }}>
                <LocalOfferRoundedIcon fontSize="small" /> Đề nghị mua ({item.offerCount || 0})
              </Typography>
              <OffersManager listingId={item._id} />
            </Box>
          ) : (
            <Box sx={{ display: "flex", gap: 1, mt: 2.5, flexWrap: "wrap" }}>
              <Button
                variant="contained"
                size="large"
                startIcon={<LocalOfferRoundedIcon />}
                disabled={!["available", "reserved"].includes(item.status)}
                onClick={() => (userInfo ? setOfferOpen(true) : navigate("/login"))}
              >
                Trả giá / Đề nghị
              </Button>
              {(item.contact?.showPhone && item.contact?.phone) || item.contact?.zalo ? (
                <Button
                  variant="outlined"
                  size="large"
                  startIcon={<PhoneRoundedIcon />}
                  onClick={() => setShowContact((v) => !v)}
                >
                  {showContact
                    ? item.contact?.phone || item.contact?.zalo
                    : "Hiện liên hệ"}
                </Button>
              ) : null}
              <IconButton
                onClick={onSave}
                sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2 }}
              >
                {item.saved ? (
                  <FavoriteRoundedIcon sx={{ color: "#e11d48" }} />
                ) : (
                  <FavoriteBorderRoundedIcon />
                )}
              </IconButton>
            </Box>
          )}
          {showContact && item.contact?.zalo && (
            <Typography sx={{ mt: 1, fontSize: 14 }}>
              Zalo: <b>{item.contact.zalo}</b>
            </Typography>
          )}

          {/* Seller card */}
          {item.seller && (
            <Box
              sx={{
                mt: 3,
                p: 2,
                borderRadius: 3,
                border: "1px solid",
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                gap: 1.5,
              }}
            >
              <Avatar src={item.seller.avatar} sx={{ width: 48, height: 48 }}>
                {(item.seller.name || "?").charAt(0)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Typography sx={{ fontWeight: 800 }} noWrap>
                    {item.seller.nickname || item.seller.name}
                  </Typography>
                  {item.seller.verified && (
                    <VerifiedRoundedIcon sx={{ fontSize: 17, color: "#2563eb" }} />
                  )}
                </Box>
                <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
                  {item.seller.verified ? "Đã xác minh danh tính" : "Người bán"}
                </Typography>
              </Box>
              <Button
                variant="text"
                startIcon={<ChatBubbleOutlineRoundedIcon />}
                onClick={() => navigate(`/marketplace?seller=${item.seller._id}`)}
              >
                Tin khác
              </Button>
            </Box>
          )}
        </Box>
      </Box>

      {/* Description + specs */}
      <Box sx={{ mt: 4, display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", md: "1.15fr 1fr" } }}>
        <Box>
          <Typography sx={{ fontWeight: 800, mb: 1 }}>Mô tả</Typography>
          <Typography sx={{ whiteSpace: "pre-wrap", color: "text.secondary", lineHeight: 1.7 }}>
            {item.description || "Người bán chưa thêm mô tả."}
          </Typography>
          {item.tags?.length > 0 && (
            <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 2 }}>
              {item.tags.map((t) => (
                <Chip key={t} label={`#${t}`} size="small" variant="outlined" />
              ))}
            </Box>
          )}
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 800, mb: 1 }}>Thông tin</Typography>
          <Box sx={{ borderRadius: 2, border: "1px solid", borderColor: "divider", overflow: "hidden" }}>
            {specs.map((s, i) => (
              <Box
                key={s.label}
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  px: 1.5,
                  py: 1,
                  bgcolor: i % 2 ? "action.hover" : "transparent",
                }}
              >
                <Typography sx={{ fontSize: 14, color: "text.secondary" }}>{s.label}</Typography>
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{s.value}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Offer dialog */}
      <Dialog open={offerOpen} onClose={() => setOfferOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 800 }}>Gửi đề nghị mua</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, color: "text.secondary", mb: 2 }}>
            Giá đang đăng: <b>{formatPrice(item.price, item.type)}</b>
          </Typography>
          <TextField
            fullWidth
            label="Giá bạn đề nghị (₫)"
            value={offerAmount}
            onChange={(e) =>
              setOfferAmount(
                e.target.value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".")
              )
            }
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Lời nhắn (tuỳ chọn)"
            value={offerMsg}
            onChange={(e) => setOfferMsg(e.target.value)}
            placeholder="Mình lấy ngay, ship COD được không ạ?"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOfferOpen(false)}>Huỷ</Button>
          <Button variant="contained" onClick={submitOffer} disabled={offering}>
            Gửi đề nghị
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
