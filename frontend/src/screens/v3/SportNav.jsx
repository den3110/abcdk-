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

// [labelKey, href, Icon?] — labelKey resolved via t() at render time.
const DESKTOP_LINKS = [
  ["v3.nav.home", "/"],
  ["v3.nav.tournaments", "/pickle-ball/tournaments"],
  ["v3.nav.rankings", "/pickle-ball/rankings"],
  ["v3.nav.courts", "/courts"],
  ["v3.nav.feed", "/feed"],
  ["v3.nav.live", "/live"],
];

const MOBILE_LINKS = [
  ["v3.nav.home", "/", Home],
  ["v3.nav.feed", "/feed", Newspaper],
  ["v3.nav.tournaments", "/pickle-ball/tournaments", Trophy],
  ["v3.nav.rankingsShort", "/pickle-ball/rankings", ChartNoAxesColumnIncreasing],
  ["v3.nav.notifications", "/notifications", Bell],
];

const PUBLIC_EXTRA_LINKS = [
  ["v3.nav.courts", "/courts", CalendarDays],
  ["v3.nav.findPartner", "/play", UserSearch],
  ["v3.nav.coaches", "/coaches", Dumbbell],
  ["v3.nav.marketplace", "/marketplace", ShoppingBag],
  ["v3.nav.clubs", "/clubs", UsersRound],
  ["v3.nav.live", "/live", Radio],
  ["v3.nav.news", "/news", FileText],
  ["v3.nav.contact", "/contact", CircleHelp],
  ["v3.nav.apiDocs", "/docs/api", BookOpenText],
];

const MEMBER_EXTRA_LINKS = [
  ["v3.nav.profile", "/profile", UserRound],
  ["v3.nav.myTournaments", "/my-tournaments", Trophy],
  ["v3.nav.messages", "/messages", MessageSquareText],
  ["v3.nav.friends", "/friends", UsersRound],
  ["v3.nav.support", "/support", CircleHelp],
];

const ADMIN_EXTRA_LINKS = [
  ["v3.nav.myBookings", "/my-bookings", CalendarDays],
  ["v3.nav.manageVenues", "/owner/venues", Building2],
  ["v3.nav.admin", "/admin", LayoutGrid],
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
  user?.nickname || user?.name || user?.fullName || user?.email || "";

const isAdmin = (user) => {
  const roles = new Set(
    [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])]
      .filter(Boolean)
      .map((role) => String(role).toLowerCase()),
  );
  return user?.isAdmin === true || roles.has("admin");
};

function ThemeButton() {
  const { t } = useLanguage();
  const theme = usePkTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="v3-icon-button"
      aria-label={dark ? t("v3.nav.themeToLight") : t("v3.nav.themeToDark")}
      onClick={() => setPkTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

function LanguageButton() {
  const { language, toggleLanguage, t } = useLanguage();
  const nextLanguage = language === "vi" ? "English" : "Tiếng Việt";
  return (
    <button
      type="button"
      className="v3-language-button"
      aria-label={t("v3.nav.switchToLang", { lang: nextLanguage })}
      onClick={toggleLanguage}
    >
      <Languages size={16} /> {language === "vi" ? "VI" : "EN"}
    </button>
  );
}

function AccountMenu({ user }) {
  const { t } = useLanguage();
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
        <span className="v3-account-name">{displayName(user) || t("v3.nav.accountFallback")}</span>
        <ChevronDown size={15} className={open ? "is-open" : ""} />
      </button>
      {open ? (
        <>
          <button className="v3-menu-scrim" aria-label={t("v3.nav.closeMenu")} onClick={() => setOpen(false)} />
          <div className="v3-account-menu" role="menu">
            <A href="/profile" onClick={() => setOpen(false)}><UserRound size={17} /> {t("v3.nav.profile")}</A>
            <A href="/my-tournaments" onClick={() => setOpen(false)}><Trophy size={17} /> {t("v3.nav.myTournaments")}</A>
            <A href="/messages" onClick={() => setOpen(false)}><MessageSquareText size={17} /> {t("v3.nav.messages")}</A>
            <A href="/friends" onClick={() => setOpen(false)}><UsersRound size={17} /> {t("v3.nav.friends")}</A>
            <A href="/settings/notifications" onClick={() => setOpen(false)}><Bell size={17} /> {t("v3.nav.notifSettings")}</A>
            {isAdmin(user) ? <A href="/admin" onClick={() => setOpen(false)}><ShieldCheck size={17} /> {t("v3.nav.admin")}</A> : null}
            <button type="button" onClick={logout}><LogOut size={17} /> {t("v3.nav.logout")}</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MoreMenu({ user }) {
  const { t } = useLanguage();
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
        {t("v3.nav.explore")} <ChevronDown size={14} className={open ? "is-open" : ""} />
      </button>
      {open ? (
        <>
          <button className="v3-menu-scrim" aria-label={t("v3.nav.closeExploreMenu")} onClick={() => setOpen(false)} />
          <div className="v3-more-menu" role="menu">
            <div className="v3-more-menu-head"><span>{t("v3.nav.allFeatures")}</span><small>PickleTour Web V3</small></div>
            <div className="v3-more-menu-grid">
              {links.map(([label, href, Icon]) => (
                <A href={href} key={href} onClick={() => setOpen(false)}>
                  <span><Icon size={18} /></span>
                  <b>{t(label)}</b>
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
  const { t } = useLanguage();
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
              aria-label={t("v3.nav.back")}
              onClick={handleBack}
            >
              <ArrowLeft size={19} />
            </button>
          ) : null}
          <SportBrand />
          <nav className="v3-desktop-nav" aria-label={t("v3.nav.mainNav")}>
            {DESKTOP_LINKS.map(([label, href]) => (
              <A key={href} href={href} aria-current={isActivePath(pathname, href) ? "page" : undefined}>
                {t(label)}
              </A>
            ))}
            <MoreMenu user={user} />
          </nav>
          <div className="v3-nav-actions">
            <button type="button" className="v3-icon-button v3-search-button" aria-label={t("v3.nav.quickSearch")} onClick={openPalette}>
              <Search size={18} />
            </button>
            <LanguageButton />
            <ThemeButton />
            {user ? <NotificationBell /> : null}
            {user ? (
              <AccountMenu user={user} />
            ) : (
              <>
                <A href="/login" className="v3-login-link">{t("v3.nav.login")}</A>
                <A href="/register" className="v3-primary-small">{t("v3.nav.joinNow")}</A>
              </>
            )}
          </div>
        </div>
      </header>

      {!hideMobileNav ? <nav className="v3-mobile-bottom" aria-label={t("v3.nav.mobileNav")}>
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
              <small>{t(label)}</small>
            </A>
          );
        })}
        <button
          type="button"
          aria-label={t("v3.nav.openMore")}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(true)}
        >
          <span><Menu size={21} /></span>
          <small>{t("v3.nav.more")}</small>
        </button>
      </nav> : null}

      {mobileMenuOpen ? (
        <div className="v3-mobile-sheet-layer">
          <button className="v3-mobile-sheet-scrim" aria-label={t("v3.nav.closeMenu")} onClick={() => setMobileMenuOpen(false)} />
          <section className="v3-mobile-sheet" aria-label={t("v3.nav.moreFeatures")}>
            <div className="v3-mobile-sheet-head">
              <SportBrand compact />
              <button type="button" className="v3-icon-button" aria-label={t("v3.nav.closeMenu")} onClick={() => setMobileMenuOpen(false)}><X size={20} /></button>
            </div>
            <div className="v3-mobile-sheet-grid">
              {[
                ...PUBLIC_EXTRA_LINKS,
                ...(user ? MEMBER_EXTRA_LINKS : []),
                ...(isAdmin(user) ? ADMIN_EXTRA_LINKS : []),
              ].map(([label, href, Icon]) => (
                <A href={href} key={href}><Icon size={21} /> <span>{t(label)}</span></A>
              ))}
              {!user ? <A href="/login"><LogIn size={21} /> <span>{t("v3.nav.login")}</span></A> : null}
            </div>
            <div className="v3-mobile-sheet-tools">
              <button type="button" onClick={() => { setMobileMenuOpen(false); openPalette(); }}><Search size={18} /> {t("v3.nav.quickSearch")}</button>
              <LanguageButton />
              <ThemeButton />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
