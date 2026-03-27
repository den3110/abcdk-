// src/pages/admin/components/BulkAssignRefDialog.jsx
/* eslint-disable react/prop-types */
import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Typography,
  Autocomplete,
  TextField,
  Checkbox,
  Avatar,
  Chip,
  Alert,
  Button,
  InputAdornment,
  CircularProgress,
} from "@mui/material";
import {
  HowToReg as RefereeIcon,
  Search as SearchIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";

// 💡 chỉnh lại path cho đúng với dự án của bạn
import {
  useListTournamentRefereesQuery,
  useBatchAssignRefereeMutation,
} from "../slices/refereeScopeApiSlice";

const idOfRef = (r) => String(r?._id ?? r?.id ?? "");
const labelOfRef = (r) =>
  r?.name ||
  r?.nickname ||
  r?.nickName ||
  r?.displayName ||
  (idOfRef(r) ? `#${idOfRef(r).slice(-4)}` : "");

function normalizeMatchIds(selectedMatchIds) {
  if (!selectedMatchIds) return [];
  if (selectedMatchIds instanceof Set) {
    return Array.from(selectedMatchIds).map(String).filter(Boolean);
  }
  if (Array.isArray(selectedMatchIds)) {
    return selectedMatchIds.map(String).filter(Boolean);
  }
  return [];
}

/**
 * BulkAssignRefDialog
 * - Tự call API lấy danh sách trọng tài của giải.
 * - Mỗi lần `open` chuyển từ false -> true sẽ refetch lại data.
 * - Gán trọng tài cho nhiều trận (matchIds) trong 1 lần.
 */
function BulkAssignRefDialog({
  open,
  onClose,
  tournamentId,
  selectedMatchIds,
  onAssigned, // callback: ví dụ refetchMatches ở ngoài
}) {
  const matchIds = useMemo(
    () => normalizeMatchIds(selectedMatchIds),
    [selectedMatchIds],
  );

  // Search nội bộ trong Autocomplete (client-side), nếu muốn server-search thì thêm q vào args
  const [keyword, setKeyword] = useState("");

  const {
    data: refData,
    isLoading: refsLoading,
    isFetching,
    error: refsErr,
    refetch,
  } = useListTournamentRefereesQuery(
    { tid: tournamentId },
    {
      skip: !open || !tournamentId,
    },
  );

  // Mỗi lần mở dialog → refetch lại danh sách trọng tài
  useEffect(() => {
    if (open && tournamentId) {
      refetch?.();
    }
  }, [open, tournamentId, refetch]);

  // Chuẩn hoá danh sách trọng tài
  const refOptions = useMemo(() => {
    if (!refData) return [];
    if (Array.isArray(refData.items)) return refData.items;
    if (Array.isArray(refData)) return refData;
    return [];
  }, [refData]);

  // State chọn trọng tài (lưu cả object để Autocomplete dễ xử lý)
  const [pickedRefs, setPickedRefs] = useState([]);

  // Reset khi đóng
  useEffect(() => {
    if (!open) {
      setPickedRefs([]);
      setKeyword("");
    }
  }, [open]);

  const [batchAssign, { isLoading: batching }] =
    useBatchAssignRefereeMutation();

  const handleSubmit = async () => {
    if (!matchIds.length) {
      toast.info("Chưa chọn trận nào.");
      return;
    }
    if (!pickedRefs.length) {
      toast.info("Hãy chọn ít nhất 1 trọng tài.");
      return;
    }

    const refereeIds = pickedRefs.map(idOfRef).filter(Boolean);
    if (!refereeIds.length) {
      toast.info("Danh sách trọng tài không hợp lệ.");
      return;
    }

    try {
      await batchAssign({
        ids: matchIds,
        referees: refereeIds,
      }).unwrap();

      toast.success(`Đã gán trọng tài cho ${matchIds.length} trận`);
      onAssigned?.(); // cho parent refetchMatches
      onClose?.();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Gán trọng tài thất bại");
    }
  };

  const loading = refsLoading || isFetching;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Gán trọng tài</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Đang chọn <b>{matchIds.length}</b> trận.
          </Typography>

          <Autocomplete
            multiple
            disableCloseOnSelect
            options={refOptions}
            loading={loading}
            value={pickedRefs}
            onChange={(_, val) => setPickedRefs(val)}
            getOptionLabel={labelOfRef}
            isOptionEqualToValue={(a, b) => idOfRef(a) === idOfRef(b)}
            filterSelectedOptions
            // Nếu muốn search client-side mặc định của MUI thì KHÔNG cần keyword riêng.
            renderOption={(props, option, { selected }) => (
              <li {...props} key={idOfRef(option)}>
                <Checkbox
                  style={{ marginRight: 8 }}
                  checked={selected}
                  size="small"
                />
                <Avatar
                  src={option?.avatar || ""}
                  alt={labelOfRef(option)}
                  sx={{ width: 24, height: 24, mr: 1 }}
                />
                <span style={{ fontWeight: 600 }}>
                  {option?.name || option?.nickname || "—"}
                </span>
                {option?.nickname && option?.name && (
                  <span style={{ marginLeft: 6, color: "#666" }}>
                    ({option.nickname})
                  </span>
                )}
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Chọn trọng tài"
                placeholder="Tìm theo tên/nickname"
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <>
                      <InputAdornment position="start">
                        {loading ? (
                          <CircularProgress size={16} />
                        ) : (
                          <SearchIcon fontSize="small" />
                        )}
                      </InputAdornment>
                      {/* Giữ lại chỗ render chip + selected values */}
                      {params.InputProps.startAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderTags={(value, getTagProps) =>
              value.map((opt, idx) => (
                <Chip
                  key={idOfRef(opt)}
                  {...getTagProps({ index: idx })}
                  size="small"
                  label={labelOfRef(opt)}
                />
              ))
            }
            noOptionsText={
              loading
                ? "Đang tải…"
                : "Không có trọng tài trong giải hoặc không khớp từ khoá."
            }
          />

          {refsErr && (
            <Alert severity="warning">
              {refsErr?.data?.message || "Không tải được danh sách trọng tài."}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
        <Button
          variant="contained"
          startIcon={<RefereeIcon />}
          disabled={
            batching ||
            loading ||
            pickedRefs.length === 0 ||
            matchIds.length === 0
          }
          onClick={handleSubmit}
        >
          {batching ? "Đang gán…" : "Gán"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default React.memo(BulkAssignRefDialog);
