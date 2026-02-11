// src/components/MobileBottomNav.jsx
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  Typography,
  useMediaQuery,
  Badge,
  useTheme,
  alpha,
  Stack,
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

/* ================= HELPER FUNCTIONS ================= */

// Lấy màu nền thực tế (recursive tìm lên cha nếu transparent)
const getEffectiveBackgroundColor = (el) => {
  if (!el) return [255, 255, 255];
  const style = window.getComputedStyle(el);
  const color = style.backgroundColor;
  const rgb = color.match(/\d+/g);

  // Nếu không có màu hoặc alpha = 0 (trong suốt) -> tìm cha
  if (!rgb || (rgb.length === 4 && parseInt(rgb[3]) === 0)) {
    return el.parentElement
      ? getEffectiveBackgroundColor(el.parentElement)
      : [255, 255, 255];
  }
  return [parseInt(rgb[0]), parseInt(rgb[1]), parseInt(rgb[2])];
};

// Kiểm tra độ sáng (true = màu tối)
const isColorDark = (rgb) => {
  const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return brightness < 128;
};

/* ================= COMPONENT ================= */

const CLUB_BADGE_START = new Date(2025, 9, 5, 0, 0, 0, 0);
const CLUB_BADGE_END = new Date(2025, 10, 5, 23, 59, 59, 999);

export default function MobileBottomNav() {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef(null);

  // State: true nếu đang nằm trên nền tối
  const [isDarkOverlay, setIsDarkOverlay] = useState(false);

  // --- 1. LOGIC AUTO DETECT BACKGROUND (GIỮ NGUYÊN) ---
  const detectBackground = useCallback(() => {
    if (!navRef.current) return;

    // Lấy vị trí ngay tâm của thanh Bottom Nav
    const rect = navRef.current.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;

    // Check 5 điểm ngang màn hình
    const samplePoints = [0.1, 0.3, 0.5, 0.7, 0.9].map(
      (p) => window.innerWidth * p
    );
    let darkCount = 0;

    samplePoints.forEach((x) => {
      // Lấy phần tử bên dưới (xuyên qua Nav)
      const elements = document.elementsFromPoint(x, centerY);
      const targetEl = elements.find((el) => !navRef.current.contains(el));

      if (targetEl) {
        const rgb = getEffectiveBackgroundColor(targetEl);
        if (isColorDark(rgb)) darkCount++;
      }
    });

    // Nếu > 50% điểm là tối -> chuyển theme
    setIsDarkOverlay(darkCount / samplePoints.length > 0.5);
  }, []);

  // --- LOGIC AUTO DETECT MỚI (Dùng MutationObserver) ---
  useEffect(() => {
    // 1. Logic xử lý khi Scroll (Giữ nguyên để mượt)
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          detectBackground();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onScroll);

    // 2. LOGIC "CAMERA AN NINH" (MutationObserver)
    // Giám sát sự thay đổi DOM (khi Skeleton mất đi, Content mới hiện ra)

    let debounceTimer;
    const observer = new MutationObserver(() => {
      // Khi DOM thay đổi, đừng check ngay (vì React render rất nhiều lần liên tiếp)
      // Hãy chờ 200ms sau khi sự thay đổi cuối cùng kết thúc mới check
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // console.log("DOM thay đổi (Skeleton xong?), check lại màu nền...");
        detectBackground();
      }, 200);
    });

    // Bắt đầu giám sát toàn bộ body
    observer.observe(document.body, {
      childList: true, // Theo dõi việc thêm/xóa phần tử (Skeleton <-> Content)
      subtree: true, // Theo dõi sâu bên trong con cháu
      attributes: true, // Theo dõi thay đổi class/style (nếu có đổi màu nền động)
    });

    // Check ngay lần đầu
    detectBackground();

    // Retry sau khi page đã paint xong (DOM có thể chưa sẵn sàng lúc mount)
    const retryTimers = [
      setTimeout(detectBackground, 300),
      setTimeout(detectBackground, 800),
    ];

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      observer.disconnect(); // Tắt camera khi unmount
      clearTimeout(debounceTimer);
      retryTimers.forEach(clearTimeout);
    };
  }, [detectBackground]); // Chỉ phụ thuộc vào hàm detect

  // --- 2. LOGIC MENU & AUTH ---
  const user = useSelector(
    (s) => s.auth?.userInfo || s.userLogin?.userInfo || null
  );
  const isAdmin = Boolean(
    user?.isAdmin ||
      user?.role === "admin" ||
      (Array.isArray(user?.roles) && user.roles.includes("admin"))
  );
  const isSmallScreen = useMediaQuery("(max-width:380px)");

  const showClubNewBadge = useMemo(() => {
    const now = new Date();
    return now >= CLUB_BADGE_START && now <= CLUB_BADGE_END;
  }, []);

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

  const activeIndex = useMemo(() => {
    let bestIdx = 0;
    let bestLen = -1;
    items.forEach((item, idx) => {
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

  /* ================= STYLE CONFIGURATION ================= */

  // 1. Màu nền (Quan trọng: Opacity thấp 0.6 để thấy độ mờ phía sau)
  const glassBackground = isDarkOverlay
    ? "rgba(35, 35, 35, 0.2)" // Đen mờ (Khi vào vùng tối)
    : "rgba(255, 255, 255, 0.2)"; // Trắng mờ (Khi ở vùng sáng)

  // 2. Viền (Border)
  const glassBorder = isDarkOverlay
    ? "rgba(255, 255, 255, 0.15)"
    : "rgba(255, 255, 255, 0.4)"; // Viền sáng hơn chút cho mode sáng

  // 3. Màu Text & Icon (Inactive)
  const inactiveColor = isDarkOverlay
    ? "rgba(255, 255, 255, 0.6)" // Chữ trắng mờ
    : theme.palette.text.secondary;

  // 4. Màu nền Pill Active
  const activePillBg = isDarkOverlay
    ? "rgba(255, 255, 255, 0.2)" // Pill trắng mờ trên nền đen
    : alpha(theme.palette.primary.main, 0.15); // Pill màu theme trên nền trắng

  // 5. Màu Icon Active
  const activeIconColor = isDarkOverlay
    ? "#90caf9" // Xanh sáng (Light Blue) cho nổi trên nền đen
    : theme.palette.primary.main;

  return (
    <Box
      ref={navRef}
      sx={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1199,
        display: { xs: "flex", md: "none" },
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <Stack
        direction="row"
        sx={{
          pointerEvents: "auto",
          width: "calc(100% - 32px)",
          maxWidth: 550,
          margin: "0 auto",
          mb: `calc(12px + env(safe-area-inset-bottom))`,
          height: 64,

          // --- KÍNH MỜ (GLASSMORPHISM) ---
          borderRadius: 9999,
          background: glassBackground, // Màu nền động

          // Blur mạnh mẽ (iOS style)
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)", // Safari/iOS cần cái này

          border: `1px solid ${glassBorder}`,
          // Shadow thay đổi nhẹ theo nền để tạo độ nổi
          boxShadow: isDarkOverlay
            ? "0 20px 40px rgba(0,0,0,0.6)"
            : "0 10px 30px rgba(0,0,0,0.15)",

          alignItems: "center",
          justifyContent: "space-around",
          padding: "0 8px",

          // Transition mượt mà khi đổi màu
          transition:
            "background 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease",
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
                flex: 1,
                cursor: "pointer",
                minWidth: 0,

                // Transition cho hiệu ứng nảy
                transition: "all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1.2)",
                transform: isActive ? "scale(1.05)" : "scale(1)",

                color: isActive ? activeIconColor : inactiveColor,
                opacity: isSmallScreen && !isActive ? 0.7 : 1,

                "&:active": { transform: "scale(0.95)" },
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <Box
                sx={{
                  padding: "6px 16px",
                  borderRadius: 9999,
                  marginBottom: "2px",
                  transition: "background-color 0.3s ease",
                  backgroundColor: isActive ? activePillBg : "transparent",
                  "& svg": {
                    fontSize: "1.5rem",
                    display: "block",
                    // Drop shadow cho icon active
                    filter: isActive
                      ? `drop-shadow(0 2px 4px ${alpha(activeIconColor, 0.4)})`
                      : "none",
                  },
                }}
              >
                {item.icon}
              </Box>

              <Typography
                variant="caption"
                sx={{
                  fontSize: "0.6rem",
                  fontWeight: isActive ? 700 : 500,
                  letterSpacing: "0.4px",
                  transition: "all 0.2s",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "100%",
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
