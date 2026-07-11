/**
 * ProfilePage — trang HỒ SƠ cá nhân phong cách Astryx (/profile).
 * Hero định danh: avatar lớn (ring gradient khi KYC verified, hover để đổi ảnh)
 * + tên/nickname + chips (vai trò, KYC, tỉnh, ngày tham gia) + 2 card điểm trình
 * (đơn/đôi kèm độ tin cậy) + vòng tròn % hoàn thiện hồ sơ.
 * Thân 2 cột: form thông tin cá nhân (input focus-glow) + đổi mật khẩu thu gọn;
 * cột phải: card KYC (số CCCD che, ảnh 2 mặt bấm zoom, upload khi chưa verified),
 * card hoàn thiện hồ sơ (chỉ liệt kê mục còn thiếu), card tài khoản (đăng xuất).
 * Có thay đổi -> thanh lưu nổi đáy màn: Hoàn tác / Lưu (diff payload như trang cũ).
 * ?ui=v1 ra trang cũ (gate ở ProfileGate.jsx).
 */
import "@fontsource-variable/figtree";

import { useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import {
  BadgeCheck,
  Camera,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Eye,
  EyeOff,
  IdCard,
  KeyRound,
  LogOut,
  MapPin,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";

import SEOHead from "../../components/SEOHead.jsx";
import ShadowFrame from "./ShadowFrame.jsx";
import SiteNav from "./SiteNav.jsx";
import SiteFooter from "./SiteFooter.jsx";
import { WhitePill, GrayPill, Lightbox, imgSrc } from "./ui.jsx";
import { PROVINCES } from "../ProfileScreen.jsx";
import {
  useGetProfileQuery,
  useUpdateUserMutation,
  useLogoutMutation,
} from "../../slices/usersApiSlice.js";
import { useUploadRealAvatarMutation, useUploadCccdMutation } from "../../slices/uploadApiSlice.js";
import { logout as logoutAction } from "../../slices/authSlice.js";

/* ------------------------------- helpers ------------------------------- */
const Container = ({ children, style }) => (
  <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px", ...style }}>
    {children}
  </div>
);

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

const toDateInput = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
};
const fmtJoined = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return `${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
};
const maskCccd = (s) => {
  const v = String(s || "");
  return v.length >= 8 ? `${v.slice(0, 4)} •••• ${v.slice(-4)}` : v;
};

/* form <-> user */
const formFromUser = (u) => ({
  name: u?.name || "",
  nickname: u?.nickname || "",
  email: u?.email || "",
  phone: u?.phone || "",
  dob: toDateInput(u?.dob),
  gender: u?.gender || "",
  province: u?.province || "",
  cccd: u?.cccd || "",
});

const KYC_META = {
  verified: { label: "Đã xác minh", variant: "success" },
  pending: { label: "Chờ duyệt", variant: "info" },
  rejected: { label: "Bị từ chối", variant: "critical" },
  unverified: { label: "Chưa xác minh", variant: "neutral" },
};

/* ------------------------------ tiểu phần ------------------------------ */
function Field({ label, children, hint }) {
  return (
    <label style={{ display: "block", minWidth: 0 }}>
      <div style={{ fontSize: 11.5, fontWeight: 750, letterSpacing: ".07em", textTransform: "uppercase", color: "#8F959C", marginBottom: 7 }}>
        {label}
      </div>
      {children}
      {hint && <div style={{ marginTop: 5, fontSize: 12, color: "#6E747B" }}>{hint}</div>}
    </label>
  );
}

function Panel({ icon, title, children, style }) {
  return (
    <section style={{ borderRadius: 18, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", padding: "22px 24px", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <span style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "rgba(61,135,255,.12)", color: "#7FB3FF" }}>
          {icon}
        </span>
        <span style={{ color: "#F0F1F3", fontWeight: 750, fontSize: 16.5 }}>{title}</span>
      </div>
      {children}
    </section>
  );
}

/* card điểm trình trong hero */
function RatingCard({ label, value, reliability, delay }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(reliability || 0) * 100)));
  return (
    <div className="pk-rise" style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.12)", background: "rgba(20,21,24,.66)", backdropFilter: "blur(10px)", padding: "16px 20px", minWidth: 148, animationDelay: delay }}>
      <div style={{ fontSize: 11.5, fontWeight: 750, letterSpacing: ".08em", textTransform: "uppercase", color: "#9AA0A6" }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 32, fontWeight: 800, letterSpacing: "-.02em", color: "#F5F6F7", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
        {Number(value ?? 0).toFixed(2)}
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8F959C", marginBottom: 4 }}>
          <span>Độ tin cậy</span>
          <span>{pct}%</span>
        </div>
        <div style={{ height: 4, borderRadius: 99, background: "rgba(255,255,255,.09)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#2694FE,#3D87FF)", borderRadius: 99 }} />
        </div>
      </div>
    </div>
  );
}

/* vòng tròn % hoàn thiện hồ sơ */
function CompletionRing({ pct, done, total }) {
  const R = 30;
  const C = 2 * Math.PI * R;
  return (
    <div className="pk-rise" style={{ display: "flex", alignItems: "center", gap: 14, animationDelay: ".3s" }}>
      <div style={{ position: "relative", width: 76, height: 76, flexShrink: 0 }}>
        <svg width="76" height="76" viewBox="0 0 76 76" style={{ transform: "rotate(-90deg)", display: "block" }}>
          <circle cx="38" cy="38" r={R} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="6" />
          <circle
            cx="38" cy="38" r={R} fill="none"
            stroke={pct >= 100 ? "#3BA55D" : "#3D87FF"}
            strokeWidth="6" strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct / 100)}
            style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.7,.2,1)" }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 14.5, fontWeight: 800, color: "#F0F1F3", pointerEvents: "none" }}>
          {pct}%
        </div>
      </div>
      <div>
        <div style={{ color: "#F0F1F3", fontWeight: 700, fontSize: 13.5 }}>Hoàn thiện hồ sơ</div>
        <div style={{ color: "#8F959C", fontSize: 12.5, marginTop: 2 }}>{done}/{total} mục</div>
      </div>
    </div>
  );
}

/* ================================= PAGE ================================= */
export default function ProfilePage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { data: user, isLoading, refetch } = useGetProfileQuery();
  const [updateProfile, { isLoading: saving }] = useUpdateUserMutation();
  const [uploadAvatar] = useUploadRealAvatarMutation();
  const [uploadCccd, { isLoading: kycUploading }] = useUploadCccdMutation();
  const [logoutApi, { isLoading: loggingOut }] = useLogoutMutation();

  /* ---- form state: init theo user, "phiên bản" theo updatedAt để re-sync sau save ---- */
  const [form, setForm] = useState(null); // null = chưa đụng -> dùng giá trị từ user
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [pw, setPw] = useState({ password: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [zoomSrc, setZoomSrc] = useState("");
  const [toast, setToast] = useState(null); // {type, msg}
  const [kycFront, setKycFront] = useState(null);
  const [kycBack, setKycBack] = useState(null);
  const avatarInputRef = useRef(null);

  const baseForm = useMemo(() => formFromUser(user), [user]);
  const f = form ?? baseForm;

  const setField = (k) => (e) => setForm({ ...f, [k]: e.target.value });

  /* ---- dirty + validate ---- */
  const dirtyFields = useMemo(() => {
    const out = {};
    for (const k of Object.keys(baseForm)) if (f[k] !== baseForm[k]) out[k] = f[k];
    return out;
  }, [f, baseForm]);
  const pwValid = !passwordOpen || (pw.password.length >= 6 && pw.password === pw.confirm);
  const pwDirty = passwordOpen && pw.password.length > 0;
  const isDirty = Object.keys(dirtyFields).length > 0 || !!avatarFile || pwDirty;

  const errors = useMemo(() => {
    const e = {};
    if (!f.name.trim()) e.name = "Chưa nhập họ tên";
    if (f.phone && !/^0\d{9}$/.test(f.phone.trim())) e.phone = "SĐT phải 10 số, bắt đầu bằng 0";
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = "Email không hợp lệ";
    if (f.cccd && !/^\d{12}$/.test(f.cccd.trim())) e.cccd = "CCCD phải đủ 12 số";
    if (passwordOpen && pw.password && pw.password.length < 6) e.password = "Mật khẩu tối thiểu 6 ký tự";
    if (passwordOpen && pw.password && pw.password !== pw.confirm) e.confirm = "Mật khẩu nhập lại chưa khớp";
    return e;
  }, [f, passwordOpen, pw]);
  const canSave = isDirty && Object.keys(errors).length === 0 && pwValid && !saving;

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3200);
  };

  /* ---- avatar ---- */
  const pickAvatar = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_SIZE) {
      showToast("error", "Ảnh quá lớn (tối đa 5MB)");
      return;
    }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  /* ---- lưu (diff như trang cũ) ---- */
  const onSave = async () => {
    if (!canSave) return;
    try {
      const payload = { ...dirtyFields };
      if (avatarFile) {
        const uploaded = await uploadAvatar(avatarFile).unwrap();
        payload.avatar = uploaded?.url || uploaded?.avatar || "";
      }
      if (pwDirty) payload.password = pw.password;
      await updateProfile(payload).unwrap();
      await refetch();
      setForm(null);
      setAvatarFile(null);
      setAvatarPreview("");
      setPw({ password: "", confirm: "" });
      setPasswordOpen(false);
      showToast("success", "Đã lưu thay đổi");
    } catch (err) {
      showToast("error", err?.data?.message || err?.error || "Lưu thất bại, thử lại nhé");
    }
  };
  const onReset = () => {
    setForm(null);
    setAvatarFile(null);
    setAvatarPreview("");
    setPw({ password: "", confirm: "" });
  };

  /* ---- KYC upload (chỉ khi chưa verified) ---- */
  const onKycSubmit = async () => {
    if (!kycFront || !kycBack) {
      showToast("error", "Chọn đủ ảnh 2 mặt CCCD nhé");
      return;
    }
    try {
      const fd = new FormData();
      fd.append("front", kycFront);
      fd.append("back", kycBack);
      await uploadCccd(fd).unwrap();
      await refetch();
      setKycFront(null);
      setKycBack(null);
      showToast("success", "Đã gửi ảnh CCCD, chờ duyệt");
    } catch (err) {
      showToast("error", err?.data?.message || "Gửi ảnh thất bại");
    }
  };

  /* ---- logout ---- */
  const onLogout = async () => {
    try {
      await logoutApi().unwrap();
    } catch {
      /* server lỗi vẫn logout local */
    }
    dispatch(logoutAction());
    navigate("/login");
  };

  /* ---- hoàn thiện hồ sơ (11 mục như trang cũ) ---- */
  const completion = useMemo(() => {
    const items = [
      ["Họ tên", !!user?.name],
      ["Nickname", !!user?.nickname],
      ["Số điện thoại", !!user?.phone],
      ["Email", !!user?.email],
      ["Ngày sinh", !!user?.dob],
      ["Giới tính", !!user?.gender],
      ["Tỉnh/thành", !!user?.province],
      ["Ảnh đại diện", !!user?.avatar],
      ["Số CCCD", !!user?.cccd],
      ["Ảnh CCCD 2 mặt", !!(user?.cccdImages?.front && user?.cccdImages?.back)],
      ["Gửi xác minh", ["pending", "verified"].includes(user?.cccdStatus)],
    ];
    const done = items.filter(([, ok]) => ok).length;
    return { items, done, total: items.length, pct: Math.round((done / items.length) * 100), missing: items.filter(([, ok]) => !ok).map(([l]) => l) };
  }, [user]);

  const kyc = KYC_META[user?.cccdStatus] || KYC_META.unverified;
  const isVerified = user?.cccdStatus === "verified";
  const avatarUrl = avatarPreview || imgSrc(user?.avatar);
  const roleLabel = user?.role === "admin" ? "Quản trị viên" : user?.role === "referee" ? "Trọng tài" : null;

  return (
    <>
      <SEOHead title="Hồ sơ của tôi — PickleTour" description="Quản lý thông tin cá nhân, điểm trình và xác minh KYC trên PickleTour." />
      <ShadowFrame style={{ minHeight: "100vh" }}>
        <Theme theme={neutralTheme}>
          <div style={{ minHeight: "100vh", background: "var(--color-background-body)", paddingBottom: isDirty ? 86 : 0 }}>
            <SiteNav />

            {/* ================= HERO ================= */}
            <div style={{ position: "relative", overflow: "hidden", borderBottom: "1px solid var(--color-border)" }}>
              <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(52% 70% at 18% 0%, rgba(61,135,255,.13), transparent 62%), radial-gradient(40% 60% at 88% 10%, rgba(38,148,254,.07), transparent 60%)" }} />
              <Container style={{ position: "relative", zIndex: 2 }}>
                {isLoading && !user ? (
                  <div style={{ padding: "62px 0 44px", display: "flex", gap: 24, alignItems: "center" }}>
                    <Skeleton width="112px" height="112px" borderRadius="999px" />
                    <div style={{ flex: 1 }}>
                      <Skeleton width="min(340px,70%)" height="36px" />
                      <div style={{ height: 12 }} />
                      <Skeleton width="min(220px,50%)" height="18px" />
                    </div>
                  </div>
                ) : (
                  <div className="pk-2col" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) auto", gap: 30, alignItems: "center", padding: "54px 0 44px" }}>
                    {/* trái: avatar + định danh */}
                    <div style={{ display: "flex", gap: 24, alignItems: "center", minWidth: 0, flexWrap: "wrap" }}>
                      <div className="pk-avatar-wrap pk-rise" style={{ position: "relative", flexShrink: 0 }}>
                        <div style={{ width: 112, height: 112, borderRadius: 999, padding: 3, background: isVerified ? "linear-gradient(135deg,#2694FE,#3BA55D)" : "rgba(255,255,255,.14)" }}>
                          {avatarUrl ? (
                            <img src={avatarUrl} alt={user?.nickname || "avatar"} style={{ width: "100%", height: "100%", borderRadius: 999, objectFit: "cover", display: "block", border: "3px solid #101114" }} />
                          ) : (
                            <div style={{ width: "100%", height: "100%", borderRadius: 999, display: "grid", placeItems: "center", background: "#1B1D21", border: "3px solid #101114", color: "#8F959C" }}>
                              <User size={40} />
                            </div>
                          )}
                        </div>
                        {isVerified && (
                          <span title="Đã xác minh KYC" style={{ position: "absolute", bottom: 4, right: 4, width: 28, height: 28, borderRadius: 999, display: "grid", placeItems: "center", background: "#3BA55D", border: "3px solid #101114", color: "#fff" }}>
                            <BadgeCheck size={15} />
                          </span>
                        )}
                        {/* hover: đổi ảnh */}
                        <div className="pk-avatar-edit" onClick={() => avatarInputRef.current?.click()} title="Đổi ảnh đại diện">
                          <Camera size={22} color="#E6E8EA" />
                        </div>
                        <input ref={avatarInputRef} type="file" accept="image/*" onChange={pickAvatar} style={{ display: "none" }} />
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <h1 className="pk-rise" style={{ margin: 0, fontWeight: 750, fontSize: "clamp(26px,3.2vw,38px)", letterSpacing: "-.02em", color: "#F5F6F7", lineHeight: 1.1, animationDelay: ".06s" }}>
                          {user?.name || "—"}
                        </h1>
                        {user?.nickname && (
                          <div className="pk-rise" style={{ marginTop: 5, color: "#9AA0A6", fontSize: 15.5, fontWeight: 600, animationDelay: ".1s" }}>
                            @{user.nickname}
                          </div>
                        )}
                        <div className="pk-rise" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 13, animationDelay: ".16s" }}>
                          {roleLabel && <Badge variant="info" label={roleLabel} />}
                          <Badge variant={kyc.variant} label={kyc.label} />
                          {user?.province && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 650, background: "rgba(255,255,255,.06)", color: "#C9CDD2", border: "1px solid rgba(255,255,255,.09)" }}>
                              <MapPin size={11} />
                              {user.province}
                            </span>
                          )}
                          {user?.createdAt && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 650, background: "rgba(255,255,255,.06)", color: "#C9CDD2", border: "1px solid rgba(255,255,255,.09)" }}>
                              <CalendarDays size={11} />
                              Tham gia {fmtJoined(user.createdAt)}
                            </span>
                          )}
                        </div>
                        <div style={{ marginTop: 16 }}>
                          <CompletionRing pct={completion.pct} done={completion.done} total={completion.total} />
                        </div>
                      </div>
                    </div>

                    {/* phải: điểm trình */}
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                      <RatingCard label="Điểm đôi" value={user?.localRatings?.doubles ?? user?.ratingDouble} reliability={user?.localRatings?.reliabilityDoubles} delay=".18s" />
                      <RatingCard label="Điểm đơn" value={user?.localRatings?.singles ?? user?.ratingSingle} reliability={user?.localRatings?.reliabilitySingles} delay=".24s" />
                    </div>
                  </div>
                )}
              </Container>
            </div>

            {/* ================= BODY ================= */}
            <Container>
              <div className="pk-2col" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.55fr) minmax(300px,1fr)", gap: 20, margin: "26px 0 80px", alignItems: "start" }}>
                {/* -------- cột trái -------- */}
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <Panel icon={<User size={16} />} title="Thông tin cá nhân">
                    <div className="pk-3col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      <Field label="Họ và tên">
                        <input className="pk-input" value={f.name} onChange={setField("name")} placeholder="Nguyễn Văn A" />
                        {errors.name && <div style={{ marginTop: 5, fontSize: 12, color: "#FF8A8E" }}>{errors.name}</div>}
                      </Field>
                      <Field label="Nickname">
                        <input className="pk-input" value={f.nickname} onChange={setField("nickname")} placeholder="Tên hiển thị trên BXH" />
                      </Field>
                      <Field label="Email" hint="Dùng để đăng nhập và nhận thông báo">
                        <input className="pk-input" type="email" value={f.email} onChange={setField("email")} placeholder="ban@email.com" />
                        {errors.email && <div style={{ marginTop: 5, fontSize: 12, color: "#FF8A8E" }}>{errors.email}</div>}
                      </Field>
                      <Field label="Số điện thoại">
                        <input className="pk-input" value={f.phone} onChange={setField("phone")} placeholder="09xxxxxxxx" inputMode="numeric" />
                        {errors.phone && <div style={{ marginTop: 5, fontSize: 12, color: "#FF8A8E" }}>{errors.phone}</div>}
                      </Field>
                      <Field label="Ngày sinh">
                        <input className="pk-input" type="date" value={f.dob} onChange={setField("dob")} />
                      </Field>
                      <Field label="Giới tính">
                        <div style={{ position: "relative" }}>
                          <select className="pk-input" value={f.gender} onChange={setField("gender")}>
                            <option value="">— Chọn —</option>
                            <option value="male">Nam</option>
                            <option value="female">Nữ</option>
                            <option value="other">Khác</option>
                          </select>
                          <ChevronDown size={15} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#8F959C" }} />
                        </div>
                      </Field>
                      <Field label="Tỉnh / Thành phố">
                        <div style={{ position: "relative" }}>
                          <select className="pk-input" value={f.province} onChange={setField("province")}>
                            <option value="">— Chọn —</option>
                            {PROVINCES.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                          <ChevronDown size={15} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#8F959C" }} />
                        </div>
                      </Field>
                      <Field label="Số CCCD" hint={isVerified ? "Đã xác minh — không thể chỉnh sửa" : "12 chữ số trên thẻ căn cước"}>
                        <input className="pk-input" value={f.cccd} onChange={setField("cccd")} disabled={isVerified} placeholder="0855xxxxxxxx" inputMode="numeric" />
                        {errors.cccd && <div style={{ marginTop: 5, fontSize: 12, color: "#FF8A8E" }}>{errors.cccd}</div>}
                      </Field>
                    </div>
                  </Panel>

                  {/* đổi mật khẩu */}
                  <Panel icon={<KeyRound size={16} />} title="Bảo mật" style={{ paddingBottom: passwordOpen ? 22 : 16 }}>
                    <button
                      type="button"
                      onClick={() => setPasswordOpen((v) => !v)}
                      style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", color: "#C9CDD2", fontSize: 14 }}
                    >
                      <span>Đổi mật khẩu đăng nhập</span>
                      <ChevronDown size={16} style={{ transform: passwordOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                    </button>
                    {passwordOpen && (
                      <div className="pk-fade pk-3col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
                        <Field label="Mật khẩu mới">
                          <div style={{ position: "relative" }}>
                            <input className="pk-input" type={showPw ? "text" : "password"} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} placeholder="Tối thiểu 6 ký tự" style={{ paddingRight: 40 }} />
                            <button type="button" onClick={() => setShowPw((v) => !v)} aria-label="Hiện mật khẩu" style={{ all: "unset", position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "#8F959C", display: "grid" }}>
                              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </div>
                          {errors.password && <div style={{ marginTop: 5, fontSize: 12, color: "#FF8A8E" }}>{errors.password}</div>}
                        </Field>
                        <Field label="Nhập lại mật khẩu">
                          <input className="pk-input" type={showPw ? "text" : "password"} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} placeholder="Nhập lại để xác nhận" />
                          {errors.confirm && <div style={{ marginTop: 5, fontSize: 12, color: "#FF8A8E" }}>{errors.confirm}</div>}
                        </Field>
                      </div>
                    )}
                  </Panel>
                </div>

                {/* -------- cột phải -------- */}
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {/* KYC */}
                  <Panel icon={<ShieldCheck size={16} />} title="Xác minh danh tính">
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <Badge variant={kyc.variant} label={kyc.label} />
                      {user?.cccd && <span style={{ color: "#C9CDD2", fontSize: 14, fontWeight: 650, letterSpacing: ".04em" }}>{maskCccd(user.cccd)}</span>}
                    </div>

                    {(user?.cccdImages?.front || user?.cccdImages?.back) && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
                        {["front", "back"].map((side) =>
                          user?.cccdImages?.[side] ? (
                            <div key={side} onClick={() => setZoomSrc(imgSrc(user.cccdImages[side]))} style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,.1)", cursor: "zoom-in", position: "relative" }}>
                              <img src={imgSrc(user.cccdImages[side])} alt={side === "front" ? "CCCD mặt trước" : "CCCD mặt sau"} style={{ display: "block", width: "100%", height: 86, objectFit: "cover" }} />
                              <span style={{ position: "absolute", bottom: 6, left: 6, padding: "2px 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: "rgba(8,9,11,.72)", color: "#DFE2E5" }}>
                                {side === "front" ? "Mặt trước" : "Mặt sau"}
                              </span>
                            </div>
                          ) : null,
                        )}
                      </div>
                    )}

                    {!isVerified && user?.cccdStatus !== "pending" && (
                      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                        {[["front", "Ảnh mặt trước", kycFront, setKycFront], ["back", "Ảnh mặt sau", kycBack, setKycBack]].map(([key, label, val, set]) => (
                          <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: 12, border: "1px dashed rgba(255,255,255,.18)", padding: "10px 12px", cursor: "pointer", color: val ? "#7CC7A2" : "#9AA0A6", fontSize: 13 }}>
                            <IdCard size={15} />
                            {val ? `${label}: ${val.name.slice(0, 22)}` : `Chọn ${label.toLowerCase()}`}
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => set(e.target.files?.[0] || null)} />
                          </label>
                        ))}
                        <WhitePill label={kycUploading ? "Đang gửi…" : "Gửi xác minh"} onClick={onKycSubmit} />
                      </div>
                    )}
                    {user?.cccdStatus === "pending" && (
                      <div style={{ marginTop: 12, color: "#9CC1FF", fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                        <CircleAlert size={14} />
                        Ảnh đã gửi, ban quản trị đang duyệt.
                      </div>
                    )}
                  </Panel>

                  {/* hoàn thiện hồ sơ */}
                  <Panel icon={<Sparkles size={16} />} title="Hoàn thiện hồ sơ">
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                      <Text type="supporting" color="secondary">{completion.done}/{completion.total} mục</Text>
                      <Text type="supporting" weight="semibold">{completion.pct}%</Text>
                    </div>
                    <div style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${completion.pct}%`, borderRadius: 99, background: completion.pct >= 100 ? "linear-gradient(90deg,#2E9E5B,#3BA55D)" : "linear-gradient(90deg,#2694FE,#3D87FF)", transition: "width .6s" }} />
                    </div>
                    {completion.missing.length ? (
                      <div style={{ marginTop: 13, display: "flex", flexDirection: "column", gap: 7 }}>
                        {completion.missing.map((m) => (
                          <div key={m} style={{ display: "flex", alignItems: "center", gap: 8, color: "#9AA0A6", fontSize: 13 }}>
                            <span style={{ width: 16, height: 16, borderRadius: 999, border: "1.5px solid rgba(255,255,255,.22)", flexShrink: 0 }} />
                            Còn thiếu: {m}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ marginTop: 13, display: "flex", alignItems: "center", gap: 8, color: "#7CC7A2", fontSize: 13.5, fontWeight: 650 }}>
                        <Check size={15} />
                        Hồ sơ đã hoàn hảo!
                      </div>
                    )}
                  </Panel>

                  {/* tài khoản */}
                  <Panel icon={<LogOut size={16} />} title="Tài khoản">
                    <div style={{ color: "#8F959C", fontSize: 13, marginBottom: 13 }}>
                      Đăng nhập với email <span style={{ color: "#C9CDD2" }}>{user?.email}</span>
                    </div>
                    <button
                      type="button"
                      onClick={onLogout}
                      disabled={loggingOut}
                      style={{ all: "unset", boxSizing: "border-box", width: "100%", textAlign: "center", padding: "11px 0", borderRadius: 999, cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#FF8A8E", background: "rgba(229,72,77,.1)", border: "1px solid rgba(242,85,90,.32)" }}
                    >
                      {loggingOut ? "Đang đăng xuất…" : "Đăng xuất"}
                    </button>
                  </Panel>
                </div>
              </div>
            </Container>

            <SiteFooter />

            {/* ============ thanh lưu nổi khi có thay đổi ============ */}
            {isDirty && (
              <div className="pk-savebar" style={{ position: "fixed", left: "50%", bottom: 22, zIndex: 50, display: "flex", alignItems: "center", gap: 14, padding: "12px 14px 12px 20px", borderRadius: 999, background: "rgba(18,19,22,.92)", border: "1px solid rgba(255,255,255,.14)", backdropFilter: "blur(14px)", boxShadow: "0 24px 60px -18px rgba(0,0,0,.7)" }}>
                <span style={{ color: "#C9CDD2", fontSize: 13.5, whiteSpace: "nowrap" }}>Bạn có thay đổi chưa lưu</span>
                <GrayPill label="Hoàn tác" onClick={onReset} />
                <WhitePill label={saving ? "Đang lưu…" : "Lưu thay đổi"} onClick={onSave} disabled={!canSave} />
              </div>
            )}

            {/* toast */}
            {toast && (
              <div className="pk-fade" style={{ position: "fixed", top: 76, right: 22, zIndex: 60, display: "flex", alignItems: "center", gap: 9, padding: "11px 16px", borderRadius: 13, background: "rgba(18,19,22,.94)", border: `1px solid ${toast.type === "success" ? "rgba(59,165,93,.45)" : "rgba(242,85,90,.45)"}`, color: toast.type === "success" ? "#7CC7A2" : "#FF8A8E", fontSize: 13.5, fontWeight: 650, backdropFilter: "blur(10px)" }}>
                {toast.type === "success" ? <Check size={15} /> : <CircleAlert size={15} />}
                {toast.msg}
              </div>
            )}

            {zoomSrc && <Lightbox src={zoomSrc} onClose={() => setZoomSrc("")} />}
          </div>
        </Theme>
      </ShadowFrame>
    </>
  );
}
