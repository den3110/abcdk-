/* eslint-disable react/prop-types */
import React, { useState } from "react";
import {
  Card,
  CardHeader,
  CardContent,
  Stack,
  Typography,
  Button,
  Chip,
  Avatar,
  Collapse,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { toast } from "react-toastify";
import dayjs from "dayjs";
import {
  useDeleteEventMutation,
  useRsvpEventMutation,
  useListEventAttendeesQuery,
} from "../../slices/clubsApiSlice";

const fmt = (s) => dayjs(s).format("HH:mm, DD/MM/YYYY");

const getApiErrMsg = (e) =>
  e?.data?.message ||
  e?.error ||
  (typeof e?.data === "string" ? e.data : "Có lỗi xảy ra.");

export default function EventCard({ clubId, event, canManage, onChanged, onEdit }) {
  const [rsvp, { isLoading: rsvping }] = useRsvpEventMutation();
  const [del, { isLoading: deleting }] = useDeleteEventMutation();

  const goingCount = event?.attendeesCount ?? event?.stats?.going ?? 0;
  const capacity = event?.capacity || 0;
  const myStatus = event?.myStatus || "none";
  const startAt = event?.startAt || event?.startTime;
  const endAt = event?.endAt || event?.endTime;

  const [showAttendees, setShowAttendees] = useState(false);
  const { data: attData, isFetching: loadingAtt } = useListEventAttendeesQuery(
    { id: clubId, eventId: event._id },
    { skip: !showAttendees },
  );
  const attendees = attData?.items || [];

  const handleRsvp = async (status) => {
    // bấm lại chính trạng thái hiện tại -> huỷ (none)
    const next = myStatus === status ? "none" : status;
    try {
      await rsvp({ id: clubId, eventId: event._id, status: next }).unwrap();
      toast.success(
        next === "going"
          ? "Đã RSVP tham gia"
          : next === "not_going"
            ? "Đã chọn không tham gia"
            : "Đã huỷ RSVP",
      );
      onChanged?.();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Xoá sự kiện này?")) return;
    try {
      await del({ id: clubId, eventId: event._id }).unwrap();
      toast.success("Đã xoá sự kiện");
      onChanged?.();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardHeader
        title={event.title}
        subheader={`${fmt(startAt)} – ${fmt(endAt)} • ${event.location || "—"}`}
        action={
          <Chip
            size="small"
            label={capacity ? `${goingCount}/${capacity}` : `${goingCount} tham gia`}
          />
        }
      />
      <CardContent>
        <Typography sx={{ mb: 2 }} color="text.secondary">
          {event.description || "—"}
        </Typography>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {/* RSVP — highlight trạng thái hiện tại của tôi */}
          <Button
            size="small"
            variant={myStatus === "going" ? "contained" : "outlined"}
            color="success"
            disabled={rsvping}
            onClick={() => handleRsvp("going")}
          >
            {myStatus === "going" ? "Sẽ tham gia ✓" : "Tham gia"}
          </Button>
          <Button
            size="small"
            variant={myStatus === "not_going" ? "contained" : "outlined"}
            color="inherit"
            disabled={rsvping}
            onClick={() => handleRsvp("not_going")}
          >
            Không tham gia
          </Button>

          {/* ICS */}
          <Button
            size="small"
            component="a"
            href={`/api/clubs/${clubId}/events/${event._id}/ics`}
          >
            Thêm vào lịch (.ics)
          </Button>

          {canManage && (
            <>
              <Button size="small" onClick={() => onEdit?.(event)}>
                Sửa
              </Button>
              <Button
                size="small"
                color="error"
                disabled={deleting}
                onClick={handleDelete}
              >
                Xoá
              </Button>
            </>
          )}
        </Stack>

        {/* Danh sách người tham gia */}
        {goingCount > 0 && (
          <>
            <Button
              size="small"
              sx={{ mt: 1, textTransform: "none" }}
              onClick={() => setShowAttendees((v) => !v)}
            >
              {showAttendees ? "Ẩn" : "Xem"} người tham gia ({goingCount})
            </Button>
            <Collapse in={showAttendees}>
              <Stack
                direction="row"
                spacing={1}
                flexWrap="wrap"
                useFlexGap
                sx={{ mt: 1 }}
              >
                {loadingAtt ? (
                  <Typography variant="caption" color="text.secondary">
                    Đang tải…
                  </Typography>
                ) : attendees.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    Chưa có ai.
                  </Typography>
                ) : (
                  attendees.map((u) => (
                    <Chip
                      key={u._id}
                      size="small"
                      component={RouterLink}
                      to={`/user/${u._id}`}
                      clickable
                      avatar={<Avatar src={u.avatar} />}
                      label={u.nickname || u.fullName || "Người dùng"}
                    />
                  ))
                )}
              </Stack>
            </Collapse>
          </>
        )}
      </CardContent>
    </Card>
  );
}
