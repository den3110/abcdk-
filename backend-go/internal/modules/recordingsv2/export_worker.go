package recordingsv2

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
)

type ExportWorkerProgress struct {
	Status              string
	CurrentRecordingID  string
	CurrentJobStartedAt *time.Time
	Stage               string
}

type ExportWorkerTickResult struct {
	Status              string
	CurrentRecordingID  string
	CurrentJobStartedAt *time.Time
	LastCompletedAt     *time.Time
	LastFailedAt        *time.Time
	LastFailedReason    string
	ExportingCount      int64
	PendingWindowCount  int64
}

var mergeSegmentsToOutputFn = mergeSegmentsToOutput

func (s *Service) ProcessNextExport(ctx context.Context, onProgress func(ExportWorkerProgress)) (ExportWorkerTickResult, error) {
	result := ExportWorkerTickResult{
		Status: "idle",
	}

	recording, err := s.repository.FindNextExportCandidate(ctx)
	if err != nil {
		return result, err
	}
	if recording == nil {
		return s.populateExportWorkerCounts(ctx, result)
	}

	startedAt := time.Now().UTC()
	result.Status = "running"
	result.CurrentRecordingID = recording.ID.Hex()
	result.CurrentJobStartedAt = &startedAt

	progressCtx, stopProgress := context.WithCancel(context.Background())
	defer stopProgress()
	var progressMu sync.RWMutex
	progressState := ExportWorkerProgress{
		Status:              "running",
		CurrentRecordingID:  recording.ID.Hex(),
		CurrentJobStartedAt: &startedAt,
		Stage:               "queued",
	}
	emitProgress := func(stage string) {
		if onProgress == nil {
			return
		}
		progressMu.Lock()
		progressState.Stage = stage
		snapshot := progressState
		progressMu.Unlock()
		onProgress(snapshot)
	}
	if onProgress != nil {
		onProgress(progressState)
		go s.emitExportProgressHeartbeat(progressCtx, &progressMu, &progressState, onProgress)
	}

	exportErr := s.exportRecording(ctx, recording, startedAt, func(stage string) {
		emitProgress(stage)
	})
	stopProgress()

	finishedAt := time.Now().UTC()
	if exportErr != nil {
		result.Status = "failed"
		result.LastFailedAt = &finishedAt
		result.LastFailedReason = exportErr.Error()
	} else {
		result.Status = "idle"
		result.LastCompletedAt = &finishedAt
	}

	return s.populateExportWorkerCounts(ctx, result)
}

func (s *Service) emitExportProgressHeartbeat(ctx context.Context, progressMu *sync.RWMutex, progress *ExportWorkerProgress, onProgress func(ExportWorkerProgress)) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			progressMu.RLock()
			snapshot := *progress
			progressMu.RUnlock()
			onProgress(snapshot)
		}
	}
}

func (s *Service) populateExportWorkerCounts(ctx context.Context, result ExportWorkerTickResult) (ExportWorkerTickResult, error) {
	exportingCount, err := s.CountRecordingsByStatus(ctx, "exporting")
	if err != nil {
		return result, err
	}
	pendingWindowCount, err := s.CountRecordingsByStatus(ctx, "pending_export_window")
	if err != nil {
		return result, err
	}
	result.ExportingCount = exportingCount
	result.PendingWindowCount = pendingWindowCount
	return result, nil
}

func (s *Service) exportRecording(ctx context.Context, recording *RecordingDocument, startedAt time.Time, onStageChange func(stage string)) (err error) {
	if recording == nil {
		return errors.New("Recording not found")
	}

	uploaded := uploadedSegments(recording)
	if len(uploaded) == 0 {
		return s.failRecordingExport(ctx, recording, errors.New("Recording v2 has no uploaded segments"))
	}

	manifestTarget, err := s.resolveRecordingStorageTarget(ctx, recording)
	if err != nil {
		return s.failRecordingExport(ctx, recording, err)
	}
	manifestKey := firstNonEmptyString(strings.TrimSpace(recording.R2ManifestKey), buildRecordingManifestObjectKey(recording.ID.Hex(), recording.Match.Hex()))
	manifest := map[string]any{
		"recordingId":  recording.ID.Hex(),
		"matchId":      recording.Match.Hex(),
		"courtId":      objectIDPtrToValue(recording.CourtID),
		"mode":         recording.Mode,
		"quality":      recording.Quality,
		"r2TargetId":   emptyStringToNil(recording.R2TargetID),
		"r2BucketName": emptyStringToNil(recording.R2BucketName),
		"finalizedAt":  firstNonNilValue(timeToValue(recording.FinalizedAt), startedAt),
		"segments":     serializeUploadedSegmentsForManifest(uploaded, recording),
	}
	if err := s.storage.PutJSON(ctx, *manifestTarget, manifestKey, manifest, "public, max-age=2, stale-while-revalidate=4"); err != nil {
		return s.failRecordingExport(ctx, recording, err)
	}

	recording.R2ManifestKey = manifestKey
	recording.Status = "exporting"
	recording.ExportAttempts++
	recording.Error = ""
	if err := s.updateRecordingExportPipeline(ctx, recording, "downloading", "Worker dang tai segment tu R2", bson.M{
		"startedAt":         startedAt,
		"downloadStartedAt": time.Now().UTC(),
		"error":             nil,
	}); err != nil {
		return err
	}
	if onStageChange != nil {
		onStageChange("downloading")
	}

	workDir, err := buildRecordingExportWorkDir(recording.ID.Hex())
	if err != nil {
		return s.failRecordingExport(ctx, recording, err)
	}
	defer func() {
		_ = os.RemoveAll(workDir)
	}()

	segmentPaths := make([]string, 0, len(uploaded))
	for _, segment := range uploaded {
		target, err := s.resolveTargetByID(ctx, segment.StorageTargetID, recording.R2TargetID)
		if err != nil {
			return s.failRecordingExport(ctx, recording, err)
		}
		localSegmentPath := filepath.Join(workDir, fmt.Sprintf("segment_%05d.mp4", segment.Index))
		if err := s.storage.DownloadObjectToFile(ctx, *target, segment.ObjectKey, localSegmentPath); err != nil {
			return s.failRecordingExport(ctx, recording, err)
		}
		segmentPaths = append(segmentPaths, localSegmentPath)
	}

	if err := s.updateRecordingExportPipeline(ctx, recording, "merging", "Worker dang ghep video", bson.M{
		"mergeStartedAt": time.Now().UTC(),
		"error":          nil,
	}); err != nil {
		return err
	}
	if onStageChange != nil {
		onStageChange("merging")
	}

	outputPath := filepath.Join(workDir, "final.mp4")
	if err := mergeSegmentsToOutputFn(ctx, segmentPaths, outputPath, workDir); err != nil {
		return s.failRecordingExport(ctx, recording, err)
	}

	outputInfo, err := os.Stat(outputPath)
	if err != nil {
		return s.failRecordingExport(ctx, recording, err)
	}

	if err := s.updateRecordingExportPipeline(ctx, recording, "uploading_drive", "Dang upload len Drive", bson.M{
		"driveUploadStartedAt": time.Now().UTC(),
		"error":                nil,
	}); err != nil {
		return err
	}
	if onStageChange != nil {
		onStageChange("uploading_drive")
	}

	uploadResult, err := s.drive.UploadFile(ctx, outputPath, fmt.Sprintf("match_%s_%d.mp4", recording.Match.Hex(), time.Now().UnixMilli()), "video/mp4")
	if err != nil {
		return s.failRecordingExport(ctx, recording, err)
	}

	recording.SizeBytes = outputInfo.Size()
	recording.DurationSeconds = normalizeNumber(sumUploadedDurationSeconds(uploaded))
	recording.DriveFileID = strings.TrimSpace(uploadResult.FileID)
	recording.DriveRawURL = strings.TrimSpace(uploadResult.RawURL)
	recording.DrivePreviewURL = strings.TrimSpace(uploadResult.PreviewURL)
	recording.PlaybackURL = buildRecordingPlaybackURL(recording.ID.Hex())
	recording.Error = ""
	recording.ReadyAt = nowPtr()
	recording.Status = "ready"

	sourceCleanup := bson.M{
		"status": "retained",
		"reason": "config_keep_r2_source",
	}
	if parseBoolEnv("LIVE_RECORDING_DELETE_R2_SOURCE_AFTER_EXPORT", false) {
		if err := s.updateRecordingExportPipeline(ctx, recording, "cleaning_r2", "Dang don segment tren R2", bson.M{
			"driveUploadedAt": time.Now().UTC(),
			"driveAuthMode":   emptyStringToNil(uploadResult.DriveAuthMode),
			"error":           nil,
		}); err != nil {
			return err
		}
		if onStageChange != nil {
			onStageChange("cleaning_r2")
		}

		deletedKeys, deleteErr := s.deleteRecordingSource(ctx, recording, true)
		if deleteErr != nil {
			sourceCleanup = bson.M{
				"status":      "failed",
				"attemptedAt": time.Now().UTC(),
				"error":       deleteErr.Error(),
			}
		} else {
			sourceCleanup = bson.M{
				"status":             "completed",
				"deletedAt":          time.Now().UTC(),
				"deletedObjectCount": len(deletedKeys),
				"deletedManifest":    recording.R2ManifestKey != "",
				"objectKeys":         deletedKeys,
			}
			recording.R2ManifestKey = ""
		}
	}

	meta := mapFromValue(recording.Meta)
	meta["sourceCleanup"] = sourceCleanup
	recording.Meta = meta
	if err := s.updateRecordingExportPipeline(ctx, recording, "completed", "Hoan tat", bson.M{
		"completedAt":   time.Now().UTC(),
		"driveAuthMode": emptyStringToNil(uploadResult.DriveAuthMode),
		"error":         nil,
	}); err != nil {
		return err
	}

	if err := s.repository.SaveRecording(ctx, recording); err != nil {
		return err
	}
	_ = s.repository.UpdateMatchVideo(ctx, recording.Match, buildRecordingPlaybackURL(recording.ID.Hex()))
	return nil
}

func (s *Service) failRecordingExport(ctx context.Context, recording *RecordingDocument, cause error) error {
	if recording == nil {
		return cause
	}
	recording.Status = "failed"
	recording.Error = strings.TrimSpace(cause.Error())
	now := time.Now().UTC()
	recording.ReadyAt = nil

	meta := mapFromValue(recording.Meta)
	exportPipeline := mapFromValue(meta["exportPipeline"])
	exportPipeline["stage"] = "failed"
	exportPipeline["label"] = "Export that bai"
	exportPipeline["failedAt"] = now
	exportPipeline["updatedAt"] = now
	exportPipeline["error"] = recording.Error
	meta["exportPipeline"] = exportPipeline
	recording.Meta = meta

	if saveErr := s.repository.SaveRecording(ctx, recording); saveErr != nil {
		return fmt.Errorf("%w (save failed: %v)", cause, saveErr)
	}
	return cause
}

func (s *Service) updateRecordingExportPipeline(ctx context.Context, recording *RecordingDocument, stage, label string, extra bson.M) error {
	if recording == nil {
		return errors.New("Recording not found")
	}
	now := time.Now().UTC()
	meta := mapFromValue(recording.Meta)
	exportPipeline := mapFromValue(meta["exportPipeline"])
	exportPipeline["stage"] = stage
	exportPipeline["label"] = label
	exportPipeline["updatedAt"] = now
	exportPipeline["staleReason"] = nil
	for key, value := range extra {
		exportPipeline[key] = value
	}
	meta["exportPipeline"] = exportPipeline
	recording.Meta = meta
	return s.repository.SaveRecording(ctx, recording)
}

func (s *Service) deleteRecordingSource(ctx context.Context, recording *RecordingDocument, includeManifest bool) ([]string, error) {
	grouped := map[string][]string{}
	push := func(targetID, objectKey string) {
		targetID = strings.TrimSpace(targetID)
		objectKey = strings.TrimSpace(objectKey)
		if targetID == "" || objectKey == "" {
			return
		}
		grouped[targetID] = append(grouped[targetID], objectKey)
	}
	for _, segment := range recording.Segments {
		push(firstNonEmptyString(segment.StorageTargetID, recording.R2TargetID), segment.ObjectKey)
	}
	if includeManifest {
		push(recording.R2TargetID, recording.R2ManifestKey)
	}

	deletedKeys := make([]string, 0)
	for targetID, objectKeys := range grouped {
		target, err := s.resolveTargetByID(ctx, targetID, recording.R2TargetID)
		if err != nil {
			return deletedKeys, err
		}
		deleted, err := s.storage.DeleteObjects(ctx, *target, objectKeys)
		if err != nil {
			return deletedKeys, err
		}
		deletedKeys = append(deletedKeys, deleted...)
	}
	return deletedKeys, nil
}

func buildRecordingExportWorkDir(recordingID string) (string, error) {
	root := strings.TrimSpace(os.Getenv("RECORDING_EXPORT_WORK_DIR"))
	if root == "" {
		root = filepath.Join(os.TempDir(), "pickletour-live-recordings")
	}
	dir := filepath.Join(root, strings.TrimSpace(recordingID), fmt.Sprintf("%d", time.Now().UnixMilli()))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func mergeSegmentsToOutput(ctx context.Context, inputPaths []string, outputPath, workDir string) error {
	concatPath := filepath.Join(workDir, "concat.txt")
	lines := make([]string, 0, len(inputPaths))
	for _, inputPath := range inputPaths {
		lines = append(lines, fmt.Sprintf("file '%s'", escapeFFmpegConcatPath(inputPath)))
	}
	if err := os.WriteFile(concatPath, []byte(strings.Join(lines, "\n")), 0o644); err != nil {
		return err
	}

	concatCopyPath := filepath.Join(workDir, "merged_copy.mp4")
	if err := runFFmpeg(ctx, "-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", concatCopyPath); err == nil {
		if err := runFFmpeg(ctx, "-y", "-i", concatCopyPath, "-map", "0", "-c", "copy", "-movflags", "+faststart", outputPath); err == nil {
			return nil
		}
	}

	return runFFmpeg(ctx, "-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", outputPath)
}

func runFFmpeg(ctx context.Context, args ...string) error {
	binary := strings.TrimSpace(os.Getenv("FFMPEG_PATH"))
	if binary == "" {
		binary = "ffmpeg"
	}
	command := exec.CommandContext(ctx, binary, args...)
	command.Stdout = nil
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if stderr.Len() > 0 {
			return fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
		}
		return err
	}
	return nil
}

func escapeFFmpegConcatPath(path string) string {
	path = filepath.ToSlash(path)
	return strings.ReplaceAll(path, "'", "'\\''")
}

func firstNonNilValue(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}
