/* eslint-disable react/prop-types */
import React from "react";
import { Card, CardHeader, CardContent, Stack, Typography, Button, Chip } from "@mui/material";
import { toast } from "react-toastify";
import dayjs from "dayjs";
import { useDeleteEventMutation, useRsvpEventMutation } from "../../slices/clubsApiSlice";

const fmt = (s) => dayjs(s).format("HH:mm, DD/MM/YYYY");

const getApiErrMsg = (e) =>
  e?.data?.message || e?.error || (typeof e?.data === "string" ? e.data : "Có lỗi xảy ra.");

export default function EventCard({ clubId, event, canManage, onChanged }) {
  const [rsvp, { isLoading: rsvping }] = useRsvpEventMutation();
  const [del,  { isLoading: deleting }] = useDeleteEventMutation();

  const goingCount = event?.stats?.going || 0;
  const capacity = event?.capacity || 0;

  const handleRsvp = async (status) => {
    try {
      await rsvp({ id: clubId, eventId: event._id, status }).unwrap();
      toast.success(status === "going" ? "Đã RSVP tham gia" : status === "not_going" ? "Đã chọn không tham gia" : "Đã huỷ RSVP");
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
        subheader={`${fmt(event.startTime)} – ${fmt(event.endTime)} • ${event.location || "—"}`}
        action={capacity ? <Chip size="small" label={`${goingCount}/${capacity}`} /> : null}
      />
      <CardContent>
        <Typography sx={{ mb: 2 }} color="text.secondary">
          {event.description || "—"}
        </Typography>

        <Stack direction="row" spacing={1} flexWrap="wrap">
          {/* RSVP */}
          <Button size="small" variant="contained" disabled={rsvping} onClick={() => handleRsvp("going")}>
            Tham gia
          </Button>
          <Button size="small" disabled={rsvping} onClick={() => handleRsvp("not_going")}>
            Không tham gia
          </Button>
          <Button size="small" disabled={rsvping} onClick={() => handleRsvp("none")}>
            Huỷ RSVP
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
            <Button size="small" color="error" disabled={deleting} onClick={handleDelete}>
              Xoá
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}