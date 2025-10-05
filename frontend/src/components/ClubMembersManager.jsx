/* eslint-disable react/prop-types */
import React from "react";
import { Box, IconButton, Tooltip, Chip, Stack } from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import {
  useListMembersQuery,
  useKickMemberMutation,
  useSetRoleMutation,
} from "../slices/clubsApiSlice";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";

export default function ClubMembersManager({ clubId }) {
  const { data, isLoading } = useListMembersQuery({ id: clubId });
  const [kick] = useKickMemberMutation();
  const [setRole] = useSetRoleMutation();

  const rows = (data?.items || []).map((m) => ({
    id: m._id,
    userId: m.user?._id,
    name: m.user?.fullName || m.user?.nickname || "N/A",
    role: m.role,
    joinedAt: m.joinedAt,
  }));

  const columns = [
    { field: "name", headerName: "Thành viên", flex: 1 },
    {
      field: "role",
      headerName: "Vai trò",
      width: 150,
      renderCell: (params) => <Chip label={params.value} size="small" />,
    },
    {
      field: "actions",
      headerName: "Hành động",
      width: 160,
      renderCell: (params) => {
        const r = params.row;
        const makeAdmin = () =>
          setRole({ id: clubId, userId: r.userId, role: "admin" });
        const makeMember = () =>
          setRole({ id: clubId, userId: r.userId, role: "member" });
        const doKick = () => kick({ id: clubId, userId: r.userId });
        return (
          <Stack direction="row" spacing={1}>
            <Tooltip title="Promote/Demote admin">
              <IconButton
                size="small"
                onClick={r.role === "admin" ? makeMember : makeAdmin}
              >
                {r.role === "admin" ? <StarBorderIcon /> : <StarIcon />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Kick">
              <IconButton size="small" color="error" onClick={doKick}>
                <DeleteIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        );
      },
    },
  ];

  return (
    <Box sx={{ height: 480, width: "100%" }}>
      <DataGrid
        loading={isLoading}
        rows={rows}
        columns={columns}
        disableRowSelectionOnClick
        pageSizeOptions={[25, 50, 100]}
        initialState={{
          pagination: { paginationModel: { pageSize: 25, page: 0 } },
        }}
      />
    </Box>
  );
}
