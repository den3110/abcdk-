import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { DeleteOutline } from "@mui/icons-material";
import { toast } from "react-toastify";
import PropTypes from "prop-types";
import PlayerSelector from "../PlayerSelector";
import {
  useCreateRegistrationMutation,
  useGetTeamRosterQuery,
  useManagerDeleteRegistrationMutation,
} from "../../slices/tournamentsApiSlice";

const playerName = (player) =>
  player?.nickName || player?.nickname || player?.fullName || "Chưa có VĐV";

const registrationLabel = (registration, eventType) => {
  const p1 = playerName(registration?.player1);
  if (String(eventType || "").toLowerCase() === "single") return p1;
  return `${p1} / ${playerName(registration?.player2)}`;
};

export default function TeamTournamentRegistrationView({
  tournamentId,
  tour,
  me,
  canManage,
  isAdmin,
}) {
  const { data, isLoading, error, refetch } = useGetTeamRosterQuery(tournamentId);
  const [createRegistration, { isLoading: saving }] = useCreateRegistrationMutation();
  const [deleteRegistration, { isLoading: deleting }] =
    useManagerDeleteRegistrationMutation();
  const [selectedFactionId, setSelectedFactionId] = useState("");
  const [player1, setPlayer1] = useState(null);
  const [player2, setPlayer2] = useState(null);
  const [message, setMessage] = useState("");

  const factions = useMemo(() => data?.factions || [], [data]);
  const manageableFactions = useMemo(() => {
    if (canManage || isAdmin) return factions;
    const meId = String(me?._id || "");
    return factions.filter(
      (faction) => String(faction?.captainUser?._id || "") === meId
    );
  }, [canManage, factions, isAdmin, me?._id]);

  useEffect(() => {
    if (
      selectedFactionId &&
      manageableFactions.some((faction) => String(faction._id) === selectedFactionId)
    ) {
      return;
    }
    setSelectedFactionId(String(manageableFactions[0]?._id || ""));
  }, [manageableFactions, selectedFactionId]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!selectedFactionId) {
      toast.error("Hãy chọn phe");
      return;
    }
    if (!player1?._id) {
      toast.error("Hãy chọn VĐV 1");
      return;
    }
    if (String(tour?.eventType || "").toLowerCase() === "double" && !player2?._id) {
      toast.error("Giải đôi cần 2 VĐV");
      return;
    }

    try {
      await createRegistration({
        tourId: tournamentId,
        player1Id: player1._id,
        player2Id: player2?._id || null,
        teamFactionId: selectedFactionId,
        message,
      }).unwrap();
      toast.success("Đã thêm roster");
      setPlayer1(null);
      setPlayer2(null);
      setMessage("");
      refetch();
    } catch (error) {
      toast.error(error?.data?.message || "Không thêm được roster");
    }
  };

  const handleDelete = async (registrationId) => {
    if (!window.confirm("Xóa entry này khỏi roster?")) return;
    try {
      await deleteRegistration(registrationId).unwrap();
      toast.success("Đã xóa roster");
      refetch();
    } catch (error) {
      toast.error(error?.data?.message || "Không xóa được roster");
    }
  };

  const showForm = manageableFactions.length > 0;

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={2.5}>
        <Typography variant="h4" fontWeight={800}>
          Roster giải đồng đội
        </Typography>

        {isLoading ? (
          <Alert severity="info">Äang táº£i roster giáº£i Ä‘á»“ng Ä‘á»™i...</Alert>
        ) : null}

        {error ? (
          <Alert severity="error">
            {error?.data?.message || "KhÃ´ng táº£i Ä‘Æ°á»£c roster giáº£i Ä‘á»“ng Ä‘á»™i."}
          </Alert>
        ) : null}

        {!showForm && (
          <Alert severity="info">
            Giải này chỉ cho đội trưởng từng phe hoặc quản lý giải thêm vận động viên.
          </Alert>
        )}

        {showForm && (
          <Card variant="outlined">
            <CardContent>
              <Stack component="form" spacing={2} onSubmit={handleSubmit}>
                <Typography variant="h6" fontWeight={700}>
                  Thêm roster
                </Typography>
                <TextField
                  select
                  label="Phe"
                  value={selectedFactionId}
                  onChange={(e) => setSelectedFactionId(e.target.value)}
                >
                  {manageableFactions.map((faction) => (
                    <MenuItem key={faction._id} value={faction._id}>
                      {faction.name}
                    </MenuItem>
                  ))}
                </TextField>
                <PlayerSelector
                  label="VĐV 1"
                  eventType={tour?.eventType}
                  onChange={setPlayer1}
                />
                {String(tour?.eventType || "").toLowerCase() === "double" && (
                  <PlayerSelector
                    label="VĐV 2"
                    eventType={tour?.eventType}
                    onChange={setPlayer2}
                  />
                )}
                <TextField
                  label="Ghi chú"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  multiline
                  minRows={2}
                />
                <Button type="submit" variant="contained" disabled={saving}>
                  Thêm vào roster
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}

        <Grid container spacing={2}>
          {factions.map((faction) => {
            const canEditFaction =
              canManage ||
              isAdmin ||
              String(faction?.captainUser?._id || "") === String(me?._id || "");

            return (
              <Grid item xs={12} md={6} key={faction._id}>
                <Card variant="outlined" sx={{ height: "100%" }}>
                  <CardContent>
                    <Stack spacing={1.5}>
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <Typography variant="h6" fontWeight={800}>
                          {faction.name}
                        </Typography>
                        <Chip label={`${faction.entryCount || 0} entry`} size="small" />
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        Đội trưởng:{" "}
                        {faction?.captainUser?.nickname ||
                          faction?.captainUser?.name ||
                          "Chưa chọn"}
                      </Typography>
                      <Divider />
                      <Stack spacing={1}>
                        {(faction.registrations || []).length === 0 && (
                          <Alert severity="info">Chưa có roster cho phe này.</Alert>
                        )}
                        {(faction.registrations || []).map((registration) => (
                          <Box
                            key={registration._id}
                            sx={{
                              p: 1.25,
                              borderRadius: 2,
                              border: "1px solid",
                              borderColor: "divider",
                            }}
                          >
                            <Stack
                              direction="row"
                              justifyContent="space-between"
                              alignItems="flex-start"
                              spacing={1}
                            >
                              <Box sx={{ minWidth: 0 }}>
                                <Typography fontWeight={700}>
                                  {registrationLabel(registration, tour?.eventType)}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  Mã #{registration.code || "—"}
                                </Typography>
                              </Box>
                              {canEditFaction && (
                                <IconButton
                                  size="small"
                                  color="error"
                                  disabled={deleting}
                                  onClick={() => handleDelete(registration._id)}
                                >
                                  <DeleteOutline fontSize="small" />
                                </IconButton>
                              )}
                            </Stack>
                          </Box>
                        ))}
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </Stack>
    </Box>
  );
}

TeamTournamentRegistrationView.propTypes = {
  tournamentId: PropTypes.string.isRequired,
  tour: PropTypes.object,
  me: PropTypes.object,
  canManage: PropTypes.bool,
  isAdmin: PropTypes.bool,
};

TeamTournamentRegistrationView.defaultProps = {
  tour: null,
  me: null,
  canManage: false,
  isAdmin: false,
};
