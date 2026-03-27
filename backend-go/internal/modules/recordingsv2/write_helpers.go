package recordingsv2

import (
	"fmt"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func normalizeMode(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "STREAM_AND_RECORD", "RECORD_ONLY", "STREAM_ONLY":
		return strings.ToUpper(strings.TrimSpace(value))
	default:
		return ""
	}
}

func buildRecordingPrefix(recordingID, matchID string) string {
	return fmt.Sprintf("recordings/v2/matches/%s/%s", strings.TrimSpace(matchID), strings.TrimSpace(recordingID))
}

func buildRecordingSegmentObjectKey(recordingID, matchID string, segmentIndex int) string {
	return fmt.Sprintf("%s/segments/segment_%05d.mp4", buildRecordingPrefix(recordingID, matchID), segmentIndex)
}

func getSegmentMeta(segment *SegmentDocument) bson.M {
	if segment == nil {
		return bson.M{}
	}
	return mapFromValue(segment.Meta)
}

func buildRecordingManifestObjectKey(recordingID, matchID string) string {
	return fmt.Sprintf("%s/manifest.json", buildRecordingPrefix(recordingID, matchID))
}

func findRecordingSegment(recording *RecordingDocument, segmentIndex int) *SegmentDocument {
	if recording == nil {
		return nil
	}
	for index := range recording.Segments {
		if recording.Segments[index].Index == segmentIndex {
			return &recording.Segments[index]
		}
	}
	return nil
}

func pickStorageTarget(targets []StorageTarget, preferredID string) *StorageTarget {
	normalizedPreferredID := strings.TrimSpace(preferredID)
	if normalizedPreferredID != "" {
		for index := range targets {
			if strings.TrimSpace(targets[index].ID) == normalizedPreferredID && storageTargetUsable(targets[index]) {
				return &targets[index]
			}
		}
	}
	for index := range targets {
		if storageTargetUsable(targets[index]) {
			return &targets[index]
		}
	}
	return nil
}

func storageTargetUsable(target StorageTarget) bool {
	return target.Enabled &&
		strings.TrimSpace(target.ID) != "" &&
		strings.TrimSpace(target.Endpoint) != "" &&
		strings.TrimSpace(target.AccessKeyID) != "" &&
		strings.TrimSpace(target.SecretAccessKey) != "" &&
		strings.TrimSpace(target.BucketName) != ""
}

func shouldPreserveExportState(recording *RecordingDocument) bool {
	if recording == nil {
		return false
	}
	switch strings.TrimSpace(recording.Status) {
	case "pending_export_window", "exporting", "ready", "failed":
		return true
	default:
		return false
	}
}

func refreshRecordingAggregate(recording *RecordingDocument) {
	if recording == nil {
		return
	}
	var sizeBytes int64
	durationSeconds := 0.0
	for _, segment := range recording.Segments {
		sizeBytes += maxInt64(0, segment.SizeBytes)
		durationSeconds += math.Max(0, segment.DurationSeconds)
	}
	recording.SizeBytes = sizeBytes
	recording.DurationSeconds = normalizeNumber(durationSeconds)
}

func sortSegmentsForPlayback(segments []SegmentDocument) []SegmentDocument {
	output := append([]SegmentDocument(nil), segments...)
	sort.Slice(output, func(i, j int) bool {
		return output[i].Index < output[j].Index
	})
	return output
}

func pendingSegments(recording *RecordingDocument) []SegmentDocument {
	output := make([]SegmentDocument, 0)
	for _, segment := range recording.Segments {
		if segment.UploadStatus != "uploaded" {
			output = append(output, segment)
		}
	}
	return output
}

func nowPtr() *time.Time {
	now := time.Now().UTC()
	return &now
}

func buildExportWindowDecision(now time.Time, ignoreWindow bool) RecordingQueueDecision {
	if ignoreWindow || !parseBoolEnv("LIVE_RECORDING_EXPORT_WINDOW_ENABLED", false) {
		return RecordingQueueDecision{
			Enabled:        false,
			ShouldQueueNow: true,
			DelayMs:        0,
			Timezone:       firstNonEmptyString(strings.TrimSpace(os.Getenv("LIVE_RECORDING_EXPORT_WINDOW_TZ")), "Asia/Saigon"),
			WindowStart:    firstNonEmptyString(strings.TrimSpace(os.Getenv("LIVE_RECORDING_EXPORT_WINDOW_START")), "00:00"),
			WindowEnd:      firstNonEmptyString(strings.TrimSpace(os.Getenv("LIVE_RECORDING_EXPORT_WINDOW_END")), "06:00"),
		}
	}

	location, err := time.LoadLocation(firstNonEmptyString(strings.TrimSpace(os.Getenv("LIVE_RECORDING_EXPORT_WINDOW_TZ")), "Asia/Saigon"))
	if err != nil {
		location = time.FixedZone("Asia/Saigon", 7*60*60)
	}
	startHour, startMinute := parseWindowClock(firstNonEmptyString(strings.TrimSpace(os.Getenv("LIVE_RECORDING_EXPORT_WINDOW_START")), "00:00"), 0, 0)
	endHour, endMinute := parseWindowClock(firstNonEmptyString(strings.TrimSpace(os.Getenv("LIVE_RECORDING_EXPORT_WINDOW_END")), "06:00"), 6, 0)
	nowInZone := now.In(location)
	start := time.Date(nowInZone.Year(), nowInZone.Month(), nowInZone.Day(), startHour, startMinute, 0, 0, location)
	end := time.Date(nowInZone.Year(), nowInZone.Month(), nowInZone.Day(), endHour, endMinute, 0, 0, location)

	crossesMidnight := end.Before(start) || end.Equal(start)
	inWindow := false
	nextStart := start
	if !crossesMidnight {
		inWindow = (nowInZone.Equal(start) || nowInZone.After(start)) && nowInZone.Before(end)
		if !inWindow {
			if nowInZone.Before(start) {
				nextStart = start
			} else {
				nextStart = start.Add(24 * time.Hour)
			}
		}
	} else {
		overnightEnd := end.Add(24 * time.Hour)
		inWindow = (nowInZone.Equal(start) || nowInZone.After(start)) || nowInZone.Before(end)
		if !inWindow {
			if nowInZone.Before(end) {
				nextStart = start.Add(-24 * time.Hour)
			} else {
				nextStart = start
			}
		} else if nowInZone.Before(end) {
			start = start.Add(-24 * time.Hour)
		}
		_ = overnightEnd
	}

	scheduledAt := nowInZone
	if !inWindow {
		scheduledAt = nextStart
	}
	delayMs := scheduledAt.Sub(nowInZone).Milliseconds()
	if delayMs < 0 {
		delayMs = 0
	}

	scheduledAtUTC := scheduledAt.UTC()
	return RecordingQueueDecision{
		Enabled:        true,
		ShouldQueueNow: inWindow || delayMs == 0,
		DelayMs:        delayMs,
		ScheduledAt:    &scheduledAtUTC,
		Timezone:       location.String(),
		WindowStart:    fmt.Sprintf("%02d:%02d", startHour, startMinute),
		WindowEnd:      fmt.Sprintf("%02d:%02d", endHour, endMinute),
	}
}

func parseWindowClock(raw string, fallbackHour, fallbackMinute int) (int, int) {
	parts := strings.Split(strings.TrimSpace(raw), ":")
	if len(parts) != 2 {
		return fallbackHour, fallbackMinute
	}
	hour, errHour := strconv.Atoi(parts[0])
	minute, errMinute := strconv.Atoi(parts[1])
	if errHour != nil || errMinute != nil || hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return fallbackHour, fallbackMinute
	}
	return hour, minute
}

func buildRequestedBySummary(userID string) bson.M {
	if strings.TrimSpace(userID) == "" {
		return bson.M{
			"userId": nil,
			"name":   "",
			"email":  "",
		}
	}
	if objectID, err := primitive.ObjectIDFromHex(strings.TrimSpace(userID)); err == nil {
		return bson.M{
			"userId": objectID,
			"name":   "",
			"email":  "",
		}
	}
	return bson.M{
		"userId": nil,
		"name":   "",
		"email":  "",
	}
}
