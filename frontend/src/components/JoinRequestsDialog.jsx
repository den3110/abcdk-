/* eslint-disable react/prop-types */
import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Avatar,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  LinearProgress,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import {
  useListJoinRequestsQuery,
  useAcceptJoinMutation,
  useRejectJoinMutation,
} from "../slices/clubsApiSlice";

export default function JoinRequestsDialog({ open, onClose, clubId }) {
  const { data, isFetching, refetch } = useListJoinRequestsQuery(
    { id: clubId, params: { status: "pending" } },
    { skip: !open }
  );
  const [accept, { isLoading: accepting }] = useAcceptJoinMutation();
  const [reject, { isLoading: rejecting }] = useRejectJoinMutation();

  const onAccept = async (reqId) => {
    await accept({ id: clubId, reqId }).unwrap();
    refetch();
  };
  const onReject = async (reqId) => {
    await reject({ id: clubId, reqId }).unwrap();
    refetch();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Yêu cầu gia nhập</DialogTitle>
      <DialogContent dividers>
        {(isFetching || accepting || rejecting) && (
          <LinearProgress sx={{ mb: 2 }} />
        )}
        <Stack spacing={1.5}>
          {(data?.items || []).map((r) => (
            <Stack
              key={r._id}
              direction="row"
              spacing={1.5}
              alignItems="center"
              sx={{ p: 1, borderRadius: 2, bgcolor: "background.default" }}
            >
              <Avatar src={r.user?.avatar} alt={r.user?.fullName} />
              <Stack flex={1}>
                <Typography variant="subtitle2">
                  {r.user?.fullName || r.user?.nickname || r.user?.email}
                </Typography>
                {r.message && (
                  <Typography variant="body2" color="text.secondary">
                    {r.message}
                  </Typography>
                )}
              </Stack>
              <Tooltip title="Chấp nhận">
                <IconButton color="success" onClick={() => onAccept(r._id)}>
                  <CheckIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Từ chối">
                <IconButton color="error" onClick={() => onReject(r._id)}>
                  <CloseIcon />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}

          {!isFetching && data?.items?.length === 0 && (
            <Typography color="text.secondary">
              Không có yêu cầu nào.
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
}
