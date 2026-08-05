// Nút Kết bạn state-aware giống mobile: gửi/huỷ/chấp nhận/xoá bạn.
import { useState } from "react";
import { useSelector } from "react-redux";
import { Button, CircularProgress } from "@mui/material";
import { UserPlus, UserCheck, UserX, Users } from "lucide-react";

import {
  useFriendStatusQuery,
  useSendFriendRequestMutation,
  useAcceptFriendMutation,
  useDeclineFriendMutation,
  useRemoveFriendMutation,
} from "../../slices/friendsApiSlice.js";

export default function FriendActionButton({
  userId,
  size = "small",
  fullWidth = false,
}) {
  const me = useSelector((s) => s.auth?.userInfo);
  const isSelf = !userId || String(userId) === String(me?._id);
  const { data: status, isFetching } = useFriendStatusQuery(userId, {
    skip: !userId || isSelf || !me,
  });
  const [sendReq, { isLoading: sending }] = useSendFriendRequestMutation();
  const [accept, { isLoading: accepting }] = useAcceptFriendMutation();
  const [decline, { isLoading: declining }] = useDeclineFriendMutation();
  const [remove, { isLoading: removing }] = useRemoveFriendMutation();
  const [busy, setBusy] = useState(false);

  if (isSelf || !me) return null;

  const busyState =
    isFetching || sending || accepting || declining || removing || busy;

  // status shape (per backend): { relation: "none"|"self"|"outgoing"|"incoming"|"friends", edgeId? }
  const rel = status?.relation || "none";
  const edgeId = status?.edgeId;

  let label = "Kết bạn";
  let Icon = UserPlus;
  let variant = "contained";
  let onClick = async () => {
    setBusy(true);
    try {
      await sendReq(userId).unwrap();
    } catch {}
    setBusy(false);
  };

  if (rel === "outgoing") {
    label = "Huỷ lời mời";
    Icon = UserX;
    variant = "outlined";
    onClick = async () => {
      if (!edgeId) return;
      setBusy(true);
      try {
        await decline(edgeId).unwrap();
      } catch {}
      setBusy(false);
    };
  } else if (rel === "incoming") {
    label = "Chấp nhận";
    Icon = UserCheck;
    variant = "contained";
    onClick = async () => {
      if (!edgeId) return;
      setBusy(true);
      try {
        await accept(edgeId).unwrap();
      } catch {}
      setBusy(false);
    };
  } else if (rel === "friends") {
    label = "Bạn bè";
    Icon = Users;
    variant = "outlined";
    onClick = async () => {
      if (!edgeId) return;
      if (!window.confirm("Huỷ kết bạn?")) return;
      setBusy(true);
      try {
        await remove(edgeId).unwrap();
      } catch {}
      setBusy(false);
    };
  }

  return (
    <Button
      size={size}
      variant={variant}
      fullWidth={fullWidth}
      disabled={busyState}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      startIcon={busyState ? <CircularProgress size={12} /> : <Icon size={14} />}
      sx={{ textTransform: "none", fontWeight: 600 }}
    >
      {label}
    </Button>
  );
}
