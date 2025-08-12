// components/RegInvitesModal.jsx
/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import {
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { toast } from "react-toastify";
import { Link as RouterLink } from "react-router-dom";

import {
  useListMyRegInvitesQuery,
  useRespondRegInviteMutation,
} from "../slices/tournamentsApiSlice";

export default function RegInvitesModal() {
  const me = useSelector((s) => s.auth?.userInfo || null);

  // 🔹 Gọi endpoint GLOBAL: trả về mọi invite (pending) mà user này cần phản hồi
  const {
    data: invites = [],
    isFetching,
    isError,
    error,
    refetch,
  } = useListMyRegInvitesQuery(undefined, { skip: !me });

  const [respond] = useRespondRegInviteMutation();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (me && Array.isArray(invites) && invites.length > 0) setOpen(true);
  }, [me, invites]);

  if (!Array.isArray(invites) || invites.length === 0) return null;

  const onAction = async (invite, action) => {
    try {
      setBusyId(invite._id);
      await respond({ inviteId: invite._id, action }).unwrap();
      toast.success(
        action === "accept" ? "Đã chấp nhận lời mời" : "Đã từ chối lời mời"
      );
      const after = await refetch();
      if (!after?.data || after.data.length === 0) setOpen(false);
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Xử lý lời mời thất bại");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onClose={() => {}} maxWidth="md" fullWidth>
      <DialogTitle>
        Lời mời tham gia giải
        {isFetching && <LinearProgress sx={{ mt: 1 }} />}
      </DialogTitle>

      <DialogContent dividers>
        {isError ? (
          <Typography color="error">
            {error?.data?.message || error?.error || "Không tải được lời mời"}
          </Typography>
        ) : (
          <Stack spacing={2}>
            {invites.map((inv) => {
              const t = inv.tournament || {};
              const isDouble = String(inv.eventType).toLowerCase() === "double";

              return (
                <Box
                  key={inv._id}
                  sx={{
                    p: 1.5,
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1.5,
                  }}
                >
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    justifyContent="space-between"
                    spacing={1}
                  >
                    <Stack spacing={0.25}>
                      <Typography fontWeight={700}>{t.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t.location || "—"} •{" "}
                        {t.startDate
                          ? new Date(t.startDate).toLocaleDateString()
                          : "—"}
                      </Typography>
                      <Chip
                        size="small"
                        label={
                          inv.eventType === "single" ? "Giải đơn" : "Giải đôi"
                        }
                        sx={{ mt: 0.5, width: "fit-content" }}
                      />
                    </Stack>

                    <Button
                      size="small"
                      component={RouterLink}
                      to={`/tournament/${t._id}/register`}
                      onClick={() => {
                        setOpen(false);
                      }}
                      variant="text"
                    >
                      Xem giải
                    </Button>
                  </Stack>

                  <Divider sx={{ my: 1.25 }} />

                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    {/* P1 */}
                    <Stack
                      direction="row"
                      spacing={1.25}
                      alignItems="center"
                      flex={1}
                    >
                      <Avatar src={inv.player1?.avatar || ""} />
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          {inv.player1?.fullName || "—"}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {inv.player1?.phone || inv.player1?.nickname || ""}
                        </Typography>
                      </Box>
                    </Stack>

                    {/* P2 (nếu doubles) */}
                    {isDouble && (
                      <Stack
                        direction="row"
                        spacing={1.25}
                        alignItems="center"
                        flex={1}
                      >
                        <Avatar src={inv.player2?.avatar || ""} />
                        <Box>
                          <Typography variant="body2" fontWeight={600}>
                            {inv.player2?.fullName || "—"}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {inv.player2?.phone || inv.player2?.nickname || ""}
                          </Typography>
                        </Box>
                      </Stack>
                    )}
                  </Stack>

                  <Stack direction="row" spacing={1} mt={1.5} flexWrap="wrap">
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => onAction(inv, "accept")}
                      disabled={busyId === inv._id}
                    >
                      Chấp nhận
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      onClick={() => onAction(inv, "decline")}
                      disabled={busyId === inv._id}
                    >
                      Từ chối
                    </Button>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setOpen(false)}
                    >
                      Để đó
                    </Button>
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={() => setOpen(false)}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
}
