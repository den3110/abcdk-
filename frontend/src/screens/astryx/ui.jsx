/**
 * ui.jsx — primitive DÙNG CHUNG cho mọi trang giao diện mới (Astryx).
 * Tách từ HomeScreenAstryx để SiteNav + các trang refactor sau cùng xài một bộ.
 * Các class pk-* định nghĩa trong ShadowFrame (EXTRA_CSS) — chỉ dùng trong ShadowFrame.
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";

/* Link SPA — dùng thay <a href> để không reload cả trang */
export const A = ({ href, children, ...rest }) => (
  <Link to={href || "/"} {...rest}>
    {children}
  </Link>
);

/* pill "primary" kiểu "Get started" của Astryx: dark = nền trắng chữ đen,
   light = ĐẢO thành nền tối chữ trắng — 2 bộ giá trị khai báo trong ShadowFrame
   (--pk-pill-*, --pk-pill2-*), dark giữ nguyên giá trị cũ.
   Có href -> <Link>; KHÔNG href -> <button> (kèm disabled) để dùng làm action. */
const pillStyle = (size, kind, disabled) => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: size === "lg" ? 48 : 38,
  padding: size === "lg" ? "0 26px" : "0 18px",
  borderRadius: 999,
  background: kind === "white" ? "var(--pk-pill-bg, #F2F3F5)" : "var(--pk-pill2-bg, #2A2B2F)",
  color: kind === "white" ? "var(--pk-pill-fg, #101114)" : "var(--pk-pill2-fg, #E6E8EA)",
  border: kind === "white" ? "none" : "1px solid var(--pk-pill2-border, rgba(255,255,255,0.07))",
  fontWeight: 600,
  fontSize: size === "lg" ? 15.5 : 14,
  fontFamily: "inherit",
  textDecoration: "none",
  whiteSpace: "nowrap",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.45 : 1,
});

const Pill = ({ label, href, size = "md", onClick, disabled = false, kind }) => {
  const style = pillStyle(size, kind, disabled);
  if (!href) {
    return (
      <button type="button" className="pk-pill" onClick={onClick} disabled={disabled} style={style}>
        {label}
      </button>
    );
  }
  return (
    <A href={href} onClick={onClick} className="pk-pill" style={style}>
      {label}
    </A>
  );
};

export const WhitePill = (props) => <Pill {...props} kind="white" />;
export const GrayPill = (props) => <Pill {...props} kind="gray" />;

/* Đường dẫn ảnh: data prod trả URL tuyệt đối hoặc /uploads tương đối — đều hiển thị được */
export const imgSrc = (u) => {
  const s = String(u || "").trim();
  if (!s) return undefined;
  return s;
};

/* Lightbox DÙNG CHUNG: bấm ảnh -> phóng to; Esc / bấm nền / nút X để đóng.
   Scrim + nút X giữ TỐI cố định ở cả 2 theme (chuẩn lightbox ảnh — như YouTube/Photos):
   màu ở đây là lớp phủ trên ảnh, không phụ thuộc theme. */
export function Lightbox({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      className="pk-fade"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(8,9,11,.84)",
        backdropFilter: "blur(10px)",
        display: "grid",
        placeItems: "center",
        padding: 28,
        cursor: "zoom-out",
      }}
    >
      <img
        src={src}
        alt="Ảnh phóng to"
        className="pk-zoomin"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "min(1080px, 94vw)",
          maxHeight: "88vh",
          borderRadius: 14,
          objectFit: "contain",
          boxShadow: "0 48px 130px -32px rgba(0,0,0,.85)",
          cursor: "default",
        }}
      />
      <button
        type="button"
        aria-label="Đóng"
        onClick={onClose}
        style={{
          all: "unset",
          position: "fixed",
          top: 18,
          right: 20,
          width: 40,
          height: 40,
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          background: "rgba(255,255,255,.10)",
          border: "1px solid rgba(255,255,255,.16)",
          color: "#E6E8EA",
        }}
      >
        <X size={20} />
      </button>
    </div>
  );
}
