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
        borderRight: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(10, 14, 20, 0.75)",
        backdropFilter: "blur(24px)",
        "&::-webkit-scrollbar": {
          display: "none",
        },
        msOverflowStyle: "none",
        scrollbarWidth: "none",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "30vh",
          background: "radial-gradient(ellipse at top, rgba(37,244,238,0.08), transparent 80%)",
          pointerEvents: "none",
        }}
      />
      <Stack spacing={2.5} sx={{ p: 2.5, position: "relative", zIndex: 1 }}>
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
            sx={{ color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}
          >
            Trải nghiệm xem trận đấu thông minh: ưu tiên phát Live, nguồn video mượt mà & replay đầy đủ tương tác cao.
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
                borderRadius: 2.5,
                textTransform: "none",
                fontWeight: 800,
                py: 1,
                bgcolor: "var(--live-accent)",
                color: "#0a0e14",
                boxShadow: "0 4px 14px rgba(37,244,238,0.25)",
                transition: "transform 140ms ease, box-shadow 140ms ease",
                "&:hover": {
                  bgcolor: "#3cfcf6",
                  boxShadow: "0 6px 20px rgba(37,244,238,0.4)",
                  transform: "translateY(-1px)",
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
                borderRadius: 2.5,
                textTransform: "none",
                fontWeight: 800,
                color: "#fff",
                px: 2.5,
                py: 1,
                bgcolor: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                transition: "all 140ms ease",
                "&:hover": {
                  bgcolor: "rgba(255,255,255,0.12)",
                  borderColor: "rgba(255,255,255,0.2)",
                  transform: "translateY(-1px)",
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
                borderRadius: 2.5,
                textTransform: "none",
                fontWeight: 800,
                py: 1,
                color: "var(--live-hot)",
                borderColor: "rgba(255,107,87,0.3)",
                bgcolor: "rgba(255,107,87,0.08)",
                animation: "pulse-hot 2s infinite ease-in-out",
                "@keyframes pulse-hot": {
                  "0%": { boxShadow: "0 0 0 0 rgba(255,107,87,0.3)" },
                  "70%": { boxShadow: "0 0 0 6px rgba(255,107,87,0)" },
                  "100%": { boxShadow: "0 0 0 0 rgba(255,107,87,0)" },
                },
                "&:hover": {
                  borderColor: "rgba(255,107,87,0.6)",
                  bgcolor: "rgba(255,107,87,0.16)",
                },
              }}
            >
              Có trận mới, nhấn để làm mới feed
            </Button>
          ) : null}
        </Stack>

        <Box
          sx={{
            p: 2,
            borderRadius: 4,
            bgcolor: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            flexDirection: "column",
            gap: 2.5,
            boxShadow: "inset 0 2px 10px rgba(255,255,255,0.01)",
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
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.5)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Lọc nhanh
            </Typography>
            <DraggableChipRail
              ariaLabel="Bộ lọc thông minh"
              items={quickFilters}
              onSelect={(item) => onApplyQuickFilter(item.key)}
            />
          </Stack>

          <Stack spacing={1}>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.5)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Hiển thị thêm bước
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

          <Stack direction="row" spacing={1.5}>
            <TextField
              select
              label="Sắp xếp"
              value={sortMode}
              onChange={(event) => onSortModeChange(event.target.value)}
              sx={{ flex: 1, ...LIVE_SIDEBAR_FIELD_SX }}
            >
              {SORT_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            <Button
              onClick={onClearFilters}
              disabled={!hasActiveFilters}
              sx={{
                flexShrink: 0,
                minWidth: 48,
                px: 2,
                borderRadius: 2.5,
                textTransform: "none",
                fontWeight: 800,
                color: "rgba(255,255,255,0.7)",
                border: "1px solid rgba(255,255,255,0.1)",
                bgcolor: "transparent",
                transition: "all 140ms",
                "&:hover": {
                  color: "#fff",
                  bgcolor: "rgba(255,255,255,0.06)",
                  borderColor: "rgba(255,255,255,0.2)",
                  transform: "translateY(-1px)",
                },
                "&.Mui-disabled": {
                  borderColor: "transparent",
                }
              }}
            >
              Xóa
            </Button>
          </Stack>
        </Box>

        <Divider sx={{ borderColor: "rgba(255,255,255,0.06)", my: 1 }} />

        <Stack spacing={1.5}>
          <Typography
            variant="caption"
            sx={{ color: "var(--live-accent)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}
          >
             • Toàn cảnh Feed
          </Typography>
          <Stack direction="row" spacing={1.5}>
            {[
              { label: "Live", value: summary?.live || 0, highlight: true },
              { label: "Replay Native", value: summary?.nativeReady || 0, highlight: false },
            ].map((item) => (
              <Box
                key={item.label}
                sx={{
                  flex: 1,
                  p: 1.5,
                  borderRadius: 3,
                  bgcolor: item.highlight ? "rgba(255,107,87,0.08)" : "rgba(255,255,255,0.03)",
                  border: "1px solid",
                  borderColor: item.highlight ? "rgba(255,107,87,0.2)" : "rgba(255,255,255,0.06)",
                  transition: "transform 140ms ease",
                  "&:hover": {
                    transform: "translateY(-2px)",
                    borderColor: item.highlight ? "rgba(255,107,87,0.4)" : "rgba(255,255,255,0.12)",
                  }
                }}
              >
                <Typography variant="caption" sx={{ color: item.highlight ? "var(--live-hot)" : "rgba(255,255,255,0.6)", fontWeight: 700 }}>
                  {item.label}
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 900, color: item.highlight ? "#fff" : "rgba(255,255,255,0.9)", mt: 0.25 }}>
                  {item.value}
                </Typography>
              </Box>
            ))}
          </Stack>
          <Stack direction="row" spacing={1.5}>
            {[
              { label: "Hoàn tất Replay", value: summary?.completeReplay || 0 },
              { label: "Video đang xử lý", value: summary?.processingReplay || 0 },
            ].map((item) => (
              <Box
                key={item.label}
                sx={{
                  flex: 1,
                  p: 1.5,
                  borderRadius: 3,
                  bgcolor: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  transition: "transform 140ms ease",
                  "&:hover": {
                    transform: "translateY(-2px)",
                    borderColor: "rgba(255,255,255,0.12)",
                  }
                }}
              >
                <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.6)", fontWeight: 700 }}>
                  {item.label}
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 900, color: "rgba(255,255,255,0.9)", mt: 0.25 }}>
                  {item.value}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Stack>

        <Divider sx={{ borderColor: "rgba(255,255,255,0.06)", my: 1 }} />

        <Stack spacing={1.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography
              variant="caption"
              sx={{ color: "var(--live-accent)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}
            >
               • Đang Chiếu
            </Typography>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.5)", fontWeight: 800 }}>
              {progressLabel}
            </Typography>
          </Stack>
          <Box
            sx={{
              p: 2,
              borderRadius: 4,
              bgcolor: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(37,244,238,0.2)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                position: "absolute",
                top: -20,
                right: -20,
                width: 100,
                height: 100,
                background: "radial-gradient(circle, rgba(37,244,238,0.15) 0%, transparent 70%)",
                pointerEvents: "none",
              }}
            />
            
            <Stack spacing={1.2} sx={{ position: "relative", zIndex: 1 }}>
              <Chip
                size="small"
                label={currentBadge}
                sx={{
                  alignSelf: "flex-start",
                  color: "#fff",
                  bgcolor: "rgba(255,107,87,0.2)",
                  border: "1px solid rgba(255,107,87,0.4)",
                  fontWeight: 800,
                  boxShadow: "0 0 10px rgba(255,107,87,0.2)"
                }}
              />
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.3, color: "#fff" }}>
                  {currentTitle}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ color: "rgba(255,255,255,0.6)", mt: 0.5 }}
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
                      color: "rgba(255,255,255,0.8)",
                      bgcolor: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  />
                ) : null}
                {currentItem?.displayCode ? (
                  <Chip
                    size="small"
                    label={currentItem.displayCode}
                    sx={{
                      color: "rgba(255,255,255,0.8)",
                      bgcolor: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  />
                ) : null}
                {currentItem?.smartScore ? (
                  <Chip
                    size="small"
                    label={`${currentItem.smartScore} điểm`}
                    sx={{
                      color: "var(--live-accent)",
                      bgcolor: "rgba(37,244,238,0.1)",
                      border: "1px solid rgba(37,244,238,0.2)",
                    }}
                  />
                ) : null}
              </Stack>
              
              <Box sx={{ mt: 1 }}>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                  <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.4)", fontSize: 10, textTransform: "uppercase" }}>
                    Tiến độ Feed
                  </Typography>
                  <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.5)", fontSize: 10 }}>
                    {loadedCount} / {totalCount || loadedCount || 0}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={progressValue}
                  sx={{
                    height: 4,
                    borderRadius: 999,
                    bgcolor: "rgba(255,255,255,0.08)",
                    "& .MuiLinearProgress-bar": {
                      borderRadius: 999,
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
