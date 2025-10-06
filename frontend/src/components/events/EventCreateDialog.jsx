/* eslint-disable react/prop-types */
import React, { useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Stack,
  Button,
  FormHelperText,
} from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import { toast } from "react-toastify";
import { useCreateEventMutation } from "../../slices/clubsApiSlice";

const getApiErrMsg = (e) =>
  e?.data?.message ||
  e?.error ||
  (typeof e?.data === "string" ? e.data : "Có lỗi xảy ra.");

export default function EventCreateDialog({ open, onClose, clubId }) {
  // Lưu dayjs object để thao tác tiện
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [capacity, setCapacity] = useState(0);

  const defaultStart = dayjs().add(1, "hour").startOf("hour");
  const defaultEnd = defaultStart.add(2, "hour");

  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);

  const [createEvent, { isLoading }] = useCreateEventMutation();

  // validate
  const errors = useMemo(() => {
    const e = {};
    if (!title.trim()) e.title = "Nhập tiêu đề sự kiện";
    if (!start || !dayjs(start).isValid()) e.start = "Chọn thời gian bắt đầu";
    if (!end || !dayjs(end).isValid()) e.end = "Chọn thời gian kết thúc";
    if (dayjs(start).isValid() && dayjs(end).isValid() && !end.isAfter(start)) {
      e.end = "Thời gian kết thúc phải sau thời gian bắt đầu";
    }
    if (capacity < 0) e.capacity = "Sức chứa không được âm";
    return e;
  }, [title, start, end, capacity]);

  const hasErrors = Object.keys(errors).length > 0;

  const submit = async () => {
    if (hasErrors) {
      toast.error(
        errors.title ||
          errors.start ||
          errors.end ||
          errors.capacity ||
          "Vui lòng kiểm tra lại thông tin"
      );
      return;
    }

    const startIso = start.toDate().toISOString();
    const endIso = end.toDate().toISOString();

    try {
      // Gửi cả startTime/endTime và startAt/endAt để tương thích backend
      await createEvent({
        id: clubId,
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        capacity: Number.isFinite(+capacity) ? +capacity : 0,
        startTime: startIso,
        endTime: endIso,
        startAt: startIso,
        endAt: endIso,
      }).unwrap();

      toast.success("Đã tạo sự kiện");
      onClose?.(true);
      // reset nếu muốn
      setTitle("");
      setDescription("");
      setLocation("");
      setCapacity(0);
      setStart(defaultStart);
      setEnd(defaultEnd);
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  // Bảo vệ UX: nếu người dùng chọn end < start thì auto đẩy end = start + 1h
  const handleStartChange = (val) => {
    const s = val;
    setStart(s);
    if (s && end && s.isValid() && end.isValid() && !end.isAfter(s)) {
      setEnd(s.add(1, "hour"));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => onClose?.(false)}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Tạo sự kiện</DialogTitle>
      <DialogContent dividers>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Tiêu đề"
              value={title}
              error={!!errors.title}
              helperText={errors.title || ""}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
            />

            <TextField
              label="Mô tả"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              minRows={3}
              fullWidth
            />

            <TextField
              label="Địa điểm"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              fullWidth
              placeholder="VD: Sân A, Nhà thi đấu Q.1…"
            />

            <DateTimePicker
              label="Bắt đầu"
              value={start}
              onChange={handleStartChange}
              slotProps={{
                textField: {
                  fullWidth: true,
                  error: !!errors.start,
                  helperText: errors.start || "",
                },
              }}
            />

            <DateTimePicker
              label="Kết thúc"
              value={end}
              onChange={(v) => setEnd(v)}
              slotProps={{
                textField: {
                  fullWidth: true,
                  error: !!errors.end,
                  helperText: errors.end || "",
                },
              }}
            />

            <TextField
              label="Sức chứa (0 = không giới hạn)"
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(Math.max(0, +e.target.value || 0))}
              error={!!errors.capacity}
              helperText={errors.capacity || ""}
              inputProps={{ min: 0 }}
            />

            <FormHelperText sx={{ mt: -1 }}>
              * Thời gian đang dùng múi giờ máy bạn; khi gửi sẽ chuyển sang ISO.
            </FormHelperText>
          </Stack>
        </LocalizationProvider>
      </DialogContent>

      <DialogActions>
        <Button onClick={() => onClose?.(false)}>Huỷ</Button>
        <Button
          variant="contained"
          disabled={isLoading || hasErrors}
          onClick={submit}
        >
          Tạo
        </Button>
      </DialogActions>
    </Dialog>
  );
}
