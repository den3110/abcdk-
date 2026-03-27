import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Add as AddIcon,
  DeleteOutline as DeleteOutlineIcon,
  Group as GroupIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";
import {
  useAddTournamentManagerMutation,
  useListTournamentManagersQuery,
  useRemoveTournamentManagerMutation,
} from "../slices/tournamentsApiSlice";
import { useLazySearchUserQuery } from "../slices/usersApiSlice";
import { useLanguage } from "../context/LanguageContext";
import ResponsiveModal from "./ResponsiveModal";

const sid = (value) =>
  String(value?._id || value?.id || value?.userId || value || "");

const personName = (user) =>
  user?.nickname || user?.name || user?.fullName || user?.phone || "—";

const personContact = (user) =>
  [user?.phone, user?.email].filter(Boolean).join(" • ") || "—";

const avatarLetter = (user) => {
  const label = personName(user).trim();
  return (label[0] || "U").toUpperCase();
};

export default function TournamentManagersDialog({
  open,
  tournamentId,
  onClose,
  onChanged,
}) {
  const { t } = useLanguage();
  const [searchText, setSearchText] = useState("");
  const [selectedManager, setSelectedManager] = useState(null);
  const [managerToRemove, setManagerToRemove] = useState(null);

  const {
    data: managerRows = [],
    isLoading: loadingManagers,
    isFetching: fetchingManagers,
    refetch: refetchManagers,
  } = useListTournamentManagersQuery(tournamentId, {
    skip: !open || !tournamentId,
    refetchOnMountOrArgChange: true,
  });

  const [searchUsers, { data: searchResults, isFetching: searchingUsers }] =
    useLazySearchUserQuery();
  const [addManager, { isLoading: addingManager }] =
    useAddTournamentManagerMutation();
  const [removeManager, { isLoading: removingManager }] =
    useRemoveTournamentManagerMutation();

  const saving = addingManager || removingManager;

  useEffect(() => {
    if (!open) {
      setSearchText("");
      setSelectedManager(null);
    }
  }, [open]);

  useEffect(() => {
    const q = searchText.trim();
    if (!open || !q) return undefined;

    const timer = setTimeout(() => {
      searchUsers(q);
    }, 300);

    return () => clearTimeout(timer);
  }, [open, searchText, searchUsers]);

  const assignedManagerIds = useMemo(
    () => new Set(managerRows.map((row) => sid(row?.user))),
    [managerRows],
  );

  const searchOptions = useMemo(() => {
    if (!searchText.trim()) return [];
    return Array.isArray(searchResults) ? searchResults : [];
  }, [searchResults, searchText]);

  const selectedManagerId = sid(selectedManager);
  const selectedAlreadyAssigned =
    !!selectedManagerId && assignedManagerIds.has(selectedManagerId);

  const handleAddManager = async () => {
    if (!selectedManagerId) return;
    if (selectedAlreadyAssigned) {
      toast.info(
        t(
          "tournaments.manage.managerAlreadyAdded",
          undefined,
          "This user is already a manager.",
        ),
      );
      return;
    }

    try {
      await addManager({
        tournamentId,
        userId: selectedManagerId,
      }).unwrap();
      toast.success(
        t(
          "tournaments.manage.managerAdded",
          undefined,
          "Manager added successfully.",
        ),
      );
      setSelectedManager(null);
      setSearchText("");
      refetchManagers?.();
      onChanged?.();
    } catch (error) {
      toast.error(
        error?.data?.message ||
          error?.error ||
          t(
            "tournaments.manage.managerAddFailed",
            undefined,
            "Failed to add manager.",
          ),
      );
    }
  };

  const requestRemoveManager = (row) => {
    setManagerToRemove(row);
  };

  const handleConfirmRemoveManager = async () => {
    const row = managerToRemove;
    if (!row) return;

    const userId = sid(row?.user);
    if (!userId) return;

    try {
      await removeManager({ tournamentId, userId }).unwrap();
      toast.success(
        t(
          "tournaments.manage.managerRemoved",
          undefined,
          "Manager removed successfully.",
        ),
      );
      setManagerToRemove(null);
      refetchManagers?.();
      onChanged?.();
    } catch (error) {
      toast.error(
        error?.data?.message ||
          error?.error ||
          t(
            "tournaments.manage.managerRemoveFailed",
            undefined,
            "Failed to remove manager.",
          ),
      );
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      maxWidth="md"
      icon={<GroupIcon fontSize="small" />}
      title={t(
        "tournaments.manage.managerDialogTitle",
        undefined,
        "Manage tournament managers",
      )}
      actions={
        <Button onClick={onClose}>
          {t("common.close", undefined, "Close")}
        </Button>
      }
    >
      <Stack spacing={2}>
        <Card variant="outlined">
          <CardHeader
            title={t(
              "tournaments.manage.managerAddSection",
              undefined,
              "Add a manager",
            )}
          />
          <Divider />
          <CardContent>
            <Stack spacing={1.5}>
              <Autocomplete
                componentsProps={{ popper: { style: { zIndex: 1400 } } }}
                fullWidth
                value={selectedManager}
                inputValue={searchText}
                onChange={(_event, value) => setSelectedManager(value)}
                onInputChange={(_event, value) => setSearchText(value)}
                options={searchOptions}
                loading={searchingUsers}
                filterOptions={(options) => options}
                noOptionsText={t(
                  "tournaments.manage.managerSearchEmpty",
                  undefined,
                  "No matching users found.",
                )}
                getOptionLabel={(option) => personName(option)}
                isOptionEqualToValue={(option, value) =>
                  sid(option) === sid(value)
                }
                renderOption={(props, option) => (
                  <li {...props} key={sid(option)}>
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <Avatar src={option?.avatar || ""}>
                        {avatarLetter(option)}
                      </Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                          {personName(option)}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                        >
                          {personContact(option)}
                        </Typography>
                      </Box>
                    </Stack>
                  </li>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t(
                      "tournaments.manage.managerSearchLabel",
                      undefined,
                      "Find user",
                    )}
                    placeholder={t(
                      "tournaments.manage.managerSearchPlaceholder",
                      undefined,
                      "Name / nickname / phone number",
                    )}
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {searchingUsers ? (
                            <CircularProgress size={18} />
                          ) : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />

              {selectedAlreadyAssigned ? (
                <Alert severity="info">
                  {t(
                    "tournaments.manage.managerAlreadyAdded",
                    undefined,
                    "This user is already a manager.",
                  )}
                </Alert>
              ) : null}

              <Box>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={handleAddManager}
                  disabled={
                    !selectedManagerId || selectedAlreadyAssigned || saving
                  }
                >
                  {t(
                    "tournaments.manage.managerAddAction",
                    undefined,
                    "Add manager",
                  )}
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader
            title={t(
              "tournaments.manage.managerListTitle",
              undefined,
              "Current managers",
            )}
            action={
              fetchingManagers ? (
                <CircularProgress size={18} sx={{ mt: 1.5 }} />
              ) : null
            }
          />
          <Divider />
          <CardContent>
            {loadingManagers ? (
              <Box textAlign="center" py={2}>
                <CircularProgress size={24} />
              </Box>
            ) : managerRows.length === 0 ? (
              <Alert severity="info">
                {t(
                  "tournaments.manage.managerEmpty",
                  undefined,
                  "No managers have been added yet.",
                )}
              </Alert>
            ) : (
              <Stack
                component="ul"
                spacing={1}
                sx={{ listStyle: "none", p: 0, m: 0 }}
              >
                {managerRows.map((row) => (
                  <Stack
                    key={row?._id || sid(row?.user)}
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    spacing={1.5}
                    sx={{
                      px: 1.25,
                      py: 1,
                      borderRadius: 1.5,
                      border: "1px solid",
                      borderColor: "divider",
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1.25}
                      alignItems="center"
                      sx={{ minWidth: 0 }}
                    >
                      <Avatar src={row?.user?.avatar || ""}>
                        {avatarLetter(row?.user)}
                      </Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>
                          {personName(row?.user)}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                        >
                          {personContact(row?.user)}
                        </Typography>
                      </Box>
                    </Stack>

                    <Tooltip
                      title={t(
                        "tournaments.manage.managerRemove",
                        undefined,
                        "Remove",
                      )}
                      arrow
                    >
                      <span>
                        <IconButton
                          edge="end"
                          size="small"
                          color="error"
                          onClick={() => requestRemoveManager(row)}
                          disabled={saving}
                        >
                          <DeleteOutlineIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Stack>

      <Dialog
        open={!!managerToRemove}
        onClose={() => setManagerToRemove(null)}
        maxWidth="xs"
        fullWidth
        sx={{ zIndex: 1400 }}
      >
        <DialogTitle>{t("common.confirm", undefined, "Confirm")}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body1">
            {t(
              "tournaments.manage.managerRemoveConfirm",
              { name: personName(managerToRemove?.user) },
              `Remove manager "${personName(managerToRemove?.user)}"?`,
            )}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManagerToRemove(null)}>
            {t("common.cancel", undefined, "Cancel")}
          </Button>
          <Button
            onClick={handleConfirmRemoveManager}
            color="error"
            variant="contained"
            disabled={saving}
          >
            {t("common.remove", undefined, "Remove")}
          </Button>
        </DialogActions>
      </Dialog>
    </ResponsiveModal>
  );
}

TournamentManagersDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  tournamentId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onChanged: PropTypes.func,
};
