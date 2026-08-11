// components/mlp/MlpPoolDrawDialog.jsx
// Dialog bốc thăm chia bảng cho MLP. Hỗ trợ 3 tab:
//   - Random: shuffle ngẫu nhiên (preview + confirm).
//   - Snake:  sort theo BXH/tên → snake seed.
//   - Manual: dropdown gán từng đội vào bảng.
// Live draw stage screen là feature riêng (route /tournament/:id/mlp/draw/live).
import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { Shuffle, Dice5, LayoutGrid } from "lucide-react";
import { toast } from "react-toastify";
import {
  useDrawMlpPoolsMutation,
  useListMlpPoolsQuery,
  useListMlpTeamsQuery,
  useResetMlpPoolsMutation,
} from "../../slices/mlpApiSlice";

function poolKeyFromIndex(idx) {
  if (!Number.isFinite(idx) || idx < 0) return null;
  let n = idx;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// Client-side helpers (mirror mlpPoolService)
function distributeRoundRobin(teamIds, poolCount) {
  const out = [];
  const seedCounter = new Array(poolCount).fill(0);
  for (let i = 0; i < teamIds.length; i++) {
    const poolIndex = i % poolCount;
    seedCounter[poolIndex] += 1;
    out.push({
      teamId: String(teamIds[i]),
      poolIndex,
      poolKey: poolKeyFromIndex(poolIndex),
      seed: seedCounter[poolIndex],
    });
  }
  return out;
}
function distributeSnake(teamIds, poolCount) {
  const out = [];
  const seedCounter = new Array(poolCount).fill(0);
  for (let i = 0; i < teamIds.length; i++) {
    const row = Math.floor(i / poolCount);
    const col = i % poolCount;
    const poolIndex = row % 2 === 0 ? col : poolCount - 1 - col;
    seedCounter[poolIndex] += 1;
    out.push({
      teamId: String(teamIds[i]),
      poolIndex,
      poolKey: poolKeyFromIndex(poolIndex),
      seed: seedCounter[poolIndex],
    });
  }
  return out;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function MlpPoolDrawDialog({ open, onClose, tour, onDrawn }) {
  const tid = tour?._id;
  const gs = tour?.mlpConfig?.groupStage || {};
  const [tab, setTab] = useState(0);
  const [poolCount, setPoolCount] = useState(gs.poolCount || 4);
  const [preview, setPreview] = useState([]); // [{teamId, poolIndex, poolKey, seed}]
  const [manualAssign, setManualAssign] = useState({}); // teamId → poolIndex
  const [drawing, setDrawing] = useState(false);
  const { data: teamsData, isLoading: teamsLoading } = useListMlpTeamsQuery(
    { tourId: tid, status: "approved" },
    { skip: !tid || !open },
  );
  const { data: poolsData } = useListMlpPoolsQuery(tid, { skip: !tid || !open });
  const [drawPools] = useDrawMlpPoolsMutation();
  const [resetPools] = useResetMlpPoolsMutation();

  const teams = useMemo(
    () => (teamsData?.items || []).filter((t) => t.status === "approved"),
    [teamsData],
  );
  const teamById = useMemo(
    () => new Map(teams.map((t) => [String(t._id), t])),
    [teams],
  );

  useEffect(() => {
    if (!open) return;
    setPoolCount(gs.poolCount || 4);
    // Init manual assign từ pool hiện có
    const init = {};
    for (const t of teams) {
      if (Number.isFinite(t.poolIndex)) init[String(t._id)] = t.poolIndex;
    }
    setManualAssign(init);
    setPreview([]);
    setTab(0);
  }, [open, gs.poolCount, teams.length]);

  const method = ["random", "snake", "manual"][tab] || "random";

  const runPreview = () => {
    if (!teams.length) return;
    const pc = Math.max(1, Math.min(32, Number(poolCount) || 4));
    if (method === "random") {
      const shuffled = shuffle(teams);
      setPreview(distributeRoundRobin(shuffled.map((t) => t._id), pc));
    } else if (method === "snake") {
      const sorted = teams.slice().sort((a, b) => {
        const wa = Number(a.standing?.wins) || 0;
        const wb = Number(b.standing?.wins) || 0;
        if (wa !== wb) return wb - wa;
        return String(a.name).localeCompare(String(b.name), "vi");
      });
      setPreview(distributeSnake(sorted.map((t) => t._id), pc));
    } else {
      // manual: build from state
      const seenPool = new Map();
      const arr = [];
      for (const t of teams) {
        const poolIndex = manualAssign[String(t._id)];
        if (!Number.isFinite(poolIndex)) continue;
        const nextSeed = (seenPool.get(poolIndex) || 0) + 1;
        seenPool.set(poolIndex, nextSeed);
        arr.push({
          teamId: String(t._id),
          poolIndex,
          poolKey: poolKeyFromIndex(poolIndex),
          seed: nextSeed,
        });
      }
      setPreview(arr);
    }
  };

  const groupedPreview = useMemo(() => {
    const map = new Map();
    for (const a of preview) {
      if (!map.has(a.poolKey)) {
        map.set(a.poolKey, { key: a.poolKey, index: a.poolIndex, items: [] });
      }
      map.get(a.poolKey).items.push({
        ...a,
        team: teamById.get(String(a.teamId)),
      });
    }
    return [...map.values()].sort((a, b) => a.index - b.index);
  }, [preview, teamById]);

  const handleCommit = async () => {
    if (!preview.length) {
      toast.error("Chưa có preview. Bấm 'Tạo bốc thăm' trước.");
      return;
    }
    setDrawing(true);
    try {
      let body;
      if (method === "manual") {
        body = {
          method: "manual",
          poolCount: Number(poolCount) || 4,
          assignments: preview.map((a) => ({
            teamId: a.teamId,
            poolIndex: a.poolIndex,
            seed: a.seed,
          })),
        };
      } else if (method === "snake") {
        // Backend chấp nhận seedOrder — dùng preview để suy ngược thứ tự
        // gốc (theo poolIndex + seed). Đơn giản: gửi manual assignments.
        body = {
          method: "manual",
          poolCount: Number(poolCount) || 4,
          assignments: preview.map((a) => ({
            teamId: a.teamId,
            poolIndex: a.poolIndex,
            seed: a.seed,
          })),
        };
      } else {
        // random — commit preview (client đã shuffle rồi để user xem)
        body = {
          method: "manual",
          poolCount: Number(poolCount) || 4,
          assignments: preview.map((a) => ({
            teamId: a.teamId,
            poolIndex: a.poolIndex,
            seed: a.seed,
          })),
        };
      }
      const r = await drawPools({ tid, ...body }).unwrap();
      toast.success(
        `Đã bốc thăm: ${r.updated} đội vào ${r.pools?.length || Number(poolCount)} bảng`,
      );
      onDrawn?.(r);
      onClose?.();
    } catch (err) {
      toast.error(err?.data?.message || "Bốc thăm thất bại");
    } finally {
      setDrawing(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("Xoá kết quả bốc thăm hiện tại?")) return;
    try {
      await resetPools(tid).unwrap();
      toast.success("Đã reset");
      setPreview([]);
      setManualAssign({});
      onDrawn?.({ reset: true });
    } catch (err) {
      toast.error(err?.data?.message || "Reset thất bại");
    }
  };

  const currentPools = poolsData?.pools || [];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Bốc thăm chia bảng</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            {teams.length} đội đã duyệt. Cấu hình:{" "}
            <b>{gs.poolCount || 4}</b> bảng × ~<b>{gs.poolSize || 4}</b> đội,
            top <b>{gs.topPerPool || 2}</b> vào knockout. Bảng lệch được cho
            phép.
          </Alert>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              size="small"
              label="Số bảng"
              type="number"
              value={poolCount}
              onChange={(e) =>
                setPoolCount(
                  Math.max(1, Math.min(32, Number(e.target.value) || 4)),
                )
              }
              inputProps={{ min: 1, max: 32 }}
              sx={{ width: 140 }}
            />
            {currentPools.length > 0 && (
              <Chip
                color="warning"
                label={`Hiện có ${currentPools.length} bảng đã bốc thăm — sẽ ghi đè`}
              />
            )}
          </Stack>

          <Tabs
            value={tab}
            onChange={(_, v) => {
              setTab(v);
              setPreview([]);
            }}
          >
            <Tab icon={<Dice5 size={16} />} iconPosition="start" label="Ngẫu nhiên" />
            <Tab icon={<Shuffle size={16} />} iconPosition="start" label="Snake seed" />
            <Tab icon={<LayoutGrid size={16} />} iconPosition="start" label="Xếp tay" />
          </Tabs>

          {tab === 0 && (
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              Xáo trộn ngẫu nhiên toàn bộ đội đã duyệt, chia đều vào các bảng.
              Bấm nhiều lần để thử phương án khác nhau trước khi commit.
            </Alert>
          )}
          {tab === 1 && (
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              Sort theo BXH (wins → tên) rồi rải hình rắn: A1, B1, C1, D1, D2,
              C2, B2, A2... Cân bằng chất lượng các bảng khi đã có kết quả cũ.
            </Alert>
          )}
          {tab === 2 && (
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              Chọn bảng cho từng đội bằng dropdown. Sau khi xong bấm "Tạo bốc
              thăm" để preview rồi commit.
            </Alert>
          )}

          {tab === 2 && (
            <Box
              sx={{
                maxHeight: 320,
                overflow: "auto",
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
                p: 1,
              }}
            >
              <Stack spacing={1}>
                {teams.map((t) => (
                  <Stack
                    key={t._id}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                  >
                    <Avatar
                      src={t.logo}
                      sx={{
                        width: 28,
                        height: 28,
                        bgcolor: t.color || "primary.main",
                        fontSize: 12,
                      }}
                    >
                      {t.shortName?.[0] || t.name?.[0]}
                    </Avatar>
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {t.name}
                    </Typography>
                    <Select
                      size="small"
                      value={
                        Number.isFinite(manualAssign[String(t._id)])
                          ? manualAssign[String(t._id)]
                          : ""
                      }
                      onChange={(e) =>
                        setManualAssign((prev) => ({
                          ...prev,
                          [String(t._id)]:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                        }))
                      }
                      displayEmpty
                      sx={{ minWidth: 120 }}
                    >
                      <MenuItem value="">(chưa gán)</MenuItem>
                      {Array.from({ length: Number(poolCount) || 4 }).map(
                        (_, i) => (
                          <MenuItem key={i} value={i}>
                            Bảng {poolKeyFromIndex(i)}
                          </MenuItem>
                        ),
                      )}
                    </Select>
                  </Stack>
                ))}
              </Stack>
            </Box>
          )}

          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              onClick={runPreview}
              disabled={teamsLoading || !teams.length}
            >
              Tạo bốc thăm (preview)
            </Button>
            {currentPools.length > 0 && (
              <Button color="warning" onClick={handleReset}>
                Reset bốc thăm hiện tại
              </Button>
            )}
          </Stack>

          {preview.length > 0 && (
            <>
              <Divider />
              <Typography variant="body2" fontWeight={800}>
                Preview kết quả bốc thăm
              </Typography>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "1fr 1fr",
                    md: "repeat(4, 1fr)",
                  },
                  gap: 1.5,
                }}
              >
                {groupedPreview.map((g) => (
                  <Box
                    key={g.key}
                    sx={{
                      p: 1.5,
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 2,
                      bgcolor: "background.default",
                    }}
                  >
                    <Typography variant="subtitle2" fontWeight={800}>
                      Bảng {g.key}
                    </Typography>
                    <Stack spacing={0.5} sx={{ mt: 1 }}>
                      {g.items.map((it) => (
                        <Stack
                          key={it.teamId}
                          direction="row"
                          spacing={1}
                          alignItems="center"
                        >
                          <Chip
                            size="small"
                            label={`#${it.seed}`}
                            variant="outlined"
                          />
                          <Avatar
                            src={it.team?.logo}
                            sx={{
                              width: 24,
                              height: 24,
                              bgcolor: it.team?.color || "primary.main",
                              fontSize: 11,
                            }}
                          >
                            {it.team?.shortName?.[0] || it.team?.name?.[0]}
                          </Avatar>
                          <Typography variant="body2" noWrap>
                            {it.team?.name}
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
        <Button
          variant="contained"
          onClick={handleCommit}
          disabled={drawing || preview.length === 0}
        >
          {drawing ? "Đang lưu..." : "Commit bốc thăm"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

MlpPoolDrawDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  tour: PropTypes.object,
  onDrawn: PropTypes.func,
};
