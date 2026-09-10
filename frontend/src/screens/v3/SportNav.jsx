/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bell,
  BookOpenText,
  Building2,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  CircleHelp,
  Dumbbell,
  FileText,
  Home,
  LayoutGrid,
  Languages,
  LogIn,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Newspaper,
  Radio,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sun,
  Trophy,
  UserSearch,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

import { logout as logoutAction } from "../../slices/authSlice.js";
import { useLogoutMutation } from "../../slices/usersApiSlice.js";
import { useNotifUnreadCountQuery } from "../../slices/notificationCenterApiSlice.js";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { useCommandPalette } from "../../context/CommandPaletteContext.jsx";
import { A, imgSrc } from "../astryx/ui.jsx";
import NotificationBell from "../astryx/NotificationBell.jsx";
import { setPkTheme, usePkTheme } from "../astryx/theme.js";
import SportBrand from "./SportBrand.jsx";

const DESKTOP_LINKS = [
  ["Trang chủ", "/"],
  ["Giải đấu", "/pickle-ball/tournaments"],
  ["Bảng xếp hạng", "/pickle-ball/rankings"],
  ["Đặt sân", "/courts"],
  ["Bảng tin", "/feed"],
  ["Trực tiếp", "/live"],
];

const MOBILE_LINKS = [
  ["Trang chủ", "/", Home],
  ["Bảng tin", "/feed", Newspaper],
  ["Giải đấu", "/pickle-ball/tournaments", Trophy],
  ["Xếp hạng", "/pickle-ball/rankings", ChartNoAxesColumnIncreasing],
  ["Thông báo", "/notifications", Bell],
];

const PUBLIC_EXTRA_LINKS = [
  ["Đặt sân", "/courts", CalendarDays],
  ["Tìm bạn đánh", "/play", UserSearch],
  ["Huấn luyện viên", "/coaches", Dumbbell],
  ["Chợ PickleTour", "/marketplace", ShoppingBag],
  ["Câu lạc bộ", "/clubs", UsersRound],
  ["Trực tiếp", "/live", Radio],
  ["Tin tức", "/news", FileText],
  ["Liên hệ", "/contact", CircleHelp],
  ["Tài liệu API", "/docs/api", BookOpenText],
];

const MEMBER_EXTRA_LINKS = [
  ["Hồ sơ", "/profile", UserRound],
  ["Giải của tôi", "/my-tournaments", Trophy],
  ["Tin nhắn", "/messages", MessageSquareText],
  ["Bạn bè", "/friends", UsersRound],
  ["Hỗ trợ", "/support", CircleHelp],
];

const ADMIN_EXTRA_LINKS = [
  ["Lượt đặt sân", "/my-bookings", CalendarDays],
  ["Quản lý sân", "/owner/venues", Building2],
  ["Quản trị", "/admin", LayoutGrid],
];

const MOBILE_ROOT_PATHS = new Set([
  "/",
  "/feed",
  "/pickle-ball/tournaments",
  "/pickle-ball/rankings",
  "/notifications",
  "/clubs",
  "/profile",
  "/my-tournaments",
]);

const isActivePath = (pathname, href) =>
  href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);

const displayName = (user) =>
  user?.nickname || user?.name || user?.fullName || user?.email || "Tài khoản";

const isAdmin = (user) => {
  const roles = new Set(
    [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])]
      .filter(Boolean)
      .map((role) => String(role).toLowerCase()),
  );
  return user?.isAdmin === true || roles.has("admin");
};

function ThemeButton() {
  const theme = usePkTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="v3-icon-button"
      aria-label={dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
      onClick={() => setPkTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

function LanguageButton() {
  const { language, toggleLanguage } = useLanguage();
  const nextLanguage = language === "vi" ? "English" : "Tiếng Việt";
  return (
    <button
      type="button"
      className="v3-language-button"
      aria-label={`Chuyển sang ${nextLanguage}`}
      onClick={toggleLanguage}
    >
      <Languages size={16} /> {language === "vi" ? "VI" : "EN"}
    </button>
  );
}

function AccountMenu({ user }) {
  const [open, setOpen] = useState(false);
  const [logoutApiCall] = useLogoutMutation();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const logout = async () => {
    try {
      await logoutApiCall().unwrap();
    } catch {
      // Phiên local vẫn phải được đóng khi API tạm thời không phản hồi.
    }
    dispatch(logoutAction());
    navigate("/login");
  };

  return (
    <div className="v3-account-wrap">
      <button
        type="button"
        className="v3-account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="v3-avatar">
          {imgSrc(user?.avatar) ? <img src={imgSrc(user.avatar)} alt="" /> : <UserRound size={17} />}
        </span>
        <span className="v3-account-name">{displayName(user)}</span>
        <ChevronDown size={15} className={open ? "is-open" : ""} />
      </button>
      {open ? (
        <>
          <button className="v3-menu-scrim" aria-label="Đóng menu" onClick={() => setOpen(false)} />
          <div className="v3-account-menu" role="menu">
            <A href="/profile" onClick={() => setOpen(false)}><UserRound size={17} /> Hồ sơ</A>
            <A href="/my-tournaments" onClick={() => setOpen(false)}><Trophy size={17} /> Giải của tôi</A>
            <A href="/messages" onClick={() => setOpen(false)}><MessageSquareText size={17} /> Tin nhắn</A>
            <A href="/friends" onClick={() => setOpen(false)}><UsersRound size={17} /> Bạn bè</A>
            <A href="/settings/notifications" onClick={() => setOpen(false)}><Bell size={17} /> Cài đặt thông báo</A>
            {isAdmin(user) ? <A href="/admin" onClick={() => setOpen(false)}><ShieldCheck size={17} /> Quản trị</A> : null}
            <button type="button" onClick={logout}><LogOut size={17} /> Đăng xuất</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MoreMenu({ user }) {
  const [open, setOpen] = useState(false);
  const links = [
    ...PUBLIC_EXTRA_LINKS,
    ...(user ? MEMBER_EXTRA_LINKS : []),
    ...(isAdmin(user) ? ADMIN_EXTRA_LINKS : []),
  ];

  return (
    <div className="v3-more-wrap">
      <button
        type="button"
        className="v3-more-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Khám phá <ChevronDown size={14} className={open ? "is-open" : ""} />
      </button>
      {open ? (
        <>
          <button className="v3-menu-scrim" aria-label="Đóng menu khám phá" onClick={() => setOpen(false)} />
          <div className="v3-more-menu" role="menu">
            <div className="v3-more-menu-head"><span>TOÀN BỘ TÍNH NĂNG</span><small>PickleTour Web V3</small></div>
            <div className="v3-more-menu-grid">
              {links.map(([label, href, Icon]) => (
                <A href={href} key={href} onClick={() => setOpen(false)}>
                  <span><Icon size={18} /></span>
                  <b>{label}</b>
                </A>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function SportNav({ hideMobileNav = false }) {
  const user = useSelector((state) => state.auth?.userInfo || null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { openPalette } = useCommandPalette();
  const { data: unreadData } = useNotifUnreadCountQuery(undefined, {
    skip: !user,
    pollingInterval: 60000,
  });
  const unreadCount = Number(unreadData?.count || 0);
  const showBackButton = !MOBILE_ROOT_PATHS.has(pathname);
  const handleBack = () => {
    const hasHistory =
      typeof window !== "undefined" &&
      (Number(window.history?.state?.idx || 0) > 0 || Boolean(document.referrer));
    if (hasHistory) navigate(-1);
    else navigate("/");
  };

  useEffect(() => setMobileMenuOpen(false), [pathname]);

  return (
    <>
      <header className="v3-site-header">
        <div className="v3-nav-inner">
          {showBackButton ? (
            <button
              type="button"
              className="v3-back-button"
              aria-label="Quay lại trang trước"
              onClick={handleBack}
            >
              <ArrowLeft size={19} />
            </button>
          ) : null}
          <SportBrand />
          <nav className="v3-desktop-nav" aria-label="Điều hướng chính">
            {DESKTOP_LINKS.map(([label, href]) => (
              <A key={href} href={href} aria-current={isActivePath(pathname, href) ? "page" : undefined}>
                {label}
              </A>
            ))}
            <MoreMenu user={user} />
          </nav>
          <div className="v3-nav-actions">
            <button type="button" className="v3-icon-button v3-search-button" aria-label="Tìm kiếm nhanh" onClick={openPalette}>
              <Search size={18} />
            </button>
            <LanguageButton />
            <ThemeButton />
            {user ? <NotificationBell /> : null}
            {user ? (
              <AccountMenu user={user} />
            ) : (
              <>
                <A href="/login" className="v3-login-link">Đăng nhập</A>
                <A href="/register" className="v3-primary-small">Tham gia ngay</A>
              </>
            )}
          </div>
        </div>
      </header>

      {!hideMobileNav ? <nav className="v3-mobile-bottom" aria-label="Điều hướng mobile">
        {MOBILE_LINKS.map(([label, href, Icon]) => {
          const active = isActivePath(pathname, href);
          return (
            <A key={href} href={href} aria-current={active ? "page" : undefined}>
              <span className="v3-mobile-tab-icon">
                <Icon size={21} strokeWidth={active ? 2.6 : 2.1} />
                {href === "/notifications" && unreadCount > 0 ? (
                  <i className="v3-mobile-badge">{unreadCount > 99 ? "99+" : unreadCount}</i>
                ) : null}
              </span>
              <small>{label}</small>
            </A>
          );
        })}
        <button
          type="button"
          aria-label="Mở thêm chức năng"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(true)}
        >
          <span><Menu size={21} /></span>
          <small>Khác</small>
        </button>
      </nav> : null}

      {mobileMenuOpen ? (
        <div className="v3-mobile-sheet-layer">
          <button className="v3-mobile-sheet-scrim" aria-label="Đóng menu" onClick={() => setMobileMenuOpen(false)} />
          <section className="v3-mobile-sheet" aria-label="Thêm chức năng">
            <div className="v3-mobile-sheet-head">
              <SportBrand compact />
              <button type="button" className="v3-icon-button" aria-label="Đóng menu" onClick={() => setMobileMenuOpen(false)}><X size={20} /></button>
            </div>
            <div className="v3-mobile-sheet-grid">
              {[
                ...PUBLIC_EXTRA_LINKS,
                ...(user ? MEMBER_EXTRA_LINKS : []),
                ...(isAdmin(user) ? ADMIN_EXTRA_LINKS : []),
              ].map(([label, href, Icon]) => (
                <A href={href} key={href}><Icon size={21} /> <span>{label}</span></A>
              ))}
              {!user ? <A href="/login"><LogIn size={21} /> <span>Đăng nhập</span></A> : null}
            </div>
            <div className="v3-mobile-sheet-tools">
              <button type="button" onClick={() => { setMobileMenuOpen(false); openPalette(); }}><Search size={18} /> Tìm kiếm nhanh</button>
              <LanguageButton />
              <ThemeButton />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
