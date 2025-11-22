/* eslint-disable react/prop-types */
import {
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Stack,
  Typography,
  Chip,
  Avatar,
  Box,
  useTheme,
  Tooltip,
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import PlaceIcon from "@mui/icons-material/Place";
import VerifiedIcon from "@mui/icons-material/Verified";
import { Link as RouterLink } from "react-router-dom";

export default function ClubCard({ club }) {
  const theme = useTheme();
  const cover = club?.coverUrl || club?.logoUrl || "/placeholder-cover.jpg";
  const logo = club?.logoUrl || "/placeholder-logo.png";

  // Giới hạn hiển thị tối đa 3 môn thể thao để tránh vỡ khung
  const displaySports = (club.sportTypes || []).slice(0, 3);
  const remainingSports = (club.sportTypes || []).length - 3;

  return (
    <Card
      elevation={0} // Bỏ shadow mặc định để dùng border hoặc shadow custom
      sx={{
        height: "100%", // Quan trọng: Giúp các card bằng nhau trong Grid
        display: "flex",
        flexDirection: "column",
        borderRadius: 3,
        border: `1px solid ${theme.palette.divider}`,
        transition: "all 0.3s ease-in-out",
        "&:hover": {
          transform: "translateY(-4px)",
          boxShadow: theme.shadows[4],
          borderColor: "transparent",
        },
      }}
    >
      <CardActionArea
        component={RouterLink}
        to={`/clubs/${club._id}`}
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-start",
        }}
      >
        {/* --- Cover Image & Avatar Wrapper --- */}
        <Box
          sx={{
            position: "relative",
            width: "100%",
            height: 140,
            backgroundColor: "grey.100",
          }}
        >
          <CardMedia
            component="img"
            src={cover}
            alt={club.name}
            sx={{
              height: "100%",
              width: "100%",
              objectFit: "cover",
            }}
          />

          {/* Gradient overlay để làm nổi bật avatar nếu cover quá sáng */}
          <Box
            sx={{
              position: "absolute",
              bottom: 0,
              left: 0,
              width: "100%",
              height: "50%",
              background:
                "linear-gradient(to top, rgba(0,0,0,0.4), transparent)",
            }}
          />

          <Avatar
            src={logo}
            alt={club.name}
            sx={{
              position: "absolute",
              left: 16,
              bottom: -24, // Đè lên phần content
              width: 64, // Tăng kích thước một chút
              height: 64,
              border: "4px solid",
              borderColor: "background.paper",
              boxShadow: theme.shadows[2],
              zIndex: 2,
              backgroundColor: "white",
            }}
          />
        </Box>

        {/* --- Content --- */}
        <CardContent
          sx={{
            pt: 4.5, // Padding top lớn để tránh avatar
            pb: 2,
            width: "100%",
            flexGrow: 1, // Đẩy content chiếm hết khoảng trống -> Footer luôn ở đáy
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
          }}
        >
          {/* Tên CLB & Verified */}
          <Box>
            <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
              <Tooltip title={club.name}>
                <Typography
                  variant="h6"
                  component="div"
                  sx={{
                    fontWeight: 700,
                    fontSize: "1.1rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap", // Chống tràn dòng
                    maxWidth: "100%",
                  }}
                >
                  {club.name}
                </Typography>
              </Tooltip>
              {club.isVerified && (
                <Tooltip title="Đã xác minh">
                  <VerifiedIcon color="primary" fontSize="small" />
                </Tooltip>
              )}
            </Stack>

            {/* Địa chỉ - Giới hạn 1 dòng */}
            {(club.province || club.city) && (
              <Stack
                direction="row"
                spacing={0.5}
                alignItems="center"
                color="text.secondary"
              >
                <PlaceIcon sx={{ fontSize: 16 }} />
                <Typography variant="body2" noWrap sx={{ maxWidth: "90%" }}>
                  {[club.city, club.province].filter(Boolean).join(", ")}
                </Typography>
              </Stack>
            )}
          </Box>

          {/* Tags thể thao */}
          <Stack
            direction="row"
            spacing={1}
            flexWrap="wrap"
            useFlexGap
            sx={{ mt: "auto" }}
          >
            {/* mt: 'auto' giúp đẩy phần này xuống nếu cần, hoặc để nó tự nhiên */}
            {displaySports.map((s) => (
              <Chip
                key={s}
                label={s}
                size="small"
                variant="outlined" // Thiết kế nhẹ nhàng hơn
                sx={{
                  borderRadius: 1,
                  fontSize: "0.75rem",
                  height: 24,
                  borderColor: "divider",
                }}
              />
            ))}
            {remainingSports > 0 && (
              <Chip
                label={`+${remainingSports}`}
                size="small"
                variant="filled"
                sx={{
                  borderRadius: 1,
                  fontSize: "0.75rem",
                  height: 24,
                  backgroundColor: "action.hover",
                }}
              />
            )}
          </Stack>
        </CardContent>

        {/* --- Footer Stat (Member count) --- */}
        <Box
          sx={{
            p: 2,
            pt: 0,
            width: "100%",
            borderTop: `1px dashed ${theme.palette.divider}`, // Đường kẻ nhẹ phân cách
            mt: "auto", // Đảm bảo footer luôn nằm dưới cùng
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ pt: 1.5, color: "text.secondary" }}
          >
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <GroupsIcon fontSize="small" />
              <Typography variant="caption" fontWeight={600}>
                {club?.stats?.memberCount ?? 0} thành viên
              </Typography>
            </Stack>

            {/* Có thể thêm nút "Tham gia" giả hoặc text khác ở đây */}
            <Typography
              variant="caption"
              sx={{ color: "primary.main", fontWeight: 600 }}
            >
              Xem chi tiết →
            </Typography>
          </Stack>
        </Box>
      </CardActionArea>
    </Card>
  );
}
