/**
 * ClubDetailPage (Astryx) — trang CHI TIẾT câu lạc bộ phong cách Astryx (dark),
 * đồng bộ theme với danh sách ClubsPage.jsx. Thay cho trang chi tiết MUI cũ.
 * Cấu trúc: SiteNav → Hero (bìa + logo + tên + chip + mô tả + hành động) →
 * thanh tab sticky (Bảng tin / Sự kiện / Bình chọn / Thành viên) → nội dung tab →
 * SiteFooter. Dùng lại 2 dialog MUI (ClubCreateDialog, JoinRequestsDialog) dạng
 * overlay portal cho Sửa CLB + Duyệt yêu cầu.
 */
/* eslint-disable react/prop-types */
import "@fontsource-variable/figtree";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import {
  BadgeCheck,
  MapPin,
  Users,
  Trophy,
  UserPlus,
  Pencil,
  Inbox,
  Megaphone,
  CalendarDays,
  BarChart3,
  Globe,
  Lock,
  EyeOff,
  Pin,
  PinOff,
  Trash2,
  Plus,
  CalendarPlus,
  Check,
  X,
  Star,
  ShieldCheck,
  Clock,
  Ban,
  UserCheck,
  ChevronDown,
  ChevronUp,
  Heart,
  MessageCircle,
  Send,
  MessagesSquare,
  ImagePlus,
  Share2,
  X as XIcon,
  Images,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Download,
  Plus as PlusIcon,
} from "lucide-react";

import SEOHead from "../../components/SEOHead.jsx";
import ShadowFrame from "./ShadowFrame.jsx";
import SiteNav from "./SiteNav.jsx";
import SiteFooter from "./SiteFooter.jsx";
import PickleMark from "./PickleMark.jsx";
import { A, Lightbox } from "./ui.jsx";
import ClubCreateDialog from "../../components/ClubCreateDialog.jsx";
import JoinRequestsDialog from "../../components/JoinRequestsDialog.jsx";
import { useUploadAvatarMutation } from "../../slices/uploadApiSlice.js";
import { useRegisterChatBotPageSnapshot } from "../../context/ChatBotPageContext.jsx";
import {
  useGetClubQuery,
  useListMembersQuery,
  useListJoinRequestsQuery,
  useAddMemberMutation,
  useSetRoleMutation,
  useKickMemberMutation,
  useBanMemberMutation,
  useUnbanMemberMutation,
  useListEventAttendeesQuery,
  useRequestJoinMutation,
  useCancelJoinMutation,
  useLeaveClubMutation,
  useListAnnouncementsQuery,
  useCreateAnnouncementMutation,
  useUpdateAnnouncementMutation,
  useDeleteAnnouncementMutation,
  useListEventsQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
  useRsvpEventMutation,
  useListPollsQuery,
  useCreatePollMutation,
  useVotePollMutation,
  useClosePollMutation,
  useDeletePollMutation,
  useListPostsQuery,
  useCreatePostMutation,
  useUpdatePostMutation,
  useDeletePostMutation,
  useReactPostMutation,
  useListPostCommentsQuery,
  useCreatePostCommentMutation,
  useDeletePostCommentMutation,
  useListPhotosQuery,
  useAddPhotosMutation,
  useDeletePhotoMutation,
  useListTransactionsQuery,
  useFinanceSummaryQuery,
  useCreateTransactionMutation,
  useUpdateTransactionMutation,
  useDeleteTransactionMutation,
  useLazyExportFinanceCsvQuery,
} from "../../slices/clubsApiSlice.js";

/* ------------------------------ tokens ------------------------------ */
const C = {
  head: "#F0F1F3",
  head2: "#F5F6F7",
  body: "#B9BEC5",
  body2: "#C9CDD2",
  muted: "#9AA0A6",
  brand: "var(--color-brand, #3D87FF)",
  surface: "var(--color-background-surface)",
  border: "var(--color-border)",
  bg: "var(--color-background-body)",
};

const Container = ({ children, style }) => (
  <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 24px", ...style }}>
    {children}
  </div>
);

const fmtInt = (n) => Number(n || 0).toLocaleString("vi-VN");
const fmtVnd = (n) => `${Number(n || 0).toLocaleString("vi-VN")} ₫`;
const INCOME_CATS = ["Phí thành viên", "Tài trợ", "Bán đồ", "Ủng hộ", "Khác"];
const EXPENSE_CATS = ["Thuê sân", "Mua bóng", "Mua dụng cụ", "Giải thưởng", "Ăn uống", "Di chuyển", "Sự kiện", "Khác"];
const METHOD_LABELS = { cash: "Tiền mặt", bank: "Ngân hàng", transfer: "Chuyển khoản", momo: "MoMo", other: "Khác" };
const toDateInput = (d) => {
  try {
    const dt = new Date(d);
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  } catch {
    return "";
  }
};
const placeOf = (c) =>
  String(c?.locationText || [c?.city, c?.province].filter(Boolean).join(", ") || "").trim();
const getApiErrMsg = (err) =>
  err?.data?.message ||
  err?.error ||
  (typeof err?.data === "string" ? err.data : "Có lỗi xảy ra, vui lòng thử lại.");

// Chia sẻ CLB: navigator.share (mobile) → clipboard → prompt
async function shareClub(club) {
  const url = `https://pickletour.vn/clubs/${club?._id}`;
  const title = club?.name || "Câu lạc bộ";
  try {
    if (navigator.share) {
      await navigator.share({ title, text: `Tham gia CLB ${title} trên PickleTour`, url });
      return;
    }
  } catch {
    /* user huỷ share — bỏ qua */
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Đã sao chép liên kết CLB.");
  } catch {
    window.prompt("Sao chép liên kết:", url);
  }
}

const fmtDateTime = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};
const fmtDate = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "";
  }
};
// value cho <input type="datetime-local"> (local time)
const toLocalInput = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(
    dt.getHours()
  )}:${pad(dt.getMinutes())}`;
};

/* ------------------------------ primitives ------------------------------ */
const chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 650,
  background: "rgba(255,255,255,.06)",
  color: C.body2,
  border: "1px solid rgba(255,255,255,.08)",
  whiteSpace: "nowrap",
};

function Btn({
  children,
  onClick,
  disabled,
  variant = "ghost",
  size = "md",
  href,
  as,
  title,
  style,
}) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: size === "sm" ? 34 : size === "lg" ? 46 : 40,
    padding: size === "sm" ? "0 13px" : size === "lg" ? "0 24px" : "0 17px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: size === "sm" ? 13 : 14.5,
    fontFamily: "inherit",
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "filter .15s, background .15s",
  };
  const variants = {
    primary: { background: C.brand, color: "#fff", border: "1px solid transparent" },
    white: { background: "#F2F3F5", color: "#101114", border: "1px solid transparent" },
    ghost: {
      background: "rgba(255,255,255,.06)",
      color: C.body2,
      border: "1px solid rgba(255,255,255,.12)",
    },
    danger: {
      background: "rgba(233,84,84,.10)",
      color: "#F1948A",
      border: "1px solid rgba(233,84,84,.28)",
    },
    success: {
      background: "rgba(59,165,93,.12)",
      color: "#7CC7A2",
      border: "1px solid rgba(59,165,93,.32)",
    },
  };
  const st = { ...base, ...(variants[variant] || variants.ghost), ...style };
  if (href && !disabled) {
    const Comp = as === "a" ? "a" : A;
    const extra = as === "a" ? { href, target: "_blank", rel: "noopener" } : { href };
    return (
      <Comp {...extra} title={title} style={st}>
        {children}
      </Comp>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} style={st}>
      {children}
    </button>
  );
}

function Card({ children, style }) {
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionEmpty({ icon, title, hint }) {
  return (
    <div style={{ textAlign: "center", padding: "56px 20px" }}>
      <div style={{ display: "flex", justifyContent: "center", color: C.muted, opacity: 0.7 }}>
        {icon}
      </div>
      <div style={{ marginTop: 14, color: "#DFE2E5", fontSize: 16.5, fontWeight: 700 }}>{title}</div>
      {hint && <div style={{ marginTop: 6, color: C.muted, fontSize: 13.5 }}>{hint}</div>}
    </div>
  );
}

// input/textarea/select dark
const fieldStyle = {
  width: "100%",
  background: "rgba(255,255,255,.05)",
  border: "1px solid rgba(255,255,255,.12)",
  borderRadius: 10,
  color: C.head,
  fontSize: 14,
  fontFamily: "inherit",
  padding: "10px 12px",
  outline: "none",
  boxSizing: "border-box",
};
const labelStyle = { color: C.body, fontSize: 12.5, fontWeight: 650, marginBottom: 6, display: "block" };

const visIcon = (v) =>
  v === "hidden" ? <EyeOff size={12} /> : v === "private" || v === "members" ? <Lock size={12} /> : <Globe size={12} />;
const visLabel = (v) =>
  ({ public: "Công khai", private: "Riêng tư", hidden: "Ẩn", members: "Thành viên" }[v] || "Công khai");

/* ================================ HERO ================================ */
function Hero({ club, my, joinCtl, onEdit, onReview, pendingCount }) {
  const place = placeOf(club);
  const members = Number(club?.stats?.memberCount || 0);
  const wins = Number(club?.stats?.tournamentWins || 0);
  const open = String(club?.joinPolicy || "").toLowerCase() === "open";
  const canManage = !!my?.canManage;

  return (
    <div style={{ position: "relative" }}>
      {/* cover */}
      <div style={{ position: "relative", height: 240, overflow: "hidden", background: "#191A1D" }}>
        {club?.coverUrl ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `url("${club.coverUrl}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "radial-gradient(80% 130% at 50% 0%, rgba(61,135,255,.20), transparent 70%)",
            }}
          />
        )}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(10,11,13,.15) 20%, var(--color-background-body) 100%)",
          }}
        />
      </div>

      <Container style={{ position: "relative", marginTop: -64, zIndex: 2 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <span style={{ display: "inline-block", borderRadius: 22, padding: 4, background: C.bg }}>
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: 20,
                overflow: "hidden",
                display: "grid",
                placeItems: "center",
                background: C.surface,
              }}
            >
              <Avatar size="large" src={club?.logoUrl || undefined} name={club?.name || "CLB"} />
            </div>
          </span>
          <div style={{ flex: 1, minWidth: 240, paddingBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: "clamp(26px, 3.6vw, 38px)",
                  fontWeight: 780,
                  letterSpacing: "-0.02em",
                  color: C.head2,
                  lineHeight: 1.1,
                }}
              >
                {club?.name || "Câu lạc bộ"}
              </h1>
              {club?.isVerified && <BadgeCheck size={22} color="#3E9EFB" />}
            </div>
            {place && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, color: C.muted, fontSize: 13.5 }}>
                <MapPin size={13} />
                <span>{place}</span>
              </div>
            )}
          </div>
        </div>

        {/* chips */}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <span style={chip}>
            <Users size={12} />
            {fmtInt(members)} thành viên
          </span>
          {wins > 0 && (
            <span style={{ ...chip, color: "#F0C24B", borderColor: "rgba(240,194,75,.3)", background: "rgba(240,194,75,.08)" }}>
              <Trophy size={12} />
              {fmtInt(wins)} cúp
            </span>
          )}
          <span style={open ? { ...chip, color: "#7CC7A2", borderColor: "rgba(59,165,93,.32)", background: "rgba(59,165,93,.10)" } : chip}>
            <UserPlus size={12} />
            {open ? "Tham gia tự do" : "Duyệt tham gia"}
          </span>
          <span style={chip}>
            {visIcon(club?.visibility)}
            {visLabel(club?.visibility)}
          </span>
          {(club?.sportTypes || []).slice(0, 3).map((s) => (
            <span key={s} style={chip}>
              {s}
            </span>
          ))}
        </div>

        {club?.description && (
          <div style={{ marginTop: 14, color: C.body, fontSize: 14.5, lineHeight: 1.6, maxWidth: 760, whiteSpace: "pre-wrap" }}>
            {club.description}
          </div>
        )}

        {/* actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          {joinCtl}
          <Btn variant="ghost" onClick={() => shareClub(club)}>
            <Share2 size={15} /> Chia sẻ
          </Btn>
          {club?.website && (
            <Btn as="a" href={club.website} variant="ghost">
              <Globe size={15} /> Website
            </Btn>
          )}
          {canManage && (
            <>
              <Btn variant="ghost" onClick={onEdit}>
                <Pencil size={15} /> Sửa CLB
              </Btn>
              <Btn variant="ghost" onClick={onReview}>
                <Inbox size={15} /> Duyệt yêu cầu
                {pendingCount > 0 && (
                  <span
                    style={{
                      marginLeft: 2,
                      background: C.brand,
                      color: "#fff",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 800,
                      padding: "1px 7px",
                    }}
                  >
                    {pendingCount}
                  </span>
                )}
              </Btn>
            </>
          )}
        </div>
      </Container>
    </div>
  );
}

/* --------------------------- Join control --------------------------- */
function JoinControl({ club, my }) {
  const state = my?.isMember ? "member" : my?.pendingRequest ? "pending" : "not_member";
  const [requestJoin, { isLoading: joining }] = useRequestJoinMutation();
  const [cancelJoin, { isLoading: canceling }] = useCancelJoinMutation();
  const [leaveClub, { isLoading: leaving }] = useLeaveClubMutation();

  const doJoin = async () => {
    try {
      const res = await requestJoin({ id: club._id }).unwrap();
      if (res?.joined) toast.success("Bạn đã tham gia CLB!");
      else toast.success("Đã gửi yêu cầu gia nhập.");
    } catch (err) {
      if (err?.status === 401) toast.warn("Bạn cần đăng nhập để xin gia nhập CLB.");
      else toast.error(getApiErrMsg(err));
    }
  };
  const doCancel = async () => {
    try {
      await cancelJoin({ id: club._id }).unwrap();
      toast.success("Đã huỷ yêu cầu gia nhập.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const doLeave = async () => {
    if (!window.confirm("Bạn chắc chắn muốn rời CLB?")) return;
    try {
      await leaveClub({ id: club._id }).unwrap();
      toast.success("Đã rời CLB.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  if (state === "member") {
    if (my?.isOwner) {
      return (
        <Btn variant="ghost" disabled title="Chủ CLB cần chuyển quyền trước khi rời">
          <ShieldCheck size={15} /> Chủ câu lạc bộ
        </Btn>
      );
    }
    return (
      <Btn variant="danger" disabled={leaving} onClick={doLeave}>
        <X size={15} /> Rời CLB
      </Btn>
    );
  }
  if (state === "pending") {
    return (
      <>
        <Btn variant="ghost" disabled>
          <Clock size={15} /> Đã gửi yêu cầu
        </Btn>
        <Btn variant="ghost" disabled={canceling} onClick={doCancel}>
          Huỷ yêu cầu
        </Btn>
      </>
    );
  }
  return (
    <Btn variant="primary" disabled={joining} onClick={doJoin}>
      <UserPlus size={15} /> Xin gia nhập
    </Btn>
  );
}

/* ============================ ANNOUNCEMENTS ============================ */
function AnnouncementsTab({ club, canManage }) {
  const id = club._id;
  const { data, isLoading } = useListAnnouncementsQuery({ id, page: 1, limit: 50 });
  const [createAnn, { isLoading: creating }] = useCreateAnnouncementMutation();
  const [updateAnn] = useUpdateAnnouncementMutation();
  const [deleteAnn] = useDeleteAnnouncementMutation();

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [editId, setEditId] = useState(null);

  const items = data?.items || [];

  const resetForm = () => {
    setTitle("");
    setContent("");
    setPinned(false);
    setEditId(null);
    setShowForm(false);
  };

  const submit = async () => {
    const tt = title.trim();
    if (!tt) return toast.info("Nhập tiêu đề thông báo.");
    try {
      if (editId) {
        await updateAnn({ id, postId: editId, title: tt, content, pinned }).unwrap();
        toast.success("Đã cập nhật thông báo.");
      } else {
        await createAnn({ id, title: tt, content, pinned }).unwrap();
        toast.success("Đã đăng thông báo.");
      }
      resetForm();
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  const startEdit = (a) => {
    setEditId(a._id);
    setTitle(a.title || "");
    setContent(a.content || "");
    setPinned(!!a.pinned);
    setShowForm(true);
  };
  const togglePin = async (a) => {
    try {
      await updateAnn({ id, postId: a._id, pinned: !a.pinned }).unwrap();
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const remove = async (a) => {
    if (!window.confirm("Xoá thông báo này?")) return;
    try {
      await deleteAnn({ id, postId: a._id }).unwrap();
      toast.success("Đã xoá thông báo.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {canManage && (
        <Card style={{ padding: 16 }}>
          {!showForm ? (
            <Btn variant="ghost" onClick={() => setShowForm(true)}>
              <Plus size={16} /> Đăng thông báo
            </Btn>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label style={labelStyle}>Tiêu đề</label>
                <input style={fieldStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tiêu đề thông báo" />
              </div>
              <div>
                <label style={labelStyle}>Nội dung</label>
                <textarea
                  style={{ ...fieldStyle, minHeight: 96, resize: "vertical" }}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Nội dung…"
                />
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: C.body2, fontSize: 13.5, cursor: "pointer" }}>
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
                Ghim lên đầu
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="primary" size="sm" onClick={submit} disabled={creating}>
                  {editId ? "Lưu" : "Đăng"}
                </Btn>
                <Btn variant="ghost" size="sm" onClick={resetForm}>
                  Huỷ
                </Btn>
              </div>
            </div>
          )}
        </Card>
      )}

      {isLoading ? (
        <Card style={{ padding: 16 }}>
          <Skeleton width="40%" height="18px" />
          <div style={{ height: 10 }} />
          <Skeleton width="90%" height="13px" />
        </Card>
      ) : items.length === 0 ? (
        <SectionEmpty icon={<Megaphone size={40} />} title="Chưa có thông báo nào" hint={canManage ? "Đăng thông báo đầu tiên cho CLB." : undefined} />
      ) : (
        items.map((a) => (
          <Card key={a._id} style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {a.pinned && (
                    <span style={{ ...chip, color: "#F0C24B", borderColor: "rgba(240,194,75,.3)", background: "rgba(240,194,75,.08)" }}>
                      <Pin size={11} /> Ghim
                    </span>
                  )}
                  <span style={{ color: C.head, fontWeight: 720, fontSize: 16 }}>{a.title}</span>
                </div>
                {a.content && (
                  <div style={{ marginTop: 8, color: C.body, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{a.content}</div>
                )}
                <div style={{ marginTop: 10, color: C.muted, fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>{a.author?.fullName || a.author?.nickname || "Ban quản trị"}</span>
                  <span>•</span>
                  <span>{fmtDate(a.createdAt)}</span>
                </div>
              </div>
              {canManage && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <Btn variant="ghost" size="sm" onClick={() => togglePin(a)} title={a.pinned ? "Bỏ ghim" : "Ghim"}>
                    {a.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                  </Btn>
                  <Btn variant="ghost" size="sm" onClick={() => startEdit(a)} title="Sửa">
                    <Pencil size={15} />
                  </Btn>
                  <Btn variant="danger" size="sm" onClick={() => remove(a)} title="Xoá">
                    <Trash2 size={15} />
                  </Btn>
                </div>
              )}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

/* =============================== EVENTS =============================== */
const emptyEventForm = {
  title: "",
  description: "",
  startAt: "",
  endAt: "",
  location: "",
  visibility: "public",
  rsvp: "open",
  capacity: 0,
};

// Danh sách người tham gia sự kiện (mở/đóng, fetch khi mở)
function EventAttendees({ clubId, event }) {
  const [open, setOpen] = useState(false);
  const { data, isFetching } = useListEventAttendeesQuery(
    { id: clubId, eventId: event._id },
    { skip: !open }
  );
  const attendees = data?.items || [];
  const count = Number(event.attendeesCount || 0);
  if (!count) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ all: "unset", cursor: "pointer", color: C.body2, fontSize: 12.5, fontWeight: 650, display: "inline-flex", alignItems: "center", gap: 5 }}
      >
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Người tham gia ({fmtInt(count)})
      </button>
      {open && (
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {isFetching ? (
            <span style={{ color: C.muted, fontSize: 12 }}>Đang tải…</span>
          ) : attendees.length === 0 ? (
            <span style={{ color: C.muted, fontSize: 12 }}>Chưa có ai.</span>
          ) : (
            attendees.map((u) => (
              <A
                key={u._id}
                href={`/user/${u._id}`}
                style={{ ...chip, textDecoration: "none", paddingLeft: 4 }}
              >
                <Avatar size="small" src={u.avatar || undefined} name={u.fullName || "?"} />
                <span style={{ color: C.body2 }}>{u.nickname || u.fullName || "Người dùng"}</span>
              </A>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function EventsTab({ club, canManage }) {
  const id = club._id;
  const { data, isLoading } = useListEventsQuery({ id, page: 1, limit: 50 });
  const [createEvent, { isLoading: creating }] = useCreateEventMutation();
  const [updateEvent, { isLoading: updating }] = useUpdateEventMutation();
  const [deleteEvent] = useDeleteEventMutation();
  const [rsvpEvent] = useRsvpEventMutation();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyEventForm);
  const [editId, setEditId] = useState(null);

  const items = data?.items || [];
  const setF = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const resetForm = () => {
    setForm(emptyEventForm);
    setEditId(null);
    setShowForm(false);
  };
  const openCreate = () => {
    setForm(emptyEventForm);
    setEditId(null);
    setShowForm(true);
  };
  const startEdit = (e) => {
    setEditId(e._id);
    setForm({
      title: e.title || "",
      description: e.description || "",
      startAt: toLocalInput(e.startAt),
      endAt: toLocalInput(e.endAt),
      location: e.location || "",
      visibility: e.visibility || "public",
      rsvp: e.rsvp || "open",
      capacity: e.capacity || 0,
    });
    setShowForm(true);
  };

  const submit = async () => {
    if (!form.title.trim()) return toast.info("Nhập tên sự kiện.");
    if (!form.startAt || !form.endAt) return toast.info("Chọn thời gian bắt đầu và kết thúc.");
    if (new Date(form.endAt) < new Date(form.startAt)) return toast.info("Thời gian kết thúc phải sau thời gian bắt đầu.");
    const body = {
      title: form.title.trim(),
      description: form.description,
      startAt: new Date(form.startAt).toISOString(),
      endAt: new Date(form.endAt).toISOString(),
      location: form.location,
      visibility: form.visibility,
      rsvp: form.rsvp,
      capacity: form.rsvp === "limit" ? Number(form.capacity || 0) : 0,
    };
    try {
      if (editId) {
        await updateEvent({ id, eventId: editId, ...body }).unwrap();
        toast.success("Đã cập nhật sự kiện.");
      } else {
        await createEvent({ id, ...body }).unwrap();
        toast.success("Đã tạo sự kiện.");
      }
      resetForm();
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  const remove = async (e) => {
    if (!window.confirm(`Xoá sự kiện "${e.title}"?`)) return;
    try {
      await deleteEvent({ id, eventId: e._id }).unwrap();
      toast.success("Đã xoá sự kiện.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  const doRsvp = async (e, status) => {
    // bấm lại chính trạng thái hiện tại -> bỏ (none)
    const next = e.myStatus === status ? "none" : status;
    try {
      await rsvpEvent({ id, eventId: e._id, status: next }).unwrap();
    } catch (err) {
      if (err?.status === 401) toast.warn("Bạn cần đăng nhập để phản hồi sự kiện.");
      else toast.error(getApiErrMsg(err));
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {canManage && (
        <Card style={{ padding: 16 }}>
          {!showForm ? (
            <Btn variant="ghost" onClick={openCreate}>
              <Plus size={16} /> Tạo sự kiện
            </Btn>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label style={labelStyle}>Tên sự kiện</label>
                <input style={fieldStyle} value={form.title} onChange={(e) => setF("title", e.target.value)} placeholder="VD: Giao lưu cuối tuần" />
              </div>
              <div>
                <label style={labelStyle}>Mô tả</label>
                <textarea style={{ ...fieldStyle, minHeight: 72, resize: "vertical" }} value={form.description} onChange={(e) => setF("description", e.target.value)} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Bắt đầu</label>
                  <input type="datetime-local" style={fieldStyle} value={form.startAt} onChange={(e) => setF("startAt", e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>Kết thúc</label>
                  <input type="datetime-local" style={fieldStyle} value={form.endAt} onChange={(e) => setF("endAt", e.target.value)} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Địa điểm</label>
                <input style={fieldStyle} value={form.location} onChange={(e) => setF("location", e.target.value)} placeholder="VD: Sân ABC, Quận 1" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Hiển thị</label>
                  <select style={fieldStyle} value={form.visibility} onChange={(e) => setF("visibility", e.target.value)}>
                    <option value="public">Công khai</option>
                    <option value="members">Chỉ thành viên</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Đăng ký</label>
                  <select style={fieldStyle} value={form.rsvp} onChange={(e) => setF("rsvp", e.target.value)}>
                    <option value="open">Không giới hạn</option>
                    <option value="limit">Giới hạn chỗ</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Sức chứa</label>
                  <input
                    type="number"
                    min={0}
                    style={{ ...fieldStyle, opacity: form.rsvp === "limit" ? 1 : 0.5 }}
                    disabled={form.rsvp !== "limit"}
                    value={form.capacity}
                    onChange={(e) => setF("capacity", e.target.value)}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="primary" size="sm" onClick={submit} disabled={creating || updating}>
                  {editId ? "Lưu" : "Tạo"}
                </Btn>
                <Btn variant="ghost" size="sm" onClick={resetForm}>
                  Huỷ
                </Btn>
              </div>
            </div>
          )}
        </Card>
      )}

      {isLoading ? (
        <Card style={{ padding: 16 }}>
          <Skeleton width="50%" height="18px" />
          <div style={{ height: 10 }} />
          <Skeleton width="70%" height="13px" />
        </Card>
      ) : items.length === 0 ? (
        <SectionEmpty icon={<CalendarDays size={40} />} title="Chưa có sự kiện nào" hint={canManage ? "Tạo sự kiện đầu tiên cho CLB." : undefined} />
      ) : (
        items.map((e) => {
          const full = e.rsvp === "limit" && e.capacity > 0 && e.attendeesCount >= e.capacity;
          const past = new Date(e.endAt) < new Date();
          return (
            <Card key={e._id} style={{ padding: 16, opacity: past ? 0.72 : 1 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ color: C.head, fontWeight: 720, fontSize: 16 }}>{e.title}</span>
                    <span style={chip}>
                      {visIcon(e.visibility)}
                      {visLabel(e.visibility)}
                    </span>
                    {past && <span style={chip}>Đã kết thúc</span>}
                  </div>
                  <div style={{ marginTop: 8, color: C.body2, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <CalendarDays size={13} />
                    <span>{fmtDateTime(e.startAt)}</span>
                    <span style={{ color: C.muted }}>→ {fmtDateTime(e.endAt)}</span>
                  </div>
                  {e.location && (
                    <div style={{ marginTop: 5, color: C.body2, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>
                      <MapPin size={13} />
                      <span>{e.location}</span>
                    </div>
                  )}
                  {e.description && (
                    <div style={{ marginTop: 8, color: C.body, fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{e.description}</div>
                  )}
                  <div style={{ marginTop: 8, color: C.muted, fontSize: 12.5 }}>
                    <Users size={12} style={{ verticalAlign: "-2px" }} /> {fmtInt(e.attendeesCount || 0)}
                    {e.rsvp === "limit" && e.capacity > 0 ? ` / ${fmtInt(e.capacity)}` : ""} tham gia
                  </div>
                </div>
                {canManage && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <Btn variant="ghost" size="sm" onClick={() => startEdit(e)} title="Sửa">
                      <Pencil size={15} />
                    </Btn>
                    <Btn variant="danger" size="sm" onClick={() => remove(e)} title="Xoá">
                      <Trash2 size={15} />
                    </Btn>
                  </div>
                )}
              </div>

              {/* RSVP + lịch */}
              {!past && (
                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <Btn
                    variant={e.myStatus === "going" ? "success" : "ghost"}
                    size="sm"
                    onClick={() => doRsvp(e, "going")}
                    disabled={full && e.myStatus !== "going"}
                    title={full && e.myStatus !== "going" ? "Sự kiện đã đủ chỗ" : undefined}
                  >
                    <Check size={14} /> {e.myStatus === "going" ? "Sẽ tham gia ✓" : "Tham gia"}
                  </Btn>
                  <Btn variant={e.myStatus === "not_going" ? "danger" : "ghost"} size="sm" onClick={() => doRsvp(e, "not_going")}>
                    <X size={14} /> Không tham gia
                  </Btn>
                  <Btn as="a" href={`/api/clubs/${id}/events/${e._id}/ics`} variant="ghost" size="sm" title="Thêm vào lịch">
                    <CalendarPlus size={14} /> Thêm vào lịch
                  </Btn>
                </div>
              )}

              <EventAttendees clubId={id} event={e} />
            </Card>
          );
        })
      )}
    </div>
  );
}

/* =============================== POLLS =============================== */
function PollCard({ club, poll, canManage }) {
  const id = club._id;
  const [votePoll, { isLoading: voting }] = useVotePollMutation();
  const [closePoll] = useClosePollMutation();
  const [deletePoll] = useDeletePollMutation();

  const closed = poll.closesAt && new Date(poll.closesAt) < new Date();
  const [sel, setSel] = useState(() => new Set(poll.myOptionIds || []));
  const voted = (poll.myOptionIds || []).length > 0;

  useEffect(() => {
    setSel(new Set(poll.myOptionIds || []));
  }, [poll.myOptionIds]);

  const totalPeople = Number(poll.voterCount || 0);
  const results = poll.results || {};

  const toggle = (optId) => {
    if (closed) return;
    setSel((prev) => {
      const next = new Set(poll.multiple ? prev : []);
      if (poll.multiple && prev.has(optId)) next.delete(optId);
      else next.add(optId);
      return next;
    });
  };

  const submitVote = async () => {
    const optionIds = [...sel];
    if (!optionIds.length) return toast.info("Chọn ít nhất một phương án.");
    try {
      await votePoll({ id, pollId: poll._id, optionIds }).unwrap();
      toast.success("Đã ghi nhận bình chọn.");
    } catch (err) {
      if (err?.status === 401) toast.warn("Bạn cần đăng nhập để bình chọn.");
      else toast.error(getApiErrMsg(err));
    }
  };

  const doClose = async () => {
    if (!window.confirm("Đóng bình chọn này? Sau khi đóng sẽ không nhận thêm phiếu.")) return;
    try {
      await closePoll({ id, pollId: poll._id }).unwrap();
      toast.success("Đã đóng bình chọn.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const doDelete = async () => {
    if (!window.confirm("Xoá bình chọn này? Toàn bộ phiếu sẽ bị xoá.")) return;
    try {
      await deletePoll({ id, pollId: poll._id }).unwrap();
      toast.success("Đã xoá bình chọn.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  const selChanged = useMemo(() => {
    const a = new Set(poll.myOptionIds || []);
    if (a.size !== sel.size) return true;
    for (const x of sel) if (!a.has(x)) return true;
    return false;
  }, [sel, poll.myOptionIds]);

  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: C.head, fontWeight: 720, fontSize: 16 }}>{poll.question}</span>
            {poll.multiple && <span style={chip}>Nhiều lựa chọn</span>}
            {closed && <span style={{ ...chip, color: "#F1948A", borderColor: "rgba(233,84,84,.28)", background: "rgba(233,84,84,.10)" }}>Đã đóng</span>}
          </div>
          <div style={{ marginTop: 6, color: C.muted, fontSize: 12.5, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span>{fmtInt(totalPeople)} người đã bình chọn</span>
            {poll.closesAt && !closed && <span>• Đóng lúc {fmtDateTime(poll.closesAt)}</span>}
          </div>
        </div>
        {canManage && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {!closed && (
              <Btn variant="ghost" size="sm" onClick={doClose} title="Đóng">
                <Lock size={15} />
              </Btn>
            )}
            <Btn variant="danger" size="sm" onClick={doDelete} title="Xoá">
              <Trash2 size={15} />
            </Btn>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
        {(poll.options || []).map((o) => {
          const optId = o.id || String(o._id);
          const count = Number(results[optId] || 0);
          const pct = totalPeople > 0 ? Math.round((count / totalPeople) * 100) : 0;
          const picked = sel.has(optId);
          const myVote = (poll.myOptionIds || []).includes(optId);
          return (
            <button
              key={optId}
              type="button"
              onClick={() => toggle(optId)}
              disabled={closed}
              style={{
                position: "relative",
                textAlign: "left",
                border: `1px solid ${picked ? C.brand : "rgba(255,255,255,.12)"}`,
                background: "rgba(255,255,255,.04)",
                borderRadius: 12,
                padding: "11px 13px",
                cursor: closed ? "default" : "pointer",
                overflow: "hidden",
                fontFamily: "inherit",
              }}
            >
              {/* thanh kết quả */}
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${pct}%`,
                  background: myVote ? "rgba(61,135,255,.20)" : "rgba(255,255,255,.055)",
                  transition: "width .35s ease",
                }}
              />
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    borderRadius: poll.multiple ? 5 : 999,
                    border: `2px solid ${picked ? C.brand : "rgba(255,255,255,.3)"}`,
                    background: picked ? C.brand : "transparent",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {picked && <Check size={12} color="#fff" />}
                </span>
                <span style={{ flex: 1, color: C.head, fontSize: 14, fontWeight: myVote ? 700 : 550 }}>{o.text}</span>
                <span style={{ color: C.body2, fontSize: 12.5, fontWeight: 700 }}>
                  {pct}% · {fmtInt(count)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {!closed && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <Btn variant="primary" size="sm" onClick={submitVote} disabled={voting || (voted && !selChanged)}>
            {voted ? "Đổi phiếu" : "Bình chọn"}
          </Btn>
          {voted && <span style={{ color: C.muted, fontSize: 12.5 }}>Bạn đã bình chọn</span>}
        </div>
      )}
    </Card>
  );
}

function PollsTab({ club, canManage }) {
  const id = club._id;
  const { data, isLoading } = useListPollsQuery({ id, page: 1, limit: 50 });
  const [createPoll, { isLoading: creating }] = useCreatePollMutation();

  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [multiple, setMultiple] = useState(false);
  const [visibility, setVisibility] = useState("members");
  const [closesAt, setClosesAt] = useState("");

  const items = data?.items || [];

  const reset = () => {
    setQuestion("");
    setOptionsText("");
    setMultiple(false);
    setVisibility("members");
    setClosesAt("");
    setShowForm(false);
  };

  const submit = async () => {
    const q = question.trim();
    if (!q) return toast.info("Nhập câu hỏi bình chọn.");
    const options = optionsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (options.length < 2) return toast.info("Cần ít nhất 2 phương án (mỗi dòng một phương án).");
    try {
      await createPoll({
        id,
        question: q,
        options,
        multiple,
        visibility,
        ...(closesAt ? { closesAt: new Date(closesAt).toISOString() } : {}),
      }).unwrap();
      toast.success("Đã tạo bình chọn.");
      reset();
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {canManage && (
        <Card style={{ padding: 16 }}>
          {!showForm ? (
            <Btn variant="ghost" onClick={() => setShowForm(true)}>
              <Plus size={16} /> Tạo bình chọn
            </Btn>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label style={labelStyle}>Câu hỏi</label>
                <input style={fieldStyle} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="VD: Chọn lịch giao lưu tuần tới?" />
              </div>
              <div>
                <label style={labelStyle}>Các phương án (mỗi dòng một phương án)</label>
                <textarea style={{ ...fieldStyle, minHeight: 90, resize: "vertical" }} value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder={"Thứ 7\nChủ nhật\nCả hai ngày"} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Hiển thị</label>
                  <select style={fieldStyle} value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                    <option value="members">Chỉ thành viên</option>
                    <option value="public">Công khai</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Đóng lúc (tuỳ chọn)</label>
                  <input type="datetime-local" style={fieldStyle} value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
                </div>
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: C.body2, fontSize: 13.5, cursor: "pointer" }}>
                <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
                Cho phép chọn nhiều phương án
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="primary" size="sm" onClick={submit} disabled={creating}>
                  Tạo
                </Btn>
                <Btn variant="ghost" size="sm" onClick={reset}>
                  Huỷ
                </Btn>
              </div>
            </div>
          )}
        </Card>
      )}

      {isLoading ? (
        <Card style={{ padding: 16 }}>
          <Skeleton width="55%" height="18px" />
          <div style={{ height: 12 }} />
          <Skeleton width="100%" height="40px" />
        </Card>
      ) : items.length === 0 ? (
        <SectionEmpty icon={<BarChart3 size={40} />} title="Chưa có bình chọn nào" hint={canManage ? "Tạo bình chọn đầu tiên." : undefined} />
      ) : (
        items.map((p) => <PollCard key={p._id} club={club} poll={p} canManage={canManage} />)
      )}
    </div>
  );
}

/* ============================= DISCUSSION ============================= */
function PostComments({ club, postId, isMember, canManage, authUserId }) {
  const id = club._id;
  const { data, isFetching } = useListPostCommentsQuery({ id, postId });
  const [createComment, { isLoading }] = useCreatePostCommentMutation();
  const [delComment] = useDeletePostCommentMutation();
  const [text, setText] = useState("");
  const comments = data?.items || [];

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      await createComment({ id, postId, content: t }).unwrap();
      setText("");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const remove = async (c) => {
    try {
      await delComment({ id, postId, commentId: c._id }).unwrap();
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12, display: "grid", gap: 10 }}>
      {isFetching && comments.length === 0 ? (
        <span style={{ color: C.muted, fontSize: 12.5 }}>Đang tải bình luận…</span>
      ) : (
        comments.map((c) => {
          const canDel = String(c.author?._id) === String(authUserId) || canManage;
          return (
            <div key={c._id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <A href={`/user/${c.author?._id}`} style={{ flexShrink: 0 }}>
                <Avatar size="small" src={c.author?.avatar || undefined} name={c.author?.fullName || "?"} />
              </A>
              <div style={{ flex: 1, minWidth: 0, background: "rgba(255,255,255,.04)", borderRadius: 12, padding: "8px 11px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: C.head, fontWeight: 700, fontSize: 13 }}>
                    {c.author?.nickname || c.author?.fullName || "Người dùng"}
                  </span>
                  <span style={{ color: C.muted, fontSize: 11 }}>{fmtDateTime(c.createdAt)}</span>
                  {canDel && (
                    <button type="button" onClick={() => remove(c)} style={{ all: "unset", cursor: "pointer", color: C.muted, marginLeft: "auto" }} title="Xoá">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <div style={{ color: C.body, fontSize: 13.5, marginTop: 3, whiteSpace: "pre-wrap" }}>{c.content}</div>
              </div>
            </div>
          );
        })
      )}
      {isMember && (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...fieldStyle, flex: 1 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Viết bình luận…"
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <Btn variant="primary" size="sm" onClick={submit} disabled={isLoading}>
            <Send size={14} />
          </Btn>
        </div>
      )}
    </div>
  );
}

function PostCard({ club, post, isMember, canManage, authUserId }) {
  const id = club._id;
  const [react] = useReactPostMutation();
  const [delPost] = useDeletePostMutation();
  const [updatePost] = useUpdatePostMutation();
  const [showComments, setShowComments] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.content || "");
  const isAuthor = String(post.author?._id) === String(authUserId);
  const canEdit = isAuthor || canManage;
  const canDelete = isAuthor || canManage;

  const doReact = async () => {
    try {
      await react({ id, postId: post._id }).unwrap();
    } catch (err) {
      if (err?.status === 401) toast.warn("Bạn cần đăng nhập.");
      else toast.error(getApiErrMsg(err));
    }
  };
  const doDelete = async () => {
    if (!window.confirm("Xoá bài viết này?")) return;
    try {
      await delPost({ id, postId: post._id }).unwrap();
      toast.success("Đã xoá bài viết.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const doPin = async () => {
    try {
      await updatePost({ id, postId: post._id, pinned: !post.pinned }).unwrap();
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const saveEdit = async () => {
    try {
      await updatePost({ id, postId: post._id, content: editText }).unwrap();
      setEditing(false);
      toast.success("Đã lưu.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  return (
    <Card style={{ padding: 16, ...(post.pinned ? { borderColor: "rgba(240,194,75,.4)" } : null) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <A href={`/user/${post.author?._id}`} style={{ flexShrink: 0 }}>
          <Avatar size="medium" src={post.author?.avatar || undefined} name={post.author?.fullName || "?"} />
        </A>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.head, fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", gap: 6 }}>
            {post.author?.nickname || post.author?.fullName || "Người dùng"}
            {post.pinned && (
              <span style={{ ...chip, color: "#F0C24B", borderColor: "rgba(240,194,75,.3)", background: "rgba(240,194,75,.08)", fontSize: 10.5, padding: "1px 7px" }}>
                <Pin size={10} /> Ghim
              </span>
            )}
          </div>
          <div style={{ color: C.muted, fontSize: 12 }}>
            {fmtDateTime(post.createdAt)}
            {post.visibility === "members" ? " · Chỉ thành viên" : ""}
          </div>
        </div>
        {canManage && (
          <Btn variant="ghost" size="sm" onClick={doPin} title={post.pinned ? "Bỏ ghim" : "Ghim"}>
            {post.pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </Btn>
        )}
        {canEdit && !editing && (
          <Btn variant="ghost" size="sm" onClick={() => { setEditText(post.content || ""); setEditing(true); }} title="Sửa">
            <Pencil size={15} />
          </Btn>
        )}
        {canDelete && (
          <Btn variant="ghost" size="sm" onClick={doDelete} title="Xoá">
            <Trash2 size={15} />
          </Btn>
        )}
      </div>

      {editing ? (
        <div style={{ marginTop: 10 }}>
          <textarea
            style={{ ...fieldStyle, minHeight: 70, resize: "vertical" }}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Btn variant="primary" size="sm" onClick={saveEdit}>Lưu</Btn>
            <Btn variant="ghost" size="sm" onClick={() => setEditing(false)}>Huỷ</Btn>
          </div>
        </div>
      ) : (
        post.content && (
          <div style={{ color: C.body, fontSize: 14.5, lineHeight: 1.6, marginTop: 10, whiteSpace: "pre-wrap" }}>
            {post.content}
          </div>
        )
      )}
      {post.imageUrl && !editing && (
        <img src={post.imageUrl} alt="" style={{ maxWidth: "100%", borderRadius: 12, marginTop: 10, display: "block" }} />
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 12, alignItems: "center" }}>
        <button
          type="button"
          onClick={doReact}
          disabled={!isMember}
          style={{ all: "unset", cursor: isMember ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 6, color: post.myReaction ? "#F26D6D" : C.body2, fontWeight: 650, fontSize: 13.5 }}
          title={isMember ? "Thích" : "Tham gia CLB để thích"}
        >
          <Heart size={16} fill={post.myReaction ? "#F26D6D" : "none"} /> {fmtInt(post.reactionCount || 0)}
        </button>
        <button
          type="button"
          onClick={() => setShowComments((v) => !v)}
          style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, color: C.body2, fontWeight: 650, fontSize: 13.5 }}
        >
          <MessageCircle size={16} /> {fmtInt(post.commentCount || 0)}
        </button>
      </div>

      {showComments && (
        <PostComments club={club} postId={post._id} isMember={isMember} canManage={canManage} authUserId={authUserId} />
      )}
    </Card>
  );
}

function DiscussionTab({ club, my }) {
  const id = club._id;
  const isMember = !!my?.isMember;
  const canManage = !!my?.canManage;
  const authIdA = useSelector((s) => s.auth?.userInfo?._id);
  const authIdB = useSelector((s) => s.user?.userInfo?._id);
  const authUserId = authIdA || authIdB || null;

  const { data, isLoading } = useListPostsQuery({ id, page: 1, limit: 30 });
  const [createPost, { isLoading: posting }] = useCreatePostMutation();
  const [uploadAvatar, { isLoading: uploadingImg }] = useUploadAvatarMutation();
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const items = data?.items || [];

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const res = await uploadAvatar(file).unwrap();
      const url = res?.url || res?.secure_url || res?.data?.url || res?.Location || "";
      if (url) setImageUrl(url);
      else toast.error("Tải ảnh thất bại.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  const submit = async () => {
    if (!content.trim() && !imageUrl.trim()) return toast.info("Nhập nội dung hoặc thêm ảnh.");
    try {
      await createPost({ id, content, imageUrl: imageUrl.trim() || undefined }).unwrap();
      setContent("");
      setImageUrl("");
      toast.success("Đã đăng bài.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {isMember ? (
        <Card style={{ padding: 16 }}>
          <textarea
            style={{ ...fieldStyle, minHeight: 70, resize: "vertical" }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Chia sẻ điều gì đó với câu lạc bộ…"
          />
          {imageUrl && (
            <div style={{ position: "relative", marginTop: 10, display: "inline-block" }}>
              <img src={imageUrl} alt="" style={{ maxWidth: "100%", maxHeight: 260, borderRadius: 12, display: "block" }} />
              <button
                type="button"
                onClick={() => setImageUrl("")}
                title="Bỏ ảnh"
                style={{ position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 999, border: "none", cursor: "pointer", background: "rgba(0,0,0,.6)", color: "#fff", display: "grid", placeItems: "center" }}
              >
                <XIcon size={15} />
              </button>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <Btn variant="primary" size="sm" onClick={submit} disabled={posting || uploadingImg}>
              <Send size={14} /> Đăng bài
            </Btn>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                height: 34,
                padding: "0 13px",
                borderRadius: 999,
                cursor: uploadingImg ? "wait" : "pointer",
                background: "rgba(255,255,255,.06)",
                color: C.body2,
                border: "1px solid rgba(255,255,255,.12)",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              <input type="file" accept="image/*" onChange={onPickImage} style={{ display: "none" }} disabled={uploadingImg} />
              <ImagePlus size={15} /> {uploadingImg ? "Đang tải…" : "Ảnh"}
            </label>
          </div>
        </Card>
      ) : (
        <Card style={{ padding: 14 }}>
          <div style={{ color: C.muted, fontSize: 13.5 }}>
            Tham gia câu lạc bộ để đăng bài và bình luận.
          </div>
        </Card>
      )}

      {isLoading ? (
        <Card style={{ padding: 16 }}>
          <Skeleton width="40%" height="16px" />
          <div style={{ height: 10 }} />
          <Skeleton width="80%" height="13px" />
        </Card>
      ) : items.length === 0 ? (
        <SectionEmpty icon={<MessagesSquare size={40} />} title="Chưa có bài viết nào" hint={isMember ? "Hãy là người đăng bài đầu tiên." : undefined} />
      ) : (
        items.map((p) => (
          <PostCard key={p._id} club={club} post={p} isMember={isMember} canManage={canManage} authUserId={authUserId} />
        ))
      )}
    </div>
  );
}

/* =============================== GALLERY =============================== */
function GalleryTab({ club, my }) {
  const id = club._id;
  const isMember = !!my?.isMember;
  const canManage = !!my?.canManage;
  const authIdA = useSelector((s) => s.auth?.userInfo?._id);
  const authIdB = useSelector((s) => s.user?.userInfo?._id);
  const authUserId = authIdA || authIdB || null;

  const { data, isLoading } = useListPhotosQuery({ id, page: 1, limit: 60 });
  const [uploadAvatar, { isLoading: uploading }] = useUploadAvatarMutation();
  const [addPhotos] = useAddPhotosMutation();
  const [deletePhoto] = useDeletePhotoMutation();
  const [lightbox, setLightbox] = useState(null);
  const items = data?.items || [];

  const onPick = async (e) => {
    const files = [...(e.target.files || [])].slice(0, 10);
    e.target.value = "";
    if (!files.length) return;
    try {
      const urls = [];
      for (const f of files) {
        const res = await uploadAvatar(f).unwrap();
        const url = res?.url || res?.secure_url || res?.data?.url || res?.Location || "";
        if (url) urls.push(url);
      }
      if (urls.length) {
        await addPhotos({ id, photos: urls.map((u) => ({ url: u })) }).unwrap();
        toast.success(`Đã thêm ${urls.length} ảnh.`);
      } else toast.error("Tải ảnh thất bại.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const remove = async (p) => {
    if (!window.confirm("Xoá ảnh này?")) return;
    try {
      await deletePhoto({ id, photoId: p._id }).unwrap();
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {isMember && (
        <Card style={{ padding: 16 }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 40,
              padding: "0 18px",
              borderRadius: 999,
              cursor: uploading ? "wait" : "pointer",
              background: C.brand,
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            <input type="file" accept="image/*" multiple onChange={onPick} style={{ display: "none" }} disabled={uploading} />
            <ImagePlus size={16} /> {uploading ? "Đang tải…" : "Thêm ảnh"}
          </label>
        </Card>
      )}

      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} width="100%" height="110px" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <SectionEmpty icon={<Images size={40} />} title="Chưa có ảnh nào" hint={isMember ? "Thêm ảnh đầu tiên cho CLB." : undefined} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
          {items.map((p) => {
            const canDel = String(p.uploadedBy?._id) === String(authUserId) || canManage;
            return (
              <div key={p._id} style={{ position: "relative", paddingTop: "100%", borderRadius: 12, overflow: "hidden", background: "#191A1D" }}>
                <div
                  onClick={() => setLightbox(p.url)}
                  style={{ position: "absolute", inset: 0, backgroundImage: `url("${p.url}")`, backgroundSize: "cover", backgroundPosition: "center", cursor: "zoom-in" }}
                />
                {canDel && (
                  <button
                    type="button"
                    onClick={() => remove(p)}
                    title="Xoá"
                    style={{ position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: 999, border: "none", cursor: "pointer", background: "rgba(0,0,0,.55)", color: "#fff", display: "grid", placeItems: "center" }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

/* =============================== FINANCE =============================== */
function StatCard({ label, value, color, icon }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 12.5, fontWeight: 600 }}>
        {icon} {label}
      </div>
      <div style={{ color: color || C.head, fontSize: 22, fontWeight: 800, marginTop: 6, letterSpacing: "-0.02em" }}>{value}</div>
    </div>
  );
}

function FinanceTab({ club, my }) {
  const id = club._id;
  const isMember = !!my?.isMember;
  const canManage = !!my?.canManage;
  const [filterType, setFilterType] = useState("");

  const { data: sum } = useFinanceSummaryQuery({ id }, { skip: !isMember });
  const { data: txData, isLoading } = useListTransactionsQuery(
    { id, limit: 100, type: filterType || undefined },
    { skip: !isMember }
  );
  const [createTx, { isLoading: creating }] = useCreateTransactionMutation();
  const [updateTx, { isLoading: updating }] = useUpdateTransactionMutation();
  const [deleteTx] = useDeleteTransactionMutation();
  const [triggerExport, { isFetching: exporting }] = useLazyExportFinanceCsvQuery();

  const emptyForm = { type: "income", amount: "", category: "", description: "", occurredAt: toDateInput(new Date()), method: "cash" };
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const setF = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const cats = form.type === "income" ? INCOME_CATS : EXPENSE_CATS;

  const items = txData?.items || [];

  const resetForm = () => {
    setForm(emptyForm);
    setEditId(null);
    setShowForm(false);
  };
  const startEdit = (t) => {
    setEditId(t._id);
    setForm({
      type: t.type,
      amount: String(t.amount || ""),
      category: t.category || "",
      description: t.description || "",
      occurredAt: toDateInput(t.occurredAt),
      method: t.method || "cash",
    });
    setShowForm(true);
  };

  const submit = async () => {
    const amt = Number(String(form.amount).replace(/[^\d]/g, ""));
    if (!amt || amt <= 0) return toast.info("Nhập số tiền hợp lệ.");
    const body = {
      type: form.type,
      amount: amt,
      category: form.category.trim(),
      description: form.description.trim(),
      occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : new Date().toISOString(),
      method: form.method,
    };
    try {
      if (editId) {
        await updateTx({ id, txId: editId, ...body }).unwrap();
        toast.success("Đã cập nhật giao dịch.");
      } else {
        await createTx({ id, ...body }).unwrap();
        toast.success("Đã ghi giao dịch.");
      }
      resetForm();
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const remove = async (t) => {
    if (!window.confirm("Xoá giao dịch này?")) return;
    try {
      await deleteTx({ id, txId: t._id }).unwrap();
      toast.success("Đã xoá.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const doExport = async () => {
    try {
      const blob = await triggerExport({ id, type: filterType || undefined }).unwrap();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quy-clb-${id}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  if (!isMember) {
    return <SectionEmpty icon={<Wallet size={40} />} title="Quỹ CLB dành cho thành viên" hint="Tham gia câu lạc bộ để xem thu chi quỹ." />;
  }

  const byCat = sum?.byCategory || [];
  const maxCat = Math.max(1, ...byCat.map((c) => c.sum));
  const byMonth = sum?.byMonth || [];
  const maxMonth = Math.max(1, ...byMonth.map((m) => Math.max(m.income, m.expense)));

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Tổng quan */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <StatCard label="Số dư quỹ" value={fmtVnd(sum?.balance)} color={Number(sum?.balance) < 0 ? "#F1948A" : C.head2} icon={<Wallet size={13} />} />
        <StatCard label="Tổng thu" value={fmtVnd(sum?.totalIncome)} color="#7CC7A2" icon={<ArrowUpRight size={13} />} />
        <StatCard label="Tổng chi" value={fmtVnd(sum?.totalExpense)} color="#F1948A" icon={<ArrowDownRight size={13} />} />
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {[{ k: "", l: "Tất cả" }, { k: "income", l: "Thu" }, { k: "expense", l: "Chi" }].map((f) => (
          <button
            key={f.k}
            type="button"
            onClick={() => setFilterType(f.k)}
            style={{ all: "unset", cursor: "pointer", padding: "6px 13px", borderRadius: 999, fontSize: 13, fontWeight: 700, color: filterType === f.k ? "#fff" : C.body2, background: filterType === f.k ? C.brand : "rgba(255,255,255,.06)", border: `1px solid ${filterType === f.k ? "transparent" : "rgba(255,255,255,.12)"}` }}
          >
            {f.l}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <Btn variant="ghost" size="sm" onClick={doExport} disabled={exporting}>
          <Download size={14} /> {exporting ? "…" : "Xuất CSV"}
        </Btn>
        {canManage && !showForm && (
          <Btn variant="primary" size="sm" onClick={() => { setForm(emptyForm); setEditId(null); setShowForm(true); }}>
            <PlusIcon size={15} /> Ghi thu/chi
          </Btn>
        )}
      </div>

      {/* Form thêm/sửa (admin) */}
      {canManage && showForm && (
        <Card style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button type="button" onClick={() => setF("type", "income")} style={{ all: "unset", flex: 1, textAlign: "center", cursor: "pointer", padding: "9px 0", borderRadius: 10, fontWeight: 700, color: form.type === "income" ? "#fff" : C.body2, background: form.type === "income" ? "#3BA55D" : "rgba(255,255,255,.06)", border: `1px solid ${form.type === "income" ? "transparent" : "rgba(255,255,255,.12)"}` }}>
              + Khoản thu
            </button>
            <button type="button" onClick={() => setF("type", "expense")} style={{ all: "unset", flex: 1, textAlign: "center", cursor: "pointer", padding: "9px 0", borderRadius: 10, fontWeight: 700, color: form.type === "expense" ? "#fff" : C.body2, background: form.type === "expense" ? "#E05353" : "rgba(255,255,255,.06)", border: `1px solid ${form.type === "expense" ? "transparent" : "rgba(255,255,255,.12)"}` }}>
              − Khoản chi
            </button>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Số tiền (₫)</label>
                <input style={fieldStyle} inputMode="numeric" value={form.amount} onChange={(e) => setF("amount", e.target.value.replace(/[^\d]/g, ""))} placeholder="VD: 200000" />
              </div>
              <div>
                <label style={labelStyle}>Ngày</label>
                <input type="date" style={fieldStyle} value={form.occurredAt} onChange={(e) => setF("occurredAt", e.target.value)} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Danh mục</label>
                <input style={fieldStyle} value={form.category} onChange={(e) => setF("category", e.target.value)} placeholder="Chọn hoặc nhập…" list="fin-cats" />
                <datalist id="fin-cats">
                  {cats.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <label style={labelStyle}>Phương thức</label>
                <select style={fieldStyle} value={form.method} onChange={(e) => setF("method", e.target.value)}>
                  {Object.entries(METHOD_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {cats.map((c) => (
                <button key={c} type="button" onClick={() => setF("category", c)} style={{ ...chip, cursor: "pointer", background: form.category === c ? "rgba(61,135,255,.18)" : "rgba(255,255,255,.06)", borderColor: form.category === c ? C.brand : "rgba(255,255,255,.08)" }}>
                  {c}
                </button>
              ))}
            </div>
            <div>
              <label style={labelStyle}>Mô tả</label>
              <textarea style={{ ...fieldStyle, minHeight: 54, resize: "vertical" }} value={form.description} onChange={(e) => setF("description", e.target.value)} placeholder="Ghi chú…" />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" size="sm" onClick={submit} disabled={creating || updating}>{editId ? "Lưu" : "Ghi"}</Btn>
              <Btn variant="ghost" size="sm" onClick={resetForm}>Huỷ</Btn>
            </div>
          </div>
        </Card>
      )}

      {/* Danh sách giao dịch */}
      {isLoading ? (
        <Card style={{ padding: 16 }}>
          <Skeleton width="60%" height="16px" />
        </Card>
      ) : items.length === 0 ? (
        <SectionEmpty icon={<Wallet size={40} />} title="Chưa có giao dịch nào" hint={canManage ? "Ghi khoản thu/chi đầu tiên." : undefined} />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {items.map((t, i) => {
            const inc = t.type === "income";
            return (
              <div key={t._id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i === 0 ? "none" : `1px solid ${C.border}` }}>
                <div style={{ width: 34, height: 34, borderRadius: 999, flexShrink: 0, display: "grid", placeItems: "center", background: inc ? "rgba(59,165,93,.14)" : "rgba(224,83,83,.14)", color: inc ? "#7CC7A2" : "#F1948A" }}>
                  {inc ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ color: C.head, fontWeight: 700, fontSize: 14 }}>{t.category || "Khác"}</span>
                    <span style={{ ...chip, fontSize: 10.5, padding: "1px 7px" }}>{METHOD_LABELS[t.method] || t.method}</span>
                  </div>
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                    {fmtDate(t.occurredAt)}
                    {t.description ? ` · ${t.description}` : ""}
                  </div>
                </div>
                <div style={{ color: inc ? "#7CC7A2" : "#F1948A", fontWeight: 800, fontSize: 14.5, whiteSpace: "nowrap" }}>
                  {inc ? "+" : "−"}{fmtVnd(t.amount)}
                </div>
                {canManage && (
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <Btn variant="ghost" size="sm" onClick={() => startEdit(t)} title="Sửa"><Pencil size={14} /></Btn>
                    <Btn variant="danger" size="sm" onClick={() => remove(t)} title="Xoá"><Trash2 size={14} /></Btn>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {/* Báo cáo */}
      {byCat.length > 0 && (
        <Card style={{ padding: 16 }}>
          <div style={{ color: C.head, fontWeight: 720, fontSize: 15, marginBottom: 12 }}>Theo danh mục</div>
          <div style={{ display: "grid", gap: 8 }}>
            {byCat.slice(0, 10).map((c, i) => {
              const inc = c.type === "income";
              return (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                    <span style={{ color: C.body2 }}>
                      <span style={{ color: inc ? "#7CC7A2" : "#F1948A" }}>{inc ? "Thu" : "Chi"}</span> · {c.category}
                    </span>
                    <span style={{ color: C.body2, fontWeight: 700 }}>{fmtVnd(c.sum)}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,.06)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(c.sum / maxCat) * 100}%`, background: inc ? "#3BA55D" : "#E05353" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {byMonth.length > 0 && (
        <Card style={{ padding: 16 }}>
          <div style={{ color: C.head, fontWeight: 720, fontSize: 15, marginBottom: 12 }}>Theo tháng</div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", overflowX: "auto", paddingBottom: 4 }}>
            {byMonth.map((m) => (
              <div key={m.month} style={{ textAlign: "center", minWidth: 44 }}>
                <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 80, justifyContent: "center" }}>
                  <div title={`Thu ${fmtVnd(m.income)}`} style={{ width: 10, borderRadius: 4, background: "#3BA55D", height: `${Math.max(2, (m.income / maxMonth) * 80)}px` }} />
                  <div title={`Chi ${fmtVnd(m.expense)}`} style={{ width: 10, borderRadius: 4, background: "#E05353", height: `${Math.max(2, (m.expense / maxMonth) * 80)}px` }} />
                </div>
                <div style={{ color: C.muted, fontSize: 10.5, marginTop: 5 }}>{m.month.slice(5)}/{m.month.slice(2, 4)}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12, color: C.muted }}>
            <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: "#3BA55D", marginRight: 5 }} />Thu</span>
            <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: "#E05353", marginRight: 5 }} />Chi</span>
          </div>
        </Card>
      )}
    </div>
  );
}

/* =============================== MEMBERS =============================== */
const roleBadge = (role) => {
  if (role === "owner") return { label: "Chủ CLB", color: "#F0C24B", bg: "rgba(240,194,75,.10)", bd: "rgba(240,194,75,.3)", icon: <Star size={11} /> };
  if (role === "admin") return { label: "Quản trị", color: "#9CC1FF", bg: "rgba(61,135,255,.12)", bd: "rgba(61,135,255,.3)", icon: <ShieldCheck size={11} /> };
  return { label: "Thành viên", color: C.body2, bg: "rgba(255,255,255,.06)", bd: "rgba(255,255,255,.08)", icon: null };
};

// chip điểm trình (đôi/đơn) từ user.score
function ScoreChips({ user }) {
  const s = user?.score;
  const dbl = Number(s?.double || 0);
  const sgl = Number(s?.single || 0);
  if (!dbl && !sgl) return null;
  return (
    <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
      {dbl > 0 && (
        <span style={{ ...chip, fontSize: 11, padding: "2px 8px", color: "#9CC1FF", background: "rgba(61,135,255,.12)", borderColor: "rgba(61,135,255,.3)" }}>
          Đôi {dbl.toFixed(3)}
        </span>
      )}
      {sgl > 0 && (
        <span style={{ ...chip, fontSize: 11, padding: "2px 8px", color: "#7CC7A2", background: "rgba(59,165,93,.10)", borderColor: "rgba(59,165,93,.32)" }}>
          Đơn {sgl.toFixed(3)}
        </span>
      )}
    </div>
  );
}

function MembersTab({ club, canSeeMembers, guardMsg }) {
  const id = club._id;
  const my = club?._my || {};
  const canManage = !!my.canManage;
  const isOwner = my.membershipRole === "owner" || my.isOwner;
  const authIdA = useSelector((s) => s.auth?.userInfo?._id);
  const authIdB = useSelector((s) => s.user?.userInfo?._id);
  const authUserId = authIdA || authIdB || null;

  const { data, isLoading } = useListMembersQuery({ id }, { skip: !id || !canSeeMembers });
  const [showBanned, setShowBanned] = useState(false);
  const { data: bannedData } = useListMembersQuery(
    { id, params: { status: "banned" } },
    { skip: !id || !canManage || !showBanned }
  );
  const [addMember, { isLoading: adding }] = useAddMemberMutation();
  const [setRole] = useSetRoleMutation();
  const [kickMember] = useKickMemberMutation();
  const [banMember] = useBanMemberMutation();
  const [unbanMember] = useUnbanMemberMutation();
  const [addKey, setAddKey] = useState("");

  const members = data?.items || [];
  const banned = bannedData?.items || [];

  const canToggleRole = (targetRole) => {
    if (!canManage) return false;
    if (targetRole === "owner") return false;
    if (isOwner) return true;
    return targetRole === "member";
  };
  const canModerate = (targetRole, targetUserId) => {
    if (!canManage) return false;
    if (String(targetUserId) === String(authUserId)) return false;
    if (targetRole === "owner") return false;
    if (isOwner) return true;
    return targetRole === "member";
  };

  const doAdd = async () => {
    const key = addKey.trim();
    if (!key) return toast.info("Nhập nickname hoặc email để thêm thành viên.");
    try {
      await addMember({ id, nickname: key, role: "member" }).unwrap();
      toast.success("Đã thêm thành viên.");
      setAddKey("");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const doToggle = async (m) => {
    const newRole = m.role === "admin" ? "member" : "admin";
    try {
      await setRole({ id, userId: m.user?._id, role: newRole }).unwrap();
      toast.success(newRole === "admin" ? "Đã phong quản trị." : "Đã bỏ quyền quản trị.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const doKick = async (m) => {
    if (!window.confirm(`Xoá "${m.user?.fullName || m.user?.nickname || m.user?.email}" khỏi CLB?`)) return;
    try {
      await kickMember({ id, userId: m.user?._id }).unwrap();
      toast.success("Đã xoá thành viên.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const doBan = async (m) => {
    if (!window.confirm(`Cấm "${m.user?.fullName || m.user?.nickname || m.user?.email}" khỏi CLB? Người này sẽ không thể tự tham gia lại.`)) return;
    try {
      await banMember({ id, userId: m.user?._id }).unwrap();
      toast.success("Đã cấm thành viên.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };
  const doUnban = async (m) => {
    try {
      await unbanMember({ id, userId: m.user?._id }).unwrap();
      toast.success("Đã bỏ cấm.");
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  const memberCard = (m) => {
    const rb = roleBadge(m.role);
    const primary = m.user?.nickname || m.user?.fullName || m.user?.email || "Người dùng";
    const secondary = m.user?.nickname && m.user?.fullName ? m.user.fullName : null;
    const showToggle = canToggleRole(m.role);
    const showMod = canModerate(m.role, m.user?._id);
    return (
      <Card key={m._id} style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <A href={`/user/${m.user?._id}`} style={{ flexShrink: 0 }}>
            <Avatar size="medium" src={m.user?.avatar || undefined} name={m.user?.fullName || primary} />
          </A>
          <div style={{ flex: 1, minWidth: 0 }}>
            <A
              href={`/user/${m.user?._id}`}
              style={{
                display: "block",
                color: C.head,
                fontWeight: 700,
                fontSize: 14.5,
                textDecoration: "none",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {primary}
            </A>
            <div style={{ color: C.muted, fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {secondary || `Tham gia ${fmtDate(m.joinedAt)}`}
            </div>
          </div>
          <span style={{ ...chip, color: rb.color, background: rb.bg, borderColor: rb.bd, flexShrink: 0 }}>
            {rb.icon}
            {rb.label}
          </span>
        </div>
        <ScoreChips user={m.user} />
        {(showToggle || showMod) && (
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {showToggle && (
              <Btn variant="ghost" size="sm" onClick={() => doToggle(m)}>
                {m.role === "admin" ? "Bỏ quản trị" : "Phong quản trị"}
              </Btn>
            )}
            {showMod && (
              <>
                <Btn variant="ghost" size="sm" onClick={() => doBan(m)}>
                  <Ban size={14} /> Cấm
                </Btn>
                <Btn variant="danger" size="sm" onClick={() => doKick(m)}>
                  <Trash2 size={14} /> Xoá
                </Btn>
              </>
            )}
          </div>
        )}
      </Card>
    );
  };

  if (!canSeeMembers) {
    return <SectionEmpty icon={<Users size={40} />} title="Danh sách thành viên bị ẩn" hint={guardMsg} />;
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {canManage && (
        <Card style={{ padding: 16 }}>
          <label style={labelStyle}>Thêm thành viên (nickname hoặc email)</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              style={{ ...fieldStyle, flex: 1, minWidth: 200 }}
              value={addKey}
              onChange={(e) => setAddKey(e.target.value)}
              placeholder="vd: giangng hoặc giang@example.com"
              onKeyDown={(e) => e.key === "Enter" && doAdd()}
            />
            <Btn variant="primary" onClick={doAdd} disabled={adding}>
              <UserPlus size={15} /> Thêm
            </Btn>
          </div>
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: C.muted, fontSize: 12 }}>
              Chủ CLB thao tác được với tất cả; quản trị chỉ thao tác với thành viên thường.
            </span>
            <Btn variant="ghost" size="sm" onClick={() => setShowBanned((v) => !v)}>
              {showBanned ? "Ẩn danh sách bị cấm" : "Danh sách bị cấm"}
            </Btn>
          </div>
        </Card>
      )}

      {canManage && showBanned && (
        <Card style={{ padding: 16, borderColor: "rgba(233,84,84,.28)" }}>
          <div style={{ color: "#F1948A", fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
            Thành viên bị cấm ({banned.length})
          </div>
          {banned.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13 }}>Không có thành viên nào bị cấm.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {banned.map((m) => (
                <div key={m._id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar size="small" src={m.user?.avatar || undefined} name={m.user?.fullName || "?"} />
                  <span style={{ flex: 1, color: C.body, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.user?.nickname || m.user?.fullName || m.user?.email || "Người dùng"}
                  </span>
                  <Btn variant="success" size="sm" onClick={() => doUnban(m)}>
                    <UserCheck size={14} /> Bỏ cấm
                  </Btn>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {[...Array(4)].map((_, i) => (
            <Card key={i} style={{ padding: 14 }}>
              <Skeleton width="60%" height="16px" />
            </Card>
          ))}
        </div>
      ) : members.length === 0 ? (
        <SectionEmpty icon={<Users size={40} />} title="Chưa có thành viên nào" />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {members.map((m) => memberCard(m))}
        </div>
      )}
    </div>
  );
}

/* ============================ member visibility ============================ */
function calcCanSeeMembers(club, my) {
  const vis = club?.memberVisibility || "admins";
  const canManage = !!my?.canManage;
  const isMember = !!my?.isMember || my?.membershipRole === "owner" || my?.membershipRole === "admin";
  if (vis === "admins") return canManage;
  if (vis === "members") return isMember || canManage;
  if (vis === "public") return true;
  return false;
}
function memberGuardMessage(club) {
  const vis = club?.memberVisibility || "admins";
  if (vis === "admins") return "Chỉ ban quản trị mới xem được danh sách thành viên.";
  if (vis === "members") return "Chỉ thành viên CLB mới xem được danh sách thành viên.";
  return "Danh sách thành viên hiện không khả dụng.";
}

/* ================================ TABS bar ================================ */
const TABS = [
  { key: "news", label: "Bảng tin", icon: Megaphone },
  { key: "discussion", label: "Thảo luận", icon: MessagesSquare },
  { key: "events", label: "Sự kiện", icon: CalendarDays },
  { key: "polls", label: "Bình chọn", icon: BarChart3 },
  { key: "gallery", label: "Ảnh", icon: Images },
  { key: "finance", label: "Quỹ", icon: Wallet },
  { key: "members", label: "Thành viên", icon: Users },
];

/* ================================= PAGE ================================= */
export default function ClubDetailPageAstryx() {
  const { id } = useParams();
  const { data: club, isLoading, isError, error, refetch } = useGetClubQuery(id);
  const [searchParams, setSearchParams] = useSearchParams();

  const my = club?._my || null;
  const canManage = !!my?.canManage;
  const canSeeMembers = calcCanSeeMembers(club, my);

  const [openEdit, setOpenEdit] = useState(false);
  const [openJR, setOpenJR] = useState(false);

  const tabFromUrl = (searchParams.get("tab") || "").toLowerCase();
  const tab = TABS.some((tt) => tt.key === tabFromUrl) ? tabFromUrl : "news";
  const setTab = (v) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", v);
    setSearchParams(next);
  };

  // đếm số yêu cầu chờ (cho badge nút Duyệt) — chỉ khi có quyền
  const { data: jrData } = useListJoinRequestsCount(club?._id, canManage);
  const pendingCount = jrData?.total || 0;

  useRegisterChatBotPageSnapshot(
    useMemo(
      () => ({
        pageType: "club_detail",
        entityTitle: club?.name || "Câu lạc bộ",
        sectionTitle: TABS.find((tt) => tt.key === tab)?.label || "Bảng tin",
        pageSummary: club?.description || `Câu lạc bộ ${club?.name || ""}`.trim(),
        activeLabels: [
          TABS.find((tt) => tt.key === tab)?.label || "",
          my?.membershipRole ? `Vai trò: ${my.membershipRole}` : "Khách xem",
          canManage ? "Có quyền quản lý" : "",
        ].filter(Boolean),
      }),
      [club?.name, club?.description, tab, my?.membershipRole, canManage]
    )
  );

  const notFound = isError && (error?.status === 404 || error?.status === 500);

  return (
    <>
      <SEOHead
        title={club?.name || "Câu lạc bộ"}
        description={club?.description || `Câu lạc bộ pickleball ${club?.name || ""} trên PickleTour.`.trim()}
        ogImage={club?.coverUrl || club?.logoUrl}
        path={`/clubs/${club?._id || id}`}
        structuredData={
          club?._id
            ? [
                {
                  "@context": "https://schema.org",
                  "@type": "SportsTeam",
                  name: club?.name,
                  sport: "Pickleball",
                  description: club?.description || `Câu lạc bộ ${club?.name || ""}`.trim(),
                  logo: club?.logoUrl || "https://pickletour.vn/icon-192.png",
                  url: `https://pickletour.vn/clubs/${club?._id}`,
                },
                {
                  "@context": "https://schema.org",
                  "@type": "BreadcrumbList",
                  itemListElement: [
                    { "@type": "ListItem", position: 1, name: "Trang chủ", item: "https://pickletour.vn" },
                    { "@type": "ListItem", position: 2, name: "Câu lạc bộ", item: "https://pickletour.vn/clubs" },
                    { "@type": "ListItem", position: 3, name: club?.name || "Chi tiết", item: `https://pickletour.vn/clubs/${club?._id}` },
                  ],
                },
              ]
            : undefined
        }
      />
      <ShadowFrame style={{ minHeight: "100vh" }}>
        <Theme theme={neutralTheme}>
          <div style={{ minHeight: "100vh", background: C.bg }}>
            <SiteNav />

            {isLoading ? (
              <Container style={{ padding: "40px 24px" }}>
                <Skeleton width="100%" height="220px" />
                <div style={{ height: 20 }} />
                <Skeleton width="45%" height="30px" />
                <div style={{ height: 12 }} />
                <Skeleton width="80%" height="16px" />
              </Container>
            ) : notFound || !club?._id ? (
              <Container style={{ padding: "90px 24px" }}>
                <SectionEmpty
                  icon={<PickleMark size={44} />}
                  title="Không tìm thấy câu lạc bộ"
                  hint="CLB có thể đã bị xoá hoặc bạn không có quyền xem."
                />
                <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
                  <Btn href="/clubs" variant="ghost">
                    ← Về danh sách CLB
                  </Btn>
                </div>
              </Container>
            ) : (
              <>
                <Hero
                  club={club}
                  my={my}
                  joinCtl={<JoinControl club={club} my={my} />}
                  onEdit={() => setOpenEdit(true)}
                  onReview={() => setOpenJR(true)}
                  pendingCount={pendingCount}
                />

                {/* tabs sticky */}
                <div
                  style={{
                    position: "sticky",
                    top: 64,
                    zIndex: 15,
                    marginTop: 26,
                    background: "rgba(17,17,18,.82)",
                    backdropFilter: "saturate(160%) blur(12px)",
                    borderBottom: `1px solid ${C.border}`,
                    borderTop: `1px solid ${C.border}`,
                  }}
                >
                  <Container>
                    <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
                      {TABS.map((tt) => {
                        const active = tab === tt.key;
                        const Icon = tt.icon;
                        return (
                          <button
                            key={tt.key}
                            type="button"
                            onClick={() => setTab(tt.key)}
                            style={{
                              all: "unset",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 7,
                              padding: "14px 14px",
                              cursor: "pointer",
                              color: active ? C.head2 : C.muted,
                              fontWeight: active ? 750 : 600,
                              fontSize: 14,
                              borderBottom: `2px solid ${active ? "var(--color-brand, #3D87FF)" : "transparent"}`,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <Icon size={15} />
                            {tt.label}
                          </button>
                        );
                      })}
                    </div>
                  </Container>
                </div>

                <Container style={{ padding: "26px 24px 80px" }}>
                  {tab === "news" && <AnnouncementsTab club={club} canManage={canManage} />}
                  {tab === "discussion" && <DiscussionTab club={club} my={my} />}
                  {tab === "events" && <EventsTab club={club} canManage={canManage} />}
                  {tab === "polls" && <PollsTab club={club} canManage={canManage} />}
                  {tab === "gallery" && <GalleryTab club={club} my={my} />}
                  {tab === "finance" && <FinanceTab club={club} my={my} />}
                  {tab === "members" && (
                    <MembersTab club={club} canSeeMembers={canSeeMembers} guardMsg={memberGuardMessage(club)} />
                  )}
                </Container>
              </>
            )}

            <SiteFooter />
          </div>
        </Theme>
      </ShadowFrame>

      {/* Overlays MUI (portal — không bị theme Astryx ảnh hưởng) */}
      {club?._id && (
        <>
          <ClubCreateDialog
            open={openEdit}
            onClose={(ok) => {
              setOpenEdit(false);
              if (ok) {
                toast.success("Đã lưu thay đổi.");
                refetch();
              }
            }}
            initial={club}
          />
          <JoinRequestsDialog open={openJR} onClose={() => setOpenJR(false)} clubId={club._id} />
        </>
      )}
    </>
  );
}

/* helper query hook cho badge số yêu cầu chờ */
function useListJoinRequestsCount(clubId, enabled) {
  return useListJoinRequestsQuery(
    { id: clubId, params: { status: "pending", limit: 1 } },
    { skip: !clubId || !enabled }
  );
}
