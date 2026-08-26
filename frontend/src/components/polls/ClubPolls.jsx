/* eslint-disable react/prop-types */
import React, { useEffect, useMemo, useState } from "react";
import {
  Stack,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Button,
  TextField,
  Box,
  LinearProgress,
  FormControlLabel,
  Checkbox,
  Chip,
} from "@mui/material";
import { toast } from "react-toastify";
import {
  useListPollsQuery,
  useCreatePollMutation,
  useVotePollMutation,
  useClosePollMutation,
  useDeletePollMutation,
} from "../../slices/clubsApiSlice";

const getApiErrMsg = (e) =>
  e?.data?.message ||
  e?.error ||
  (typeof e?.data === "string" ? e.data : "Có lỗi xảy ra.");

function PollCard({ clubId, poll, canManage, onChanged }) {
  const [vote, { isLoading: voting }] = useVotePollMutation();
  const [closePoll, { isLoading: closing }] = useClosePollMutation();
  const [deletePoll] = useDeletePollMutation();

  const closed = !!poll.closesAt && new Date(poll.closesAt) < new Date();
  const people = Number(poll.voterCount || 0);
  const myOptionIds = poll.myOptionIds || [];
  const voted = myOptionIds.length > 0;

  const [sel, setSel] = useState(() => new Set(myOptionIds));
  useEffect(() => {
    setSel(new Set(poll.myOptionIds || []));
  }, [poll.myOptionIds]);

  const submitVote = async (optionIds) => {
    if (!optionIds.length) return toast.info("Chọn ít nhất một phương án.");
    try {
      await vote({ id: clubId, pollId: poll._id, optionIds }).unwrap();
      toast.success("Đã ghi nhận bình chọn");
      onChanged?.();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  const onPick = (oid) => {
    if (closed) return;
    if (poll.multiple) {
      setSel((prev) => {
        const next = new Set(prev);
        if (next.has(oid)) next.delete(oid);
        else next.add(oid);
        return next;
      });
    } else {
      submitVote([oid]);
    }
  };

  const doClose = async () => {
    if (!window.confirm("Đóng khảo sát này? Sẽ không nhận thêm phiếu.")) return;
    try {
      await closePoll({ id: clubId, pollId: poll._id }).unwrap();
      toast.success("Đã đóng khảo sát");
      onChanged?.();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };
  const doDelete = async () => {
    if (!window.confirm("Xoá khảo sát này? Toàn bộ phiếu sẽ bị xoá.")) return;
    try {
      await deletePoll({ id: clubId, pollId: poll._id }).unwrap();
      toast.success("Đã xoá khảo sát");
      onChanged?.();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardHeader
        title={poll.title || poll.question}
        subheader={`${people} người đã bình chọn • ${new Date(
          poll.createdAt,
        ).toLocaleDateString()}`}
        action={
          <Stack direction="row" spacing={1} alignItems="center">
            {poll.multiple && <Chip size="small" label="Nhiều lựa chọn" />}
            {closed && <Chip size="small" color="default" label="Đã đóng" />}
          </Stack>
        }
      />
      <CardContent>
        <Stack spacing={1.25}>
          {(poll.options || []).map((opt) => {
            const oid = opt.id || opt._id;
            const votes = poll.results?.[oid] ?? opt.votes ?? 0;
            const pct = people > 0 ? Math.round((votes / people) * 100) : 0;
            const picked = poll.multiple ? sel.has(oid) : myOptionIds.includes(oid);
            const isMyVote = myOptionIds.includes(oid);
            return (
              <Box
                key={oid}
                onClick={() => onPick(oid)}
                sx={{
                  p: 1,
                  borderRadius: 1.5,
                  border: "1px solid",
                  borderColor: picked ? "primary.main" : "divider",
                  bgcolor: isMyVote ? "action.selected" : "action.hover",
                  cursor: closed ? "default" : "pointer",
                }}
              >
                <FormControlLabel
                  sx={{ pointerEvents: "none", m: 0 }}
                  control={
                    <Checkbox
                      size="small"
                      checked={picked}
                      disabled={voting}
                      sx={{ p: 0.5, mr: 0.5 }}
                    />
                  }
                  label={
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: isMyVote ? 700 : 400 }}
                    >
                      {opt.text}
                    </Typography>
                  }
                />
                <LinearProgress
                  variant="determinate"
                  value={pct}
                  sx={{ mt: 0.5, borderRadius: 1 }}
                />
                <Typography variant="caption" color="text.secondary">
                  {pct}% • {votes} phiếu
                </Typography>
              </Box>
            );
          })}

          {poll.multiple && !closed && (
            <Box>
              <Button
                variant="contained"
                size="small"
                disabled={voting}
                onClick={() => submitVote([...sel])}
              >
                {voted ? "Đổi phiếu" : "Bình chọn"}
              </Button>
            </Box>
          )}
          {voted && !closed && (
            <Typography variant="caption" color="text.secondary">
              Bạn đã bình chọn
            </Typography>
          )}

          {canManage && (
            <Stack direction="row" spacing={1}>
              {!closed && (
                <Button size="small" onClick={doClose} disabled={closing}>
                  Đóng khảo sát
                </Button>
              )}
              <Button size="small" color="error" onClick={doDelete}>
                Xoá
              </Button>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function ClubPolls({ club, canManage }) {
  const clubId = club?._id;
  const { data, isLoading, isFetching, refetch } = useListPollsQuery(
    { id: clubId },
    { skip: !clubId },
  );

  const [createPoll, { isLoading: creating }] = useCreatePollMutation();

  const [title, setTitle] = useState("");
  const [opts, setOpts] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);

  const items = useMemo(() => data?.items || [], [data]);

  const addOption = () => setOpts((o) => [...o, ""]);
  const changeOpt = (i, v) =>
    setOpts((o) => o.map((x, idx) => (idx === i ? v : x)));

  const submit = async () => {
    const options = opts.map((s) => s.trim()).filter(Boolean);
    if (!title.trim() || options.length < 2) {
      return toast.info("Nhập tiêu đề và ít nhất 2 lựa chọn.");
    }
    try {
      await createPoll({ id: clubId, title, options, multiple }).unwrap();
      setTitle("");
      setOpts(["", ""]);
      setMultiple(false);
      toast.success("Đã tạo khảo sát");
      refetch();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  return (
    <Stack spacing={2}>
      {canManage && (
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Stack spacing={1.5}>
              <TextField
                label="Tiêu đề khảo sát"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              {opts.map((v, i) => (
                <TextField
                  key={i}
                  label={`Lựa chọn #${i + 1}`}
                  value={v}
                  onChange={(e) => changeOpt(i, e.target.value)}
                />
              ))}
              <FormControlLabel
                control={
                  <Checkbox
                    checked={multiple}
                    onChange={(e) => setMultiple(e.target.checked)}
                  />
                }
                label="Cho phép chọn nhiều phương án"
              />
              <Stack direction="row" spacing={1}>
                <Button onClick={addOption}>Thêm lựa chọn</Button>
                <Button variant="contained" disabled={creating} onClick={submit}>
                  Tạo khảo sát
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      {(isLoading || isFetching) && (
        <Typography color="text.secondary">Đang tải khảo sát…</Typography>
      )}

      {items.map((p) => (
        <PollCard
          key={p._id}
          clubId={clubId}
          poll={p}
          canManage={canManage}
          onChanged={refetch}
        />
      ))}

      {!isLoading && !isFetching && items.length === 0 && (
        <Box sx={{ color: "text.secondary" }}>
          <Typography>Chưa có khảo sát nào.</Typography>
        </Box>
      )}
    </Stack>
  );
}
