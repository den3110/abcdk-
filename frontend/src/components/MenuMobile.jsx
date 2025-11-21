// src/components/MobileBottomNav.jsx
import { useMemo } from "react"; // Xóa useState và useEffect vì không dùng trực tiếp
import {
  Box,
  Typography,
  useMediaQuery,
  Badge,
  useTheme,
  alpha,
  Stack, // Thêm Stack để bố trí các item dễ hơn
} from "@mui/material";
import { useNavigate, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";

// Icons
import HomeIcon from "@mui/icons-material/HomeRounded";
import EmojiEventsIcon from "@mui/icons-material/EmojiEventsRounded";
import AssessmentIcon from "@mui/icons-material/AssessmentRounded";
import PersonIcon from "@mui/icons-material/PersonRounded";
import EventAvailableIcon from "@mui/icons-material/EventAvailableRounded";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import GroupsIcon from "@mui/icons-material/GroupsRounded";

// Badge "Mới" cho Câu lạc bộ
const CLUB_BADGE_START = new Date(2025, 9, 5, 0, 0, 0, 0);
const CLUB_BADGE_END = new Date(2025, 10, 5, 23, 59, 59, 999);

export default function MobileBottomNav() {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  // --- Selectors & Logic ---
  const user = useSelector(
    (s) => s.auth?.userInfo || s.userLogin?.userInfo || null
  );
  const isAdmin = Boolean(
    user?.isAdmin ||
      user?.role === "admin" ||
      (Array.isArray(user?.roles) && user.roles.includes("admin"))
  );

  const isSmallScreen = useMediaQuery("(max-width:380px)");

  // Logic hiển thị Badge
  const showClubNewBadge = useMemo(() => {
    const now = new Date();
    return now >= CLUB_BADGE_START && now <= CLUB_BADGE_END;
  }, []);

  // --- Config Menu Items ---
  const items = useMemo(() => {
    const base = [
      { label: "Trang chủ", icon: <HomeIcon />, path: "/" },
      {
        label: "Giải đấu",
        icon: <EmojiEventsIcon />,
        path: "/pickle-ball/tournaments",
      },
      {
        label: "Xếp hạng",
        icon: <AssessmentIcon />,
        path: "/pickle-ball/rankings",
      },
      {
        label: "Của tôi",
        icon: <EventAvailableIcon />,
        path: "/my-tournaments",
      },
      { label: "Cá nhân", icon: <PersonIcon />, path: "/profile" },
    ];

    if (user) {
      const clubIcon = showClubNewBadge ? (
        <Badge
          color="error"
          variant="dot"
          sx={{
            "& .MuiBadge-badge": {
              top: 2,
              right: 2,
              border: `2px solid ${theme.palette.background.paper}`,
            },
          }}
        >
          <GroupsIcon />
        </Badge>
      ) : (
        <GroupsIcon />
      );

      base.splice(base.length - 1, 0, {
        label: "CLB",
        icon: clubIcon,
        path: "/clubs",
      });
    }

    if (isAdmin) {
      base.splice(base.length - 1, 0, {
        label: "Admin",
        icon: <AdminPanelSettingsIcon />,
        path: "/admin",
      });
    }
    return base;
  }, [user, isAdmin, showClubNewBadge, theme]);

  // Logic active index (tìm path khớp nhất)
  const activeIndex = useMemo(() => {
    let bestIdx = 0;
    let bestLen = -1;
    items.forEach((item, idx) => {
      // Logic đặc biệt cho path root '/'
      if (item.path === "/" && location.pathname === "/") {
        bestIdx = idx;
        bestLen = item.path.length;
        return;
      }

      if (
        item.path !== "/" &&
        (location.pathname === item.path ||
          location.pathname.startsWith(item.path + "/"))
      ) {
        if (item.path.length > bestLen) {
          bestIdx = idx;
          bestLen = item.path.length;
        }
      }
    });
    return bestIdx;
  }, [location.pathname, items]);

  // --- Render Component ---
  return (
    // Box chứa toàn bộ khu vực dock, fixed ở dưới cùng
    <Box
      sx={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1199, // Đảm bảo nổi trên các nội dung khác
        display: { xs: "flex", md: "none" }, // Chỉ hiện trên mobile
        justifyContent: "center", // Căn giữa
        pointerEvents: "none", // Cho phép click xuyên qua vùng padding trong suốt
      }}
    >
      {/* Box chính của dock, với hiệu ứng glassmorphism và bo tròn 50% */}
      <Stack
        direction="row" // Sắp xếp các item theo chiều ngang
        sx={{
          pointerEvents: "auto", // Cho phép tương tác với các item

          // Kích thước và vị trí lơ lửng
          width: "calc(100% - 32px)", // Chiếm gần hết chiều rộng, chừa 16px mỗi bên
          maxWidth: 550, // Giới hạn chiều rộng trên màn hình lớn hơn
          margin: "0 auto", // Căn giữa
          mb: `calc(12px + env(safe-area-inset-bottom))`, // ✅ Đẩy lên 12px + padding cho Safe Area của iOS
          height: 64, // Chiều cao cố định của dock

          // ✅ Hiệu ứng Liquid Glass và Bo tròn 50%
          borderRadius: 9999, // ✅ Tạo hình viên thuốc hoàn hảo (bo tròn 50%)
          background: alpha(theme.palette.background.paper, 0.2), // Nền trong suốt hơn
          backdropFilter: "blur(30px) saturate(1.8)", // ✅ Tăng blur và saturate để giống iOS hơn
          WebkitBackdropFilter: "blur(30px) saturate(1.8)", // Safari support
          border: `1px solid ${alpha(theme.palette.divider, 0.15)}`, // Viền nhẹ
          boxShadow: theme.shadows[15], // ✅ Shadow mạnh mẽ hơn để tạo độ nổi khối

          // Flexbox properties cho Stack
          alignItems: "center",
          justifyContent: "space-around",
          padding: "0 8px", // Padding bên trong stack
        }}
      >
        {items.map((item, idx) => {
          const isActive = idx === activeIndex;

          return (
            <Box
              key={item.path}
              onClick={() => navigate(item.path)}
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                flex: 1, // Chia đều không gian cho mỗi item
                cursor: "pointer",
                minWidth: 0, // Quan trọng để item có thể co lại

                // Hiệu ứng chuyển động và màu sắc
                transition: "all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1.2)", // Hiệu ứng nảy mềm mại hơn
                transform: isActive ? "scale(1.05)" : "scale(1)", // ✅ Scale nhẹ khi active
                color: isActive
                  ? theme.palette.primary.main
                  : theme.palette.text.secondary,
                opacity: isSmallScreen && !isActive ? 0.7 : 1,

                // Hiệu ứng hover/tap
                "&:active": {
                  transform: "scale(0.95)", // Hơi nén xuống khi chạm
                },
                "-webkit-tap-highlight-color": "transparent", // Xóa highlight mặc định khi chạm
              }}
            >
              {/* Icon Container with Pill Indicator */}
              <Box
                sx={{
                  padding: "6px 16px",
                  borderRadius: 9999, // ✅ Background icon cũng bo tròn 50%
                  marginBottom: "2px",
                  transition: "background-color 0.3s ease",
                  backgroundColor: isActive
                    ? alpha(theme.palette.primary.main, 0.15) // ✅ Nền icon active đậm hơn một chút
                    : "transparent",
                  "& svg": {
                    fontSize: "1.5rem",
                    display: "block",
                    filter: isActive
                      ? `drop-shadow(0 2px 4px ${alpha(
                          theme.palette.primary.main,
                          0.3
                        )})`
                      : "none", // ✅ Drop shadow màu primary
                  },
                }}
              >
                {item.icon}
              </Box>

              {/* Label */}
              <Typography
                variant="caption"
                sx={{
                  fontSize: "0.6rem", // ✅ Cỡ chữ nhỏ hơn một chút cho gọn
                  fontWeight: isActive ? 700 : 500,
                  letterSpacing: "0.4px", // Tăng letter spacing nhẹ
                  transition: "all 0.2s",
                  whiteSpace: "nowrap", // Không cho label xuống dòng
                  overflow: "hidden",
                  textOverflow: "ellipsis", // Cắt bỏ nếu quá dài
                  maxWidth: "100%", // Đảm bảo không tràn
                  display: items.length > 5 && !isActive ? "none" : "block",
                }}
              >
                {item.label}
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
