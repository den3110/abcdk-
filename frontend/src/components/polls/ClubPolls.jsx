/* eslint-disable react/prop-types */
import React, { useState } from "react";
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
  RadioGroup,
  FormControlLabel,
  Radio,
} from "@mui/material";
import { toast } from "react-toastify";
import {
  useListPollsQuery,
  useCreatePollMutation,
  useVotePollMutation,
  useClosePollMutation,
} from "../../slices/clubsApiSlice";

const getApiErrMsg = (e) =>
  e?.data?.message ||
  e?.error ||
  (typeof e?.data === "string" ? e.data : "Có lỗi xảy ra.");

export default function ClubPolls({ club, canManage }) {
  const clubId = club?._id;
  const { data, isLoading, isFetching, refetch } = useListPollsQuery(
    { id: clubId },
    { skip: !clubId }
  );

  const [createPoll, { isLoading: creating }] = useCreatePollMutation();
  const [vote, { isLoading: voting }] = useVotePollMutation();
  const [closePoll, { isLoading: closing }] = useClosePollMutation();

  const [title, setTitle] = useState("");
  const [opts, setOpts] = useState(["", ""]);

  const items = data?.items || [];

  const addOption = () => setOpts((o) => [...o, ""]);
  const changeOpt = (i, v) =>
    setOpts((o) => o.map((x, idx) => (idx === i ? v : x)));

  const submit = async () => {
    const options = opts.map((s) => s.trim()).filter(Boolean);
    if (!title.trim() || options.length < 2) {
      return toast.info("Nhập tiêu đề và ít nhất 2 lựa chọn.");
    }
    try {
      await createPoll({ id: clubId, title, options }).unwrap();
      setTitle("");
      setOpts(["", ""]);
      toast.success("Đã tạo khảo sát");
      refetch();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  const doVote = async (poll, optionId) => {
    try {
      await vote({
        id: clubId,
        pollId: poll._id,
        optionIds: [optionId],
      }).unwrap();
      toast.success("Đã ghi nhận bình chọn");
      refetch();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };
  const doClose = async (poll) => {
    if (!window.confirm("Kết thúc khảo sát này?")) return;
    try {
      await closePoll({ id: clubId, pollId: poll._id }).unwrap();
      toast.success("Đã kết thúc khảo sát");
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
              <Stack direction="row" spacing={1}>
                <Button onClick={addOption}>Thêm lựa chọn</Button>
                <Button
                  variant="contained"
                  disabled={creating}
                  onClick={submit}
                >
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

      {items.map((p) => {
        const total =
          (p.options || []).reduce(
            (a, b) => a + (p.results?.[b.id || b._id] || 0),
            0
          ) || 0;
        const closed = !!p.closedAt;

        return (
          <Card key={p._id} variant="outlined" sx={{ borderRadius: 3 }}>
            <CardHeader
              title={p.title || p.question}
              subheader={new Date(p.createdAt).toLocaleString()}
            />
            <CardContent>
              <Stack spacing={1.5}>
                {!closed ? (
                  <>
                    {/* control theo nhóm */}
                    <RadioGroup
                      name={`poll-${p._id}`}
                      onChange={(_, val) => doVote(p, val)}
                    >
                      {(p.options || []).map((opt) => {
                        const oid = opt.id || opt._id; // <-- quan trọng
                        const votes = p.results?.[oid] || opt.votes || 0; // hỗ trợ cả 2 kiểu
                        return (
                          <Box
                            key={oid}
                            sx={{
                              p: 1,
                              borderRadius: 1,
                              bgcolor: "action.hover",
                            }}
                          >
                            <FormControlLabel
                              value={oid}
                              control={<Radio disabled={voting} />}
                              label={opt.text}
                            />
                            {total > 0 && (
                              <>
                                <LinearProgress
                                  variant="determinate"
                                  value={(votes * 100) / total}
                                />
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {votes} / {total}
                                </Typography>
                              </>
                            )}
                          </Box>
                        );
                      })}
                    </RadioGroup>

                    {canManage && (
                      <Button onClick={() => doClose(p)} disabled={closing}>
                        Kết thúc khảo sát
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    {(p.options || []).map((opt) => {
                      const oid = opt.id || opt._id;
                      const votes = p.results?.[oid] || opt.votes || 0;
                      return (
                        <Box key={oid} sx={{ p: 1 }}>
                          <Typography>{opt.text}</Typography>
                          <LinearProgress
                            variant="determinate"
                            value={(votes * 100) / (total || 1)}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {votes} / {total}
                          </Typography>
                        </Box>
                      );
                    })}
                    <Typography variant="caption" color="text.secondary">
                      Đã kết thúc
                    </Typography>
                  </>
                )}
              </Stack>
            </CardContent>
          </Card>
        );
      })}
      {!isLoading && !isFetching && items.length === 0 && (
        <Box sx={{ color: "text.secondary" }}>
          <Typography>Chưa có khảo sát nào.</Typography>
        </Box>
      )}
    </Stack>
  );
}
