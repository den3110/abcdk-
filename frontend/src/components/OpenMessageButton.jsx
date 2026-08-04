// components/OpenMessageButton.jsx
// Nút mở DM với 1 user. Bấm → gọi openDm(userId) → navigate /messages?c=<cid>.
import { Button, IconButton, Tooltip } from "@mui/material";
import { MessageCircle } from "lucide-react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import { useOpenDmMutation } from "../slices/messagesApiSlice.js";

export default function OpenMessageButton({
  userId,
  size = "small",
  compact = true,
  label = "Nhắn tin",
}) {
  const me = useSelector((s) => s.auth?.userInfo);
  const navigate = useNavigate();
  const [openDm, { isLoading }] = useOpenDmMutation();

  if (!me || !userId || String(userId) === String(me._id)) return null;

  const open = async () => {
    try {
      const conv = await openDm(userId).unwrap();
      navigate(`/messages?c=${conv._id}`);
    } catch (err) {
      toast.error(err?.data?.message || "Không mở được hội thoại");
    }
  };

  if (compact) {
    return (
      <Tooltip title={label}>
        <IconButton size={size} onClick={open} disabled={isLoading} color="primary">
          <MessageCircle size={size === "small" ? 16 : 20} />
        </IconButton>
      </Tooltip>
    );
  }
  return (
    <Button
      size={size}
      startIcon={<MessageCircle size={16} />}
      onClick={open}
      disabled={isLoading}
      variant="outlined"
      sx={{ textTransform: "none" }}
    >
      {label}
    </Button>
  );
}
