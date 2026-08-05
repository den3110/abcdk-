// Nút Nhắn tin: mở DM (dùng lại openDm mutation) → navigate /messages?c=xxx
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Button, CircularProgress } from "@mui/material";
import { MessageCircle } from "lucide-react";

import { useOpenDmMutation } from "../../slices/messagesApiSlice.js";

export default function MessageActionButton({
  userId,
  size = "small",
  fullWidth = false,
}) {
  const me = useSelector((s) => s.auth?.userInfo);
  const navigate = useNavigate();
  const [openDm, { isLoading }] = useOpenDmMutation();

  if (!me || !userId || String(userId) === String(me._id)) return null;

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const conv = await openDm(userId).unwrap();
      navigate(`/messages?c=${conv._id}`);
    } catch {}
  };

  return (
    <Button
      size={size}
      variant="outlined"
      color="primary"
      fullWidth={fullWidth}
      disabled={isLoading}
      onClick={handleClick}
      startIcon={
        isLoading ? <CircularProgress size={12} /> : <MessageCircle size={14} />
      }
      sx={{ textTransform: "none", fontWeight: 600 }}
    >
      Nhắn tin
    </Button>
  );
}
