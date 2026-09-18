/* eslint-disable react/prop-types */
// components/mlp/MlpTeamPoolsDialog.jsx
// Dialog "Thêm / Chuyển đội" cho giải MLP — tương đương GroupPairsManagerDialog
// nhưng thao tác trên MlpTeam.poolKey thay vì Registration/group.
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
  Divider,
  CircularProgress,
  MenuItem,
  Select,
  Alert,
} from "@mui/material";
import { toast } from "react-toastify";
import {
  useListMlpTeamsQuery,
  usePatchMlpTeamPoolMutation,
  useGenerateMlpDualsMutation,
} from "../../slices/mlpApiSlice";

const nextLetter = (keys) => {
  if (!keys.length) return "A";
  return String.fromCharCode(65 + keys.length);
};

export default function MlpTeamPoolsDialog({ open, onClose, tourId }) {
  const { data: teamsResp, isFetching } = useListMlpTeamsQuery(
    { tourId, status: "approved" },
    { skip: !tourId || !open },
  );
  const teams = Array.isArray(teamsResp?.items) ? teamsResp.items : [];
  const [patchPool, { isLoading: patching }] = usePatchMlpTeamPoolMutation();
  const [genDuals, { isLoading: genning }] = useGenerateMlpDualsMutation();
  const [genDirty, setGenDirty] = useState(false);

  const poolMap = useMemo(() => {
    const m = {};
    for (const t of teams) {
      const k = t.poolKey || "__none__";
      (m[k] = m[k] || []).push(t);
    }
    return m;
  }, [teams]);
  const poolKeys = Object.keys(poolMap)
    .filter((k) => k !== "__none__")
    .sort();
  const unassigned = poolMap["__none__"] || [];
  const newKey = nextLetter(poolKeys);
  const choices = poolKeys.includes(newKey)
    ? poolKeys
    : [...poolKeys, newKey];

  const doMove = async (team, poolKey) => {
    try {
      await patchPool({
        tourId,
        teamId: team._id,
        poolKey,
      }).unwrap();
      setGenDirty(true);
      toast.success(poolKey ? `Đã chuyển "${team.name}" sang Bảng ${poolKey}` : `Đã đưa "${team.name}" ra khỏi bảng`);
    } catch (e) {
      toast.error(e?.data?.message || "Chuyển bảng thất bại");
    }
  };
  const doGen = async () => {
    try {
      await genDuals(tourId).unwrap();
      setGenDirty(false);
      toast.success("Đã sinh lại lịch dual matches");
    } catch (e) {
      toast.error(e?.data?.message || "Sinh lại dual thất bại");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Thêm / Chuyển đội (MLP)</DialogTitle>
      <DialogContent dividers>
        {isFetching ? (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <CircularProgress size={22} />
          </Box>
        ) : (
          <Stack spacing={2}>
            {genDirty && (
              <Alert
                severity="warning"
                action={
                  <Button
                    color="warning"
                    variant="contained"
                    onClick={doGen}
                    disabled={genning}
                    size="small"
                  >
                    {genning ? "Đang sinh..." : "Sinh lại lịch dual"}
                  </Button>
                }
              >
                Đã có thay đổi bảng — nhớ sinh lại lịch dual matches để cập
                nhật vòng bảng.
              </Alert>
            )}

            {poolKeys.map((k) => (
              <PoolBox
                key={k}
                title={`Bảng ${k}`}
                teams={poolMap[k]}
                choices={choices.filter((c) => c !== k)}
                onMove={doMove}
                onRemove={(tm) => doMove(tm, null)}
                patching={patching}
              />
            ))}

            <PoolBox
              title={`Chưa gán bảng (${unassigned.length})`}
              teams={unassigned}
              choices={choices}
              onMove={doMove}
              emptyText="Tất cả đội đã có bảng."
              patching={patching}
              highlight
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
}

function PoolBox({
  title,
  teams,
  choices,
  onMove,
  onRemove,
  emptyText,
  patching,
  highlight,
}) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: highlight ? "success.main" : "divider",
        borderRadius: 2,
        p: 1.5,
      }}
    >
      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
        {title}
      </Typography>
      {teams?.length ? (
        <Stack spacing={1}>
          {teams.map((tm) => (
            <TeamRow
              key={tm._id}
              team={tm}
              choices={choices}
              onMove={onMove}
              onRemove={onRemove}
              patching={patching}
            />
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {emptyText || "Chưa có đội."}
        </Typography>
      )}
    </Box>
  );
}

function TeamRow({ team, choices, onMove, onRemove, patching }) {
  const [target, setTarget] = useState("");
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ py: 0.5 }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={700} noWrap>
          {team.name}
        </Typography>
        {team.shortName ? (
          <Chip
            label={team.shortName}
            size="small"
            variant="outlined"
            sx={{ mt: 0.5 }}
          />
        ) : null}
      </Box>
      <Select
        size="small"
        displayEmpty
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        sx={{ minWidth: 150 }}
      >
        <MenuItem value="">-- chọn bảng --</MenuItem>
        {choices.map((k) => (
          <MenuItem key={k} value={k}>
            Bảng {k}
          </MenuItem>
        ))}
      </Select>
      <Button
        size="small"
        variant="contained"
        disabled={!target || patching}
        onClick={() => {
          onMove(team, target);
          setTarget("");
        }}
      >
        Chuyển
      </Button>
      {onRemove ? (
        <Button
          size="small"
          variant="text"
          color="error"
          disabled={patching}
          onClick={() => onRemove(team)}
        >
          Rời bảng
        </Button>
      ) : null}
    </Stack>
  );
}
