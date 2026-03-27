package recordingsv2

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"go.mongodb.org/mongo-driver/bson"
)

var (
	ErrInvalidMatchID     = errors.New("matchId is invalid")
	ErrInvalidRecordingID = errors.New("Recording id is invalid")
	ErrRecordingNotFound  = errors.New("Recording not found")
)

type Service struct {
	repository Repository
	storage    StorageDriver
	drive      DriveProxy
}

func NewService(repository Repository, storage StorageDriver) *Service {
	return NewServiceWithDrive(repository, storage, nil)
}

func NewServiceWithDrive(repository Repository, storage StorageDriver, drive DriveProxy) *Service {
	if storage == nil {
		storage = NewR2StorageDriver()
	}
	if drive == nil {
		drive = NewGoogleDriveProxy(repository)
	}
	return &Service{
		repository: repository,
		storage:    storage,
		drive:      drive,
	}
}

func (s *Service) GetRecordingByMatch(ctx context.Context, matchID string) (map[string]any, error) {
	matchObjectID, err := parseObjectID(matchID)
	if err != nil {
		return nil, ErrInvalidMatchID
	}

	recording, err := s.repository.FindByMatch(ctx, matchObjectID)
	if err != nil {
		return nil, err
	}
	if recording == nil {
		return nil, ErrRecordingNotFound
	}

	return map[string]any{
		"ok":        true,
		"recording": s.serializeRecording(ctx, recording),
	}, nil
}

func (s *Service) PlayRecording(ctx context.Context, recordingID string) (*RedirectDecision, error) {
	recording, err := s.loadRecording(ctx, recordingID)
	if err != nil {
		return nil, err
	}

	id := recording.ID.Hex()
	if strings.TrimSpace(recording.DriveFileID) != "" {
		return &RedirectDecision{RedirectURL: buildRecordingRawStreamURL(id)}, nil
	}
	if driveRawURL := strings.TrimSpace(recording.DriveRawURL); driveRawURL != "" {
		return &RedirectDecision{RedirectURL: driveRawURL}, nil
	}
	if strings.TrimSpace(recording.Status) == "ready" {
		if drivePreviewURL := strings.TrimSpace(recording.DrivePreviewURL); drivePreviewURL != "" {
			return &RedirectDecision{RedirectURL: drivePreviewURL}, nil
		}
	}
	if isRecordingTemporaryPlaybackReady(recording) {
		return &RedirectDecision{RedirectURL: buildRecordingTemporaryPlaybackURL(id)}, nil
	}

	return &RedirectDecision{
		StatusCode: http.StatusConflict,
		Payload: map[string]any{
			"ok":        false,
			"status":    recording.Status,
			"message":   "Recording is not ready yet",
			"recording": s.serializeRecording(ctx, recording),
		},
	}, nil
}

func (s *Service) PlayAICommentary(ctx context.Context, recordingID string) (*RedirectDecision, error) {
	recording, err := s.loadRecording(ctx, recordingID)
	if err != nil {
		return nil, err
	}

	commentary := getAICommentaryAsset(recording)
	if commentary.FileID != "" {
		return &RedirectDecision{RedirectURL: buildRecordingAICommentaryRawURL(recording.ID.Hex())}, nil
	}
	if commentary.RawURL != "" {
		return &RedirectDecision{RedirectURL: commentary.RawURL}, nil
	}
	if commentary.PreviewURL != "" {
		return &RedirectDecision{RedirectURL: commentary.PreviewURL}, nil
	}

	return &RedirectDecision{
		StatusCode: http.StatusConflict,
		Payload: map[string]any{
			"ok":        false,
			"status":    firstNonEmptyString(stringFromValue(recording.AICommentary["status"]), "idle"),
			"message":   "AI commentary video is not ready yet",
			"recording": s.serializeRecording(ctx, recording),
		},
	}, nil
}

func (s *Service) GetRawStatus(ctx context.Context, recordingID string) (map[string]any, int, error) {
	recording, err := s.loadRecording(ctx, recordingID)
	if err != nil {
		return nil, 0, err
	}

	links := buildRecordingLinks(recording.ID.Hex())
	payload := map[string]any{
		"ok":           true,
		"ready":        false,
		"status":       recording.Status,
		"rawStreamUrl": emptyStringToNil(links.RawStreamURL),
		"rawStatusUrl": emptyStringToNil(links.RawStatusURL),
		"playbackUrl":  emptyStringToNil(links.PlaybackURL),
		"recording":    s.serializeRecording(ctx, recording),
	}

	if strings.TrimSpace(recording.DriveFileID) == "" && strings.TrimSpace(recording.DriveRawURL) != "" {
		payload["ready"] = true
		payload["message"] = "Raw video is available via stored Drive raw URL"
		return payload, http.StatusOK, nil
	}

	if strings.TrimSpace(recording.DriveFileID) == "" {
		payload["message"] = "Drive file has not been uploaded yet"
		return payload, http.StatusOK, nil
	}

	probe, err := s.drive.Probe(ctx, recording.DriveFileID)
	if err == nil {
		payload["ready"] = true
		payload["message"] = "Raw video is ready to stream"
		payload["probe"] = serializeDriveProbe(probe)
		return payload, http.StatusOK, nil
	}

	if strings.TrimSpace(recording.DriveRawURL) != "" {
		payload["ready"] = true
		payload["message"] = "Raw video fallback to stored Drive raw URL"
		payload["probe"] = nil
		payload["fallbackUrl"] = recording.DriveRawURL
		payload["warning"] = err.Error()
		return payload, http.StatusOK, nil
	}

	payload["ok"] = false
	payload["ready"] = false
	payload["message"] = err.Error()
	return payload, http.StatusBadGateway, nil
}

func (s *Service) loadRecording(ctx context.Context, recordingID string) (*RecordingDocument, error) {
	recordingObjectID, err := parseObjectID(recordingID)
	if err != nil {
		return nil, ErrInvalidRecordingID
	}

	recording, err := s.repository.FindByID(ctx, recordingObjectID)
	if err != nil {
		return nil, err
	}
	if recording == nil {
		return nil, ErrRecordingNotFound
	}

	return recording, nil
}

func (s *Service) serializeRecording(ctx context.Context, recording *RecordingDocument) map[string]any {
	if recording == nil {
		return nil
	}

	playbackConfig, err := s.repository.LoadLivePlaybackConfig(ctx)
	if err != nil {
		playbackConfig = defaultLivePlaybackConfigFromEnv()
	}
	playbackConfig = normalizeLivePlaybackConfig(playbackConfig)
	links := buildRecordingLinks(recording.ID.Hex())
	temporaryPlaybackReady := isRecordingTemporaryPlaybackReady(recording)
	storageFailoverHistory := buildStorageFailoverHistory(recording.Meta)

	var latestStorageFailover any
	if len(storageFailoverHistory) > 0 {
		latestStorageFailover = storageFailoverHistory[len(storageFailoverHistory)-1]
	}

	segments := make([]map[string]any, 0, len(recording.Segments))
	for _, segment := range recording.Segments {
		segments = append(segments, map[string]any{
			"index":           segment.Index,
			"objectKey":       segment.ObjectKey,
			"storageTargetId": emptyStringToNil(firstNonEmptyString(segment.StorageTargetID, recording.R2TargetID)),
			"bucketName":      emptyStringToNil(firstNonEmptyString(segment.BucketName, recording.R2BucketName)),
			"uploadStatus":    segment.UploadStatus,
			"sizeBytes":       segment.SizeBytes,
			"durationSeconds": normalizeNumber(segment.DurationSeconds),
			"isFinal":         segment.IsFinal,
			"uploadedAt":      timeToValue(segment.UploadedAt),
		})
	}

	return map[string]any{
		"id":                     recording.ID.Hex(),
		"matchId":                recording.Match.Hex(),
		"courtId":                objectIDPtrToValue(recording.CourtID),
		"mode":                   recording.Mode,
		"quality":                firstNonEmptyString(recording.Quality, ""),
		"status":                 recording.Status,
		"recordingSessionId":     recording.RecordingSessionID,
		"durationSeconds":        normalizeNumber(recording.DurationSeconds),
		"sizeBytes":              recording.SizeBytes,
		"r2TargetId":             emptyStringToNil(recording.R2TargetID),
		"r2BucketName":           emptyStringToNil(recording.R2BucketName),
		"latestStorageFailover":  latestStorageFailover,
		"storageFailoverHistory": storageFailoverHistory,
		"driveFileId":            emptyStringToNil(recording.DriveFileID),
		"driveRawUrl":            emptyStringToNil(recording.DriveRawURL),
		"drivePreviewUrl":        emptyStringToNil(recording.DrivePreviewURL),
		"playbackUrl":            emptyStringToNil(links.PlaybackURL),
		"rawStreamUrl":           emptyStringToNil(links.RawStreamURL),
		"rawStatusUrl":           emptyStringToNil(links.RawStatusURL),
		"temporaryPlaybackUrl":   emptyStringToNil(links.TemporaryPlaybackURL),
		"temporaryPlaylistUrl":   emptyStringToNil(links.TemporaryPlaylistURL),
		"temporaryPlaybackReady": temporaryPlaybackReady,
		"livePlayback":           buildSerializedLivePlayback(recording, playbackConfig),
		"aiCommentary":           buildAICommentarySummary(recording),
		"rawStreamAvailable":     strings.TrimSpace(recording.DriveFileID) != "" || strings.TrimSpace(recording.DriveRawURL) != "",
		"driveAuthMode":          emptyStringToNil(nestedString(recording.Meta, "exportPipeline", "driveAuthMode")),
		"exportAttempts":         recording.ExportAttempts,
		"error":                  emptyStringToNil(recording.Error),
		"finalizedAt":            timeToValue(recording.FinalizedAt),
		"scheduledExportAt":      timeToValue(recording.ScheduledExportAt),
		"readyAt":                timeToValue(recording.ReadyAt),
		"createdAt":              timeToValue(recording.CreatedAt),
		"updatedAt":              timeToValue(recording.UpdatedAt),
		"segments":               segments,
	}
}

func buildStorageFailoverHistory(meta bson.M) []map[string]any {
	history := make([]map[string]any, 0)
	for _, entryValue := range arrayFromValue(meta["storageFailoverHistory"]) {
		entry := mapFromValue(entryValue)
		serialized := map[string]any{
			"fromTargetId": emptyStringToNil(stringFromValue(entry["fromTargetId"])),
			"toTargetId":   emptyStringToNil(stringFromValue(entry["toTargetId"])),
			"reason":       emptyStringToNil(stringFromValue(entry["reason"])),
			"checkedAt":    timeFromValue(entry["checkedAt"]),
			"detail":       emptyStringToNil(stringFromValue(entry["detail"])),
		}
		if serialized["fromTargetId"] == nil && serialized["toTargetId"] == nil && serialized["reason"] == nil && serialized["checkedAt"] == nil && serialized["detail"] == nil {
			continue
		}
		history = append(history, serialized)
	}
	return history
}
