package recordingsv2

import (
	"context"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
)

const defaultAutoExportNoSegmentMinutes = 15

type AutoExportFailure struct {
	RecordingID string `json:"recordingId"`
	Error       string `json:"error"`
}

type AutoExportSweepResult struct {
	TimeoutMinutes      int                 `json:"timeoutMinutes"`
	QueuedRecordingIDs  []string            `json:"queuedRecordingIds"`
	SkippedRecordingIDs []string            `json:"skippedRecordingIds"`
	Failures            []AutoExportFailure `json:"failures"`
}

type queueRecordingExportOptions struct {
	IgnoreWindow            bool
	PublishReason           string
	ForceReason             string
	ForceFromUploading      bool
	LatestSegmentActivityAt *time.Time
	SegmentTimeoutMinutes   int
}

func (s *Service) AutoExportInactiveRecordings(ctx context.Context, now time.Time) (AutoExportSweepResult, error) {
	result := AutoExportSweepResult{
		TimeoutMinutes: defaultAutoExportNoSegmentMinutes,
	}

	timeoutMinutes, err := s.loadAutoExportNoSegmentMinutes(ctx)
	if err != nil {
		return result, err
	}
	result.TimeoutMinutes = timeoutMinutes

	candidates, err := s.repository.ListAutoExportCandidates(ctx)
	if err != nil {
		return result, err
	}

	timeout := time.Duration(timeoutMinutes) * time.Minute
	now = now.UTC()
	for _, recording := range candidates {
		if recording == nil || recording.ID.IsZero() {
			continue
		}

		latestSegmentActivityAt := latestSegmentActivityTime(recording)
		uploaded := uploadedSegments(recording)
		if len(uploaded) == 0 || latestSegmentActivityAt == nil {
			result.SkippedRecordingIDs = append(result.SkippedRecordingIDs, recording.ID.Hex())
			continue
		}

		idleFor := now.Sub(*latestSegmentActivityAt)
		if idleFor < timeout {
			continue
		}

		err := s.queueRecordingExport(ctx, recording, queueRecordingExportOptions{
			PublishReason:           "recording_export_auto_queued_no_segment",
			ForceReason:             "segment_timeout",
			ForceFromUploading:      strings.TrimSpace(recording.Status) == "uploading",
			LatestSegmentActivityAt: latestSegmentActivityAt,
			SegmentTimeoutMinutes:   timeoutMinutes,
		})
		if err != nil {
			result.Failures = append(result.Failures, AutoExportFailure{
				RecordingID: recording.ID.Hex(),
				Error:       err.Error(),
			})
			continue
		}
		result.QueuedRecordingIDs = append(result.QueuedRecordingIDs, recording.ID.Hex())
	}

	return result, nil
}

func (s *Service) queueRecordingExport(ctx context.Context, recording *RecordingDocument, options queueRecordingExportOptions) error {
	target, err := s.resolveRecordingStorageTarget(ctx, recording)
	if err != nil {
		return err
	}

	sourceStatus := strings.TrimSpace(recording.Status)
	uploaded := uploadedSegments(recording)
	queuedAt := time.Now().UTC()
	decision := buildExportWindowDecision(queuedAt, options.IgnoreWindow)
	manifestKey := buildRecordingManifestObjectKey(recording.ID.Hex(), recording.Match.Hex())
	manifest := map[string]any{
		"recordingId":  recording.ID.Hex(),
		"matchId":      recording.Match.Hex(),
		"courtId":      objectIDPtrToValue(recording.CourtID),
		"mode":         recording.Mode,
		"quality":      recording.Quality,
		"r2TargetId":   emptyStringToNil(recording.R2TargetID),
		"r2BucketName": emptyStringToNil(recording.R2BucketName),
		"finalizedAt":  queuedAt,
		"segments":     serializeUploadedSegmentsForManifest(uploaded, recording),
	}
	if err := s.storage.PutJSON(ctx, *target, manifestKey, manifest, "public, max-age=2, stale-while-revalidate=4"); err != nil {
		return err
	}

	recording.R2ManifestKey = manifestKey
	recording.FinalizedAt = &queuedAt
	if decision.ShouldQueueNow {
		recording.Status = "exporting"
		recording.ScheduledExportAt = nil
	} else {
		recording.Status = "pending_export_window"
		recording.ScheduledExportAt = decision.ScheduledAt
	}
	recording.ReadyAt = nil
	recording.Error = ""
	recording.PlaybackURL = buildRecordingPlaybackURL(recording.ID.Hex())

	meta := mapFromValue(recording.Meta)
	exportPipeline := mapFromValue(meta["exportPipeline"])
	exportPipeline["stage"] = ternaryString(decision.ShouldQueueNow, "queued", "delayed_until_window")
	exportPipeline["label"] = ternaryString(decision.ShouldQueueNow, "Dang cho worker", "Dang cho khung gio dem")
	exportPipeline["queuedAt"] = queuedAt
	exportPipeline["queueJobId"] = nil
	exportPipeline["scheduledExportAt"] = decision.ScheduledAt
	exportPipeline["windowStart"] = decision.WindowStart
	exportPipeline["windowEnd"] = decision.WindowEnd
	exportPipeline["timezone"] = decision.Timezone
	exportPipeline["updatedAt"] = queuedAt
	exportPipeline["error"] = nil
	exportPipeline["publishReason"] = firstNonEmptyString(strings.TrimSpace(options.PublishReason), "recording_export_queued")
	if options.IgnoreWindow || sourceStatus == "pending_export_window" {
		exportPipeline["manualTransitionAt"] = queuedAt
		exportPipeline["manualTransitionSource"] = firstNonEmptyString(sourceStatus, "manual")
	}
	if options.ForceFromUploading {
		exportPipeline["manualTransitionAt"] = queuedAt
		exportPipeline["manualTransitionSource"] = "uploading"
	}
	if strings.TrimSpace(options.ForceReason) != "" {
		exportPipeline["forceReason"] = strings.TrimSpace(options.ForceReason)
		exportPipeline["forceTriggeredAt"] = queuedAt
	}
	meta["exportPipeline"] = exportPipeline

	if strings.TrimSpace(options.ForceReason) == "segment_timeout" {
		meta["autoExportOnNoSegment"] = bson.M{
			"sourceStatus":            sourceStatus,
			"triggeredAt":             queuedAt,
			"latestSegmentActivityAt": timeToValue(options.LatestSegmentActivityAt),
			"timeoutMinutes":          options.SegmentTimeoutMinutes,
			"uploadedSegmentCount":    len(uploaded),
			"pendingSegmentCount":     len(pendingSegments(recording)),
		}
	}

	recording.Meta = meta
	if err := s.repository.SaveRecording(ctx, recording); err != nil {
		return err
	}
	_ = s.repository.UpdateMatchVideo(ctx, recording.Match, buildRecordingTemporaryPlaybackURL(recording.ID.Hex()))
	return nil
}

func (s *Service) loadAutoExportNoSegmentMinutes(ctx context.Context) (int, error) {
	systemSettings, err := s.repository.LoadSystemSettings(ctx)
	if err != nil {
		return defaultAutoExportNoSegmentMinutes, err
	}

	liveRecording := mapFromValue(systemSettings["liveRecording"])
	configured := int(numberFromValue(liveRecording["autoExportNoSegmentMinutes"]))
	if configured >= 1 {
		return configured, nil
	}
	return defaultAutoExportNoSegmentMinutes, nil
}

func latestSegmentActivityTime(recording *RecordingDocument) *time.Time {
	if recording == nil {
		return nil
	}

	var latest time.Time
	for _, segment := range recording.Segments {
		updateLatestSegmentActivity(&latest, segment.UploadedAt)
		meta := mapFromValue(segment.Meta)
		updateLatestSegmentActivity(&latest, meta["lastPartUploadedAt"])
		updateLatestSegmentActivity(&latest, meta["completedAt"])
	}

	if latest.IsZero() {
		return nil
	}
	normalized := latest.UTC()
	return &normalized
}

func updateLatestSegmentActivity(latest *time.Time, value any) {
	if latest == nil {
		return
	}
	timestamp, ok := timeFromValue(value).(time.Time)
	if !ok {
		return
	}
	timestamp = timestamp.UTC()
	if latest.IsZero() || timestamp.After(*latest) {
		*latest = timestamp
	}
}
