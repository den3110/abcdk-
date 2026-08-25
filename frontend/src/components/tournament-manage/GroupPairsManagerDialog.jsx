// Quản lý cặp trong bảng SAU bốc thăm (giải vòng bảng):
//  - Thêm 1 cặp (đã đăng ký, chưa ở bảng nào) vào bảng bất kỳ → tự sinh trận vòng tròn.
//  - Chuyển 1 cặp sang bảng khác → xoá trận bảng cũ + tạo trận bảng mới.
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Stack,
  Typography,
  Chip,
  Select,
  MenuItem,
  Divider,
  Autocomplete,
  TextField,
  CircularProgress,
} from "@mui/material";
import { toast } from "react-toastify";

import {
  useGetRegistrationsQuery,
  useAddPairToGroupMutation,
  useMovePairBetweenGroupsMutation,
} from "../../slices/tournamentsApiSlice";

const nameOf = (p) =>
  (p?.nickName && String(p.nickName).trim()) ||
  (p?.fullName && String(p.fullName).trim()) ||
  "—";
const pairText = (r) => {
  if (!r) return "—";
  const a = nameOf(r.player1);
  const b = r.player2 ? nameOf(r.player2) : "";
  return b ? `${a} & ${b}` : a;
};

export default function GroupPairsManagerDialog({
  open,
  onClose,
  tourId,
  bracket,
}) {
  const { data: regs = [] } = useGetRegistrationsQuery(tourId, {
    skip: !tourId || !open,
  });
  const [addPair, { isLoading: adding }] = useAddPairToGroupMutation();
  const [movePair, { isLoading: moving }] = useMovePairBetweenGroupsMutation();

  const regById = useMemo(() => {
    const m = new Map();
    for (const r of regs) m.set(String(r._id), r);
    return m;
  }, [regs]);

  const groups = bracket?.groups || [];

  // regId nào đã ở trong 1 bảng bất kỳ
  const placed = useMemo(() => {
    const s = new Set();
    for (const g of groups)
      for (const id of g.regIds || []) s.add(String(id));
    return s;
  }, [groups]);

  // Cặp đã đăng ký nhưng chưa gán bảng
  const unassigned = useMemo(
    () =>
      regs.filter(
        (r) =>
          !placed.has(String(r._id)) &&
          (!r.status || r.status === "approved"),
      ),
    [regs, placed],
  );

  const [pickGroupId, setPickGroupId] = useState("");
  const [pickReg, setPickReg] = useState(null);

  const doAdd = async () => {
    if (!pickGroupId || !pickReg) return;
    try {
      const res = await addPair({
        bracketId: bracket._id,
        groupId: pickGroupId,
        regId: pickReg._id,
      }).unwrap();
      toast.success(`Đã thêm cặp + tạo ${res.created} trận.`);
      setPickReg(null);
    } catch (e) {
      toast.error(e?.data?.message || "Thêm cặp thất bại.");
    }
  };

  const doMove = async (regId, toGroupId) => {
    if (!toGroupId) return;
    try {
      const res = await movePair({
        bracketId: bracket._id,
        regId,
        toGroupId,
      }).unwrap();
      toast.success(`Đã chuyển bảng + tạo ${res.created} trận.`);
    } catch (e) {
      toast.error(e?.data?.message || "Chuyển bảng thất bại.");
    }
  };

  const busy = adding || moving;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Quản lý cặp trong bảng
        <Typography variant="body2" color="text.secondary">
          {bracket?.name || "Vòng bảng"} · thêm/chuyển cặp sau bốc thăm
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {/* Thêm cặp mới */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
            Thêm cặp vào bảng
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Autocomplete
              sx={{ flex: 1 }}
              options={unassigned}
              value={pickReg}
              onChange={(_, v) => setPickReg(v)}
              getOptionLabel={(o) =>
                `${pairText(o)}${o?.code ? ` · #${o.code}` : ""}`
              }
              isOptionEqualToValue={(o, v) => String(o._id) === String(v._id)}
              renderInput={(p) => (
                <TextField
                  {...p}
                  size="small"
                  label={`Cặp chưa gán bảng (${unassigned.length})`}
                  placeholder="Chọn cặp…"
                />
              )}
            />
            <Select
              size="small"
              displayEmpty
              value={pickGroupId}
              onChange={(e) => setPickGroupId(e.target.value)}
              sx={{ minWidth: 130 }}
            >
              <MenuItem value="">
                <em>Chọn bảng</em>
              </MenuItem>
              {groups.map((g, i) => (
                <MenuItem key={g._id} value={g._id}>
                  {g.name || `Bảng ${i + 1}`}
                </MenuItem>
              ))}
            </Select>
            <Button
              variant="contained"
              onClick={doAdd}
              disabled={busy || !pickGroupId || !pickReg}
              startIcon={adding ? <CircularProgress size={16} /> : null}
            >
              Thêm
            </Button>
          </Stack>
        </Box>

        <Divider sx={{ my: 1.5 }} />

        {/* Danh sách bảng + cặp */}
        {groups.length === 0 ? (
          <Typography color="text.secondary">Bracket chưa có bảng.</Typography>
        ) : (
          groups.map((g, gi) => (
            <Box key={g._id} sx={{ mb: 2 }}>
              <Chip
                label={`${g.name || `Bảng ${gi + 1}`} · ${(g.regIds || []).length} cặp`}
                size="small"
                color="primary"
                sx={{ fontWeight: 700, mb: 1 }}
              />
              <Stack spacing={1}>
                {(g.regIds || []).length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    (trống)
                  </Typography>
                )}
                {(g.regIds || []).map((rid) => {
                  const r = regById.get(String(rid));
                  return (
                    <Stack
                      key={String(rid)}
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{
                        px: 1,
                        py: 0.75,
                        borderRadius: 1,
                        border: "1px solid",
                        borderColor: "divider",
                      }}
                    >
                      <Typography sx={{ flex: 1, fontWeight: 600 }} noWrap>
                        {pairText(r)}
                      </Typography>
                      <Select
                        size="small"
                        displayEmpty
                        value=""
                        onChange={(e) => doMove(String(rid), e.target.value)}
                        disabled={busy}
                        sx={{ minWidth: 150 }}
                        renderValue={() => "Chuyển bảng…"}
                      >
                        {groups
                          .filter((gg) => String(gg._id) !== String(g._id))
                          .map((gg, idx) => (
                            <MenuItem key={gg._id} value={gg._id}>
                              → {gg.name || `Bảng ${idx + 1}`}
                            </MenuItem>
                          ))}
                      </Select>
                    </Stack>
                  );
                })}
              </Stack>
            </Box>
          ))
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
}
