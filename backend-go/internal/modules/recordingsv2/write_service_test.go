package recordingsv2

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type stubStorageDriver struct {
	lastPutObjectKey  string
	lastPutPayload    any
	deletedObjectKeys []string
}

func (s *stubStorageDriver) PartSizeBytes() int64 { return 8 * 1024 * 1024 }

func (s *stubStorageDriver) CreateSegmentUploadURL(_ context.Context, target StorageTarget, objectKey, contentType string) (map[string]any, error) {
	return map[string]any{
		"uploadUrl":        "https://upload.example.com/" + objectKey,
		"objectKey":        objectKey,
		"expiresInSeconds": 1200,
		"method":           "PUT",
		"headers": map[string]any{
			"Content-Type": contentType,
		},
		"storageTargetId": target.ID,
		"bucketName":      target.BucketName,
	}, nil
}

func (s *stubStorageDriver) CreateManifestUploadURL(_ context.Context, target StorageTarget, objectKey string) (map[string]any, error) {
	return map[string]any{
		"uploadUrl":        "https://upload.example.com/" + objectKey,
		"objectKey":        objectKey,
		"expiresInSeconds": 43200,
		"method":           "PUT",
		"headers": map[string]any{
			"Content-Type": "application/json; charset=utf-8",
		},
		"storageTargetId": target.ID,
		"bucketName":      target.BucketName,
	}, nil
}

func (s *stubStorageDriver) CreateObjectDownloadURL(_ context.Context, target StorageTarget, objectKey string, expiresIn time.Duration) (map[string]any, error) {
	return map[string]any{
		"downloadUrl":      "https://download.example.com/" + objectKey,
		"objectKey":        objectKey,
		"expiresInSeconds": int(expiresIn / time.Second),
		"method":           "GET",
		"storageTargetId":  target.ID,
		"bucketName":       target.BucketName,
	}, nil
}

func (s *stubStorageDriver) StartMultipartUpload(_ context.Context, target StorageTarget, objectKey, contentType string) (map[string]any, error) {
	return map[string]any{
		"uploadId":        "upload-123",
		"objectKey":       objectKey,
		"partSizeBytes":   s.PartSizeBytes(),
		"contentType":     contentType,
		"storageTargetId": target.ID,
		"bucketName":      target.BucketName,
	}, nil
}

func (s *stubStorageDriver) CreateMultipartPartUploadURL(_ context.Context, target StorageTarget, objectKey, uploadID string, partNumber int) (map[string]any, error) {
	return map[string]any{
		"uploadUrl":        "https://upload.example.com/" + objectKey + "/part",
		"objectKey":        objectKey,
		"uploadId":         uploadID,
		"partNumber":       partNumber,
		"expiresInSeconds": 1200,
		"method":           "PUT",
		"headers":          map[string]any{},
		"storageTargetId":  target.ID,
		"bucketName":       target.BucketName,
	}, nil
}

func (s *stubStorageDriver) CompleteMultipartUpload(_ context.Context, _ StorageTarget, _ string, _ string, _ []map[string]any) error {
	return nil
}

func (s *stubStorageDriver) AbortMultipartUpload(_ context.Context, _ StorageTarget, _ string, _ string) error {
	return nil
}

func (s *stubStorageDriver) PutJSON(_ context.Context, _ StorageTarget, objectKey string, payload any, _ string) error {
	s.lastPutObjectKey = objectKey
	s.lastPutPayload = payload
	return nil
}

func (s *stubStorageDriver) DownloadObjectToFile(_ context.Context, _ StorageTarget, objectKey, targetPath string) error {
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(targetPath, []byte("stub:"+objectKey), 0o644)
}

func (s *stubStorageDriver) DeleteObjects(_ context.Context, _ StorageTarget, objectKeys []string) ([]string, error) {
	s.deletedObjectKeys = append(s.deletedObjectKeys, objectKeys...)
	return append([]string(nil), objectKeys...), nil
}

func TestStartRecordingCreatesNewRecording(t *testing.T) {
	repository := &stubRepository{
		matchByID: &MatchDocument{
			ID: primitive.NewObjectID(),
		},
		storageTargets: []StorageTarget{
			{ID: "r2-01", BucketName: "recordings", Endpoint: "https://example.r2.cloudflarestorage.com", AccessKeyID: "key", SecretAccessKey: "secret", Enabled: true},
		},
	}
	service := NewService(repository, &stubStorageDriver{})

	payload, statusCode, err := service.StartRecording(context.Background(), StartRecordingInput{
		MatchID: repository.matchByID.ID.Hex(),
		Mode:    "stream_and_record",
		Quality: "1080p",
	})
	if err != nil {
		t.Fatalf("StartRecording returned error: %v", err)
	}
	if statusCode != 200 {
		t.Fatalf("expected 200, got %d", statusCode)
	}
	if repository.insertedRecording == nil {
		t.Fatalf("expected inserted recording to be stored")
	}
	if repository.insertedRecording.R2TargetID != "r2-01" {
		t.Fatalf("unexpected storage target: %s", repository.insertedRecording.R2TargetID)
	}
	if payload["ok"] != true {
		t.Fatalf("expected ok=true, got %v", payload["ok"])
	}
}

func TestFinalizeRecordingBuildsManifestAndExportState(t *testing.T) {
	t.Setenv("LIVE_RECORDING_EXPORT_WINDOW_ENABLED", "false")
	t.Setenv("LIVE_RECORDING_PLAYBACK_BASE_URL", "https://api.example.com")

	recordingID := primitive.NewObjectID()
	matchID := primitive.NewObjectID()
	repository := &stubRepository{
		recordingByID: &RecordingDocument{
			ID:                 recordingID,
			Match:              matchID,
			Mode:               "STREAM_AND_RECORD",
			Quality:            "1080p",
			RecordingSessionID: "session-1",
			Status:             "uploading",
			R2TargetID:         "r2-01",
			R2BucketName:       "recordings",
			Meta:               bson.M{},
			Segments: []SegmentDocument{
				{
					Index:           0,
					ObjectKey:       "recordings/v2/matches/a/b/segments/segment_00000.mp4",
					StorageTargetID: "r2-01",
					BucketName:      "recordings",
					UploadStatus:    "uploaded",
					SizeBytes:       1024,
					DurationSeconds: 12.5,
					IsFinal:         true,
				},
			},
		},
		storageTargets: []StorageTarget{
			{ID: "r2-01", BucketName: "recordings", Endpoint: "https://example.r2.cloudflarestorage.com", AccessKeyID: "key", SecretAccessKey: "secret", Enabled: true},
		},
	}
	storage := &stubStorageDriver{}
	service := NewService(repository, storage)

	payload, statusCode, err := service.FinalizeRecording(context.Background(), recordingID.Hex(), false, "recording_export_queued")
	if err != nil {
		t.Fatalf("FinalizeRecording returned error: %v", err)
	}
	if statusCode != 200 {
		t.Fatalf("expected 200, got %d", statusCode)
	}
	if repository.savedRecording == nil {
		t.Fatalf("expected saved recording")
	}
	if repository.savedRecording.Status != "exporting" {
		t.Fatalf("expected status exporting, got %s", repository.savedRecording.Status)
	}
	if storage.lastPutObjectKey == "" {
		t.Fatalf("expected manifest upload to be written")
	}
	if repository.updatedMatchID != matchID {
		t.Fatalf("expected match video update")
	}
	if payload["queued"] != true {
		t.Fatalf("expected queued=true, got %v", payload["queued"])
	}
}

func TestGetTemporaryPlaylistBuildsSegmentLinks(t *testing.T) {
	t.Setenv("LIVE_RECORDING_PLAYBACK_BASE_URL", "https://api.example.com")
	recordingID := primitive.NewObjectID()
	matchID := primitive.NewObjectID()
	finalizedAt := time.Now().UTC()
	repository := &stubRepository{
		recordingByID: &RecordingDocument{
			ID:          recordingID,
			Match:       matchID,
			Status:      "uploading",
			FinalizedAt: &finalizedAt,
			R2TargetID:  "r2-01",
			Segments: []SegmentDocument{
				{
					Index:           0,
					ObjectKey:       "recordings/v2/matches/a/b/segments/segment_00000.mp4",
					StorageTargetID: "r2-01",
					BucketName:      "recordings",
					UploadStatus:    "uploaded",
					SizeBytes:       2048,
					DurationSeconds: 9.5,
					IsFinal:         true,
				},
			},
		},
		storageTargets: []StorageTarget{
			{ID: "r2-01", BucketName: "recordings", Endpoint: "https://example.r2.cloudflarestorage.com", AccessKeyID: "key", SecretAccessKey: "secret", Enabled: true},
		},
	}
	service := NewService(repository, &stubStorageDriver{})

	payload, statusCode, _, err := service.GetTemporaryPlaylist(context.Background(), recordingID.Hex())
	if err != nil {
		t.Fatalf("GetTemporaryPlaylist returned error: %v", err)
	}
	if statusCode != 200 {
		t.Fatalf("expected 200, got %d", statusCode)
	}
	segments := payload["segments"].([]map[string]any)
	if len(segments) != 1 {
		t.Fatalf("expected 1 segment, got %d", len(segments))
	}
	if segments[0]["url"] != "https://download.example.com/recordings/v2/matches/a/b/segments/segment_00000.mp4" {
		t.Fatalf("unexpected segment url: %v", segments[0]["url"])
	}
}

func TestProcessNextExportCompletesRecordingAndUpdatesMatchVideo(t *testing.T) {
	t.Setenv("LIVE_RECORDING_PLAYBACK_BASE_URL", "https://api.example.com")
	t.Setenv("LIVE_RECORDING_DELETE_R2_SOURCE_AFTER_EXPORT", "true")

	recordingID := primitive.NewObjectID()
	matchID := primitive.NewObjectID()
	finalizedAt := time.Now().UTC()
	repository := &stubRepository{
		nextExportRecord: &RecordingDocument{
			ID:            recordingID,
			Match:         matchID,
			Mode:          "STREAM_AND_RECORD",
			Quality:       "1080p",
			Status:        "exporting",
			R2TargetID:    "r2-01",
			R2BucketName:  "recordings",
			R2ManifestKey: "recordings/v2/matches/a/b/manifest.json",
			FinalizedAt:   &finalizedAt,
			Meta:          bson.M{"exportPipeline": bson.M{}},
			Segments: []SegmentDocument{
				{
					Index:           0,
					ObjectKey:       "recordings/v2/matches/a/b/segments/segment_00000.mp4",
					StorageTargetID: "r2-01",
					BucketName:      "recordings",
					UploadStatus:    "uploaded",
					SizeBytes:       1024,
					DurationSeconds: 10,
					IsFinal:         true,
				},
			},
		},
		storageTargets: []StorageTarget{
			{ID: "r2-01", BucketName: "recordings", Endpoint: "https://example.r2.cloudflarestorage.com", AccessKeyID: "key", SecretAccessKey: "secret", Enabled: true},
		},
		recordingCounts: map[string]int64{
			"exporting":             0,
			"pending_export_window": 0,
		},
	}
	storage := &stubStorageDriver{}
	drive := &stubDriveProxy{
		uploadResult: &DriveUploadResult{
			FileID:        "drive-file-id",
			RawURL:        "https://drive.example.com/raw.mp4",
			PreviewURL:    "https://drive.example.com/preview",
			DriveAuthMode: "serviceAccount",
		},
	}
	service := NewServiceWithDrive(repository, storage, drive)

	originalMerge := mergeSegmentsToOutputFn
	mergeSegmentsToOutputFn = func(_ context.Context, _ []string, outputPath, _ string) error {
		return os.WriteFile(outputPath, []byte("final-video"), 0o644)
	}
	defer func() {
		mergeSegmentsToOutputFn = originalMerge
	}()

	result, err := service.ProcessNextExport(context.Background(), nil)
	if err != nil {
		t.Fatalf("ProcessNextExport returned error: %v", err)
	}
	if result.LastCompletedAt == nil {
		t.Fatalf("expected LastCompletedAt to be set")
	}
	if repository.savedRecording == nil {
		t.Fatalf("expected saved recording")
	}
	if repository.savedRecording.Status != "ready" {
		t.Fatalf("expected ready status, got %s", repository.savedRecording.Status)
	}
	if repository.savedRecording.DriveFileID != "drive-file-id" {
		t.Fatalf("unexpected drive file id: %s", repository.savedRecording.DriveFileID)
	}
	if repository.updatedMatchVideo != "https://api.example.com/api/live/recordings/v2/"+recordingID.Hex()+"/play" {
		t.Fatalf("unexpected match video url: %s", repository.updatedMatchVideo)
	}
	sourceCleanup := mapFromValue(repository.savedRecording.Meta["sourceCleanup"])
	if sourceCleanup["status"] != "completed" {
		t.Fatalf("expected completed source cleanup, got %v", sourceCleanup["status"])
	}
	if len(storage.deletedObjectKeys) != 2 {
		t.Fatalf("expected 2 deleted objects, got %d", len(storage.deletedObjectKeys))
	}
	if drive.lastUploadType != "video/mp4" {
		t.Fatalf("unexpected upload mime type: %s", drive.lastUploadType)
	}
}

func TestProcessNextExportMarksRecordingFailedWhenDriveUploadFails(t *testing.T) {
	recordingID := primitive.NewObjectID()
	repository := &stubRepository{
		nextExportRecord: &RecordingDocument{
			ID:           recordingID,
			Match:        primitive.NewObjectID(),
			Status:       "exporting",
			R2TargetID:   "r2-01",
			R2BucketName: "recordings",
			Meta:         bson.M{"exportPipeline": bson.M{}},
			Segments: []SegmentDocument{
				{
					Index:           0,
					ObjectKey:       "recordings/v2/matches/a/b/segments/segment_00000.mp4",
					StorageTargetID: "r2-01",
					BucketName:      "recordings",
					UploadStatus:    "uploaded",
					SizeBytes:       1024,
					DurationSeconds: 10,
					IsFinal:         true,
				},
			},
		},
		storageTargets: []StorageTarget{
			{ID: "r2-01", BucketName: "recordings", Endpoint: "https://example.r2.cloudflarestorage.com", AccessKeyID: "key", SecretAccessKey: "secret", Enabled: true},
		},
		recordingCounts: map[string]int64{
			"exporting":             0,
			"pending_export_window": 0,
		},
	}
	storage := &stubStorageDriver{}
	drive := &stubDriveProxy{
		uploadErr: errors.New("drive upload failed"),
	}
	service := NewServiceWithDrive(repository, storage, drive)

	originalMerge := mergeSegmentsToOutputFn
	mergeSegmentsToOutputFn = func(_ context.Context, _ []string, outputPath, _ string) error {
		return os.WriteFile(outputPath, []byte("final-video"), 0o644)
	}
	defer func() {
		mergeSegmentsToOutputFn = originalMerge
	}()

	result, err := service.ProcessNextExport(context.Background(), nil)
	if err != nil {
		t.Fatalf("ProcessNextExport returned unexpected error: %v", err)
	}
	if result.LastFailedReason != "drive upload failed" {
		t.Fatalf("unexpected LastFailedReason: %s", result.LastFailedReason)
	}
	if repository.savedRecording == nil {
		t.Fatalf("expected saved recording")
	}
	if repository.savedRecording.Status != "failed" {
		t.Fatalf("expected failed status, got %s", repository.savedRecording.Status)
	}
	if repository.savedRecording.Error != "drive upload failed" {
		t.Fatalf("unexpected recording error: %s", repository.savedRecording.Error)
	}
}
