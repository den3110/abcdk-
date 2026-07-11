/**
 * SiteNav — header DÙNG CHUNG cho các trang giao diện mới (Astryx, trong ShadowFrame).
 * Biết trạng thái đăng nhập:
 *  - Khách: link "Đăng nhập" + pill "Bắt đầu".
 *  - Đã đăng nhập: avatar + tên + dropdown (Hồ sơ / Giải của tôi / Quản trị nếu admin / Đăng xuất).
 * Dropdown tự dựng (MUI không dùng được trong shadow) — backdrop fixed để đóng khi bấm ra ngoài.
 */
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Avatar } from "@astryxdesign/core/Avatar";
import { ChevronDown, LogOut, Moon, Shield, Sun, Trophy, User } from "lucide-react";

import PickleMark from "./PickleMark.jsx";
import { A, WhitePill, imgSrc } from "./ui.jsx";
import { setPkTheme, usePkTheme } from "./theme.js";
import { logout as logoutAction } from "../../slices/authSlice.js";
import { useLogoutMutation } from "../../slices/usersApiSlice.js";

const NAV_LINKS = [
  ["Giải đấu", "/pickle-ball/tournaments"],
  ["Bảng xếp hạng", "/pickle-ball/rankings"],
  ["Trực tiếp", "/live"],
  ["Câu lạc bộ", "/clubs"],
  ["Liên hệ", "/contact"],
];

const normalizeRole = (r) => String(r || "").trim().toLowerCase();
const isAdminUser = (u) => {
  const roles = new Set(
    Array.isArray(u?.roles) ? u.roles.map(normalizeRole) : []
  );
  if (u?.role) roles.add(normalizeRole(u.role));
  if (u?.isAdmin === true) roles.add("admin");
  return roles.has("admin");
};
const displayName = (u) =>
  [u?.nickname, u?.name, u?.fullName, u?.email]
    .map((x) => String(x || "").trim())
    .find(Boolean) || "Tài khoản";

/* Nút gạt sáng/tối — dùng được cả khi chưa đăng nhập. Icon = chế độ SẼ chuyển sang. */
function ThemeToggle() {
  const theme = usePkTheme();
  const dark = theme === "dark";
  const label = dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối";
  return (
    <button
      type="button"
      onClick={() => setPkTheme(dark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className="pk-pill"
      style={{
        all: "unset",
        width: 36,
        height: 36,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        color: "light-dark(#3D4247, #C6CACF)",
        border: "1px solid light-dark(rgba(0,0,0,.10), rgba(255,255,255,0.10))",
      }}
    >
      {dark ? <Sun size={17} strokeWidth={2.1} /> : <Moon size={17} strokeWidth={2.1} />}
    </button>
  );
}

function MenuItem({ icon: Ico, label, href, onClick, danger }) {
  const inner = (
    <span
      className="pk-menuitem"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 10,
        fontSize: 14.5,
        fontWeight: 550,
        color: danger ? "light-dark(#D6474F, #F2717A)" : "light-dark(#3D4247, #DFE2E5)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <Ico size={16} strokeWidth={2.2} style={{ opacity: 0.85 }} />
      {label}
    </span>
  );
  if (href) {
    return (
      <A href={href} onClick={onClick} style={{ textDecoration: "none", display: "block" }}>
        {inner}
      </A>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ all: "unset", display: "block", width: "100%", boxSizing: "border-box" }}
    >
      {inner}
    </button>
  );
}

function UserMenu({ userInfo }) {
  const [open, setOpen] = useState(false);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [logoutApiCall] = useLogoutMutation();
  const name = displayName(userInfo);
  const avatar = imgSrc(userInfo?.avatar || userInfo?.user?.avatar);

  const onLogout = async () => {
    setOpen(false);
    try {
      await logoutApiCall().unwrap();
    } catch (e) {
      // vẫn logout local dù API lỗi — không kẹt phiên chết
    }
    dispatch(logoutAction());
    navigate("/login");
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          all: "unset",
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "5px 10px 5px 6px",
          borderRadius: 999,
          cursor: "pointer",
          background: open ? "light-dark(rgba(0,0,0,.06), rgba(255,255,255,0.08))" : "transparent",
          border: "1px solid light-dark(rgba(0,0,0,.10), rgba(255,255,255,0.10))",
        }}
      >
        <Avatar size="small" src={avatar} name={name} />
        <span
          style={{
            color: "light-dark(#26282B, #E6E8EA)",
            fontSize: 14,
            fontWeight: 600,
            maxWidth: 140,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        <ChevronDown
          size={15}
          style={{ color: "light-dark(#6B7075, #9AA0A6)", transition: "transform .2s", transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 28 }}
          />
          <div
            role="menu"
            className="pk-fade"
            style={{
              position: "absolute",
              top: "calc(100% + 10px)",
              right: 0,
              zIndex: 30,
              minWidth: 218,
              padding: 6,
              borderRadius: 14,
              background: "light-dark(#FFFFFF, #1C1D20)",
              border: "1px solid var(--color-border, rgba(255,255,255,0.09))",
              boxShadow: "0 24px 60px -18px light-dark(rgba(0,0,0,.2), rgba(0,0,0,.65))",
            }}
          >
            <MenuItem icon={User} label="Hồ sơ" href="/profile" onClick={() => setOpen(false)} />
            <MenuItem icon={Trophy} label="Giải của tôi" href="/my-tournaments" onClick={() => setOpen(false)} />
            {isAdminUser(userInfo) && (
              <MenuItem icon={Shield} label="Quản trị" href="/admin" onClick={() => setOpen(false)} />
            )}
            <div style={{ height: 1, margin: "6px 8px", background: "light-dark(rgba(0,0,0,.08), rgba(255,255,255,0.08))" }} />
            <MenuItem icon={LogOut} label="Đăng xuất" onClick={onLogout} danger />
          </div>
        </>
      )}
    </div>
  );
}

export default function SiteNav() {
  const userInfo = useSelector((s) => s.auth?.userInfo || null);

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "light-dark(rgba(255,255,255,.72), rgba(17,17,18,0.72))",
        backdropFilter: "saturate(160%) blur(12px)",
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: "0 24px",
          height: 64,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <A href="/" aria-label="PickleTour" className="pk-brand" style={{ display: "flex", alignItems: "center" }}>
          <PickleMark size={34} />
        </A>
        <nav
          className="pk-navlinks"
          style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: "flex", gap: 28 }}
        >
          {NAV_LINKS.map(([label, href]) => (
            <A key={href} href={href} style={{ color: "light-dark(#3D4247, #D8DBDF)", textDecoration: "none", fontSize: 14.5, fontWeight: 550 }}>
              {label}
            </A>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ThemeToggle />
          {userInfo ? (
            <UserMenu userInfo={userInfo} />
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <A href="/login" style={{ color: "light-dark(#3D4247, #C6CACF)", textDecoration: "none", fontSize: 14.5, fontWeight: 550 }}>
                Đăng nhập
              </A>
              <WhitePill label="Bắt đầu" href="/register" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
