// src/components/market/ListingCard.jsx — thẻ sản phẩm trên Chợ
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";
import FavoriteBorderRoundedIcon from "@mui/icons-material/FavoriteBorderRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import {
  CATEGORY_MAP,
  CONDITION_MAP,
  TYPE_MAP,
  STATUS_MAP,
  formatPrice,
  priceRangeLabel,
  timeAgo,
} from "../../constants/market";

export default function ListingCard({ item, onToggleSave, canSave = true }) {
  const navigate = useNavigate();
  if (!item) return null;
  const cond = CONDITION_MAP[item.condition];
  const cat = CATEGORY_MAP[item.category];
  const type = TYPE_MAP[item.type];
  const status = STATUS_MAP[item.status];
  const img = item.images?.[0]?.url || item.images?.[0] || "";
  const isSold = item.status === "sold";
  const isReserved = item.status === "reserved";

  return (
    <Box
      onClick={() => navigate(`/marketplace/${item._id}`)}
      sx={{
        cursor: "pointer",
        borderRadius: 3,
        overflow: "hidden",
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
        transition: "transform .18s ease, box-shadow .18s ease, border-color .18s",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        "&:hover": {
          transform: "translateY(-4px)",
          boxShadow: "0 12px 28px rgba(0,0,0,.12)",
          borderColor: "primary.main",
        },
      }}
    >
      {/* Ảnh */}
      <Box sx={{ position: "relative", pt: "100%", bgcolor: "action.hover" }}>
        {img ? (
          <Box
            component="img"
            src={img}
            loading="lazy"
            alt={item.title}
            sx={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: isSold ? "grayscale(.7) brightness(.85)" : "none",
            }}
          />
        ) : (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              fontSize: 44,
            }}
          >
            {cat?.emoji || "📦"}
          </Box>
        )}

        {/* Badge type (trao đổi / cho tặng) */}
        {type && item.type !== "sell" && (
          <Chip
            size="small"
            label={`${type.emoji} ${type.label}`}
            sx={{
              position: "absolute",
              top: 8,
              left: 8,
              fontWeight: 700,
              color: "#fff",
              bgcolor: type.color,
              "& .MuiChip-label": { px: 1 },
            }}
          />
        )}

        {/* Featured */}
        {item.featured && (
          <Tooltip title="Tin nổi bật">
            <Box
              sx={{
                position: "absolute",
                top: 8,
                left: item.type !== "sell" ? "auto" : 8,
                right: item.type !== "sell" ? 44 : "auto",
                bgcolor: "#f59e0b",
                color: "#fff",
                borderRadius: "50%",
                width: 26,
                height: 26,
                display: "grid",
                placeItems: "center",
              }}
            >
              <StarRoundedIcon sx={{ fontSize: 18 }} />
            </Box>
          </Tooltip>
        )}

        {/* Save */}
        {canSave && onToggleSave && (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave(item);
            }}
            sx={{
              position: "absolute",
              top: 6,
              right: 6,
              bgcolor: "rgba(255,255,255,.9)",
              "&:hover": { bgcolor: "#fff" },
            }}
          >
            {item.saved ? (
              <FavoriteRoundedIcon sx={{ fontSize: 18, color: "#e11d48" }} />
            ) : (
              <FavoriteBorderRoundedIcon sx={{ fontSize: 18, color: "#334155" }} />
            )}
          </IconButton>
        )}

        {/* Overlay trạng thái */}
        {(isSold || isReserved) && (
          <Box
            sx={{
              position: "absolute",
              bottom: 8,
              left: 8,
              px: 1.2,
              py: 0.3,
              borderRadius: 1.5,
              fontSize: 12,
              fontWeight: 800,
              color: "#fff",
              bgcolor: status?.color || "#6b7280",
              boxShadow: "0 2px 6px rgba(0,0,0,.25)",
            }}
          >
            {status?.label}
          </Box>
        )}
      </Box>

      {/* Nội dung */}
      <Box sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 0.5, flex: 1 }}>
        <Typography
          sx={{ fontWeight: 800, fontSize: 16, color: "primary.main", lineHeight: 1.2 }}
        >
          {priceRangeLabel(item)}
        </Typography>
        <Typography
          sx={{
            fontSize: 14,
            fontWeight: 600,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: 38,
          }}
        >
          {item.title}
        </Typography>

        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", alignItems: "center" }}>
          {cond && (
            <Chip
              size="small"
              label={cond.label}
              sx={{
                height: 20,
                fontSize: 11,
                fontWeight: 700,
                color: cond.color,
                bgcolor: `${cond.color}18`,
                "& .MuiChip-label": { px: 0.8 },
              }}
            />
          )}
          {item.brand && (
            <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
              {item.brand}
            </Typography>
          )}
        </Box>

        <Box
          sx={{
            mt: "auto",
            pt: 0.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "text.secondary",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.4, minWidth: 0 }}>
            <PlaceOutlinedIcon sx={{ fontSize: 14 }} />
            <Typography noWrap sx={{ fontSize: 11 }}>
              {item.location?.province || "—"} · {timeAgo(item.createdAt)}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.3 }}>
            <VisibilityOutlinedIcon sx={{ fontSize: 14 }} />
            <Typography sx={{ fontSize: 11 }}>{item.views || 0}</Typography>
          </Box>
        </Box>

        {item.seller && (
          <Box
            sx={{
              mt: 0.5,
              pt: 0.75,
              borderTop: "1px dashed",
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              gap: 0.75,
            }}
          >
            <Avatar
              src={item.seller.avatar}
              sx={{ width: 20, height: 20, fontSize: 11 }}
            >
              {(item.seller.name || "?").charAt(0)}
            </Avatar>
            <Typography noWrap sx={{ fontSize: 12, fontWeight: 600, flex: 1 }}>
              {item.seller.nickname || item.seller.name}
            </Typography>
            {item.seller.ratingCount > 0 && (
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.2, color: "#f59e0b" }}>
                <StarRoundedIcon sx={{ fontSize: 13 }} />
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: "text.secondary" }}>
                  {item.seller.ratingAvg?.toFixed(1)}
                </Typography>
              </Box>
            )}
            {item.seller.verified && (
              <Tooltip title="Đã xác minh danh tính">
                <VerifiedRoundedIcon sx={{ fontSize: 15, color: "#2563eb" }} />
              </Tooltip>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
