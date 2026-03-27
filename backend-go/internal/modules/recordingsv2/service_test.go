package recordingsv2

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type stubDriveProxy struct {
	probeResult      *DriveProbeResult
	probeErr         error
	streamResult     *DriveStreamResult
	streamErr        error
	uploadResult     *DriveUploadResult
	uploadErr        error
	lastProbeFileID  string
	lastStreamFileID string
	lastRangeHeader  string
	lastUploadPath   string
	lastUploadName   string
	lastUploadType   string
}

func (s *stubDriveProxy) Probe(_ context.Context, fileID string) (*DriveProbeResult, error) {
	s.lastProbeFileID = fileID
	return s.probeResult, s.probeErr
}

func (s *stubDriveProxy) Stream(_ context.Context, fileID, rangeHeader string) (*DriveStreamResult, error) {
	s.lastStreamFileID = fileID
	s.lastRangeHeader = rangeHeader
	return s.streamResult, s.streamErr
}

func (s *stubDriveProxy) UploadFile(_ context.Context, filePath, fileName, mimeType string) (*DriveUploadResult, error) {
	s.lastUploadPath = filePath
	s.lastUploadName = fileName
	s.lastUploadType = mimeType
	return s.uploadResult, s.uploadErr
}

type stubRepository struct {
	recordingByMatch   *RecordingDocument
	recordingByID      *RecordingDocument
	nextExportRecord   *RecordingDocument
	autoExportRecords  []*RecordingDocument
	recordingBySession *RecordingDocument
	matchByID          *MatchDocument
	playbackConfig     LivePlaybackConfig
	storageTargets     []StorageTarget
	systemSettings     bson.M
	configValues       map[string]string
	monitorRecordings  []bson.M
	activeJob          bson.M
	recentJobs         []bson.M
	countsByStatus     map[string]int64
	activeJobByRecord  bson.M
	completedJob       bson.M
	promotedScheduled  int64
	recordingCounts    map[string]int64
	findErr            error
	configErr          error
	insertedRecording  *RecordingDocument
	savedRecording     *RecordingDocument
	updatedMatchID     primitive.ObjectID
	updatedMatchVideo  string
}

func (s *stubRepository) FindByMatch(_ context.Context, _ primitive.ObjectID) (*RecordingDocument, error) {
	return s.recordingByMatch, s.findErr
}

func (s *stubRepository) FindByID(_ context.Context, _ primitive.ObjectID) (*RecordingDocument, error) {
	return s.recordingByID, s.findErr
}

func (s *stubRepository) FindNextExportCandidate(_ context.Context) (*RecordingDocument, error) {
	return s.nextExportRecord, s.findErr
}

func (s *stubRepository) ListAutoExportCandidates(_ context.Context) ([]*RecordingDocument, error) {
	return s.autoExportRecords, s.findErr
}

func (s *stubRepository) FindByRecordingSessionID(_ context.Context, _ string) (*RecordingDocument, error) {
	return s.recordingBySession, s.findErr
}

func (s *stubRepository) FindMatchByID(_ context.Context, _ primitive.ObjectID) (*MatchDocument, error) {
	return s.matchByID, s.findErr
}

func (s *stubRepository) InsertRecording(_ context.Context, recording *RecordingDocument) error {
	s.insertedRecording = recording
	return s.findErr
}

func (s *stubRepository) SaveRecording(_ context.Context, recording *RecordingDocument) error {
	s.savedRecording = recording
	s.recordingByID = recording
	return s.findErr
}

func (s *stubRepository) UpdateMatchVideo(_ context.Context, matchID primitive.ObjectID, videoURL string) error {
	s.updatedMatchID = matchID
	s.updatedMatchVideo = videoURL
	return s.findErr
}

func (s *stubRepository) LoadStorageTargets(_ context.Context) ([]StorageTarget, error) {
	return s.storageTargets, s.configErr
}

func (s *stubRepository) LoadLivePlaybackConfig(_ context.Context) (LivePlaybackConfig, error) {
	return s.playbackConfig, s.configErr
}

func (s *stubRepository) LoadSystemSettings(_ context.Context) (bson.M, error) {
	return s.systemSettings, s.configErr
}

func (s *stubRepository) LoadConfigValues(_ context.Context, keys ...string) (map[string]string, error) {
	values := make(map[string]string, len(keys))
	for _, key := range keys {
		values[key] = s.configValues[key]
	}
	return values, s.configErr
}

func (s *stubRepository) ListMonitorRecordings(_ context.Context) ([]bson.M, error) {
	return s.monitorRecordings, s.findErr
}

func (s *stubRepository) FindActiveAICommentaryJob(_ context.Context) (bson.M, error) {
	return s.activeJob, s.findErr
}

func (s *stubRepository) ListRecentAICommentaryJobs(_ context.Context, _ int64) ([]bson.M, error) {
	return s.recentJobs, s.findErr
}

func (s *stubRepository) CountAICommentaryJobsByStatus(_ context.Context, status string) (int64, error) {
	return s.countsByStatus[status], s.findErr
}

func (s *stubRepository) FindActiveAICommentaryJobByRecording(_ context.Context, _ primitive.ObjectID) (bson.M, error) {
	return s.activeJobByRecord, s.findErr
}

func (s *stubRepository) FindCompletedAICommentaryJobByFingerprint(_ context.Context, _ primitive.ObjectID, _ string) (bson.M, error) {
	return s.completedJob, s.findErr
}

func (s *stubRepository) InsertAICommentaryJob(_ context.Context, job bson.M) (primitive.ObjectID, error) {
	if job == nil {
		return primitive.NilObjectID, s.findErr
	}
	if _, ok := job["_id"]; !ok {
		job["_id"] = primitive.NewObjectID()
	}
	s.activeJob = job
	return job["_id"].(primitive.ObjectID), s.findErr
}

func (s *stubRepository) PromoteScheduledExports(_ context.Context, _ time.Time) (int64, error) {
	return s.promotedScheduled, s.findErr
}

func (s *stubRepository) CountRecordingsByStatus(_ context.Context, status string) (int64, error) {
	return s.recordingCounts[status], s.findErr
}

func TestGetRecordingByMatchSerializesPlaybackAndCommentary(t *testing.T) {
	t.Setenv("LIVE_RECORDING_PLAYBACK_BASE_URL", "https://api.example.com")

	recordingID := primitive.NewObjectID()
	matchID := primitive.NewObjectID()
	courtID := primitive.NewObjectID()
	finalizedAt := time.Date(2026, 3, 26, 12, 0, 0, 0, time.UTC)
	readyAt := finalizedAt.Add(2 * time.Minute)

	service := NewService(&stubRepository{
		recordingByMatch: &RecordingDocument{
			ID:                 recordingID,
			Match:              matchID,
			CourtID:            &courtID,
			Mode:               "STREAM_AND_RECORD",
			Quality:            "1080p",
			Status:             "ready",
			RecordingSessionID: "session-1",
			DurationSeconds:    120.25,
			SizeBytes:          1024,
			R2TargetID:         "target-a",
			R2BucketName:       "bucket-a",
			DriveRawURL:        "https://drive.example.com/raw.mp4",
			DrivePreviewURL:    "https://drive.example.com/preview",
			ExportAttempts:     2,
			FinalizedAt:        &finalizedAt,
			ReadyAt:            &readyAt,
			CreatedAt:          &finalizedAt,
			UpdatedAt:          &readyAt,
			Meta: bson.M{
				"exportPipeline": bson.M{
					"driveAuthMode": "serviceAccount",
				},
				"storageFailoverHistory": bson.A{
					bson.M{
						"fromTargetId": "target-a",
						"toTargetId":   "target-b",
						"reason":       "recording_write_target_reselected",
						"checkedAt":    finalizedAt,
					},
				},
				"livePlayback": bson.M{
					"manifestUrl":       "https://cdn.example.com/live-manifest.json",
					"publicBaseUrl":     "https://cdn.example.com",
					"manifestObjectKey": "recordings/v2/live-manifest.json",
				},
			},
			AICommentary: bson.M{
				"status":            "completed",
				"dubbedDriveFileId": "drive-commentary-file",
			},
			Segments: []SegmentDocument{
				{
					Index:           0,
					ObjectKey:       "recordings/v2/segment_00000.mp4",
					StorageTargetID: "target-a",
					BucketName:      "bucket-a",
					UploadStatus:    "uploaded",
					SizeBytes:       1024,
					DurationSeconds: 120.25,
					IsFinal:         true,
					UploadedAt:      &readyAt,
				},
			},
		},
		playbackConfig: LivePlaybackConfig{
			Enabled:             true,
			DelaySeconds:        60,
			ManifestName:        "live-manifest.json",
			GlobalPublicBaseURL: "https://cdn-global.example.com",
			TargetPublicBaseURL: map[string]string{
				"target-a": "https://cdn.example.com",
			},
		},
	}, nil)

	payload, err := service.GetRecordingByMatch(context.Background(), matchID.Hex())
	if err != nil {
		t.Fatalf("GetRecordingByMatch returned error: %v", err)
	}

	recording := payload["recording"].(map[string]any)
	if got := recording["playbackUrl"]; got != "https://api.example.com/api/live/recordings/v2/"+recordingID.Hex()+"/play" {
		t.Fatalf("unexpected playbackUrl: %v", got)
	}
	if got := recording["temporaryPlaybackReady"]; got != true {
		t.Fatalf("expected temporaryPlaybackReady=true, got %v", got)
	}
	if got := recording["driveAuthMode"]; got != "serviceAccount" {
		t.Fatalf("unexpected driveAuthMode: %v", got)
	}

	livePlayback := recording["livePlayback"].(map[string]any)
	if got := livePlayback["manifestUrl"]; got != "https://cdn.example.com/live-manifest.json" {
		t.Fatalf("unexpected live manifest url: %v", got)
	}

	aiCommentary := recording["aiCommentary"].(map[string]any)
	if got := aiCommentary["dubbedPlaybackUrl"]; got != "https://api.example.com/api/live/recordings/v2/"+recordingID.Hex()+"/commentary/play" {
		t.Fatalf("unexpected commentary playback url: %v", got)
	}
	if got := aiCommentary["ready"]; got != true {
		t.Fatalf("expected aiCommentary.ready=true, got %v", got)
	}
}

func TestPlayRecordingRedirectsToRawStreamForDriveFile(t *testing.T) {
	t.Setenv("LIVE_RECORDING_PLAYBACK_BASE_URL", "https://api.example.com")

	recordingID := primitive.NewObjectID()
	service := NewService(&stubRepository{
		recordingByID: &RecordingDocument{
			ID:          recordingID,
			Match:       primitive.NewObjectID(),
			Status:      "ready",
			DriveFileID: "drive-file-id",
		},
	}, nil)

	decision, err := service.PlayRecording(context.Background(), recordingID.Hex())
	if err != nil {
		t.Fatalf("PlayRecording returned error: %v", err)
	}
	if decision.RedirectURL != "https://api.example.com/api/live/recordings/v2/"+recordingID.Hex()+"/raw" {
		t.Fatalf("unexpected redirect url: %s", decision.RedirectURL)
	}
}

func TestPlayRecordingReturnsConflictWhenNotReady(t *testing.T) {
	recordingID := primitive.NewObjectID()
	service := NewService(&stubRepository{
		recordingByID: &RecordingDocument{
			ID:             recordingID,
			Match:          primitive.NewObjectID(),
			Status:         "uploading",
			AICommentary:   bson.M{},
			Meta:           bson.M{},
			Segments:       []SegmentDocument{},
			ExportAttempts: 0,
		},
	}, nil)

	decision, err := service.PlayRecording(context.Background(), recordingID.Hex())
	if err != nil {
		t.Fatalf("PlayRecording returned error: %v", err)
	}
	if decision.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409, got %d", decision.StatusCode)
	}
	if got := decision.Payload["message"]; got != "Recording is not ready yet" {
		t.Fatalf("unexpected message: %v", got)
	}
}

func TestPlayAICommentaryRedirectsToRawCommentary(t *testing.T) {
	t.Setenv("LIVE_RECORDING_PLAYBACK_BASE_URL", "https://api.example.com")

	recordingID := primitive.NewObjectID()
	service := NewService(&stubRepository{
		recordingByID: &RecordingDocument{
			ID:    recordingID,
			Match: primitive.NewObjectID(),
			AICommentary: bson.M{
				"dubbedDriveFileId": "commentary-file",
			},
		},
	}, nil)

	decision, err := service.PlayAICommentary(context.Background(), recordingID.Hex())
	if err != nil {
		t.Fatalf("PlayAICommentary returned error: %v", err)
	}
	if decision.RedirectURL != "https://api.example.com/api/live/recordings/v2/"+recordingID.Hex()+"/commentary/raw" {
		t.Fatalf("unexpected commentary redirect url: %s", decision.RedirectURL)
	}
}

func TestGetRawStatusUsesStoredDriveRawURL(t *testing.T) {
	t.Setenv("LIVE_RECORDING_PLAYBACK_BASE_URL", "https://api.example.com")

	recordingID := primitive.NewObjectID()
	service := NewService(&stubRepository{
		recordingByID: &RecordingDocument{
			ID:          recordingID,
			Match:       primitive.NewObjectID(),
			Status:      "exporting",
			DriveRawURL: "https://drive.example.com/raw.mp4",
		},
	}, nil)

	payload, statusCode, err := service.GetRawStatus(context.Background(), recordingID.Hex())
	if err != nil {
		t.Fatalf("GetRawStatus returned error: %v", err)
	}
	if statusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", statusCode)
	}
	if got := payload["ready"]; got != true {
		t.Fatalf("expected ready=true, got %v", got)
	}
	if got := payload["message"]; got != "Raw video is available via stored Drive raw URL" {
		t.Fatalf("unexpected message: %v", got)
	}
}

func TestGetRawStatusProbesDriveFile(t *testing.T) {
	recordingID := primitive.NewObjectID()
	drive := &stubDriveProxy{
		probeResult: &DriveProbeResult{
			DriveAuthMode: "serviceAccount",
			StatusCode:    http.StatusPartialContent,
			ContentType:   "video/mp4",
			ContentLength: "1",
			ContentRange:  "bytes 0-0/100",
			AcceptRanges:  "bytes",
			CheckedAt:     time.Date(2026, 3, 26, 12, 0, 0, 0, time.UTC),
		},
	}
	service := NewServiceWithDrive(&stubRepository{
		recordingByID: &RecordingDocument{
			ID:          recordingID,
			Match:       primitive.NewObjectID(),
			Status:      "ready",
			DriveFileID: "drive-file-id",
		},
	}, nil, drive)

	payload, statusCode, err := service.GetRawStatus(context.Background(), recordingID.Hex())
	if err != nil {
		t.Fatalf("GetRawStatus returned error: %v", err)
	}
	if statusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", statusCode)
	}
	if drive.lastProbeFileID != "drive-file-id" {
		t.Fatalf("expected probe on drive-file-id, got %q", drive.lastProbeFileID)
	}
	if got := payload["ready"]; got != true {
		t.Fatalf("expected ready=true, got %v", got)
	}
	probe, ok := payload["probe"].(map[string]any)
	if !ok {
		t.Fatalf("expected probe payload, got %T", payload["probe"])
	}
	if got := probe["driveAuthMode"]; got != "serviceAccount" {
		t.Fatalf("unexpected driveAuthMode: %v", got)
	}
}

func TestGetRawStatusFallsBackToStoredDriveRawURLWhenProbeFails(t *testing.T) {
	recordingID := primitive.NewObjectID()
	service := NewServiceWithDrive(&stubRepository{
		recordingByID: &RecordingDocument{
			ID:          recordingID,
			Match:       primitive.NewObjectID(),
			Status:      "ready",
			DriveFileID: "drive-file-id",
			DriveRawURL: "https://drive.example.com/raw.mp4",
		},
	}, nil, &stubDriveProxy{
		probeErr: io.EOF,
	})

	payload, statusCode, err := service.GetRawStatus(context.Background(), recordingID.Hex())
	if err != nil {
		t.Fatalf("GetRawStatus returned error: %v", err)
	}
	if statusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", statusCode)
	}
	if got := payload["fallbackUrl"]; got != "https://drive.example.com/raw.mp4" {
		t.Fatalf("unexpected fallbackUrl: %v", got)
	}
	if got := payload["warning"]; got == nil {
		t.Fatalf("expected warning in payload")
	}
}

func TestGetRawStreamDecisionStreamsDriveFile(t *testing.T) {
	recordingID := primitive.NewObjectID()
	drive := &stubDriveProxy{
		streamResult: &DriveStreamResult{
			StatusCode: http.StatusPartialContent,
			Headers: http.Header{
				"Content-Type": []string{"video/mp4"},
			},
			Body: io.NopCloser(strings.NewReader("video")),
		},
	}
	service := NewServiceWithDrive(&stubRepository{
		recordingByID: &RecordingDocument{
			ID:          recordingID,
			Match:       primitive.NewObjectID(),
			Status:      "ready",
			DriveFileID: "drive-file-id",
			SizeBytes:   4096,
		},
	}, nil, drive)

	decision, err := service.GetRawStreamDecision(context.Background(), recordingID.Hex(), false, "bytes=0-10")
	if err != nil {
		t.Fatalf("GetRawStreamDecision returned error: %v", err)
	}
	if decision.Stream == nil {
		t.Fatalf("expected stream result")
	}
	if drive.lastRangeHeader != "bytes=0-10" {
		t.Fatalf("unexpected range header: %q", drive.lastRangeHeader)
	}
	if decision.FallbackSizeBytes != 4096 {
		t.Fatalf("unexpected fallback size: %d", decision.FallbackSizeBytes)
	}
}

func TestGetRawStreamDecisionFallsBackToStoredRawURLOnStreamFailure(t *testing.T) {
	recordingID := primitive.NewObjectID()
	service := NewServiceWithDrive(&stubRepository{
		recordingByID: &RecordingDocument{
			ID:          recordingID,
			Match:       primitive.NewObjectID(),
			Status:      "ready",
			DriveFileID: "drive-file-id",
			DriveRawURL: "https://drive.example.com/raw.mp4",
		},
	}, nil, &stubDriveProxy{
		streamErr: io.ErrUnexpectedEOF,
	})

	decision, err := service.GetRawStreamDecision(context.Background(), recordingID.Hex(), false, "")
	if err != nil {
		t.Fatalf("GetRawStreamDecision returned error: %v", err)
	}
	if decision.RedirectURL != "https://drive.example.com/raw.mp4" {
		t.Fatalf("unexpected redirect url: %q", decision.RedirectURL)
	}
}

func TestPromoteDueScheduledExportsDelegatesToRepository(t *testing.T) {
	repository := &stubRepository{
		promotedScheduled: 3,
	}
	service := NewService(repository, nil)

	promoted, err := service.PromoteDueScheduledExports(context.Background(), time.Now().UTC())
	if err != nil {
		t.Fatalf("PromoteDueScheduledExports returned error: %v", err)
	}
	if promoted != 3 {
		t.Fatalf("expected 3 promoted recordings, got %d", promoted)
	}
}

func TestCountRecordingsByStatusDelegatesToRepository(t *testing.T) {
	repository := &stubRepository{
		recordingCounts: map[string]int64{
			"exporting": 5,
		},
	}
	service := NewService(repository, nil)

	count, err := service.CountRecordingsByStatus(context.Background(), "exporting")
	if err != nil {
		t.Fatalf("CountRecordingsByStatus returned error: %v", err)
	}
	if count != 5 {
		t.Fatalf("expected 5 exporting recordings, got %d", count)
	}
}

func TestAutoExportInactiveRecordingsQueuesIdleUploadingRecording(t *testing.T) {
	t.Setenv("LIVE_RECORDING_EXPORT_WINDOW_ENABLED", "false")
	t.Setenv("LIVE_RECORDING_PLAYBACK_BASE_URL", "https://api.example.com")

	now := time.Date(2026, 3, 26, 12, 0, 0, 0, time.UTC)
	recordingID := primitive.NewObjectID()
	matchID := primitive.NewObjectID()
	latestActivity := now.Add(-20 * time.Minute)
	repository := &stubRepository{
		autoExportRecords: []*RecordingDocument{
			{
				ID:           recordingID,
				Match:        matchID,
				Status:       "uploading",
				Mode:         "STREAM_AND_RECORD",
				Quality:      "1080p",
				R2TargetID:   "r2-01",
				R2BucketName: "recordings",
				Meta:         bson.M{},
				Segments: []SegmentDocument{
					{
						Index:           0,
						ObjectKey:       "recordings/v2/matches/a/b/segments/segment_00000.mp4",
						StorageTargetID: "r2-01",
						BucketName:      "recordings",
						UploadStatus:    "uploaded",
						SizeBytes:       1024,
						DurationSeconds: 12,
						UploadedAt:      &latestActivity,
					},
					{
						Index:           1,
						ObjectKey:       "recordings/v2/matches/a/b/segments/segment_00001.mp4",
						StorageTargetID: "r2-01",
						BucketName:      "recordings",
						UploadStatus:    "uploading_parts",
						Meta: bson.M{
							"lastPartUploadedAt": latestActivity,
						},
					},
				},
			},
		},
		storageTargets: []StorageTarget{
			{ID: "r2-01", BucketName: "recordings", Endpoint: "https://example.r2.cloudflarestorage.com", AccessKeyID: "key", SecretAccessKey: "secret", Enabled: true},
		},
		systemSettings: bson.M{
			"liveRecording": bson.M{
				"autoExportNoSegmentMinutes": 15,
			},
		},
	}
	storage := &stubStorageDriver{}
	service := NewService(repository, storage)

	result, err := service.AutoExportInactiveRecordings(context.Background(), now)
	if err != nil {
		t.Fatalf("AutoExportInactiveRecordings returned error: %v", err)
	}
	if result.TimeoutMinutes != 15 {
		t.Fatalf("expected timeout 15 minutes, got %d", result.TimeoutMinutes)
	}
	if len(result.QueuedRecordingIDs) != 1 || result.QueuedRecordingIDs[0] != recordingID.Hex() {
		t.Fatalf("unexpected queued recording ids: %#v", result.QueuedRecordingIDs)
	}
	if repository.savedRecording == nil {
		t.Fatalf("expected saved recording")
	}
	if repository.savedRecording.Status != "exporting" {
		t.Fatalf("expected exporting status, got %s", repository.savedRecording.Status)
	}
	autoExportMeta := mapFromValue(repository.savedRecording.Meta["autoExportOnNoSegment"])
	if got := autoExportMeta["timeoutMinutes"]; int(numberFromValue(got)) != 15 {
		t.Fatalf("unexpected auto export timeout: %v", got)
	}
	if got := autoExportMeta["pendingSegmentCount"]; int(numberFromValue(got)) != 1 {
		t.Fatalf("unexpected pending segment count: %v", got)
	}
	exportPipeline := mapFromValue(repository.savedRecording.Meta["exportPipeline"])
	if got := stringFromValue(exportPipeline["forceReason"]); got != "segment_timeout" {
		t.Fatalf("unexpected force reason: %v", got)
	}
	if storage.lastPutObjectKey == "" {
		t.Fatalf("expected manifest upload to be written")
	}
	if repository.updatedMatchVideo != "https://api.example.com/api/live/recordings/v2/"+recordingID.Hex()+"/temp" {
		t.Fatalf("unexpected temporary playback url: %s", repository.updatedMatchVideo)
	}
}

func TestAutoExportInactiveRecordingsSkipsRecentRecording(t *testing.T) {
	now := time.Date(2026, 3, 26, 12, 0, 0, 0, time.UTC)
	recordingID := primitive.NewObjectID()
	latestActivity := now.Add(-5 * time.Minute)
	repository := &stubRepository{
		autoExportRecords: []*RecordingDocument{
			{
				ID:     recordingID,
				Match:  primitive.NewObjectID(),
				Status: "recording",
				Segments: []SegmentDocument{
					{
						Index:        0,
						UploadStatus: "uploaded",
						UploadedAt:   &latestActivity,
					},
				},
			},
		},
		systemSettings: bson.M{
			"liveRecording": bson.M{
				"autoExportNoSegmentMinutes": 15,
			},
		},
	}
	service := NewService(repository, &stubStorageDriver{})

	result, err := service.AutoExportInactiveRecordings(context.Background(), now)
	if err != nil {
		t.Fatalf("AutoExportInactiveRecordings returned error: %v", err)
	}
	if len(result.QueuedRecordingIDs) != 0 {
		t.Fatalf("expected no queued recordings, got %#v", result.QueuedRecordingIDs)
	}
	if repository.savedRecording != nil {
		t.Fatalf("did not expect recording to be saved")
	}
}
