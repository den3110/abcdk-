import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { toast } from "react-toastify";
import {
  useAdminListMatchesByTournamentQuery,
  useCreateTeamMatchMutation,
  useGetTeamRosterQuery,
  useGetTeamStandingsQuery,
} from "../../slices/tournamentsApiSlice";
import { addBusinessBreadcrumb } from "../../utils/sentry";

const playerName = (player) =>
  player?.nickName || player?.nickname || player?.fullName || "Chưa có VĐV";

const registrationLabel = (registration, eventType) => {
  const p1 = playerName(registration?.player1);
  if (String(eventType || "").toLowerCase() === "single") return p1;
  return `${p1} / ${playerName(registration?.player2)}`;
};

const matchCode = (match) =>
  match?.displayCode ||
  match?.code ||
  match?.globalCode ||
  `T${(match?.order ?? 0) + 1}`;

export default function TeamTournamentManageView({
  tournamentId,
  tour,
  canManage,
}) {
  const {
    data: rosterData,
    isLoading: rosterLoading,
    refetch: refetchRoster,
  } = useGetTeamRosterQuery(tournamentId);
  const {
    data: standingsData,
    isLoading: standingsLoading,
    refetch: refetchStandings,
  } = useGetTeamStandingsQuery(tournamentId);
  const {
    data: matchPage,
    isLoading: matchesLoading,
    refetch: refetchMatches,
  } = useAdminListMatchesByTournamentQuery({
    tid: tournamentId,
    page: 1,
    pageSize: 1000,
  });
  const [createTeamMatch, { isLoading: creating }] =
    useCreateTeamMatchMutation();

  const factions = rosterData?.factions || [];
  const factionA = factions[0] || null;
  const factionB = factions[1] || null;
  const [pairA, setPairA] = useState("");
  const [pairB, setPairB] = useState("");

  const matches = useMemo(() => matchPage?.list || [], [matchPage]);
  const loading = rosterLoading || standingsLoading || matchesLoading;

  const handleCreate = async () => {
    if (!pairA || !pairB) {
      toast.error("Hãy chọn đủ 2 entry từ 2 phe");
      return;
    }

    addBusinessBreadcrumb("team_tournament.match.create.submit", {
      tournamentId,
      tournamentName: tour?.name,
      pairARegistrationId: pairA,
      pairBRegistrationId: pairB,
    });

    try {
      await createTeamMatch({
        tourId: tournamentId,
        pairA,
        pairB,
      }).unwrap();
      toast.success("Đã tạo trận đồng đội");
      setPairA("");
      setPairB("");
      refetchRoster();
      refetchStandings();
      refetchMatches();
    } catch (submitError) {
      toast.error(submitError?.data?.message || "Không tạo được trận");
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={2.5}>
        <Typography variant="h4" fontWeight={800}>
          Quản lý giải đồng đội
        </Typography>

        {loading ? (
          <Box sx={{ py: 2, display: "flex", justifyContent: "center" }}>
            <CircularProgress size={28} />
          </Box>
        ) : null}

        {!canManage && (
          <Alert severity="warning">
            Bạn không có quyền quản lý giải đồng đội này.
          </Alert>
        )}

        <Grid container spacing={2}>
          {(standingsData?.standings || []).map((row) => (
            <Grid item xs={12} md={6} key={row._id}>
              <Card variant="outlined">
                <CardContent>
                  <Stack spacing={1}>
                    <Typography variant="h6" fontWeight={800}>
                      {row.name}
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Chip color="success" label={`Thắng ${row.wins || 0}`} />
                      <Chip color="error" label={`Thua ${row.losses || 0}`} />
                      <Chip label={`Đã đấu ${row.played || 0}`} />
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Grid container spacing={2}>
          {factions.map((faction) => (
            <Grid item xs={12} md={6} key={faction._id}>
              <Card variant="outlined" sx={{ height: "100%" }}>
                <CardContent>
                  <Stack spacing={1.25}>
                    <Typography variant="h6" fontWeight={800}>
                      {faction.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Đội trưởng:{" "}
                      {faction?.captainUser?.nickname ||
                        faction?.captainUser?.name ||
                        "Chưa chọn"}
                    </Typography>
                    <Stack spacing={1}>
                      {(faction.registrations || []).map((registration) => (
                        <Box
                          key={registration._id}
                          sx={{
                            p: 1,
                            border: "1px solid",
                            borderColor: "divider",
                            borderRadius: 2,
                          }}
                        >
                          <Typography fontWeight={700}>
                            {registrationLabel(registration, tour?.eventType)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            #{registration.code || "—"}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={800}>
                Tạo trận thủ công
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    select
                    label={factionA?.name || "Phe A"}
                    value={pairA}
                    onChange={(e) => setPairA(e.target.value)}
                    fullWidth
                  >
                    {(factionA?.registrations || []).map((registration) => (
                      <MenuItem key={registration._id} value={registration._id}>
                        {registrationLabel(registration, tour?.eventType)}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    select
                    label={factionB?.name || "Phe B"}
                    value={pairB}
                    onChange={(e) => setPairB(e.target.value)}
                    fullWidth
                  >
                    {(factionB?.registrations || []).map((registration) => (
                      <MenuItem key={registration._id} value={registration._id}>
                        {registrationLabel(registration, tour?.eventType)}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
              </Grid>
              <Box>
                <Button
                  variant="contained"
                  disabled={!canManage || creating}
                  onClick={handleCreate}
                >
                  Tạo trận
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1.5}>
              <Typography variant="h6" fontWeight={800}>
                Danh sách trận đồng đội
              </Typography>
              {matches.length === 0 && (
                <Alert severity="info">Chưa có trận đồng đội nào.</Alert>
              )}
              {matches.map((match) => (
                <Box
                  key={match._id}
                  sx={{
                    p: 1.25,
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 2,
                  }}
                >
                  <Stack
                    direction={{ xs: "column", md: "row" }}
                    spacing={1}
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", md: "center" }}
                  >
                    <Box>
                      <Typography fontWeight={800}>{matchCode(match)}</Typography>
                      <Typography variant="body2">
                        {registrationLabel(match?.pairA, tour?.eventType)} vs{" "}
                        {registrationLabel(match?.pairB, tour?.eventType)}
                      </Typography>
                    </Box>
                    <Chip label={match?.status || "scheduled"} size="small" />
                  </Stack>
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}

TeamTournamentManageView.propTypes = {
  tournamentId: PropTypes.string.isRequired,
  tour: PropTypes.object,
  canManage: PropTypes.bool,
};

TeamTournamentManageView.defaultProps = {
  tour: null,
  canManage: false,
};
