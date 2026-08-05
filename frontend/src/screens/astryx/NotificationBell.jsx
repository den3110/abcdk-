// Notification bell cho SiteNav — dropdown 5 thông báo mới nhất + badge unread.
// Realtime qua socket "notification:new" (mobile cũng emit sự kiện này).
import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";

import {
  useListNotifsQuery,
  useNotifUnreadCountQuery,
  useMarkNotifReadMutation,
  useMarkAllNotifReadMutation,
  notificationCenterApiSlice,
} from "../../slices/notificationCenterApiSlice.js";
import { socket } from "../../lib/socket.js";

const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "vừa xong";
  if (diff < 3600) return `${Math.floor(diff / 60)}p`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}n`;
  return d.toLocaleDateString("vi-VN");
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { data: unreadData, refetch: refetchCount } = useNotifUnreadCountQuery(
    undefined,
    {
      skip: !userInfo,
      pollingInterval: 60000, // fallback poll 1p, socket sẽ update ngay khi có
    }
  );
  const { data, refetch, isLoading } = useListNotifsQuery(
    { limit: 8 },
    { skip: !userInfo || !open }
  );
  const [markRead] = useMarkNotifReadMutation();
  const [markAllRead] = useMarkAllNotifReadMutation();

  const unreadCount = Number(unreadData?.count || 0);

  // Socket realtime: nghe "notification:new" cho user hiện tại
  useEffect(() => {
    if (!userInfo?._id) return;
    if (!socket.connected) {
      try {
        socket.connect();
      } catch {}
    }
    const onNew = (payload) => {
      // Optimistic: tăng count + prepend vào cache list nếu đã fetch
      dispatch(
        notificationCenterApiSlice.util.updateQueryData(
          "notifUnreadCount",
          undefined,
          (draft) => {
            if (draft) draft.count = (draft.count || 0) + 1;
            else return { count: 1 };
          }
        )
      );
      dispatch(
        notificationCenterApiSlice.util.updateQueryData(
          "listNotifs",
          { limit: 8 },
          (draft) => {
            if (!draft?.items) return;
            if (
              !draft.items.find((i) => String(i._id) === String(payload?._id))
            ) {
              draft.items.unshift(payload);
              draft.items = draft.items.slice(0, 8);
            }
          }
        )
      );
    };
    socket.on("notification:new", onNew);
    return () => socket.off("notification:new", onNew);
  }, [userInfo?._id, dispatch]);

  const handleClickItem = useCallback(
    async (n) => {
      setOpen(false);
      if (!n.isRead) {
        try {
          await markRead(n._id).unwrap();
        } catch {}
        refetchCount();
      }
      if (n.url) navigate(n.url);
      else navigate("/notifications");
    },
    [markRead, navigate, refetchCount]
  );

  const handleMarkAllRead = async () => {
    try {
      await markAllRead().unwrap();
      refetch();
      refetchCount();
    } catch {}
  };

  if (!userInfo) return null;
  const items = data?.items || [];

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unreadCount > 0 ? `${unreadCount} thông báo chưa đọc` : "Thông báo"
        }
        style={{
          all: "unset",
          position: "relative",
          width: 36,
          height: 36,
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          color: "light-dark(#3D4247, #C6CACF)",
          border:
            "1px solid light-dark(rgba(0,0,0,.10), rgba(255,255,255,0.10))",
          background: open
            ? "light-dark(rgba(0,0,0,.06), rgba(255,255,255,0.08))"
            : "transparent",
        }}
      >
        <Bell size={17} strokeWidth={2.1} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 9,
              background: "#E41E3F",
              color: "#fff",
              fontSize: 10,
              fontWeight: 800,
              display: "grid",
              placeItems: "center",
              border: "2px solid light-dark(#fff, #111112)",
              lineHeight: 1,
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
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
              width: 380,
              maxWidth: "calc(100vw - 24px)",
              maxHeight: 480,
              display: "flex",
              flexDirection: "column",
              borderRadius: 14,
              background: "light-dark(#FFFFFF, #1C1D20)",
              border:
                "1px solid var(--color-border, rgba(255,255,255,0.09))",
              boxShadow:
                "0 24px 60px -18px light-dark(rgba(0,0,0,.2), rgba(0,0,0,.65))",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                borderBottom:
                  "1px solid light-dark(rgba(0,0,0,.08), rgba(255,255,255,0.08))",
              }}
            >
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 15,
                  color: "light-dark(#26282B, #E6E8EA)",
                }}
              >
                Thông báo
              </span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    color: "#1877F2",
                    fontSize: 12,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <CheckCheck size={13} /> Đánh dấu đã đọc tất cả
                </button>
              )}
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {isLoading && (
                <div style={{ padding: 24, textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
                  Đang tải…
                </div>
              )}
              {!isLoading && items.length === 0 && (
                <div style={{ padding: 32, textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
                  Chưa có thông báo nào
                </div>
              )}
              {items.map((n) => (
                <div
                  key={n._id}
                  onClick={() => handleClickItem(n)}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "10px 14px",
                    cursor: "pointer",
                    borderBottom:
                      "1px solid light-dark(rgba(0,0,0,.05), rgba(255,255,255,0.05))",
                    background: n.isRead
                      ? "transparent"
                      : "light-dark(rgba(24,119,242,0.06), rgba(69,153,255,0.10))",
                    alignItems: "flex-start",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "light-dark(rgba(0,0,0,.04), rgba(255,255,255,0.05))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = n.isRead
                      ? "transparent"
                      : "light-dark(rgba(24,119,242,0.06), rgba(69,153,255,0.10))";
                  }}
                >
                  {n.actor?.avatar ? (
                    <img
                      src={n.actor.avatar}
                      alt=""
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        objectFit: "cover",
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        background: "#0066FF",
                        color: "#fff",
                        display: "grid",
                        placeItems: "center",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {(
                        n.actor?.nickname ||
                        n.actor?.name ||
                        n.title ||
                        "?"
                      )[0]?.toUpperCase()}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: n.isRead ? 500 : 700,
                        color: "light-dark(#26282B, #E6E8EA)",
                        lineHeight: 1.35,
                      }}
                    >
                      {n.title || "Thông báo"}
                    </div>
                    {n.body && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "light-dark(#5A6068, #A0A6AD)",
                          marginTop: 2,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {n.body}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: 11,
                        color: n.isRead ? "#94A3B8" : "#1877F2",
                        marginTop: 4,
                        fontWeight: 600,
                      }}
                    >
                      {fmtTime(n.createdAt)}
                    </div>
                  </div>
                  {!n.isRead && (
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#1877F2",
                        marginTop: 6,
                        flexShrink: 0,
                      }}
                    />
                  )}
                </div>
              ))}
            </div>

            <div
              style={{
                padding: 10,
                borderTop:
                  "1px solid light-dark(rgba(0,0,0,.08), rgba(255,255,255,0.08))",
                textAlign: "center",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate("/notifications");
                }}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  color: "#1877F2",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Xem tất cả thông báo
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
