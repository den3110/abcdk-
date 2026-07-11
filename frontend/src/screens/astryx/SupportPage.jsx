/**
 * SupportPage — TRUNG TÂM HỖ TRỢ phong cách Astryx (/support và /support/:id).
 * Giữ đủ tính năng trang cũ (SupportCenter.jsx):
 *  - Danh sách yêu cầu của tôi: tìm kiếm, lọc loại/mức ưu tiên, lọc trạng thái bằng
 *    dãy thẻ thống kê (tất cả / chưa đọc / đang mở / đã phản hồi / đã đóng), badge
 *    "Mới" khi support trả lời mà mình chưa đọc, tự chọn yêu cầu đầu tiên khi vào /support.
 *  - Hội thoại: bong bóng support (trái) / bạn (phải), ảnh đính kèm bấm phóng to
 *    (Lightbox), người phụ trách, lý do đóng; gửi phản hồi kèm tối đa 5 ảnh
 *    (yêu cầu đã đóng -> gửi phản hồi để mở lại).
 *  - Tạo yêu cầu (modal): tiêu đề, loại, mức ưu tiên, nội dung, email/SĐT liên hệ,
 *    đính kèm tối đa 5 ảnh — bắt buộc có nội dung hoặc ảnh (như cũ).
 *  - Đánh giá 1–5 sao + góp ý khi yêu cầu đã đóng (đồng bộ điểm đã chấm trước đó).
 * Ảnh upload qua /api/upload/support (webp 1280, q82) đúng như trang cũ.
 * Route nằm trong PrivateRoute nên luôn có phiên đăng nhập.
 * ?ui=v1 tại route này ra trang cũ (gate ở SupportGate.jsx).
 */
import "@fontsource-variable/figtree";

import { useEffect, useMemo, useRef, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";
import { useNavigate, useParams } from "react-router-dom";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Text } from "@astryxdesign/core/Text";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Clock,
  Headset,
  ImagePlus,
  LifeBuoy,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Star,
  X,
} from "lucide-react";

import SEOHead from "../../components/SEOHead.jsx";
import ShadowFrame from "./ShadowFrame.jsx";
import SiteNav from "./SiteNav.jsx";
import SiteFooter from "./SiteFooter.jsx";
import PickleMark from "./PickleMark.jsx";
import { WhitePill, GrayPill, Lightbox, imgSrc } from "./ui.jsx";
import {
  useCreateSupportTicketMutation,
  useGetMySupportTicketQuery,
  useListMySupportTicketsQuery,
  useRateMySupportTicketMutation,
  useReplyMySupportTicketMutation,
} from "../../slices/supportApiSlice.js";
import { useUploadImageToFolderMutation } from "../../slices/uploadApiSlice.js";

/* ------------------------- token màu (theme-ready) ------------------------- */
/* Không hardcode hex trần cho chữ/nền/viền tuỳ chỉnh — dùng var + fallback dark. */
const T_STRONG = "var(--pk-text-strong, #F0F1F3)";
const T_TEXT = "var(--pk-text, #C9CDD2)";
const T_MUTE = "var(--pk-text-mute, #8F959C)";
const T_FAINT = "var(--pk-text-faint, #6E747B)";
const SURFACE_2 = "var(--pk-surface-2, rgba(255,255,255,.05))";
const BORDER_2 = "var(--pk-border-2, rgba(255,255,255,.12))";
const CHIP_BG = "var(--pk-chip-bg, rgba(255,255,255,.06))";

/* ------------------------------ meta dữ liệu ------------------------------ */
/* Trạng thái/ưu tiên giữ nguyên value backend; màu trạng thái được phép hex. */
const STATUS_META = {
  open: { label: "Đang mở", color: "#F0C24B", text: "#F0C24B", bg: "rgba(240,194,75,.12)", border: "rgba(240,194,75,.32)" },
  pending: { label: "Đã phản hồi", color: "#3D87FF", text: "#7FB3FF", bg: "rgba(61,135,255,.12)", border: "rgba(61,135,255,.32)" },
  closed: { label: "Đã đóng", color: "#3BA55D", text: "#7CC7A2", bg: "rgba(59,165,93,.13)", border: "rgba(59,165,93,.34)" },
};

const CATEGORY_OPTIONS = [
  { value: "account", label: "Tài khoản" },
  { value: "tournament", label: "Giải đấu" },
  { value: "payment", label: "Thanh toán" },
  { value: "technical", label: "Kỹ thuật" },
  { value: "report", label: "Báo lỗi" },
  { value: "other", label: "Khác" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "Thấp", text: T_MUTE, bg: CHIP_BG, border: BORDER_2 },
  { value: "normal", label: "Bình thường", text: "#7FB3FF", bg: "rgba(61,135,255,.10)", border: "rgba(61,135,255,.26)" },
  { value: "high", label: "Cao", text: "#F0C24B", bg: "rgba(240,194,75,.10)", border: "rgba(240,194,75,.28)" },
  { value: "urgent", label: "Khẩn cấp", text: "#FF8A8E", bg: "rgba(242,85,90,.12)", border: "rgba(242,85,90,.32)" },
];

const getStatusMeta = (status) => STATUS_META[status] || STATUS_META.open;
const priorityMeta = (value) =>
  PRIORITY_OPTIONS.find((item) => item.value === value) || PRIORITY_OPTIONS[1];
const optionLabel = (options, value, fallback = "Khác") =>
  options.find((item) => item.value === value)?.label || fallback;

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/* "Chưa đọc" = support nhắn sau lần mình mở case gần nhất (logic y trang cũ) */
function isUnreadForUser(ticket) {
  if (!ticket?.lastMessageAt) return false;
  if (!ticket?.userLastReadAt) return true;
  return (
    new Date(ticket.lastMessageAt).getTime() >
    new Date(ticket.userLastReadAt).getTime()
  );
}

function attachmentPayload(uploadResult, file) {
  const body = uploadResult || {};
  return {
    url: body.url,
    mime: body.mime || file.type || "image/jpeg",
    name: body.filename || file.name || "attachment",
    size: body.size || file.size || 0,
  };
}

/* matchMedia hook nhỏ — quyết định sticky/cuộn nội bộ trên desktop */
function useMedia(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/* ------------------------------- tiểu phần ------------------------------- */
const Container = ({ children, style }) => (
  <div style={{ maxWidth: 1220, margin: "0 auto", padding: "0 24px", ...style }}>
    {children}
  </div>
);

function Field({ label, children, hint }) {
  return (
    <label style={{ display: "block", minWidth: 0 }}>
      <div style={{ fontSize: 11.5, fontWeight: 750, letterSpacing: ".07em", textTransform: "uppercase", color: T_MUTE, marginBottom: 7 }}>
        {label}
      </div>
      {children}
      {hint && <div style={{ marginTop: 5, fontSize: 12, color: T_FAINT }}>{hint}</div>}
    </label>
  );
}

/* select có mũi tên riêng (không dùng được MUI trong shadow) */
function SelectBox({ value, onChange, children, disabled }) {
  return (
    <div style={{ position: "relative" }}>
      <select className="pk-input" value={value} onChange={onChange} disabled={disabled}>
        {children}
      </select>
      <ChevronDown size={15} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: T_MUTE }} />
    </div>
  );
}

/* pill trạng thái / ưu tiên: chấm màu + nhãn */
function TonePill({ tone, small = false, dot = true }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: small ? "2px 9px" : "3.5px 11px",
        borderRadius: 999,
        fontSize: small ? 11 : 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
        color: tone.text,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor", flexShrink: 0 }} />}
      {tone.label}
    </span>
  );
}

/* chip xám trung tính (loại vấn đề, meta phụ) */
function NeutralChip({ children }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3.5px 11px", borderRadius: 999, fontSize: 12, fontWeight: 650, whiteSpace: "nowrap", color: T_TEXT, background: CHIP_BG, border: `1px solid ${BORDER_2}` }}>
      {children}
    </span>
  );
}

/* thẻ thống kê đầu trang — bấm để lọc nhanh */
function StatTile({ label, value, dot, active, onClick, delay }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pk-pill pk-rise"
      style={{
        all: "unset",
        boxSizing: "border-box",
        cursor: "pointer",
        borderRadius: 16,
        padding: "13px 16px",
        minWidth: 0,
        border: `1px solid ${active ? "rgba(61,135,255,.55)" : "var(--color-border)"}`,
        background: active ? "rgba(61,135,255,.10)" : "var(--color-background-surface)",
        animationDelay: delay,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 750, letterSpacing: ".07em", textTransform: "uppercase", color: T_MUTE }}>
        {dot && <span style={{ width: 7, height: 7, borderRadius: 999, background: dot, flexShrink: 0 }} />}
        {label}
      </span>
      <span style={{ display: "block", marginTop: 7, fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1, color: T_STRONG, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </button>
  );
}

/* card 1 yêu cầu trong danh sách trái */
function TicketCard({ ticket, active, onClick }) {
  const meta = getStatusMeta(ticket?.status);
  const prio = priorityMeta(ticket?.priority);
  const unread = isUnreadForUser(ticket);

  return (
    <button
      type="button"
      onClick={onClick}
      className="pk-tcard"
      style={{
        all: "unset",
        boxSizing: "border-box",
        display: "block",
        width: "100%",
        cursor: "pointer",
        borderRadius: 14,
        padding: "13px 14px",
        border: `1px solid ${active ? "rgba(61,135,255,.55)" : BORDER_2}`,
        background: active ? "rgba(61,135,255,.09)" : SURFACE_2,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: meta.color, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14.5, fontWeight: unread ? 800 : 700, color: T_STRONG }}>
          {ticket?.title || "Hỗ trợ"}
        </span>
        {unread && (
          <span style={{ flexShrink: 0, padding: "1.5px 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em", color: "#FF8A8E", background: "rgba(242,85,90,.14)", border: "1px solid rgba(242,85,90,.36)" }}>
            MỚI
          </span>
        )}
      </span>
      <span
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          marginTop: 6,
          fontSize: 13,
          lineHeight: 1.5,
          color: unread ? T_TEXT : T_MUTE,
          minHeight: 39,
        }}
      >
        {ticket?.lastMessagePreview || "Chưa có nội dung"}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <TonePill tone={meta} small />
        <TonePill tone={prio} small dot={false} />
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: T_FAINT, whiteSpace: "nowrap" }}>
          {formatDate(ticket?.lastMessageAt || ticket?.updatedAt)}
        </span>
      </span>
    </button>
  );
}

/* chip file đã chọn (trước khi upload) */
function FileChips({ files, onRemove, disabled }) {
  if (!files.length) return null;
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      {files.map((file) => (
        <span
          key={`${file.name}-${file.size}-${file.lastModified}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 240, padding: "4px 8px 4px 11px", borderRadius: 999, fontSize: 12, fontWeight: 600, color: T_TEXT, background: CHIP_BG, border: `1px solid ${BORDER_2}` }}
        >
          <Paperclip size={11.5} style={{ flexShrink: 0, opacity: 0.75 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
          <button
            type="button"
            aria-label={`Bỏ ${file.name}`}
            onClick={() => onRemove(file)}
            disabled={disabled}
            style={{ all: "unset", display: "grid", placeItems: "center", width: 16, height: 16, borderRadius: 999, cursor: disabled ? "not-allowed" : "pointer", color: T_MUTE, flexShrink: 0 }}
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

/* nút "chọn ảnh" dạng pill xám có input file ẩn */
function AttachButton({ onPick, disabled, label = "Ảnh" }) {
  return (
    <label
      className="pk-pill"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        height: 38,
        padding: "0 16px",
        borderRadius: 999,
        fontSize: 14,
        fontWeight: 600,
        whiteSpace: "nowrap",
        color: T_TEXT,
        background: CHIP_BG,
        border: `1px solid ${BORDER_2}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <ImagePlus size={15} />
      {label}
      <input hidden type="file" accept="image/*" multiple disabled={disabled} onChange={onPick} />
    </label>
  );
}

/* đính kèm trong bong bóng chat: ảnh -> thumbnail bấm phóng to, khác -> link */
function AttachmentRow({ attachments = [], onZoom }) {
  if (!Array.isArray(attachments) || !attachments.length) return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      {attachments.map((attachment, index) => {
        const isImage = String(attachment?.mime || "").startsWith("image/");
        const url = imgSrc(attachment?.url);
        if (!url) return null;
        if (isImage) {
          return (
            <img
              key={`${attachment.url}-${index}`}
              src={url}
              alt={attachment?.name || `Ảnh ${index + 1}`}
              loading="lazy"
              onClick={() => onZoom(url)}
              style={{ width: 96, height: 72, objectFit: "cover", borderRadius: 10, cursor: "zoom-in", border: `1px solid ${BORDER_2}`, display: "block" }}
            />
          );
        }
        return (
          <a
            key={`${attachment.url}-${index}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, fontSize: 12, fontWeight: 650, textDecoration: "none", color: "var(--color-text-accent, #3E9EFB)", background: CHIP_BG, border: `1px solid ${BORDER_2}` }}
          >
            <Paperclip size={11.5} />
            {attachment?.name || `Tệp ${index + 1}`}
          </a>
        );
      })}
    </div>
  );
}

/* bong bóng hội thoại: support bên trái (xanh dương), mình bên phải (xanh lục) */
function MessageBubble({ message, onZoom }) {
  const fromStaff = message?.senderRole === "staff";
  const senderName =
    message?.senderUser?.nickname ||
    message?.senderUser?.name ||
    (fromStaff ? "Support" : "Bạn");

  return (
    <div className="pk-fade" style={{ display: "flex", flexDirection: "column", alignItems: fromStaff ? "flex-start" : "flex-end", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: "min(680px, 92%)", marginBottom: 4 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: fromStaff ? "#7FB3FF" : "#7CC7A2", display: "inline-flex", alignItems: "center", gap: 5 }}>
          {fromStaff && <Headset size={11.5} />}
          {fromStaff ? `Support — ${senderName}` : senderName}
        </span>
        <span style={{ fontSize: 11, color: T_FAINT }}>{formatDate(message?.createdAt)}</span>
      </div>
      <div
        style={{
          maxWidth: "min(680px, 92%)",
          padding: "10px 14px",
          borderRadius: fromStaff ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
          background: fromStaff ? "rgba(61,135,255,.10)" : "rgba(59,165,93,.10)",
          border: `1px solid ${fromStaff ? "rgba(61,135,255,.24)" : "rgba(59,165,93,.24)"}`,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontSize: 14,
          lineHeight: 1.6,
          color: T_TEXT,
        }}
      >
        {message?.text || "[Đính kèm]"}
        <AttachmentRow attachments={message?.attachments} onZoom={onZoom} />
      </div>
    </div>
  );
}

/* chấm điểm 1–5 sao */
function Stars({ value, onChange, disabled }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: "inline-flex", gap: 3 }} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = (hover || value) >= i;
        return (
          <button
            key={i}
            type="button"
            aria-label={`${i} sao`}
            disabled={disabled}
            onClick={() => onChange(i)}
            onMouseEnter={() => !disabled && setHover(i)}
            style={{ all: "unset", padding: 2, display: "grid", cursor: disabled ? "default" : "pointer" }}
          >
            <Star size={21} fill={filled ? "#F0C24B" : "none"} color={filled ? "#F0C24B" : T_FAINT} strokeWidth={1.8} />
          </button>
        );
      })}
    </div>
  );
}

/* empty state có PickleMark */
function EmptyState({ title, desc, action, compact = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 10, padding: compact ? "36px 18px" : "64px 24px", minHeight: compact ? 0 : 300 }}>
      <span className="pk-drift" style={{ color: T_FAINT, opacity: 0.75 }}>
        <PickleMark size={compact ? 40 : 56} color="currentColor" />
      </span>
      <div style={{ color: T_STRONG, fontWeight: 750, fontSize: compact ? 14.5 : 17 }}>{title}</div>
      {desc && <div style={{ color: T_MUTE, fontSize: 13.5, lineHeight: 1.55, maxWidth: 380 }}>{desc}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

/* hộp cảnh báo lỗi + nút thử lại */
function ErrorBox({ message, onRetry }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center", padding: "30px 18px", borderRadius: 14, border: "1px solid rgba(242,85,90,.32)", background: "rgba(242,85,90,.08)" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#FF8A8E", fontSize: 13.5, fontWeight: 650 }}>
        <CircleAlert size={15} />
        {message}
      </span>
      {onRetry && <GrayPill label="Thử lại" onClick={onRetry} />}
    </div>
  );
}

/* ================================= PAGE ================================= */
export default function SupportPage() {
  const navigate = useNavigate();
  const { id: routeTicketId } = useParams();
  const isDesktop = useMedia("(min-width: 900px)");

  /* ---- bộ lọc danh sách ---- */
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  /* ---- modal tạo yêu cầu ---- */
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("other");
  const [newPriority, setNewPriority] = useState("normal");
  const [newText, setNewText] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newFiles, setNewFiles] = useState([]);

  /* ---- phản hồi + đánh giá ---- */
  const [replyText, setReplyText] = useState("");
  const [replyFiles, setReplyFiles] = useState([]);
  const [ratingScore, setRatingScore] = useState(0);
  const [ratingComment, setRatingComment] = useState("");

  const [toast, setToast] = useState(null); // {type, msg}
  const [zoomSrc, setZoomSrc] = useState("");
  const messagesRef = useRef(null);

  const {
    data: ticketsData,
    isLoading: ticketsLoading,
    isFetching: ticketsFetching,
    isError: ticketsError,
    refetch: refetchTickets,
  } = useListMySupportTicketsQuery();

  const tickets = useMemo(
    () => (Array.isArray(ticketsData) ? ticketsData : []),
    [ticketsData],
  );

  const selectedId = routeTicketId || "";
  const {
    data: detail,
    isFetching: detailFetching,
    isError: detailError,
    refetch: refetchDetail,
  } = useGetMySupportTicketQuery(selectedId || skipToken);

  const [createTicket, { isLoading: creating }] = useCreateSupportTicketMutation();
  const [replyTicket, { isLoading: replying }] = useReplyMySupportTicketMutation();
  const [rateTicket, { isLoading: rating }] = useRateMySupportTicketMutation();
  const [uploadImage, { isLoading: uploading }] = useUploadImageToFolderMutation();

  /* vào /support (không id) -> tự mở yêu cầu đầu tiên (y trang cũ) */
  useEffect(() => {
    if (routeTicketId || ticketsLoading || !tickets.length) return;
    navigate(`/support/${tickets[0]._id}`, { replace: true });
  }, [navigate, routeTicketId, tickets, ticketsLoading]);

  /* đồng bộ đánh giá đã chấm của case đang xem */
  useEffect(() => {
    const ticket = detail?.ticket;
    setRatingScore(ticket?.ratingScore || 0);
    setRatingComment(ticket?.ratingComment || "");
  }, [detail?.ticket]);

  const selectedTicket = detail?.ticket || null;
  const messages = useMemo(
    () => (Array.isArray(detail?.messages) ? detail.messages : []),
    [detail?.messages],
  );

  /* tin mới nhất ở cuối -> cuộn xuống đáy khi đổi case / có tin mới */
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, selectedId]);

  /* modal tạo yêu cầu: khoá cuộn nền + Esc để đóng (không đóng khi đang gửi) */
  useEffect(() => {
    if (!newOpen) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event) => {
      if (event.key === "Escape") closeNewModal();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeNewModal đọc busy mới nhất nhờ re-subscribe theo busy
  }, [newOpen, busy]);

  const filteredTickets = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (statusFilter && ticket.status !== statusFilter) return false;
      if (categoryFilter && ticket.category !== categoryFilter) return false;
      if (priorityFilter && ticket.priority !== priorityFilter) return false;
      if (unreadOnly && !isUnreadForUser(ticket)) return false;
      if (!q) return true;
      const haystack = [
        ticket.title,
        ticket.lastMessagePreview,
        ticket.status,
        ticket.category,
        ticket.priority,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [categoryFilter, keyword, priorityFilter, statusFilter, tickets, unreadOnly]);

  const stats = useMemo(
    () =>
      tickets.reduce(
        (acc, ticket) => {
          acc.total += 1;
          if (ticket.status === "open") acc.open += 1;
          if (ticket.status === "pending") acc.pending += 1;
          if (ticket.status === "closed") acc.closed += 1;
          if (isUnreadForUser(ticket)) acc.unread += 1;
          return acc;
        },
        { total: 0, open: 0, pending: 0, closed: 0, unread: 0 },
      ),
    [tickets],
  );

  const selectedStatus = getStatusMeta(selectedTicket?.status);
  const selectedPriority = priorityMeta(selectedTicket?.priority);
  const busy = creating || replying || uploading;
  const hasActiveFilter =
    !!keyword.trim() || !!statusFilter || !!categoryFilter || !!priorityFilter || unreadOnly;

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3200);
  };

  /* ---- files: chọn tối đa 5 ảnh, upload từng cái vào folder support ---- */
  const uploadFiles = async (files) => {
    const attachments = [];
    for (const file of files) {
      const result = await uploadImage({
        folder: "support",
        file,
        options: { format: "webp", width: 1280, height: 1280, quality: 82 },
      }).unwrap();
      attachments.push(attachmentPayload(result, file));
    }
    return attachments;
  };

  const onPickFiles = (event, setter) => {
    const files = Array.from(event.target.files || []).slice(0, 5);
    setter((current) => [...current, ...files].slice(0, 5));
    event.target.value = "";
  };

  const removeFile = (file, setter) => {
    setter((current) => current.filter((item) => item !== file));
  };

  /* ---- tạo yêu cầu ---- */
  const closeNewModal = (force = false) => {
    if (busy && !force) return;
    setNewOpen(false);
    setNewTitle("");
    setNewCategory("other");
    setNewPriority("normal");
    setNewText("");
    setNewContactEmail("");
    setNewContactPhone("");
    setNewFiles([]);
  };

  const handleCreateTicket = async () => {
    const text = newText.trim();
    if (!text && !newFiles.length) {
      showToast("error", "Vui lòng nhập nội dung hoặc đính kèm ảnh.");
      return;
    }
    try {
      const attachments = await uploadFiles(newFiles);
      const ticket = await createTicket({
        title: newTitle.trim() || "Hỗ trợ",
        text,
        attachments,
        category: newCategory,
        priority: newPriority,
        contactEmail: newContactEmail,
        contactPhone: newContactPhone,
        source: "web",
      }).unwrap();
      closeNewModal(true);
      showToast("success", "Đã gửi yêu cầu hỗ trợ.");
      if (ticket?._id) navigate(`/support/${ticket._id}`);
    } catch (error) {
      showToast("error", error?.data?.message || "Không thể tạo yêu cầu hỗ trợ.");
    }
  };

  /* ---- gửi phản hồi ---- */
  const handleReply = async () => {
    const text = replyText.trim();
    if (!selectedId || (!text && !replyFiles.length)) return;
    try {
      const attachments = await uploadFiles(replyFiles);
      await replyTicket({ id: selectedId, text, attachments }).unwrap();
      setReplyText("");
      setReplyFiles([]);
      showToast("success", "Đã gửi phản hồi.");
    } catch (error) {
      showToast("error", error?.data?.message || "Không thể gửi phản hồi.");
    }
  };

  /* ---- đánh giá khi đã đóng ---- */
  const handleRateTicket = async () => {
    if (!selectedId || !ratingScore) return;
    try {
      await rateTicket({ id: selectedId, score: ratingScore, comment: ratingComment }).unwrap();
      showToast("success", "Đã lưu đánh giá.");
    } catch (error) {
      showToast("error", error?.data?.message || "Không thể lưu đánh giá.");
    }
  };

  const onRefresh = () => {
    refetchTickets();
    if (selectedId) refetchDetail();
  };

  const clearFilters = () => {
    setKeyword("");
    setStatusFilter("");
    setCategoryFilter("");
    setPriorityFilter("");
    setUnreadOnly(false);
  };

  /* thẻ thống kê: bấm để lọc trạng thái nhanh; "Chưa đọc" bật lọc riêng */
  const statTiles = [
    { key: "", label: "Tất cả", value: stats.total, dot: null, active: !statusFilter && !unreadOnly },
    { key: "unread", label: "Chưa đọc", value: stats.unread, dot: "#F2555A", active: unreadOnly },
    { key: "open", label: "Đang mở", value: stats.open, dot: "#F0C24B", active: statusFilter === "open" },
    { key: "pending", label: "Đã phản hồi", value: stats.pending, dot: "#3D87FF", active: statusFilter === "pending" },
    { key: "closed", label: "Đã đóng", value: stats.closed, dot: "#3BA55D", active: statusFilter === "closed" },
  ];
  const onStatTile = (key) => {
    if (key === "unread") {
      setUnreadOnly((v) => !v);
      return;
    }
    setUnreadOnly(false);
    setStatusFilter((current) => (current === key ? "" : key));
  };

  const panelBase = {
    borderRadius: 18,
    border: "1px solid var(--color-border)",
    background: "var(--color-background-surface)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
  };

  return (
    <>
      <SEOHead title="Trung tâm hỗ trợ — PickleTour" noIndex />
      <ShadowFrame style={{ minHeight: "100vh" }}>
        <Theme theme={neutralTheme}>
          <div style={{ minHeight: "100vh", background: "var(--color-background-body)" }}>
            <SiteNav />

            {/* ================= HERO ================= */}
            <div style={{ position: "relative", overflow: "hidden" }}>
              <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(46% 62% at 78% 0%, rgba(61,135,255,.11), transparent 62%)" }} />
              <div aria-hidden className="pk-spin-slow" style={{ position: "absolute", right: -130, top: -140, opacity: 0.05, color: "var(--color-brand, #3D87FF)", pointerEvents: "none" }}>
                <PickleMark size={420} />
              </div>
              <Container style={{ position: "relative", zIndex: 2 }}>
                <div className="pk-2col" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 22, alignItems: "end", padding: "58px 0 30px" }}>
                  <div style={{ minWidth: 0 }}>
                    <h1 className="pk-rise" style={{ margin: 0, fontWeight: 750, fontSize: "clamp(34px, 4.8vw, 60px)", lineHeight: 1.04, letterSpacing: "-0.026em", color: T_STRONG }}>
                      Trung tâm{" "}
                      <span style={{ color: "var(--color-brand, #3D87FF)" }}>hỗ trợ.</span>
                    </h1>
                    <div className="pk-rise" style={{ maxWidth: 560, marginTop: 14, animationDelay: ".12s" }}>
                      <Text type="large" color="secondary">
                        Gửi yêu cầu, theo dõi phản hồi của đội ngũ PickleTour và nhận thông báo ngay khi support trả lời.
                      </Text>
                    </div>
                  </div>
                  <div className="pk-rise" style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingBottom: 6, animationDelay: ".18s" }}>
                    <GrayPill
                      onClick={onRefresh}
                      disabled={ticketsFetching || detailFetching}
                      label={
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                          <RefreshCw size={14} className={ticketsFetching || detailFetching ? "pk-spinning" : undefined} />
                          Tải lại
                        </span>
                      }
                    />
                    <WhitePill
                      onClick={() => setNewOpen(true)}
                      label={
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                          <Plus size={15} />
                          Tạo yêu cầu
                        </span>
                      }
                    />
                  </div>
                </div>

                {/* thống kê nhanh — bấm để lọc */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, paddingBottom: 26 }}>
                  {statTiles.map((tile, index) => (
                    <StatTile
                      key={tile.label}
                      label={tile.label}
                      value={ticketsLoading ? "—" : tile.value}
                      dot={tile.dot}
                      active={tile.active}
                      onClick={() => onStatTile(tile.key)}
                      delay={`${0.2 + index * 0.05}s`}
                    />
                  ))}
                </div>
              </Container>
            </div>

            {/* ================= BODY: danh sách + hội thoại ================= */}
            <Container>
              <div className="pk-2col" style={{ display: "grid", gridTemplateColumns: "minmax(300px, 380px) minmax(0, 1fr)", gap: 18, alignItems: "start", margin: "4px 0 84px" }}>
                {/* -------- cột trái: danh sách yêu cầu -------- */}
                <section
                  className="pk-fade"
                  style={{
                    ...panelBase,
                    ...(isDesktop ? { position: "sticky", top: 80, maxHeight: "calc(100vh - 100px)" } : {}),
                  }}
                >
                  <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, borderBottom: `1px solid ${BORDER_2}` }}>
                    <div style={{ position: "relative" }}>
                      <Search size={15} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: T_MUTE, pointerEvents: "none" }} />
                      <input
                        className="pk-input"
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        placeholder="Tìm yêu cầu hỗ trợ…"
                        style={{ paddingLeft: 38, paddingRight: keyword ? 38 : 14 }}
                      />
                      {keyword && (
                        <button
                          type="button"
                          aria-label="Xoá từ khoá"
                          onClick={() => setKeyword("")}
                          style={{ all: "unset", position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", display: "grid", placeItems: "center", width: 20, height: 20, cursor: "pointer", color: T_MUTE }}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <SelectBox value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                        <option value="">Loại: tất cả</option>
                        {CATEGORY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </SelectBox>
                      <SelectBox value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
                        <option value="">Ưu tiên: tất cả</option>
                        {PRIORITY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </SelectBox>
                    </div>
                  </div>

                  <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0, overflowY: isDesktop ? "auto" : "visible" }}>
                    {ticketsLoading ? (
                      Array.from({ length: 4 }).map((_, index) => (
                        <Skeleton key={index} width="100%" height="112px" borderRadius="14px" />
                      ))
                    ) : ticketsError ? (
                      <ErrorBox message="Không thể tải danh sách yêu cầu." onRetry={refetchTickets} />
                    ) : filteredTickets.length ? (
                      filteredTickets.map((ticket) => (
                        <TicketCard
                          key={ticket._id}
                          ticket={ticket}
                          active={String(ticket._id) === String(selectedId)}
                          onClick={() => navigate(`/support/${ticket._id}`)}
                        />
                      ))
                    ) : tickets.length ? (
                      <EmptyState
                        compact
                        title="Không có yêu cầu khớp bộ lọc"
                        desc="Thử đổi từ khoá hoặc xoá bộ lọc hiện tại."
                        action={hasActiveFilter && <GrayPill label="Xoá bộ lọc" onClick={clearFilters} />}
                      />
                    ) : (
                      <EmptyState
                        compact
                        title="Chưa có yêu cầu hỗ trợ nào"
                        desc="Gặp vấn đề về tài khoản, giải đấu hay thanh toán? Gửi yêu cầu để đội ngũ hỗ trợ xử lý."
                        action={
                          <WhitePill
                            onClick={() => setNewOpen(true)}
                            label={
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                                <Plus size={15} />
                                Tạo yêu cầu đầu tiên
                              </span>
                            }
                          />
                        }
                      />
                    )}
                  </div>
                </section>

                {/* -------- cột phải: hội thoại -------- */}
                <section
                  className="pk-fade"
                  style={{
                    ...panelBase,
                    minHeight: 520,
                    ...(isDesktop ? { position: "sticky", top: 80, height: "calc(100vh - 100px)" } : {}),
                  }}
                >
                  {!selectedId ? (
                    ticketsLoading ? (
                      <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
                        <Skeleton width="min(360px, 70%)" height="26px" />
                        <Skeleton width="min(220px, 46%)" height="16px" />
                        <div style={{ height: 8 }} />
                        <Skeleton width="72%" height="64px" borderRadius="14px" />
                        <Skeleton width="58%" height="64px" borderRadius="14px" />
                      </div>
                    ) : (
                      <EmptyState
                        title="Chưa chọn yêu cầu hỗ trợ"
                        desc="Chọn một yêu cầu trong danh sách hoặc tạo yêu cầu mới để trao đổi với đội ngũ hỗ trợ."
                        action={
                          <WhitePill
                            onClick={() => setNewOpen(true)}
                            label={
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                                <Plus size={15} />
                                Tạo yêu cầu mới
                              </span>
                            }
                          />
                        }
                      />
                    )
                  ) : detailError ? (
                    <div style={{ padding: 20 }}>
                      <ErrorBox message="Không thể tải chi tiết yêu cầu." onRetry={refetchDetail} />
                    </div>
                  ) : (
                    <>
                      {/* ---- header case ---- */}
                      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER_2}` }}>
                        {selectedTicket ? (
                          <>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                              <h2 style={{ margin: 0, flex: 1, minWidth: 180, fontSize: 18, fontWeight: 800, letterSpacing: "-.01em", color: T_STRONG, overflowWrap: "anywhere" }}>
                                {selectedTicket.title || "Hỗ trợ"}
                              </h2>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <TonePill tone={selectedStatus} />
                                <NeutralChip>{optionLabel(CATEGORY_OPTIONS, selectedTicket.category)}</NeutralChip>
                                <TonePill tone={selectedPriority} dot={false} />
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 9, fontSize: 12.5, color: T_MUTE }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                <Clock size={12.5} />
                                Cập nhật {formatDate(selectedTicket.lastMessageAt || selectedTicket.updatedAt)}
                              </span>
                              {selectedTicket.assignedTo && (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                  <Headset size={12.5} />
                                  Phụ trách:{" "}
                                  <span style={{ color: T_TEXT, fontWeight: 650 }}>
                                    {selectedTicket.assignedTo.nickname ||
                                      selectedTicket.assignedTo.name ||
                                      selectedTicket.assignedTo.email}
                                  </span>
                                </span>
                              )}
                            </div>
                            {selectedTicket.closeReason && (
                              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, fontSize: 13, color: "#7CC7A2", background: "rgba(59,165,93,.10)", border: "1px solid rgba(59,165,93,.28)" }}>
                                <Check size={14} style={{ flexShrink: 0 }} />
                                Lý do đóng: {selectedTicket.closeReason}
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <Skeleton width="min(340px, 68%)" height="24px" />
                            <Skeleton width="min(200px, 44%)" height="14px" />
                          </div>
                        )}
                      </div>

                      {/* ---- luồng tin nhắn ---- */}
                      <div
                        ref={messagesRef}
                        style={{
                          flex: 1,
                          minHeight: isDesktop ? 0 : 260,
                          maxHeight: isDesktop ? undefined : 440,
                          overflowY: "auto",
                          padding: "18px 20px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 14,
                          background: SURFACE_2,
                        }}
                      >
                        {detailFetching && !messages.length ? (
                          Array.from({ length: 4 }).map((_, index) => (
                            <div key={index} style={{ alignSelf: index % 2 ? "flex-end" : "flex-start", width: index % 2 ? "58%" : "70%" }}>
                              <Skeleton width="100%" height="68px" borderRadius="14px" />
                            </div>
                          ))
                        ) : messages.length ? (
                          messages.map((message) => (
                            <MessageBubble key={message._id} message={message} onZoom={setZoomSrc} />
                          ))
                        ) : (
                          <EmptyState
                            compact
                            title="Chưa có phản hồi trong yêu cầu này"
                            desc="Đội ngũ hỗ trợ sẽ trả lời sớm nhất trong giờ hành chính."
                          />
                        )}
                      </div>

                      {/* ---- đánh giá khi đã đóng ---- */}
                      {selectedTicket?.status === "closed" && (
                        <div style={{ padding: "14px 20px", borderTop: `1px solid ${BORDER_2}` }}>
                          <div style={{ fontSize: 11.5, fontWeight: 750, letterSpacing: ".07em", textTransform: "uppercase", color: T_MUTE, marginBottom: 8 }}>
                            Đánh giá hỗ trợ
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                            <Stars value={ratingScore} onChange={setRatingScore} disabled={rating} />
                            <input
                              className="pk-input"
                              value={ratingComment}
                              onChange={(event) => setRatingComment(event.target.value)}
                              placeholder="Góp ý thêm cho support…"
                              style={{ flex: 1, minWidth: 180 }}
                            />
                            <GrayPill
                              label={rating ? "Đang lưu…" : "Lưu đánh giá"}
                              onClick={handleRateTicket}
                              disabled={!ratingScore || rating}
                            />
                          </div>
                        </div>
                      )}

                      {/* ---- ô soạn phản hồi ---- */}
                      <div style={{ padding: "14px 20px 16px", borderTop: `1px solid ${BORDER_2}`, display: "flex", flexDirection: "column", gap: 10 }}>
                        <FileChips files={replyFiles} onRemove={(file) => removeFile(file, setReplyFiles)} disabled={busy} />
                        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                          <textarea
                            className="pk-input"
                            rows={2}
                            value={replyText}
                            onChange={(event) => setReplyText(event.target.value)}
                            placeholder={
                              selectedTicket?.status === "closed"
                                ? "Gửi phản hồi để mở lại yêu cầu…"
                                : "Nhập phản hồi…"
                            }
                            disabled={!selectedTicket || busy}
                            style={{ flex: 1, minWidth: 200, resize: "none", minHeight: 48, maxHeight: 140, lineHeight: 1.5 }}
                          />
                          <div style={{ display: "flex", gap: 8 }}>
                            <AttachButton onPick={(event) => onPickFiles(event, setReplyFiles)} disabled={!selectedTicket || busy} />
                            <WhitePill
                              onClick={handleReply}
                              disabled={!selectedTicket || (!replyText.trim() && !replyFiles.length) || busy}
                              label={
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                                  <Send size={14} />
                                  {replying || uploading ? "Đang gửi…" : "Gửi"}
                                </span>
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </section>
              </div>
            </Container>

            <SiteFooter />

            {/* ============ modal tạo yêu cầu ============ */}
            {newOpen && (
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Tạo yêu cầu hỗ trợ"
                className="pk-fade"
                onClick={() => closeNewModal()}
                style={{ position: "fixed", inset: 0, zIndex: 65, background: "rgba(8,9,11,.7)", backdropFilter: "blur(8px)", display: "grid", placeItems: "center", padding: 18 }}
              >
                <div
                  className="pk-zoomin"
                  onClick={(event) => event.stopPropagation()}
                  style={{ width: "min(600px, 100%)", maxHeight: "min(86vh, 760px)", overflowY: "auto", borderRadius: 20, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", boxShadow: "0 40px 110px -30px rgba(0,0,0,.8)", padding: "24px 24px 20px" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 18 }}>
                    <span style={{ width: 36, height: 36, borderRadius: 11, display: "grid", placeItems: "center", background: "rgba(61,135,255,.12)", color: "#7FB3FF", border: "1px solid rgba(61,135,255,.25)", flexShrink: 0 }}>
                      <LifeBuoy size={17} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: T_STRONG, fontWeight: 800, fontSize: 17.5, letterSpacing: "-.01em" }}>Tạo yêu cầu hỗ trợ</div>
                      <div style={{ color: T_MUTE, fontSize: 12.5, marginTop: 2 }}>Mô tả càng chi tiết, xử lý càng nhanh.</div>
                    </div>
                    <button
                      type="button"
                      aria-label="Đóng"
                      onClick={() => closeNewModal()}
                      disabled={busy}
                      style={{ all: "unset", display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 999, cursor: busy ? "not-allowed" : "pointer", color: T_MUTE, background: CHIP_BG, border: `1px solid ${BORDER_2}`, flexShrink: 0 }}
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <Field label="Tiêu đề">
                      <input
                        className="pk-input"
                        value={newTitle}
                        onChange={(event) => setNewTitle(event.target.value)}
                        placeholder="Ví dụ: Cần hỗ trợ đăng ký giải"
                        autoFocus
                      />
                    </Field>
                    <div className="pk-3col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Loại vấn đề">
                        <SelectBox value={newCategory} onChange={(event) => setNewCategory(event.target.value)}>
                          {CATEGORY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </SelectBox>
                      </Field>
                      <Field label="Mức ưu tiên">
                        <SelectBox value={newPriority} onChange={(event) => setNewPriority(event.target.value)}>
                          {PRIORITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </SelectBox>
                      </Field>
                    </div>
                    <Field label="Nội dung" hint="Bắt buộc có nội dung hoặc ít nhất một ảnh đính kèm.">
                      <textarea
                        className="pk-input"
                        rows={5}
                        value={newText}
                        onChange={(event) => setNewText(event.target.value)}
                        placeholder="Mô tả vấn đề, bước tái hiện, mã đơn hoặc thông tin liên quan…"
                        style={{ resize: "vertical", minHeight: 110, lineHeight: 1.55 }}
                      />
                    </Field>
                    <div className="pk-3col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Email liên hệ">
                        <input
                          className="pk-input"
                          type="email"
                          value={newContactEmail}
                          onChange={(event) => setNewContactEmail(event.target.value)}
                          placeholder="ban@email.com"
                        />
                      </Field>
                      <Field label="Số điện thoại">
                        <input
                          className="pk-input"
                          value={newContactPhone}
                          onChange={(event) => setNewContactPhone(event.target.value)}
                          placeholder="09xxxxxxxx"
                          inputMode="numeric"
                        />
                      </Field>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <AttachButton label="Đính kèm ảnh" onPick={(event) => onPickFiles(event, setNewFiles)} disabled={busy || newFiles.length >= 5} />
                        <span style={{ fontSize: 12, color: T_FAINT }}>Tối đa 5 ảnh — {newFiles.length}/5</span>
                      </div>
                      <FileChips files={newFiles} onRemove={(file) => removeFile(file, setNewFiles)} disabled={busy} />
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${BORDER_2}` }}>
                    <GrayPill label="Huỷ" onClick={() => closeNewModal()} disabled={busy} />
                    <WhitePill
                      onClick={handleCreateTicket}
                      disabled={(!newText.trim() && !newFiles.length) || busy}
                      label={busy ? "Đang gửi…" : "Gửi yêu cầu"}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* toast góc phải */}
            {toast && (
              <div className="pk-fade" style={{ position: "fixed", top: 76, right: 22, zIndex: 80, display: "flex", alignItems: "center", gap: 9, padding: "11px 16px", borderRadius: 13, background: "var(--pk-toast-bg, rgba(18,19,22,.94))", border: `1px solid ${toast.type === "success" ? "rgba(59,165,93,.45)" : "rgba(242,85,90,.45)"}`, color: toast.type === "success" ? "#7CC7A2" : "#FF8A8E", fontSize: 13.5, fontWeight: 650, backdropFilter: "blur(10px)" }}>
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
