package recordingsv2

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

var (
	ErrInvalidMode       = errors.New("mode is invalid")
	ErrMatchNotFound     = errors.New("Match not found")
	ErrStorageNotReady   = errors.New("Recording R2 storage is not configured")
	ErrInvalidSegment    = errors.New("segmentIndex must be >= 0")
	ErrObjectKeyRequired = errors.New("objectKey is required")
)

type StartRecordingInput struct {
	MatchID            string
	Mode               string
	Quality            string
	CourtID            string
	RecordingSessionID string
}

type PresignSegmentInput struct {
	RecordingID  string
	SegmentIndex int
	ContentType  string
}

type PresignBatchInput struct {
	RecordingID       string
	StartSegmentIndex int
	Count             int
	SegmentIndexes    []int
	ContentType       string
}

type MultipartPartInput struct {
	RecordingID  string
	SegmentIndex int
	PartNumber   int
}

type MultipartProgressInput struct {
	RecordingID    string
	SegmentIndex   int
	PartNumber     int
	ETag           string
	SizeBytes      int64
	TotalSizeBytes int64
}

type CompleteMultipartInput struct {
	RecordingID     string
	SegmentIndex    int
	SizeBytes       int64
	DurationSeconds float64
	IsFinal         bool
	Parts           []map[string]any
}

type CompleteSegmentInput struct {
	RecordingID     string
	SegmentIndex    int
	ObjectKey       string
	ETag            string
	SizeBytes       int64
	DurationSeconds float64
	IsFinal         bool
}

func (s *Service) StartRecording(ctx context.Context, input StartRecordingInput) (map[string]any, int, error) {
	matchID, err := parseObjectID(input.MatchID)
	if err != nil {
		return map[string]any{"message": "matchId is required"}, http.StatusBadRequest, nil
	}
	mode := normalizeMode(input.Mode)
	if mode == "" {
		return map[string]any{"message": ErrInvalidMode.Error()}, http.StatusBadRequest, nil
	}

	match, err := s.repository.FindMatchByID(ctx, matchID)
	if err != nil {
		return nil, 0, err
	}
	if match == nil {
		return map[string]any{"message": ErrMatchNotFound.Error()}, http.StatusNotFound, nil
	}

	recordingSessionID := strings.TrimSpace(input.RecordingSessionID)
	if recordingSessionID == "" {
		recordingSessionID = fmt.Sprintf("recording_%d_%s", time.Now().UnixMilli(), primitive.NewObjectID().Hex()[16:])
	}

	recording, err := s.repository.FindByRecordingSessionID(ctx, recordingSessionID)
	if err != nil {
		return nil, 0, err
	}
	targets, err := s.repository.LoadStorageTargets(ctx)
	if err != nil && recording == nil {
		return nil, 0, err
	}
	target := pickStorageTarget(targets, "")

	if recording == nil {
		recording = &RecordingDocument{
			ID:                 primitive.NewObjectID(),
			Match:              match.ID,
			CourtID:            resolveCourtID(input.CourtID, match.CourtID),
			Mode:               mode,
			Quality:            strings.TrimSpace(input.Quality),
			RecordingSessionID: recordingSessionID,
			Status:             "recording",
			Segments:           []SegmentDocument{},
			R2TargetID:         emptyTargetField(target, func(value StorageTarget) string { return value.ID }),
			R2BucketName:       emptyTargetField(target, func(value StorageTarget) string { return value.BucketName }),
			PlaybackURL:        "",
			Meta:               bson.M{},
		}
		recording.R2Prefix = buildRecordingPrefix(recording.ID.Hex(), recording.Match.Hex())
		recording.PlaybackURL = buildRecordingPlaybackURL(recording.ID.Hex())
		if err := s.repository.InsertRecording(ctx, recording); err != nil {
			return nil, 0, err
		}
	} else {
		recording.Mode = mode
		recording.Quality = strings.TrimSpace(input.Quality)
		if recording.CourtID == nil {
			recording.CourtID = resolveCourtID(input.CourtID, match.CourtID)
		}
		if recording.Status == "ready" || strings.TrimSpace(recording.Status) == "" {
			recording.Status = "recording"
		}
		if target := pickStorageTarget(targets, recording.R2TargetID); target != nil {
			recording.R2TargetID = target.ID
			recording.R2BucketName = target.BucketName
		}
		if strings.TrimSpace(recording.PlaybackURL) == "" {
			recording.PlaybackURL = buildRecordingPlaybackURL(recording.ID.Hex())
		}
		if strings.TrimSpace(recording.R2Prefix) == "" {
			recording.R2Prefix = buildRecordingPrefix(recording.ID.Hex(), recording.Match.Hex())
		}
		if err := s.repository.SaveRecording(ctx, recording); err != nil {
			return nil, 0, err
		}
	}

	return map[string]any{
		"ok": true,
		"storage": map[string]any{
			"r2Configured": len(targets) > 0,
		},
		"recording": s.serializeRecording(ctx, recording),
	}, http.StatusOK, nil
}

func (s *Service) PresignSegment(ctx context.Context, input PresignSegmentInput) (map[string]any, int, error) {
	recording, statusCode, err := s.loadMutableRecording(ctx, input.RecordingID)
	if err != nil || statusCode != 0 {
		return nil, statusCode, err
	}
	if input.SegmentIndex < 0 {
		return map[string]any{"message": ErrInvalidSegment.Error()}, http.StatusBadRequest, nil
	}
	entry, err := s.presignSegmentEntry(ctx, recording, input.SegmentIndex, firstNonEmptyString(strings.TrimSpace(input.ContentType), "video/mp4"))
	if err != nil {
		if errors.Is(err, ErrStorageNotReady) {
			return map[string]any{"message": err.Error()}, http.StatusServiceUnavailable, nil
		}
		return nil, 0, err
	}
	return map[string]any{
		"ok":           true,
		"recordingId":  recording.ID.Hex(),
		"segmentIndex": entry["segmentIndex"],
		"objectKey":    entry["objectKey"],
		"upload":       entry["upload"],
	}, http.StatusOK, nil
}

func (s *Service) PresignSegmentBatch(ctx context.Context, input PresignBatchInput) (map[string]any, int, error) {
	recording, statusCode, err := s.loadMutableRecording(ctx, input.RecordingID)
	if err != nil || statusCode != 0 {
		return nil, statusCode, err
	}
	indexes := normalizeSegmentIndexes(input)
	if len(indexes) == 0 {
		return map[string]any{"message": "startSegmentIndex must be >= 0"}, http.StatusBadRequest, nil
	}

	segments := make([]map[string]any, 0, len(indexes))
	for _, segmentIndex := range indexes {
		entry, err := s.presignSegmentEntry(ctx, recording, segmentIndex, firstNonEmptyString(strings.TrimSpace(input.ContentType), "video/mp4"))
		if err != nil {
			if errors.Is(err, ErrStorageNotReady) {
				return map[string]any{"message": err.Error()}, http.StatusServiceUnavailable, nil
			}
			return nil, 0, err
		}
		segments = append(segments, entry)
	}
	return map[string]any{
		"ok":          true,
		"recordingId": recording.ID.Hex(),
		"count":       len(segments),
		"segments":    segments,
	}, http.StatusOK, nil
}

func (s *Service) PresignLiveManifest(ctx context.Context, recordingID string) (map[string]any, int, error) {
	recording, statusCode, err := s.loadMutableRecording(ctx, recordingID)
	if err != nil || statusCode != 0 {
		return nil, statusCode, err
	}
	target, err := s.resolveRecordingStorageTarget(ctx, recording)
	if err != nil {
		if errors.Is(err, ErrStorageNotReady) {
			return map[string]any{"message": err.Error()}, http.StatusServiceUnavailable, nil
		}
		return nil, 0, err
	}

	playbackConfig, err := s.repository.LoadLivePlaybackConfig(ctx)
	if err != nil {
		playbackConfig = defaultLivePlaybackConfigFromEnv()
	}
	livePlayback := buildSerializedLivePlayback(recording, playbackConfig)
	livePlaybackMap, _ := livePlayback.(map[string]any)
	if livePlaybackMap == nil || livePlaybackMap["manifestObjectKey"] == nil {
		return map[string]any{"message": "Public CDN live playback is not configured for this recording"}, http.StatusConflict, nil
	}

	objectKey := stringFromValue(livePlaybackMap["manifestObjectKey"])
	upload, err := s.storage.CreateManifestUploadURL(ctx, *target, objectKey)
	if err != nil {
		return nil, 0, err
	}
	if recording.Meta == nil {
		recording.Meta = bson.M{}
	}
	livePlaybackMeta := mapFromValue(recording.Meta["livePlayback"])
	livePlaybackMeta["enabled"] = true
	livePlaybackMeta["manifestObjectKey"] = objectKey
	livePlaybackMeta["manifestUrl"] = livePlaybackMap["manifestUrl"]
	livePlaybackMeta["publicBaseUrl"] = livePlaybackMap["publicBaseUrl"]
	livePlaybackMeta["delaySeconds"] = livePlaybackMap["delaySeconds"]
	livePlaybackMeta["status"] = livePlaybackMap["status"]
	livePlaybackMeta["finalPlaybackUrl"] = livePlaybackMap["finalPlaybackUrl"]
	recording.Meta["livePlayback"] = livePlaybackMeta
	if err := s.repository.SaveRecording(ctx, recording); err != nil {
		return nil, 0, err
	}

	return map[string]any{
		"ok":           true,
		"recordingId":  recording.ID.Hex(),
		"livePlayback": buildSerializedLivePlayback(recording, playbackConfig),
		"upload":       upload,
	}, http.StatusOK, nil
}

func (s *Service) StartMultipartSegment(ctx context.Context, input PresignSegmentInput) (map[string]any, int, error) {
	recording, statusCode, err := s.loadMutableRecording(ctx, input.RecordingID)
	if err != nil || statusCode != 0 {
		return nil, statusCode, err
	}
	if input.SegmentIndex < 0 {
		return map[string]any{"message": ErrInvalidSegment.Error()}, http.StatusBadRequest, nil
	}
	target, err := s.resolveRecordingStorageTarget(ctx, recording)
	if err != nil {
		if errors.Is(err, ErrStorageNotReady) {
			return map[string]any{"message": err.Error()}, http.StatusServiceUnavailable, nil
		}
		return nil, 0, err
	}

	segment := findRecordingSegment(recording, input.SegmentIndex)
	objectKey := buildRecordingSegmentObjectKey(recording.ID.Hex(), recording.Match.Hex(), input.SegmentIndex)
	if segment != nil && strings.TrimSpace(segment.ObjectKey) != "" {
		objectKey = segment.ObjectKey
	}
	if segment != nil && segment.UploadStatus == "uploaded" {
		meta := getSegmentMeta(segment)
		return map[string]any{
			"ok":              true,
			"recordingId":     recording.ID.Hex(),
			"segmentIndex":    input.SegmentIndex,
			"objectKey":       objectKey,
			"uploadId":        nil,
			"partSizeBytes":   firstNonZeroInt64(int64(numberFromValue(meta["partSizeBytes"])), s.storage.PartSizeBytes()),
			"alreadyUploaded": true,
		}, http.StatusOK, nil
	}

	if segment == nil {
		recording.Segments = append(recording.Segments, SegmentDocument{Index: input.SegmentIndex})
		segment = findRecordingSegment(recording, input.SegmentIndex)
	}
	segment.ObjectKey = objectKey
	segment.StorageTargetID = target.ID
	segment.BucketName = target.BucketName

	meta := getSegmentMeta(segment)
	shouldRestart := strings.TrimSpace(stringFromValue(meta["uploadId"])) == "" ||
		segment.UploadStatus == "aborted" ||
		segment.UploadStatus == "failed" ||
		strings.TrimSpace(segment.StorageTargetID) != target.ID

	uploadID := strings.TrimSpace(stringFromValue(meta["uploadId"]))
	partSizeBytes := firstNonZeroInt64(int64(numberFromValue(meta["partSizeBytes"])), s.storage.PartSizeBytes())
	if shouldRestart {
		multipart, err := s.storage.StartMultipartUpload(ctx, *target, objectKey, firstNonEmptyString(strings.TrimSpace(input.ContentType), "video/mp4"))
		if err != nil {
			return nil, 0, err
		}
		uploadID = strings.TrimSpace(stringFromValue(multipart["uploadId"]))
		partSizeBytes = int64(numberFromValue(multipart["partSizeBytes"]))
		meta["completedParts"] = bson.A{}
		meta["completedPartCount"] = 0
		meta["completedBytes"] = 0
		meta["nextByteOffset"] = 0
	}
	meta["uploadId"] = uploadID
	meta["partSizeBytes"] = partSizeBytes
	meta["contentType"] = firstNonEmptyString(strings.TrimSpace(input.ContentType), "video/mp4")
	if meta["startedAt"] == nil {
		meta["startedAt"] = time.Now().UTC()
	}
	meta["abortedAt"] = nil
	meta["storageTargetId"] = target.ID
	segment.UploadStatus = "uploading_parts"
	segment.Meta = meta
	recording.Error = ""
	if err := s.repository.SaveRecording(ctx, recording); err != nil {
		return nil, 0, err
	}

	return map[string]any{
		"ok":              true,
		"recordingId":     recording.ID.Hex(),
		"segmentIndex":    input.SegmentIndex,
		"objectKey":       objectKey,
		"uploadId":        uploadID,
		"partSizeBytes":   partSizeBytes,
		"alreadyUploaded": false,
	}, http.StatusOK, nil
}

func (s *Service) PresignMultipartPart(ctx context.Context, input MultipartPartInput) (map[string]any, int, error) {
	recording, statusCode, err := s.loadMutableRecording(ctx, input.RecordingID)
	if err != nil || statusCode != 0 {
		return nil, statusCode, err
	}
	if input.SegmentIndex < 0 {
		return map[string]any{"message": ErrInvalidSegment.Error()}, http.StatusBadRequest, nil
	}
	if input.PartNumber <= 0 {
		return map[string]any{"message": "partNumber must be >= 1"}, http.StatusBadRequest, nil
	}

	segment := findRecordingSegment(recording, input.SegmentIndex)
	if segment == nil {
		return map[string]any{"message": "Recording segment not found"}, http.StatusNotFound, nil
	}
	if segment.UploadStatus == "uploaded" {
		return map[string]any{"message": "Recording segment already uploaded"}, http.StatusConflict, nil
	}
	meta := getSegmentMeta(segment)
	uploadID := strings.TrimSpace(stringFromValue(meta["uploadId"]))
	if uploadID == "" {
		return map[string]any{"message": "Multipart upload has not been started for this segment"}, http.StatusConflict, nil
	}
	target, err := s.resolveTargetByID(ctx, segment.StorageTargetID, recording.R2TargetID)
	if err != nil {
		if errors.Is(err, ErrStorageNotReady) {
			return map[string]any{"message": err.Error()}, http.StatusServiceUnavailable, nil
		}
		return nil, 0, err
	}
	upload, err := s.storage.CreateMultipartPartUploadURL(ctx, *target, segment.ObjectKey, uploadID, input.PartNumber)
	if err != nil {
		return nil, 0, err
	}
	return map[string]any{
		"ok":           true,
		"recordingId":  recording.ID.Hex(),
		"segmentIndex": input.SegmentIndex,
		"partNumber":   input.PartNumber,
		"objectKey":    segment.ObjectKey,
		"uploadId":     uploadID,
		"upload":       upload,
	}, http.StatusOK, nil
}

func (s *Service) ReportMultipartProgress(_ context.Context, input MultipartProgressInput) (map[string]any, int, error) {
	if _, err := parseObjectID(input.RecordingID); err != nil {
		return map[string]any{"message": "recordingId is required"}, http.StatusBadRequest, nil
	}
	if input.SegmentIndex < 0 {
		return map[string]any{"message": ErrInvalidSegment.Error()}, http.StatusBadRequest, nil
	}
	if input.PartNumber <= 0 {
		return map[string]any{"message": "partNumber must be >= 1"}, http.StatusBadRequest, nil
	}
	return map[string]any{
		"ok":             true,
		"accepted":       true,
		"recordingId":    input.RecordingID,
		"segmentIndex":   input.SegmentIndex,
		"partNumber":     input.PartNumber,
		"etag":           strings.TrimSpace(input.ETag),
		"sizeBytes":      input.SizeBytes,
		"totalSizeBytes": input.TotalSizeBytes,
	}, http.StatusOK, nil
}

func (s *Service) CompleteMultipartSegment(ctx context.Context, input CompleteMultipartInput) (map[string]any, int, error) {
	recording, statusCode, err := s.loadMutableRecording(ctx, input.RecordingID)
	if err != nil || statusCode != 0 {
		return nil, statusCode, err
	}
	if input.SegmentIndex < 0 {
		return map[string]any{"message": ErrInvalidSegment.Error()}, http.StatusBadRequest, nil
	}
	if len(input.Parts) == 0 {
		return map[string]any{"message": "parts are required for multipart completion"}, http.StatusBadRequest, nil
	}
	segment := findRecordingSegment(recording, input.SegmentIndex)
	if segment == nil {
		return map[string]any{"message": "Recording segment not found"}, http.StatusNotFound, nil
	}
	if segment.UploadStatus == "uploaded" {
		return map[string]any{"ok": true, "recording": s.serializeRecording(ctx, recording)}, http.StatusOK, nil
	}
	meta := getSegmentMeta(segment)
	uploadID := strings.TrimSpace(stringFromValue(meta["uploadId"]))
	if uploadID == "" {
		return map[string]any{"message": "Multipart upload has not been started for this segment"}, http.StatusConflict, nil
	}
	target, err := s.resolveTargetByID(ctx, segment.StorageTargetID, recording.R2TargetID)
	if err != nil {
		if errors.Is(err, ErrStorageNotReady) {
			return map[string]any{"message": err.Error()}, http.StatusServiceUnavailable, nil
		}
		return nil, 0, err
	}
	if err := s.storage.CompleteMultipartUpload(ctx, *target, segment.ObjectKey, uploadID, input.Parts); err != nil {
		return nil, 0, err
	}

	now := time.Now().UTC()
	segment.UploadStatus = "uploaded"
	segment.StorageTargetID = target.ID
	segment.BucketName = target.BucketName
	segment.ETag = lastPartETag(input.Parts)
	segment.SizeBytes = maxInt64(0, input.SizeBytes)
	segment.DurationSeconds = normalizeNumber(input.DurationSeconds)
	segment.IsFinal = input.IsFinal
	segment.UploadedAt = &now
	meta["uploadId"] = nil
	meta["completedParts"] = normalizeCompletedParts(input.Parts)
	meta["completedPartCount"] = len(input.Parts)
	meta["completedBytes"] = completedPartBytes(meta["completedParts"])
	meta["totalSizeBytes"] = segment.SizeBytes
	meta["completedAt"] = now
	segment.Meta = meta

	if !shouldPreserveExportState(recording) {
		recording.Status = "uploading"
		recording.Error = ""
	}
	refreshRecordingAggregate(recording)
	if err := s.repository.SaveRecording(ctx, recording); err != nil {
		return nil, 0, err
	}
	return map[string]any{"ok": true, "recording": s.serializeRecording(ctx, recording)}, http.StatusOK, nil
}

func (s *Service) AbortMultipartSegment(ctx context.Context, recordingID string, segmentIndex int) (map[string]any, int, error) {
	recording, statusCode, err := s.loadMutableRecording(ctx, recordingID)
	if err != nil || statusCode != 0 {
		return nil, statusCode, err
	}
	if segmentIndex < 0 {
		return map[string]any{"message": ErrInvalidSegment.Error()}, http.StatusBadRequest, nil
	}
	segment := findRecordingSegment(recording, segmentIndex)
	if segment == nil {
		return map[string]any{"ok": true, "aborted": false}, http.StatusOK, nil
	}
	if segment.UploadStatus == "uploaded" {
		return map[string]any{"ok": true, "aborted": false, "alreadyUploaded": true}, http.StatusOK, nil
	}
	meta := getSegmentMeta(segment)
	uploadID := strings.TrimSpace(stringFromValue(meta["uploadId"]))
	if uploadID != "" && strings.TrimSpace(segment.ObjectKey) != "" {
		target, err := s.resolveTargetByID(ctx, segment.StorageTargetID, recording.R2TargetID)
		if err == nil && target != nil {
			_ = s.storage.AbortMultipartUpload(ctx, *target, segment.ObjectKey, uploadID)
		}
	}
	meta["uploadId"] = nil
	meta["abortedAt"] = time.Now().UTC()
	segment.UploadStatus = "aborted"
	segment.Meta = meta
	if err := s.repository.SaveRecording(ctx, recording); err != nil {
		return nil, 0, err
	}
	return map[string]any{"ok": true, "aborted": true, "recording": s.serializeRecording(ctx, recording)}, http.StatusOK, nil
}

func (s *Service) CompleteSegment(ctx context.Context, input CompleteSegmentInput) (map[string]any, int, error) {
	recording, statusCode, err := s.loadMutableRecording(ctx, input.RecordingID)
	if err != nil || statusCode != 0 {
		return nil, statusCode, err
	}
	if input.SegmentIndex < 0 {
		return map[string]any{"message": ErrInvalidSegment.Error()}, http.StatusBadRequest, nil
	}
	if strings.TrimSpace(input.ObjectKey) == "" {
		return map[string]any{"message": ErrObjectKeyRequired.Error()}, http.StatusBadRequest, nil
	}

	segment := findRecordingSegment(recording, input.SegmentIndex)
	if segment == nil {
		target, err := s.resolveRecordingStorageTarget(ctx, recording)
		if err != nil {
			if errors.Is(err, ErrStorageNotReady) {
				return map[string]any{"message": err.Error()}, http.StatusServiceUnavailable, nil
			}
			return nil, 0, err
		}
		recording.Segments = append(recording.Segments, SegmentDocument{
			Index:           input.SegmentIndex,
			ObjectKey:       strings.TrimSpace(input.ObjectKey),
			StorageTargetID: target.ID,
			BucketName:      target.BucketName,
			UploadStatus:    "uploaded",
			ETag:            strings.TrimSpace(input.ETag),
			SizeBytes:       maxInt64(0, input.SizeBytes),
			DurationSeconds: normalizeNumber(input.DurationSeconds),
			IsFinal:         input.IsFinal,
			UploadedAt:      nowPtr(),
		})
	} else {
		segment.ObjectKey = strings.TrimSpace(input.ObjectKey)
		if strings.TrimSpace(segment.StorageTargetID) == "" {
			if target, err := s.resolveRecordingStorageTarget(ctx, recording); err == nil && target != nil {
				segment.StorageTargetID = target.ID
				segment.BucketName = target.BucketName
			}
		}
		segment.UploadStatus = "uploaded"
		segment.ETag = strings.TrimSpace(input.ETag)
		segment.SizeBytes = maxInt64(0, input.SizeBytes)
		segment.DurationSeconds = normalizeNumber(input.DurationSeconds)
		segment.IsFinal = input.IsFinal
		segment.UploadedAt = nowPtr()
	}
	if !shouldPreserveExportState(recording) {
		recording.Status = "uploading"
		recording.Error = ""
	}
	refreshRecordingAggregate(recording)
	if err := s.repository.SaveRecording(ctx, recording); err != nil {
		return nil, 0, err
	}
	return map[string]any{"ok": true, "recording": s.serializeRecording(ctx, recording)}, http.StatusOK, nil
}

func (s *Service) FinalizeRecording(ctx context.Context, recordingID string, ignoreWindow bool, publishReason string) (map[string]any, int, error) {
	recording, statusCode, err := s.loadMutableRecording(ctx, recordingID)
	if err != nil || statusCode != 0 {
		return nil, statusCode, err
	}
	uploaded := uploadedSegments(recording)
	if len(uploaded) == 0 {
		return map[string]any{"message": "Cannot finalize a recording with no uploaded segments"}, http.StatusBadRequest, nil
	}
	pending := pendingSegments(recording)
	if len(pending) > 0 {
		return map[string]any{"message": "Cannot finalize recording until all segments are uploaded", "pendingSegments": len(pending)}, http.StatusConflict, nil
	}
	if err := s.queueRecordingExport(ctx, recording, queueRecordingExportOptions{
		IgnoreWindow:  ignoreWindow,
		PublishReason: publishReason,
	}); err != nil {
		if errors.Is(err, ErrStorageNotReady) {
			return map[string]any{"message": err.Error()}, http.StatusServiceUnavailable, nil
		}
		return nil, 0, err
	}

	return map[string]any{
		"ok":                 true,
		"queued":             true,
		"scheduledForWindow": recording.Status == "pending_export_window",
		"recording":          s.serializeRecording(ctx, recording),
	}, http.StatusOK, nil
}

func (s *Service) GetTemporaryPlaylist(ctx context.Context, recordingID string) (map[string]any, int, http.Header, error) {
	recording, err := s.loadRecording(ctx, recordingID)
	if err != nil {
		return nil, 0, nil, err
	}
	headers := http.Header{}
	if strings.TrimSpace(recording.DriveFileID) != "" || strings.TrimSpace(recording.DriveRawURL) != "" {
		return map[string]any{
			"ok":          true,
			"ready":       true,
			"redirectUrl": buildRecordingPlaybackURL(recording.ID.Hex()),
			"recording":   s.serializeRecording(ctx, recording),
		}, http.StatusOK, headers, nil
	}
	if !isRecordingTemporaryPlaybackReady(recording) {
		return map[string]any{
			"ok":        false,
			"status":    recording.Status,
			"message":   "Recording temporary playback is not ready yet",
			"recording": s.serializeRecording(ctx, recording),
		}, http.StatusConflict, headers, nil
	}

	segments := make([]map[string]any, 0)
	for _, segment := range uploadedSegments(recording) {
		target, err := s.resolveTargetByID(ctx, segment.StorageTargetID, recording.R2TargetID)
		if err != nil {
			return nil, 0, nil, err
		}
		download, err := s.storage.CreateObjectDownloadURL(ctx, *target, segment.ObjectKey, 12*time.Hour)
		if err != nil {
			return nil, 0, nil, err
		}
		segments = append(segments, map[string]any{
			"index":            segment.Index,
			"objectKey":        segment.ObjectKey,
			"storageTargetId":  emptyStringToNil(firstNonEmptyString(segment.StorageTargetID, recording.R2TargetID)),
			"durationSeconds":  normalizeNumber(segment.DurationSeconds),
			"sizeBytes":        segment.SizeBytes,
			"isFinal":          segment.IsFinal,
			"url":              download["downloadUrl"],
			"expiresInSeconds": download["expiresInSeconds"],
		})
	}
	headers.Set("Access-Control-Allow-Origin", "*")
	headers.Set("Cache-Control", "private, max-age=30, stale-while-revalidate=30")
	return map[string]any{
		"ok":                   true,
		"ready":                true,
		"playbackUrl":          buildRecordingPlaybackURL(recording.ID.Hex()),
		"temporaryPlaybackUrl": buildRecordingTemporaryPlaybackURL(recording.ID.Hex()),
		"temporaryPlaylistUrl": buildRecordingTemporaryPlaylistURL(recording.ID.Hex()),
		"recording":            s.serializeRecording(ctx, recording),
		"segments":             segments,
	}, http.StatusOK, headers, nil
}

func (s *Service) GetTemporaryPlaybackPage(ctx context.Context, recordingID string) (string, map[string]any, int, http.Header, error) {
	recording, err := s.loadRecording(ctx, recordingID)
	if err != nil {
		return "", nil, 0, nil, err
	}
	headers := http.Header{}
	if strings.TrimSpace(recording.DriveFileID) != "" || strings.TrimSpace(recording.DriveRawURL) != "" {
		headers.Set("Location", buildRecordingPlaybackURL(recording.ID.Hex()))
		return "", nil, http.StatusFound, headers, nil
	}
	if !isRecordingTemporaryPlaybackReady(recording) {
		return "", map[string]any{
			"ok":        false,
			"status":    recording.Status,
			"message":   "Recording temporary playback is not ready yet",
			"recording": s.serializeRecording(ctx, recording),
		}, http.StatusConflict, headers, nil
	}
	headers.Del("X-Frame-Options")
	headers.Set("Content-Security-Policy", "default-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src * data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors *")
	headers.Set("Cross-Origin-Resource-Policy", "cross-origin")
	headers.Set("Cache-Control", "private, max-age=30, stale-while-revalidate=30")
	return buildTemporaryPlaybackHTML(recording, buildRecordingTemporaryPlaylistURL(recording.ID.Hex()), buildRecordingPlaybackURL(recording.ID.Hex())), nil, http.StatusOK, headers, nil
}

func (s *Service) GetRawStreamDecision(ctx context.Context, recordingID string, commentary bool, rangeHeader string) (*RedirectDecision, error) {
	recording, err := s.loadRecording(ctx, recordingID)
	if err != nil {
		return nil, err
	}
	if commentary {
		asset := getAICommentaryAsset(recording)
		if asset.FileID != "" {
			stream, streamErr := s.drive.Stream(ctx, asset.FileID, rangeHeader)
			if streamErr == nil {
				return &RedirectDecision{
					Stream:            stream,
					FileLabel:         fmt.Sprintf("recording-%s-ai-commentary.mp4", recording.ID.Hex()),
					FallbackSizeBytes: maxInt64(0, int64(numberFromValue(recording.AICommentary["outputSizeBytes"]))),
				}, nil
			}
			if asset.RawURL != "" {
				return &RedirectDecision{RedirectURL: asset.RawURL}, nil
			}
			return &RedirectDecision{
				StatusCode: http.StatusBadGateway,
				Payload: map[string]any{
					"ok":        false,
					"ready":     false,
					"status":    firstNonEmptyString(stringFromValue(recording.AICommentary["status"]), "idle"),
					"message":   streamErr.Error(),
					"recording": s.serializeRecording(ctx, recording),
				},
			}, nil
		}
		if asset.RawURL != "" {
			return &RedirectDecision{RedirectURL: asset.RawURL}, nil
		}
		return &RedirectDecision{
			StatusCode: http.StatusConflict,
			Payload: map[string]any{
				"ok":        false,
				"ready":     false,
				"status":    firstNonEmptyString(stringFromValue(recording.AICommentary["status"]), "idle"),
				"message":   "AI commentary raw stream is not ready yet",
				"recording": s.serializeRecording(ctx, recording),
			},
		}, nil
	}

	if strings.TrimSpace(recording.DriveFileID) != "" {
		stream, streamErr := s.drive.Stream(ctx, recording.DriveFileID, rangeHeader)
		if streamErr == nil {
			return &RedirectDecision{
				Stream:            stream,
				FileLabel:         fmt.Sprintf("recording-%s.mp4", recording.ID.Hex()),
				FallbackSizeBytes: maxInt64(0, recording.SizeBytes),
			}, nil
		}
		if strings.TrimSpace(recording.DriveRawURL) != "" {
			return &RedirectDecision{RedirectURL: recording.DriveRawURL}, nil
		}
		return &RedirectDecision{
			StatusCode: http.StatusBadGateway,
			Payload: map[string]any{
				"ok":        false,
				"ready":     false,
				"status":    recording.Status,
				"message":   streamErr.Error(),
				"recording": s.serializeRecording(ctx, recording),
			},
		}, nil
	}
	if strings.TrimSpace(recording.DriveRawURL) != "" {
		return &RedirectDecision{RedirectURL: recording.DriveRawURL}, nil
	}
	return &RedirectDecision{
		StatusCode: http.StatusConflict,
		Payload: map[string]any{
			"ok":        false,
			"ready":     false,
			"status":    recording.Status,
			"message":   "Recording raw stream is not ready yet",
			"recording": s.serializeRecording(ctx, recording),
		},
	}, nil
}

func (s *Service) presignSegmentEntry(ctx context.Context, recording *RecordingDocument, segmentIndex int, contentType string) (map[string]any, error) {
	target, err := s.resolveRecordingStorageTarget(ctx, recording)
	if err != nil {
		return nil, err
	}
	objectKey := buildRecordingSegmentObjectKey(recording.ID.Hex(), recording.Match.Hex(), segmentIndex)
	upload, err := s.storage.CreateSegmentUploadURL(ctx, *target, objectKey, contentType)
	if err != nil {
		return nil, err
	}
	segment := findRecordingSegment(recording, segmentIndex)
	if segment == nil {
		recording.Segments = append(recording.Segments, SegmentDocument{
			Index:           segmentIndex,
			ObjectKey:       objectKey,
			StorageTargetID: target.ID,
			BucketName:      target.BucketName,
			UploadStatus:    "presigned",
		})
	} else if segment.UploadStatus != "uploaded" {
		segment.ObjectKey = objectKey
		segment.StorageTargetID = target.ID
		segment.BucketName = target.BucketName
		segment.UploadStatus = "presigned"
	}
	if err := s.repository.SaveRecording(ctx, recording); err != nil {
		return nil, err
	}
	return map[string]any{
		"segmentIndex": segmentIndex,
		"objectKey":    objectKey,
		"upload":       upload,
	}, nil
}

func (s *Service) resolveRecordingStorageTarget(ctx context.Context, recording *RecordingDocument) (*StorageTarget, error) {
	return s.resolveTargetByID(ctx, recording.R2TargetID, "")
}

func (s *Service) resolveTargetByID(ctx context.Context, preferredID, fallbackID string) (*StorageTarget, error) {
	targets, err := s.repository.LoadStorageTargets(ctx)
	if err != nil {
		return nil, err
	}
	target := pickStorageTarget(targets, firstNonEmptyString(preferredID, fallbackID))
	if target == nil {
		return nil, ErrStorageNotReady
	}
	return target, nil
}

func (s *Service) loadMutableRecording(ctx context.Context, recordingID string) (*RecordingDocument, int, error) {
	objectID, err := parseObjectID(strings.TrimSpace(recordingID))
	if err != nil {
		return nil, http.StatusBadRequest, nil
	}
	recording, err := s.repository.FindByID(ctx, objectID)
	if err != nil {
		return nil, 0, err
	}
	if recording == nil {
		return nil, http.StatusNotFound, nil
	}
	return recording, 0, nil
}

func normalizeSegmentIndexes(input PresignBatchInput) []int {
	if len(input.SegmentIndexes) > 0 {
		seen := map[int]struct{}{}
		output := make([]int, 0, len(input.SegmentIndexes))
		for _, value := range input.SegmentIndexes {
			if value < 0 {
				continue
			}
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			output = append(output, value)
		}
		sort.Ints(output)
		return output
	}
	if input.StartSegmentIndex < 0 {
		return nil
	}
	count := input.Count
	if count <= 0 {
		count = 10
	}
	if count > 25 {
		count = 25
	}
	output := make([]int, 0, count)
	for index := 0; index < count; index++ {
		output = append(output, input.StartSegmentIndex+index)
	}
	return output
}

func resolveCourtID(rawCourtID string, fallback *primitive.ObjectID) *primitive.ObjectID {
	if objectID, err := primitive.ObjectIDFromHex(strings.TrimSpace(rawCourtID)); err == nil {
		return &objectID
	}
	return fallback
}

func emptyTargetField(target *StorageTarget, selector func(StorageTarget) string) string {
	if target == nil {
		return ""
	}
	return selector(*target)
}

func lastPartETag(parts []map[string]any) string {
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(stringFromValue(parts[len(parts)-1]["etag"]))
}

func normalizeCompletedParts(parts []map[string]any) bson.A {
	output := bson.A{}
	for _, part := range parts {
		partNumber := int(numberFromValue(part["partNumber"]))
		etag := strings.TrimSpace(stringFromValue(part["etag"]))
		if partNumber <= 0 || etag == "" {
			continue
		}
		output = append(output, bson.M{
			"partNumber": partNumber,
			"etag":       etag,
			"sizeBytes":  int64(numberFromValue(part["sizeBytes"])),
		})
	}
	return output
}

func completedPartBytes(value any) int64 {
	var total int64
	for _, part := range arrayFromValue(value) {
		total += int64(numberFromValue(mapFromValue(part)["sizeBytes"]))
	}
	return total
}

func serializeUploadedSegmentsForManifest(segments []SegmentDocument, recording *RecordingDocument) []map[string]any {
	output := make([]map[string]any, 0, len(segments))
	for _, segment := range segments {
		output = append(output, map[string]any{
			"index":           segment.Index,
			"objectKey":       segment.ObjectKey,
			"storageTargetId": emptyStringToNil(firstNonEmptyString(segment.StorageTargetID, recording.R2TargetID)),
			"bucketName":      emptyStringToNil(firstNonEmptyString(segment.BucketName, recording.R2BucketName)),
			"sizeBytes":       segment.SizeBytes,
			"durationSeconds": normalizeNumber(segment.DurationSeconds),
			"isFinal":         segment.IsFinal,
		})
	}
	return output
}

func ternaryString(condition bool, whenTrue, whenFalse string) string {
	if condition {
		return whenTrue
	}
	return whenFalse
}

func firstNonZeroInt64(values ...int64) int64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}
