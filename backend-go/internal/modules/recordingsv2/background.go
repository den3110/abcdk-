package recordingsv2

import (
	"context"
	"strings"
	"time"
)

func (s *Service) PromoteDueScheduledExports(ctx context.Context, now time.Time) (int64, error) {
	return s.repository.PromoteScheduledExports(ctx, now.UTC())
}

func (s *Service) CountRecordingsByStatus(ctx context.Context, status string) (int64, error) {
	return s.repository.CountRecordingsByStatus(ctx, strings.TrimSpace(status))
}

func (s *Service) RunAutoExportSweep(ctx context.Context, now time.Time) (AutoExportSweepResult, error) {
	return s.AutoExportInactiveRecordings(ctx, now.UTC())
}
