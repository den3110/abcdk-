import sys
with open('frontend/src/screens/live/LiveFeedPage.jsx', 'r', encoding='utf-8') as f:
    text = f.read()

start_marker = 'function InteractiveLiveSidebar({'
end_marker = 'export default function LiveFeedPage() {'

start_idx = text.find(start_marker)
end_idx = text.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("Failed to find markers")
    sys.exit(1)

new_func = r'''function InteractiveLiveSidebar({
  searchInput,
  onSearchChange,
  searchResults,
  isSearchResultsFetching,
  onSearchSelect,
  mode,
  onModeChange,
  tournamentId,
  onTournamentChange,
  sourceFilter,
  onSourceFilterChange,
  replayFilter,
  onReplayFilterChange,
  sortMode,
  onSortModeChange,
  tournaments,
  summary,
  statuses,
  sources,
  replayStates,
  hasActiveFilters,
  onClearFilters,
  onRefresh,
  isFetching,
  hasPendingNewItems,
  onShowNewItems,
  currentItem,
  activeIndex,
  loadedCount,
  totalCount,
  quickFilters,
  onApplyQuickFilter,
}) {
  const currentTitle = currentItem ? getFeedTitle(currentItem) : "Chưa có trận";
  const currentSubtitle = currentItem
    ? getFeedSubtitle(currentItem)
    : "Feed sẽ tự cập nhật";
  const currentBadge = normalizeLiveBadgeLabel(
    asTrimmed(currentItem?.smartBadge) || statusLabel(currentItem?.status),
  );
  const progressValue =
    totalCount > 0 ? Math.min(100, ((activeIndex + 1) / totalCount) * 100) : 0;
  const progressLabel =
    totalCount > 0 ? `${Math.min(activeIndex + 1, totalCount)}/${totalCount}` : "0/0";
  const modeItems = useMemo(
    () =>
      MODE_OPTIONS.map((option) => ({
        key: option.value,
        value: option.value,
        label: formatCountLabel(
          option.label,
          getModeCount(summary, statuses, option.value),
        ),
        selected: option.value === mode,
      })),
    [mode, statuses, summary],
  );
  const tournamentOptions = useMemo(
    () =>
      tournaments.map((item) => ({
        value: sid(item) || "",
        label: formatCountLabel(item.name, Number(item?.count || 0)),
      })),
    [tournaments],
  );

  return (
    <Box
      sx={{
        display: { xs: "none", md: "block" },
        position: "relative",
        zIndex: 10,
        height: "100dvh",
        overflowY: "auto",
        borderRight: "1px solid var(--live-border)",
        background: "var(--live-sidebar-bg)",
        backdropFilter: "blur(18px)",
        "&::-webkit-scrollbar": {
          display: "none",
        },
        msOverflowStyle: "none",
        scrollbarWidth: "none",
      }}
    >
      <Stack spacing={2.5} sx={{ p: 2.5 }}>
        <Stack spacing={1.5}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              minHeight: 50,
              "& a": {
                display: "inline-flex",
                alignItems: "center",
              },
            }}
          >
            <LogoAnimationMorph isMobile={false} showBackButton={false} />
          </Box>
          <Typography
            variant="body2"
            sx={{ color: "var(--live-text-secondary)", lineHeight: 1.6 }}
          >
            Nền tảng live chuyên nghiệp. Ưu tiên phát trực tiếp, video gốc mượt mà và nội dung đầy đủ tương tác cao.
          </Typography>
        </Stack>

        <Stack spacing={1.2}>
          <Stack direction="row" spacing={1.2}>
            <Button
              variant="contained"
              onClick={onRefresh}
              startIcon={
                isFetching ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <RefreshRoundedIcon />
                )
              }
              sx={{
                flex: 1,
                borderRadius: 1.5,
                textTransform: "none",
                fontWeight: 600,
                py: 0.8,
                bgcolor: "var(--live-surface-strong)",
                color: "var(--live-text)",
                boxShadow: "none",
                border: "1px solid var(--live-border-strong)",
                "&:hover": {
                  bgcolor: "var(--live-surface)",
                  boxShadow: "none",
                },
              }}
            >
              Làm mới
            </Button>
            <Button
              component={RouterLink}
              to="/live/clusters"
              startIcon={<GridViewRoundedIcon />}
              sx={{
                flex: 1,
                borderRadius: 1.5,
                textTransform: "none",
                fontWeight: 600,
                color: "var(--live-text)",
                px: 2,
                py: 0.8,
                bgcolor: "transparent",
                border: "1px solid var(--live-border-strong)",
                "&:hover": {
                  bgcolor: "var(--live-surface)",
                },
              }}
            >
              Cụm sân
            </Button>
          </Stack>

          {hasPendingNewItems ? (
            <Button
              variant="outlined"
              onClick={onShowNewItems}
              sx={{
                borderRadius: 1.5,
                textTransform: "none",
                fontWeight: 600,
                py: 0.8,
                color: "var(--live-hot)",
                borderColor: "var(--live-hot-border)",
                bgcolor: "var(--live-hot-soft)",
                "&:hover": {
                  borderColor: "var(--live-hot-border-strong)",
                  bgcolor: "var(--live-hot-soft-strong)",
                },
              }}
            >
              Có bản mới • Bấm để tải lại
            </Button>
          ) : null}
        </Stack>

        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <LiveMatchSearchField
            value={searchInput}
            onChange={onSearchChange}
            results={searchResults}
            isSearching={isSearchResultsFetching}
            onSelect={onSearchSelect}
            selectedId={sid(currentItem)}
          />

          <Stack spacing={1}>
            <Typography variant="overline" sx={{ color: "var(--live-text-muted)", fontWeight: 700, lineHeight: 1 }}>
              Lọc thông minh
            </Typography>
            <DraggableChipRail
              ariaLabel="Bộ lọc thông minh"
              items={quickFilters}
              onSelect={(item) => onApplyQuickFilter(item.key)}
            />
          </Stack>

          <Stack spacing={1}>
            <Typography variant="overline" sx={{ color: "var(--live-text-muted)", fontWeight: 700, lineHeight: 1 }}>
              Chế độ Feed
            </Typography>
            <DraggableChipRail
              ariaLabel="Chế độ feed"
              items={modeItems}
              onSelect={(item) => onModeChange(item.value)}
            />
          </Stack>

          <CustomTournamentPicker
            label="Giải đấu"
            value={tournamentId}
            options={tournamentOptions}
            onChange={onTournamentChange}
            placeholder="Tất cả giải đấu"
          />

          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ flex: 1 }}>
              <TextField
                select
                label="Sắp xếp"
                value={sortMode}
                onChange={(event) => onSortModeChange(event.target.value)}
                fullWidth
                sx={{ ...LIVE_SIDEBAR_FIELD_SX }}
              >
                {SORT_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>

            <Button
              onClick={onClearFilters}
              disabled={!hasActiveFilters}
              sx={{
                minWidth: 48,
                px: 2,
                borderRadius: 1.5,
                textTransform: "none",
                fontWeight: 600,
                color: "var(--live-text)",
                border: "1px solid var(--live-border)",
                bgcolor: "var(--live-surface)",
                "&:hover": {
                  bgcolor: "var(--live-surface-strong)",
                },
                "&.Mui-disabled": {
                  opacity: 0.4,
                }
              }}
            >
              Xóa lọc
            </Button>
          </Stack>
        </Box>

        <Divider sx={{ borderColor: "var(--live-border)" }} />

        <Stack spacing={1.5}>
          <Typography
            variant="overline"
            sx={{ color: "var(--live-text-muted)", fontWeight: 700, lineHeight: 1 }}
          >
             Thống kê Feed
          </Typography>
          <Stack direction="row" spacing={1}>
            {[
              { label: "Đang Live", value: summary?.live || 0 },
              { label: "Nguồn Native", value: summary?.nativeReady || 0 },
            ].map((item) => (
              <Box
                key={item.label}
                sx={{
                  flex: 1,
                  p: 1.5,
                  borderRadius: 1.5,
                  bgcolor: "var(--live-surface)",
                  border: "1px solid var(--live-border)",
                }}
              >
                <Typography variant="caption" sx={{ color: "var(--live-text-muted)", fontWeight: 600 }}>
                  {item.label}
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 700, color: "var(--live-text)", mt: 0.2 }}>
                  {item.value}
                </Typography>
              </Box>
            ))}
          </Stack>
          <Stack direction="row" spacing={1}>
            {[
              { label: "Replay Đầy đủ", value: summary?.completeReplay || 0 },
              { label: "Đang Xử Lý", value: summary?.processingReplay || 0 },
            ].map((item) => (
              <Box
                key={item.label}
                sx={{
                  flex: 1,
                  p: 1.5,
                  borderRadius: 1.5,
                  bgcolor: "var(--live-surface)",
                  border: "1px solid var(--live-border)",
                }}
              >
                <Typography variant="caption" sx={{ color: "var(--live-text-muted)", fontWeight: 600 }}>
                  {item.label}
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 700, color: "var(--live-text)", mt: 0.2 }}>
                  {item.value}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Stack>

        <Divider sx={{ borderColor: "var(--live-border)" }} />

        <Stack spacing={1.5}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography
              variant="overline"
              sx={{ color: "var(--live-hot)", fontWeight: 700, lineHeight: 1 }}
            >
               Tâm điểm hiện tại
            </Typography>
            <Typography variant="caption" sx={{ color: "var(--live-text-muted)", fontWeight: 600 }}>
              {progressLabel}
            </Typography>
          </Box>
          <Box
            sx={{
              p: 2,
              borderRadius: 2,
              bgcolor: "var(--live-surface)",
              border: "1px solid var(--live-border-strong)",
            }}
          >
            <Stack spacing={1.2}>
              <Chip
                size="small"
                label={currentBadge}
                sx={{
                  alignSelf: "flex-start",
                  color: "var(--live-text)",
                  bgcolor: "var(--live-hot-soft)",
                  border: "1px solid var(--live-hot-border)",
                  fontWeight: 600,
                }}
              />
              <Box>
                <Typography variant="body1" sx={{ fontWeight: 700, lineHeight: 1.4, color: "var(--live-text)" }}>
                  {currentTitle}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ color: "var(--live-text-secondary)", mt: 0.25 }}
                >
                  {currentSubtitle}
                </Typography>
              </Box>

              <Stack direction="row" spacing={0.75} useFlexGap flexWrap>
                {currentItem?.courtLabel ? (
                  <Chip
                    size="small"
                    label={currentItem.courtLabel}
                    sx={{
                      color: "var(--live-text)",
                      bgcolor: "var(--live-chip-bg)",
                      border: "1px solid var(--live-border)",
                    }}
                  />
                ) : null}
                {currentItem?.displayCode ? (
                  <Chip
                    size="small"
                    label={currentItem.displayCode}
                    sx={{
                      color: "var(--live-text)",
                      bgcolor: "var(--live-chip-bg)",
                      border: "1px solid var(--live-border)",
                    }}
                  />
                ) : null}
                {currentItem?.smartScore ? (
                  <Chip
                    size="small"
                    label={`${currentItem.smartScore} điểm`}
                    sx={{
                      color: "var(--live-accent)",
                      bgcolor: "var(--live-accent-soft)",
                      border: "1px solid var(--live-accent-border)",
                    }}
                  />
                ) : null}
              </Stack>
              
              <Box sx={{ mt: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={progressValue}
                  sx={{
                    height: 4,
                    borderRadius: 2,
                    bgcolor: "var(--live-chip-bg)",
                    "& .MuiLinearProgress-bar": {
                      borderRadius: 2,
                      background: "linear-gradient(90deg, var(--live-hot), var(--live-accent))",
                    },
                  }}
                />
              </Box>
            </Stack>
          </Box>
        </Stack>
      </Stack>
    </Box>
  );
}
'''

new_text = text[:start_idx] + new_func + '\n' + text[end_idx:]

with open('frontend/src/screens/live/LiveFeedPage.jsx', 'w', encoding='utf-8') as f:
    f.write(new_text)

print("Success!")
