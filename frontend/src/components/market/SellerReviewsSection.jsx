// src/components/market/SellerReviewsSection.jsx — đánh giá uy tín người bán
import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import { toast } from "react-toastify";
import StarRating from "./StarRating";
import { timeAgo } from "../../constants/market";
import {
  useListSellerReviewsQuery,
  useUpsertSellerReviewMutation,
  useDeleteSellerReviewMutation,
} from "../../slices/marketApiSlice";

export default function SellerReviewsSection({ sellerId, listingId, userInfo }) {
  const { data, isLoading, refetch } = useListSellerReviewsQuery(sellerId, { skip: !sellerId });
  const [upsert, { isLoading: saving }] = useUpsertSellerReviewMutation();
  const [del] = useDeleteSellerReviewMutation();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (data?.myReview) {
      setRating(data.myReview.rating || 0);
      setComment(data.myReview.comment || "");
    }
  }, [data?.myReview]);

  if (isLoading)
    return <Box sx={{ py: 2 }}><CircularProgress size={22} /></Box>;

  const items = data?.items || [];
  const submit = async () => {
    if (!rating) return toast.info("Vui lòng chọn số sao");
    try {
      await upsert({ sellerId, rating, comment, listingId }).unwrap();
      await refetch();
      toast.success("Đã gửi đánh giá");
    } catch (e) {
      toast.error(e?.data?.message || "Không gửi được đánh giá");
    }
  };
  const remove = async () => {
    if (!data?.myReview) return;
    try {
      await del({ reviewId: data.myReview._id, sellerId }).unwrap();
      await refetch();
      setRating(0);
      setComment("");
    } catch {}
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
        <Typography sx={{ fontWeight: 900, fontSize: 28 }}>
          {data?.ratingAvg ? data.ratingAvg.toFixed(1) : "—"}
        </Typography>
        <Box>
          <StarRating value={data?.ratingAvg || 0} size={20} />
          <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
            {data?.ratingCount || 0} đánh giá
          </Typography>
        </Box>
      </Box>

      {/* Write form */}
      {userInfo && data?.canReview && (
        <Box sx={{ p: 1.5, mb: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
          <Typography sx={{ fontWeight: 700, mb: 0.5 }}>
            {data.myReview ? "Sửa đánh giá của bạn" : "Đánh giá người bán này"}
          </Typography>
          <StarRating value={rating} size={30} onChange={setRating} />
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={2}
            placeholder="Nhận xét (tuỳ chọn): giao dịch, thái độ, đúng mô tả…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            sx={{ mt: 1 }}
          />
          <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
            <Button variant="contained" size="small" onClick={submit} disabled={saving}>
              {data.myReview ? "Cập nhật" : "Gửi đánh giá"}
            </Button>
            {data.myReview && (
              <Button size="small" color="inherit" onClick={remove}>Xoá đánh giá</Button>
            )}
          </Box>
        </Box>
      )}
      {userInfo && !data?.canReview && !data?.myReview && (
        <Typography sx={{ fontSize: 13, color: "text.secondary", mb: 1.5 }}>
          Bạn cần từng liên hệ/trả giá sản phẩm của người bán này mới đánh giá được.
        </Typography>
      )}

      <Divider sx={{ mb: 1 }} />
      {items.length === 0 ? (
        <Typography sx={{ color: "text.secondary", fontSize: 14 }}>Chưa có đánh giá nào.</Typography>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {items.map((r) => (
            <Box key={r._id} sx={{ display: "flex", gap: 1.25 }}>
              <Avatar src={r.reviewer?.avatar} sx={{ width: 34, height: 34 }}>
                {(r.reviewer?.name || "?").charAt(0)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 14 }} noWrap>
                    {r.reviewer?.nickname || r.reviewer?.name}
                  </Typography>
                  <StarRating value={r.rating} size={14} />
                  <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{timeAgo(r.createdAt)}</Typography>
                </Box>
                {r.comment && <Typography sx={{ fontSize: 14, color: "text.secondary" }}>{r.comment}</Typography>}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
