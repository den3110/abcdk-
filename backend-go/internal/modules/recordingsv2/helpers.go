package recordingsv2

import (
	"fmt"
	"math"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type recordingLinks struct {
	PlaybackURL          string
	RawStreamURL         string
	RawStatusURL         string
	TemporaryPlaybackURL string
	TemporaryPlaylistURL string
}

type aiCommentaryAsset struct {
	FileID      string
	RawURL      string
	PreviewURL  string
	PlaybackURL string
	Ready       bool
}

func buildRecordingLinks(recordingID string) recordingLinks {
	id := strings.TrimSpace(recordingID)
	if id == "" {
		return recordingLinks{}
	}

	return recordingLinks{
		PlaybackURL:          buildRecordingPlaybackURL(id),
		RawStreamURL:         buildRecordingRawStreamURL(id),
		RawStatusURL:         buildRecordingRawStatusURL(id),
		TemporaryPlaybackURL: buildRecordingTemporaryPlaybackURL(id),
		TemporaryPlaylistURL: buildRecordingTemporaryPlaylistURL(id),
	}
}

func buildSerializedLivePlayback(recording *RecordingDocument, cfg LivePlaybackConfig) any {
	if recording == nil {
		return nil
	}
	return buildRecordingLivePlayback(recording, cfg)
}

func buildRecordingLivePlayback(recording *RecordingDocument, cfg LivePlaybackConfig) any {
	if recording == nil {
		return nil
	}

	matchID := recording.Match.Hex()
	recordingID := recording.ID.Hex()
	if matchID == "" || recordingID == "" {
		return nil
	}

	livePlaybackMeta := mapFromValue(recording.Meta["livePlayback"])
	manifestObjectKey := firstNonEmptyString(
		stringFromValue(livePlaybackMeta["manifestObjectKey"]),
		buildRecordingLiveManifestObjectKey(recordingID, matchID, cfg.ManifestName),
	)

	manifestURL := ""
	publicBaseURL := ""
	if cfg.Enabled {
		manifestURL = firstNonEmptyString(
			stringFromValue(livePlaybackMeta["manifestUrl"]),
			buildRecordingPublicObjectURL(manifestObjectKey, recording.R2TargetID, cfg),
		)
		publicBaseURL = firstNonEmptyString(
			stringFromValue(livePlaybackMeta["publicBaseUrl"]),
			resolveRecordingPublicBaseURL(recording.R2TargetID, cfg),
		)
	}

	finalPlaybackURL := firstNonEmptyString(
		stringFromValue(livePlaybackMeta["finalPlaybackUrl"]),
		pickFinalServer2URL(recording),
	)
	uploaded := uploadedSegments(recording)
	uploadedDurationSeconds := sumUploadedDurationSeconds(uploaded)
	delayedReady := cfg.Enabled && manifestURL != "" && len(uploaded) > 0 && uploadedDurationSeconds >= float64(cfg.DelaySeconds)
	finalReady := finalPlaybackURL != "" && (recording.Status == "ready" || recording.DriveFileID != "" || recording.DriveRawURL != "" || recording.DrivePreviewURL != "")

	if !finalReady && !cfg.Enabled {
		return nil
	}

	delaySeconds := cfg.DelaySeconds
	status := "pending"
	ready := false
	if finalReady {
		status = "final"
		ready = true
		delaySeconds = 0
	} else if delayedReady {
		status = "ready"
		ready = true
	} else if cfg.Enabled && len(uploaded) > 0 {
		status = "preparing"
	}

	if finalPlaybackURL == "" && manifestURL == "" && publicBaseURL == "" {
		return nil
	}

	providerLabel := "PickleTour CDN"
	if finalReady {
		providerLabel = "PickleTour Video"
	}

	var disabledReason any
	if !ready && cfg.Enabled && !finalReady {
		disabledReason = "Dang chuan bi luong tre tu PickleTour CDN."
	}

	return map[string]any{
		"enabled":                 true,
		"key":                     "server2",
		"providerLabel":           providerLabel,
		"displayLabel":            "Server 2",
		"manifestObjectKey":       emptyStringToNil(manifestObjectKey),
		"manifestUrl":             emptyStringToNil(manifestURL),
		"publicBaseUrl":           emptyStringToNil(publicBaseURL),
		"finalPlaybackUrl":        emptyStringToNil(finalPlaybackURL),
		"delaySeconds":            delaySeconds,
		"uploadedDurationSeconds": normalizeNumber(uploadedDurationSeconds),
		"uploadedSegmentCount":    len(uploaded),
		"ready":                   ready,
		"status":                  status,
		"disabledReason":          disabledReason,
	}
}

func buildAICommentarySummary(recording *RecordingDocument) map[string]any {
	ai := mapFromValue(recording.AICommentary)
	playbackURL := strings.TrimSpace(stringFromValue(ai["dubbedPlaybackUrl"]))
	if playbackURL == "" && recording != nil && (stringFromValue(ai["dubbedDriveFileId"]) != "" || stringFromValue(ai["dubbedDriveRawUrl"]) != "") {
		playbackURL = buildRecordingAICommentaryPlaybackURL(recording.ID.Hex())
	}

	rawURL := strings.TrimSpace(stringFromValue(ai["dubbedDriveRawUrl"]))
	if rawURL == "" && recording != nil {
		rawURL = buildRecordingAICommentaryRawURL(recording.ID.Hex())
	}

	return map[string]any{
		"status":                firstNonEmptyString(stringFromValue(ai["status"]), "idle"),
		"latestJobId":           emptyStringToNil(idStringFromValue(ai["latestJobId"])),
		"sourceDriveFileId":     emptyStringToNil(stringFromValue(ai["sourceDriveFileId"])),
		"language":              emptyStringToNil(stringFromValue(ai["language"])),
		"voicePreset":           emptyStringToNil(stringFromValue(ai["voicePreset"])),
		"tonePreset":            emptyStringToNil(stringFromValue(ai["tonePreset"])),
		"sourceFingerprint":     emptyStringToNil(stringFromValue(ai["sourceFingerprint"])),
		"dubbedDriveFileId":     emptyStringToNil(stringFromValue(ai["dubbedDriveFileId"])),
		"dubbedDriveRawUrl":     emptyStringToNil(stringFromValue(ai["dubbedDriveRawUrl"])),
		"dubbedDrivePreviewUrl": emptyStringToNil(stringFromValue(ai["dubbedDrivePreviewUrl"])),
		"dubbedPlaybackUrl":     emptyStringToNil(playbackURL),
		"outputSizeBytes":       maxInt64(0, int64(numberFromValue(ai["outputSizeBytes"]))),
		"rawUrl":                emptyStringToNil(rawURL),
		"renderedAt":            timeFromValue(ai["renderedAt"]),
		"error":                 emptyStringToNil(stringFromValue(ai["error"])),
		"ready":                 stringFromValue(ai["dubbedDriveFileId"]) != "" || stringFromValue(ai["dubbedDriveRawUrl"]) != "" || stringFromValue(ai["dubbedPlaybackUrl"]) != "",
	}
}

func getAICommentaryAsset(recording *RecordingDocument) aiCommentaryAsset {
	ai := mapFromValue(recording.AICommentary)
	fileID := strings.TrimSpace(stringFromValue(ai["dubbedDriveFileId"]))
	rawURL := strings.TrimSpace(stringFromValue(ai["dubbedDriveRawUrl"]))
	previewURL := strings.TrimSpace(stringFromValue(ai["dubbedDrivePreviewUrl"]))
	playbackURL := strings.TrimSpace(stringFromValue(ai["dubbedPlaybackUrl"]))
	if playbackURL == "" && recording != nil && (fileID != "" || rawURL != "") {
		playbackURL = buildRecordingAICommentaryPlaybackURL(recording.ID.Hex())
	}

	return aiCommentaryAsset{
		FileID:      fileID,
		RawURL:      rawURL,
		PreviewURL:  previewURL,
		PlaybackURL: playbackURL,
		Ready:       fileID != "" || rawURL != "" || playbackURL != "" || previewURL != "",
	}
}

func uploadedSegments(recording *RecordingDocument) []SegmentDocument {
	if recording == nil {
		return nil
	}

	segments := make([]SegmentDocument, 0, len(recording.Segments))
	for _, segment := range recording.Segments {
		if segment.UploadStatus == "uploaded" {
			segments = append(segments, segment)
		}
	}

	sort.Slice(segments, func(i, j int) bool {
		return segments[i].Index < segments[j].Index
	})

	return segments
}

func pendingSegmentsCount(recording *RecordingDocument) int {
	if recording == nil {
		return 0
	}

	count := 0
	for _, segment := range recording.Segments {
		if segment.UploadStatus != "uploaded" {
			count++
		}
	}
	return count
}

func sumUploadedDurationSeconds(segments []SegmentDocument) float64 {
	total := 0.0
	for _, segment := range segments {
		total += segment.DurationSeconds
	}
	return total
}

func isRecordingTemporaryPlaybackReady(recording *RecordingDocument) bool {
	if recording == nil || recording.FinalizedAt == nil {
		return false
	}
	return len(uploadedSegments(recording)) > 0 && pendingSegmentsCount(recording) == 0
}

func pickFinalServer2URL(recording *RecordingDocument) string {
	if recording == nil {
		return ""
	}
	if driveRawURL := strings.TrimSpace(recording.DriveRawURL); driveRawURL != "" {
		return driveRawURL
	}
	if drivePreviewURL := strings.TrimSpace(recording.DrivePreviewURL); drivePreviewURL != "" {
		return drivePreviewURL
	}
	if playbackURL := strings.TrimSpace(recording.PlaybackURL); playbackURL != "" {
		return playbackURL
	}
	return buildRecordingPlaybackURL(recording.ID.Hex())
}

func buildRecordingPlaybackURL(recordingID string) string {
	return fmt.Sprintf("%s/api/live/recordings/v2/%s/play", getPlaybackAPIBase(), strings.TrimSpace(recordingID))
}

func buildRecordingRawStreamURL(recordingID string) string {
	return fmt.Sprintf("%s/api/live/recordings/v2/%s/raw", getPlaybackAPIBase(), strings.TrimSpace(recordingID))
}

func buildRecordingRawStatusURL(recordingID string) string {
	return fmt.Sprintf("%s/api/live/recordings/v2/%s/raw/status", getPlaybackAPIBase(), strings.TrimSpace(recordingID))
}

func buildRecordingTemporaryPlaybackURL(recordingID string) string {
	return fmt.Sprintf("%s/api/live/recordings/v2/%s/temp", getPlaybackAPIBase(), strings.TrimSpace(recordingID))
}

func buildRecordingTemporaryPlaylistURL(recordingID string) string {
	return fmt.Sprintf("%s/api/live/recordings/v2/%s/temp/playlist", getPlaybackAPIBase(), strings.TrimSpace(recordingID))
}

func buildRecordingAICommentaryPlaybackURL(recordingID string) string {
	return fmt.Sprintf("%s/api/live/recordings/v2/%s/commentary/play", getPlaybackAPIBase(), strings.TrimSpace(recordingID))
}

func buildRecordingAICommentaryRawURL(recordingID string) string {
	return fmt.Sprintf("%s/api/live/recordings/v2/%s/commentary/raw", getPlaybackAPIBase(), strings.TrimSpace(recordingID))
}

func getPlaybackAPIBase() string {
	for _, key := range []string{"LIVE_RECORDING_PLAYBACK_BASE_URL", "PUBLIC_API_BASE_URL", "API_URL"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return strings.TrimRight(value, "/")
		}
	}
	return getAppHost()
}

func getAppHost() string {
	for _, key := range []string{"HOST", "FRONTEND_URL"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return strings.TrimRight(value, "/")
		}
	}
	return "https://pickletour.vn"
}

func buildRecordingLiveManifestObjectKey(recordingID, matchID, manifestName string) string {
	return fmt.Sprintf("recordings/v2/matches/%s/%s/%s", strings.TrimSpace(matchID), strings.TrimSpace(recordingID), normalizeManifestName(manifestName, "live-manifest.json"))
}

func resolveRecordingPublicBaseURL(targetID string, cfg LivePlaybackConfig) string {
	normalizedTargetID := strings.TrimSpace(targetID)
	if normalizedTargetID != "" {
		if value := normalizePublicBaseURL(cfg.TargetPublicBaseURL[normalizedTargetID]); value != "" {
			return value
		}
	}
	if len(cfg.TargetPublicBaseURL) == 1 {
		for _, value := range cfg.TargetPublicBaseURL {
			if normalizedValue := normalizePublicBaseURL(value); normalizedValue != "" {
				return normalizedValue
			}
		}
	}
	return normalizePublicBaseURL(cfg.GlobalPublicBaseURL)
}

func buildRecordingPublicObjectURL(objectKey, targetID string, cfg LivePlaybackConfig) string {
	baseURL := resolveRecordingPublicBaseURL(targetID, cfg)
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if baseURL == "" || objectKey == "" {
		return ""
	}
	return fmt.Sprintf("%s/%s", strings.TrimRight(baseURL, "/"), objectKey)
}

func parseObjectID(raw string) (primitive.ObjectID, error) {
	return primitive.ObjectIDFromHex(strings.TrimSpace(raw))
}

func parseBoolEnv(key string, fallback bool) bool {
	return parseBool(strings.TrimSpace(os.Getenv(key)), fallback)
}

func parseBool(value string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func normalizeDelaySeconds(value any, fallback int) int {
	numeric := numberFromValue(value)
	if numeric <= 0 {
		return fallback
	}
	delay := int(math.Floor(numeric))
	if delay < 15 {
		return 15
	}
	if delay > 600 {
		return 600
	}
	return delay
}

func normalizeManifestName(value, fallback string) string {
	normalized := strings.TrimSpace(value)
	normalized = strings.TrimLeft(normalized, "/")
	normalized = strings.ReplaceAll(normalized, "\\", "/")
	for strings.Contains(normalized, "//") {
		normalized = strings.ReplaceAll(normalized, "//", "/")
	}
	if normalized == "" {
		return fallback
	}
	if strings.Contains(normalized, "..") {
		return fallback
	}
	return normalized
}

func normalizePublicBaseURL(value string) string {
	normalized := strings.TrimRight(strings.TrimSpace(value), "/")
	if normalized == "" {
		return ""
	}
	parsed, err := url.Parse(normalized)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return strings.TrimRight(parsed.String(), "/")
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func stringFromValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case primitive.ObjectID:
		if typed == primitive.NilObjectID {
			return ""
		}
		return typed.Hex()
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func idStringFromValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case primitive.ObjectID:
		if typed == primitive.NilObjectID {
			return ""
		}
		return typed.Hex()
	default:
		return stringFromValue(value)
	}
}

func numberFromValue(value any) float64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case int:
		return float64(typed)
	case int8:
		return float64(typed)
	case int16:
		return float64(typed)
	case int32:
		return float64(typed)
	case int64:
		return float64(typed)
	case uint:
		return float64(typed)
	case uint8:
		return float64(typed)
	case uint16:
		return float64(typed)
	case uint32:
		return float64(typed)
	case uint64:
		return float64(typed)
	case float32:
		return float64(typed)
	case float64:
		return typed
	case primitive.Decimal128:
		floatValue, _ := strconv.ParseFloat(typed.String(), 64)
		return floatValue
	default:
		floatValue, err := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(typed)), 64)
		if err != nil {
			return 0
		}
		return floatValue
	}
}

func mapFromValue(value any) bson.M {
	switch typed := value.(type) {
	case nil:
		return bson.M{}
	case bson.M:
		return typed
	case map[string]any:
		return bson.M(typed)
	default:
		return bson.M{}
	}
}

func arrayFromValue(value any) []any {
	switch typed := value.(type) {
	case nil:
		return nil
	case bson.A:
		return []any(typed)
	case []any:
		return typed
	default:
		return nil
	}
}

func nestedString(root bson.M, keys ...string) string {
	current := any(root)
	for _, key := range keys {
		nextMap := mapFromValue(current)
		if len(nextMap) == 0 {
			return ""
		}
		current = nextMap[key]
	}
	return stringFromValue(current)
}

func timeFromValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case time.Time:
		return typed
	case *time.Time:
		if typed == nil {
			return nil
		}
		return *typed
	case primitive.DateTime:
		t := typed.Time()
		return t
	case string:
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(typed))
		if err != nil {
			return nil
		}
		return parsed
	default:
		return nil
	}
}

func timeToValue(value *time.Time) any {
	if value == nil {
		return nil
	}
	return *value
}

func objectIDPtrToValue(value *primitive.ObjectID) any {
	if value == nil || *value == primitive.NilObjectID {
		return nil
	}
	return value.Hex()
}

func emptyStringToNil(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func normalizeNumber(value float64) float64 {
	return math.Round(value*1000) / 1000
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
