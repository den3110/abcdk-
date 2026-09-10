/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  Home,
  LogIn,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Newspaper,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sun,
  Trophy,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

import { logout as logoutAction } from "../../slices/authSlice.js";
import { useLogoutMutation } from "../../slices/usersApiSlice.js";
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
  ["Xếp hạng", "/pickle-ball/rankings", CalendarDays],
  ["Thông báo", "/notifications", Bell],
];

const EXTRA_LINKS = [
  ["Câu lạc bộ", "/clubs", UsersRound],
  ["Tìm bạn đánh", "/play", Search],
  ["Chợ PickleTour", "/marketplace", ShoppingBag],
  ["Tin nhắn", "/messages", MessageSquareText],
];

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
            {isAdmin(user) ? <A href="/admin" onClick={() => setOpen(false)}><ShieldCheck size={17} /> Quản trị</A> : null}
            <button type="button" onClick={logout}><LogOut size={17} /> Đăng xuất</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function SportNav() {
  const user = useSelector((state) => state.auth?.userInfo || null);
  const { pathname } = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => setMobileMenuOpen(false), [pathname]);

  return (
    <>
      <header className="v3-site-header">
        <div className="v3-nav-inner">
          <SportBrand />
          <nav className="v3-desktop-nav" aria-label="Điều hướng chính">
            {DESKTOP_LINKS.map(([label, href]) => (
              <A key={href} href={href} aria-current={isActivePath(pathname, href) ? "page" : undefined}>
                {label}
              </A>
            ))}
          </nav>
          <div className="v3-nav-actions">
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

      <nav className="v3-mobile-bottom" aria-label="Điều hướng mobile">
        {MOBILE_LINKS.map(([label, href, Icon]) => {
          const active = isActivePath(pathname, href);
          return (
            <A key={href} href={href} aria-current={active ? "page" : undefined}>
              <span><Icon size={21} strokeWidth={active ? 2.6 : 2.1} /></span>
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
      </nav>

      {mobileMenuOpen ? (
        <div className="v3-mobile-sheet-layer">
          <button className="v3-mobile-sheet-scrim" aria-label="Đóng menu" onClick={() => setMobileMenuOpen(false)} />
          <section className="v3-mobile-sheet" aria-label="Thêm chức năng">
            <div className="v3-mobile-sheet-head">
              <SportBrand compact />
              <button type="button" className="v3-icon-button" aria-label="Đóng menu" onClick={() => setMobileMenuOpen(false)}><X size={20} /></button>
            </div>
            <div className="v3-mobile-sheet-grid">
              {EXTRA_LINKS.map(([label, href, Icon]) => (
                <A href={href} key={href}><Icon size={21} /> <span>{label}</span></A>
              ))}
              {user ? <A href="/profile"><UserRound size={21} /> <span>Hồ sơ</span></A> : <A href="/login"><LogIn size={21} /> <span>Đăng nhập</span></A>}
            </div>
            <div className="v3-mobile-sheet-theme"><span>Chế độ hiển thị</span><ThemeButton /></div>
          </section>
        </div>
      ) : null}
    </>
  );
}
