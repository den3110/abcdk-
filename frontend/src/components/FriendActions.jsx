// components/FriendActions.jsx
// Nút Kết bạn / Huỷ / Chấp nhận / Bạn bè (unfriend) cho 1 user.
import { useState } from "react";
import { Button, CircularProgress, IconButton, Menu, MenuItem, Tooltip } from "@mui/material";
import { UserPlus, UserCheck, UserX, Users, MoreVertical } from "lucide-react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";

import {
  useFriendStatusQuery,
  useSendFriendRequestMutation,
  useAcceptFriendMutation,
  useDeclineFriendMutation,
  useRemoveFriendMutation,
} from "../slices/friendsApiSlice.js";

export default function FriendActions({ userId, size = "small", compact = false }) {
  const me = useSelector((s) => s.auth?.userInfo);
  const [anchor, setAnchor] = useState(null);
  const { data, isFetching } = useFriendStatusQuery(userId, { skip: !me || !userId });
  const [sendReq, { isLoading: sending }] = useSendFriendRequestMutation();
  const [accept, { isLoading: accepting }] = useAcceptFriendMutation();
  const [decline] = useDeclineFriendMutation();
  const [remove, { isLoading: removing }] = useRemoveFriendMutation();

  if (!me || !userId) return null;
  if (data?.status === "self") return null;

  const status = data?.status || "none";

  const doSend = async () => {
    try {
      await sendReq(userId).unwrap();
      toast.success("Đã gửi lời mời kết bạn");
    } catch (err) {
      toast.error(err?.data?.message || "Không gửi được");
    }
  };
  const doCancel = async () => {
    try {
      await remove(data.edgeId).unwrap();
      toast.info("Đã huỷ lời mời");
    } catch (err) {
      toast.error(err?.data?.message || "Không huỷ được");
    }
  };
  const doAccept = async () => {
    try {
      await accept(data.edgeId).unwrap();
      toast.success("Đã kết bạn");
    } catch (err) {
      toast.error(err?.data?.message || "Không chấp nhận được");
    }
  };
  const doDecline = async () => {
    try {
      await decline(data.edgeId).unwrap();
    } catch (err) {
      toast.error(err?.data?.message || "Không từ chối được");
    }
  };
  const doUnfriend = async () => {
    if (!window.confirm("Huỷ kết bạn với người này?")) return;
    try {
      await remove(data.edgeId).unwrap();
      toast.info("Đã huỷ kết bạn");
    } catch (err) {
      toast.error(err?.data?.message || "Không huỷ được");
    }
  };

  if (isFetching && !data) {
    return <CircularProgress size={16} />;
  }

  if (status === "none" || status === "declined") {
    return compact ? (
      <Tooltip title="Kết bạn">
        <IconButton onClick={doSend} disabled={sending} size={size}>
          <UserPlus size={16} />
        </IconButton>
      </Tooltip>
    ) : (
      <Button
        size={size}
        startIcon={<UserPlus size={16} />}
        onClick={doSend}
        disabled={sending}
        variant="contained"
        sx={{ textTransform: "none" }}
      >
        Kết bạn
      </Button>
    );
  }

  if (status === "pending_outgoing") {
    return (
      <Button
        size={size}
        variant="outlined"
        onClick={doCancel}
        disabled={removing}
        sx={{ textTransform: "none" }}
      >
        Huỷ lời mời
      </Button>
    );
  }

  if (status === "pending_incoming") {
    return (
      <>
        <Button
          size={size}
          startIcon={<UserCheck size={16} />}
          onClick={doAccept}
          disabled={accepting}
          variant="contained"
          color="success"
          sx={{ textTransform: "none", mr: 0.5 }}
        >
          Chấp nhận
        </Button>
        {!compact && (
          <Button
            size={size}
            startIcon={<UserX size={16} />}
            onClick={doDecline}
            variant="text"
            color="error"
            sx={{ textTransform: "none" }}
          >
            Từ chối
          </Button>
        )}
      </>
    );
  }

  if (status === "accepted") {
    return (
      <>
        <Button
          size={size}
          startIcon={<Users size={16} />}
          variant="outlined"
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ textTransform: "none" }}
        >
          Bạn bè
        </Button>
        <Menu
          anchorEl={anchor}
          open={!!anchor}
          onClose={() => setAnchor(null)}
        >
          <MenuItem
            onClick={() => {
              setAnchor(null);
              doUnfriend();
            }}
            sx={{ color: "error.main" }}
          >
            Huỷ kết bạn
          </MenuItem>
        </Menu>
      </>
    );
  }

  return null;
}
