/* eslint-disable react/prop-types */
import {
  memo,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  OpenInNew as OpenInNewIcon,
  Sports as SportsIcon,
  Movie as MovieIcon,
  Print as PrintIcon,
  Stadium as StadiumIcon,
  HowToReg as RefereeIcon,
} from "@mui/icons-material";

import { useLanguage } from "../../../context/LanguageContext";

const StatusDetailItem = memo(function StatusDetailItem({ label, children }) {
  return (
    <Box
      sx={{
        minWidth: 0,
        p: 1.25,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography component="div" variant="body2" sx={{ mt: 0.35, fontWeight: 600 }}>
        {children}
      </Typography>
    </Box>
  );
});

export const MatchStatusDialog = memo(function MatchStatusDialog({
  open,
  match,
  onClose,
  t,
  locale,
  helpers,
}) {
  const {
    detailValue,
    getManageStatusMeta,
    matchCode,
    statusChipLocalized,
    teamLabel,
    courtLabel,
    scoreSummary,
    statusWinnerLabel,
    matchStarterName,
    formatOptionalDateTime,
    matchStartedAt,
    matchFinishedAt,
  } = helpers;
  const videoUrl = detailValue(match?.video);
  const hasVideo = videoUrl !== "—";
  const statusText = getManageStatusMeta(t, match?.status).label;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <SportsIcon fontSize="small" />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" noWrap>
              Chi tiết trạng thái
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {matchCode(match)} · {statusText}
            </Typography>
          </Box>
          {statusChipLocalized(t, match?.status)}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              {matchCode(match)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {teamLabel(match, "A")} vs {teamLabel(match, "B")}
            </Typography>
          </Paper>

          <Box
            sx={{
              display: "grid",
              gap: 1,
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
            }}
          >
            <StatusDetailItem label="Trạng thái">
              {statusChipLocalized(t, match?.status)}
            </StatusDetailItem>
            <StatusDetailItem label="Sân">{courtLabel(match)}</StatusDetailItem>
            <StatusDetailItem label="Thứ tự">
              {Number.isFinite(match?.order) ? `T${match.order + 1}` : "—"}
            </StatusDetailItem>
            <StatusDetailItem label="Tỉ số">{scoreSummary(match)}</StatusDetailItem>
            <StatusDetailItem label="Cặp A">{teamLabel(match, "A")}</StatusDetailItem>
            <StatusDetailItem label="Cặp B">{teamLabel(match, "B")}</StatusDetailItem>
            <StatusDetailItem label="Đội thắng">{statusWinnerLabel(match)}</StatusDetailItem>
            <StatusDetailItem label="Trọng tài">
              {detailValue(matchStarterName(match))}
            </StatusDetailItem>
            <StatusDetailItem label="Video">
              {hasVideo ? (
                <Button
                  size="small"
                  component="a"
                  href={videoUrl}
                  target="_blank"
                  rel="noopener"
                  endIcon={<OpenInNewIcon fontSize="small" />}
                  sx={{ px: 0, minWidth: 0 }}
                >
                  Mở video
                </Button>
              ) : (
                "—"
              )}
            </StatusDetailItem>
            <StatusDetailItem label="Cập nhật">
              {formatOptionalDateTime(match?.updatedAt, locale)}
            </StatusDetailItem>
            <StatusDetailItem label="Bắt đầu">
              {formatOptionalDateTime(matchStartedAt(match), locale)}
            </StatusDetailItem>
            <StatusDetailItem label="Kết thúc">
              {formatOptionalDateTime(matchFinishedAt(match), locale)}
            </StatusDetailItem>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
});

export const TableSkeletonRows = memo(function TableSkeletonRows({
  rows = 8,
  cols = 8,
}) {
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <TableCell key={c} sx={{ py: 0.5 }}>
              <Skeleton variant="text" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
});

export const MatchCardSkeleton = memo(function MatchCardSkeleton() {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardHeader
        sx={{ py: 1 }}
        avatar={<Skeleton variant="circular" width={22} height={22} />}
        title={<Skeleton variant="text" width="60%" />}
        subheader={
          <Stack direction="row" spacing={0.5}>
            <Skeleton variant="rounded" width={56} height={20} />
            <Skeleton variant="rounded" width={44} height={20} />
          </Stack>
        }
        action={<Skeleton variant="circular" width={24} height={24} />}
      />
      <Divider />
      <CardContent sx={{ py: 1 }}>
        <Stack spacing={0.5}>
          <Skeleton variant="text" width="90%" />
          <Skeleton variant="text" width="85%" />
          <Skeleton variant="rounded" width={120} height={22} />
        </Stack>
      </CardContent>
    </Card>
  );
});

export const MatchListSectionRow = memo(function MatchListSectionRow({
  label,
  color = "default",
  colSpan = 9,
}) {
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        sx={{
          py: 0.9,
          borderBottom: "none !important",
          overflow: "visible !important",
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Divider sx={{ flex: 1, opacity: 0.45 }} />
          <Chip
            size="small"
            color={color}
            variant="outlined"
            label={label}
            sx={{ fontWeight: 600 }}
          />
          <Divider sx={{ flex: 1, opacity: 0.45 }} />
        </Stack>
      </TableCell>
    </TableRow>
  );
});

export const MatchListSectionBlock = memo(function MatchListSectionBlock({
  label,
  color = "default",
}) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ my: 0.5 }}>
      <Divider sx={{ flex: 1, opacity: 0.45 }} />
      <Chip
        size="small"
        color={color}
        variant="outlined"
        label={label}
        sx={{ fontWeight: 600 }}
      />
      <Divider sx={{ flex: 1, opacity: 0.45 }} />
    </Stack>
  );
});

export const ActionChipsLocalized = memo(function ActionChipsLocalized({
  match,
  canStartReferee = false,
  onOpenVideo,
  onDeleteVideo,
  onAssignCourt,
  onAssignRef,
  onExportRefNote,
  onStartReferee,
}) {
  const { t } = useLanguage();
  const st = String(match?.status || "").toLowerCase();
  const canAssignCourt = !(st === "live" || st === "finished");
  const canStartMatch = Boolean(canStartReferee && onStartReferee);

  return (
    <Box
      onClick={(e) => e.stopPropagation()}
      sx={{ display: "flex", flexWrap: "wrap", columnGap: 0.75, rowGap: 0.75 }}
    >
      <Chip
        size="small"
        color="primary"
        variant="filled"
        icon={<PrintIcon />}
        label={t("tournaments.manage.refereeReport")}
        onClick={() => onExportRefNote?.(match)}
      />
      <Chip
        size="small"
        color="info"
        variant={match?.video ? "filled" : "outlined"}
        icon={<MovieIcon />}
        label={
          match?.video
            ? t("tournaments.manage.editVideo")
            : t("tournaments.manage.attachVideo")
        }
        onClick={() => onOpenVideo(match)}
      />
      {match?.video && (
        <Chip
          size="small"
          color="error"
          variant="outlined"
          label={t("tournaments.manage.removeVideo")}
          onClick={() => onDeleteVideo(match)}
        />
      )}
      {canAssignCourt && (
        <Chip
          size="small"
          color="secondary"
          variant="outlined"
          icon={<StadiumIcon />}
          label={t("tournaments.manage.assignCourt")}
          onClick={() => onAssignCourt(match)}
        />
      )}
      <Chip
        size="small"
        color="primary"
        variant="outlined"
        icon={<RefereeIcon />}
        label={t("tournaments.manage.assignSingleReferee")}
        onClick={() => onAssignRef(match)}
      />
      {canStartMatch ? (
        <Chip
          size="small"
          color="warning"
          variant="filled"
          icon={<SportsIcon />}
          label="Bắt trận"
          onClick={() => onStartReferee(match)}
        />
      ) : null}
    </Box>
  );
});

function useTournamentManageLiveMatch(liveStore, matchId) {
  const liveMatchId = String(matchId || "");
  const subscribe = useCallback(
    (onStoreChange) =>
      liveMatchId && liveStore?.subscribe
        ? liveStore.subscribe(liveMatchId, onStoreChange)
        : () => {},
    [liveStore, liveMatchId],
  );
  const getSnapshot = useCallback(
    () => (liveMatchId && liveStore?.get ? liveStore.get(liveMatchId) : null),
    [liveStore, liveMatchId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const MatchDesktopRows = memo(function MatchDesktopRows({
  match,
  liveStore,
  helpers,
  canStartReferee = false,
  onRowClick,
  onOpenVideo,
  onDeleteVideo,
  onAssignCourt,
  onAssignRef,
  onExportRefNote,
  onOpenStatus,
  onStartReferee,
  checked = false,
  onToggleSelect,
}) {
  const { t } = useLanguage();
  const {
    matchCode,
    courtLabel,
    manageDisplayStatus,
    statusChipLocalized,
    teamLabel,
    scoreSummary,
  } = helpers;
  const matchId = match?._id || match?.id;
  const live = useTournamentManageLiveMatch(liveStore, matchId);
  const merged = live ? { ...match, ...live } : match;
  const mergedCourtLabel = courtLabel(merged);
  const displayStatus = manageDisplayStatus(merged, merged?.status);
  const displayMatch =
    displayStatus === merged?.status ? merged : { ...merged, status: displayStatus };

  return (
    <>
      <TableRow
        hover
        onClick={() => onRowClick(matchId)}
        sx={{
          cursor: "pointer",
          "& td, & th": { borderBottom: "none !important" },
        }}
      >
        <TableCell
          padding="checkbox"
          sx={{ width: 56, minWidth: 56, py: 0.5 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={checked}
            onChange={(e) => {
              e.stopPropagation();
              onToggleSelect?.(matchId);
            }}
            size="small"
          />
        </TableCell>
        <TableCell sx={{ width: 100, whiteSpace: "nowrap", py: 0.5 }}>
          {matchCode(merged)}
        </TableCell>
        <TableCell sx={{ width: 220, maxWidth: 220, py: 0.5 }}>
          <Typography noWrap>{teamLabel(merged, "A")}</Typography>
        </TableCell>
        <TableCell sx={{ width: 220, maxWidth: 220, py: 0.5 }}>
          <Typography noWrap>{teamLabel(merged, "B")}</Typography>
        </TableCell>
        <TableCell
          sx={{
            width: 150,
            maxWidth: 150,
            whiteSpace: "normal !important",
            overflow: "visible !important",
            textOverflow: "clip !important",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            lineHeight: 1.35,
            py: 0.5,
          }}
        >
          <Tooltip
            title={mergedCourtLabel || ""}
            arrow
            disableHoverListener={!mergedCourtLabel || mergedCourtLabel === "—"}
          >
            <Typography
              component="span"
              sx={{
                display: "block",
                whiteSpace: "normal",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
                lineHeight: 1.35,
              }}
            >
              {mergedCourtLabel}
            </Typography>
          </Tooltip>
        </TableCell>
        <TableCell sx={{ width: 68, whiteSpace: "nowrap", py: 0.5 }}>
          {Number.isFinite(merged?.order) ? `T${merged.order + 1}` : "—"}
        </TableCell>
        <TableCell sx={{ width: 110, whiteSpace: "nowrap", py: 0.5 }}>
          {scoreSummary(merged)}
        </TableCell>
        <TableCell
          sx={{ width: 110, whiteSpace: "nowrap", py: 0.5 }}
          onClick={(e) => e.stopPropagation()}
        >
          {statusChipLocalized(t, displayStatus, (event) => {
            event.stopPropagation();
            onOpenStatus?.(displayMatch);
          })}
        </TableCell>
        <TableCell
          onClick={(e) => e.stopPropagation()}
          align="center"
          sx={{ width: 76, py: 0.5 }}
        >
          {merged?.video ? (
            <Tooltip title={merged.video} arrow>
              <IconButton
                size="small"
                component="a"
                href={merged.video}
                target="_blank"
                rel="noopener"
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : (
            <Chip size="small" variant="outlined" label="—" />
          )}
        </TableCell>
      </TableRow>

      <TableRow>
        <TableCell sx={{ width: 56, minWidth: 56, py: 0.25 }} />
        <TableCell colSpan={8} sx={{ py: 0.75, whiteSpace: "normal" }}>
          <ActionChipsLocalized
            match={merged}
            canStartReferee={canStartReferee}
            onOpenVideo={onOpenVideo}
            onDeleteVideo={onDeleteVideo}
            onAssignCourt={onAssignCourt}
            onAssignRef={onAssignRef}
            onExportRefNote={onExportRefNote}
            onStartReferee={onStartReferee}
          />
        </TableCell>
      </TableRow>
    </>
  );
});

export const MatchCard = memo(function MatchCard({
  match,
  liveStore,
  helpers,
  canStartReferee = false,
  onCardClick,
  onOpenVideo,
  onDeleteVideo,
  onAssignCourt,
  onAssignRef,
  onExportRefNote,
  onOpenStatus,
  onStartReferee,
  checked = false,
  onToggleSelect,
}) {
  const { t } = useLanguage();
  const {
    matchCode,
    courtLabel,
    manageDisplayStatus,
    statusChipLocalized,
    teamLabel,
    scoreSummary,
  } = helpers;
  const matchId = match?._id || match?.id;
  const live = useTournamentManageLiveMatch(liveStore, matchId);
  const merged = live ? { ...match, ...live } : match;
  const code = matchCode(merged);
  const displayStatus = manageDisplayStatus(merged, merged?.status);
  const displayMatch =
    displayStatus === merged?.status ? merged : { ...merged, status: displayStatus };

  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        cursor: "pointer",
        position: "relative",
        "&:hover": { boxShadow: 2 },
      }}
      onClick={() => onCardClick(matchId)}
    >
      <Box
        sx={{ position: "absolute", top: 6, right: 6, zIndex: 2 }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={checked}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect?.(matchId);
          }}
          size="small"
          inputProps={{ "aria-label": "Chọn trận" }}
        />
      </Box>
      <CardHeader
        sx={{ py: 1 }}
        avatar={<SportsIcon fontSize="small" />}
        titleTypographyProps={{ variant: "subtitle2", noWrap: true }}
        title={
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            flexWrap="wrap"
          >
            <Typography variant="subtitle2" noWrap>
              {code}
            </Typography>
            {statusChipLocalized(t, displayStatus, (event) => {
              event.stopPropagation();
              onOpenStatus?.(displayMatch);
            })}
          </Stack>
        }
        subheader={
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            <Chip
              size="small"
              label={t("tournaments.manage.courtChip", {
                court: courtLabel(merged),
              })}
            />
            {Number.isFinite(merged?.order) && (
              <Chip
                size="small"
                variant="outlined"
                label={`T${merged.order + 1}`}
              />
            )}
          </Stack>
        }
      />
      <Divider />
      <CardContent sx={{ py: 1 }}>
        <Stack spacing={0.75}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("tournaments.manage.pairA")}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {teamLabel(merged, "A")}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("tournaments.manage.pairB")}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {teamLabel(merged, "B")}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("tournaments.manage.score")}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {scoreSummary(merged)}
            </Typography>
          </Box>

          <Box onClick={(e) => e.stopPropagation()}>
            {merged?.video ? (
              <Stack
                direction="row"
                spacing={0.75}
                alignItems="center"
                flexWrap="wrap"
              >
                <Chip
                  size="small"
                  color="success"
                  variant="outlined"
                  label="Có video"
                  icon={<MovieIcon />}
                />
                <Tooltip title={merged.video} arrow>
                  <IconButton
                    size="small"
                    component="a"
                    href={merged.video}
                    target="_blank"
                    rel="noopener"
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ) : (
              <Chip size="small" variant="outlined" label="Chưa có video" />
            )}
          </Box>

          <ActionChipsLocalized
            match={merged}
            canStartReferee={canStartReferee}
            onOpenVideo={onOpenVideo}
            onDeleteVideo={onDeleteVideo}
            onAssignCourt={onAssignCourt}
            onAssignRef={onAssignRef}
            onExportRefNote={onExportRefNote}
            onStartReferee={onStartReferee}
          />
        </Stack>
      </CardContent>
    </Card>
  );
});

export const BulkVideoDialogLocalized = memo(function BulkVideoDialogLocalized({
  open,
  selectedCount = 0,
  busy = false,
  onClose,
  onSubmit,
}) {
  const { t } = useLanguage();
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (open) setUrl("");
  }, [open]);

  const handleSubmit = useCallback(() => {
    const value = (url || "").trim();
    if (!value || !selectedCount || busy) return;
    onSubmit?.(value);
  }, [url, selectedCount, busy, onSubmit]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" keepMounted>
      <DialogTitle>
        {t("tournaments.manage.bulkVideoTitle", { count: selectedCount })}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            autoFocus
            label={t("tournaments.manage.videoUrlLabel")}
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            fullWidth
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
          <Alert severity="info">{t("tournaments.manage.bulkVideoHint")}</Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          {t("common.close", undefined, "Close")}
        </Button>
        <Button
          variant="contained"
          startIcon={<MovieIcon />}
          disabled={busy || !url.trim() || !selectedCount}
          onClick={handleSubmit}
        >
          {t("tournaments.manage.attachVideo")}
        </Button>
      </DialogActions>
    </Dialog>
  );
});
