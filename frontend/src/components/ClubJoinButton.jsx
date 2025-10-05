/* eslint-disable react/prop-types */
import React from "react";
import { Button, Stack } from "@mui/material";
import { toast } from "react-toastify";
import {
  useRequestJoinMutation,
  useCancelJoinMutation,
  useLeaveClubMutation,
} from "../slices/clubsApiSlice";

/**
 * Props:
 *  - club: object (đã fetch)
 *  - state: "not_member" | "pending" | "member"
 *  - onChanged?: (action: "joined"|"requested"|"canceled"|"left") => void
 */
const getApiErrMsg = (err) =>
  err?.data?.message ||
  err?.error ||
  (typeof err?.data === "string"
    ? err.data
    : "Có lỗi xảy ra, vui lòng thử lại.");

export default function ClubJoinButton({
  club,
  state = "not_member",
  onChanged,
}) {
  const [requestJoin, { isLoading: joining }] = useRequestJoinMutation();
  const [cancelJoin, { isLoading: canceling }] = useCancelJoinMutation();
  const [leaveClub, { isLoading: leaving }] = useLeaveClubMutation();

  if (!club?._id) return null;

  const handleRequestJoin = async () => {
    try {
      const res = await requestJoin({ id: club._id }).unwrap();
      // server: if joinPolicy === "open" => { joined: true }
      if (res?.joined) {
        toast.success("Bạn đã tham gia CLB!");
        onChanged && onChanged("joined");
      } else {
        toast.success("Đã gửi yêu cầu gia nhập.");
        onChanged && onChanged("requested");
      }
    } catch (err) {
      if (err?.status === 401) {
        toast.warn("Bạn cần đăng nhập để xin gia nhập CLB.");
      } else {
        toast.error(getApiErrMsg(err));
      }
    }
  };

  const handleCancelJoin = async () => {
    try {
      await cancelJoin({ id: club._id }).unwrap();
      toast.success("Đã huỷ yêu cầu gia nhập.");
      onChanged && onChanged("canceled");
    } catch (err) {
      if (err?.status === 401) {
        toast.warn("Bạn cần đăng nhập để huỷ yêu cầu.");
      } else {
        toast.error(getApiErrMsg(err));
      }
    }
  };

  const handleLeave = async () => {
    if (!window.confirm("Bạn chắc chắn muốn rời CLB?")) return;
    try {
      await leaveClub({ id: club._id }).unwrap();
      toast.success("Đã rời CLB.");
      onChanged && onChanged("left");
    } catch (err) {
      if (err?.status === 401) {
        toast.warn("Bạn cần đăng nhập để rời CLB.");
      } else {
        toast.error(getApiErrMsg(err));
      }
    }
  };

  if (state === "member") {
    return (
      <Button
        variant="outlined"
        color="error"
        disabled={leaving}
        onClick={handleLeave}
      >
        Rời CLB
      </Button>
    );
  }

  if (state === "pending") {
    return (
      <Stack direction="row" spacing={1}>
        <Button disabled>Đã gửi yêu cầu</Button>
        <Button
          variant="outlined"
          disabled={canceling}
          onClick={handleCancelJoin}
        >
          Huỷ yêu cầu
        </Button>
      </Stack>
    );
  }

  // not_member
  return (
    <Button variant="contained" disabled={joining} onClick={handleRequestJoin}>
      Xin gia nhập
    </Button>
  );
}
