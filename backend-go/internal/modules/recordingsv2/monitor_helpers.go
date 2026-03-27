package recordingsv2

import (
	"context"
	"os"
	"sort"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
)

func buildParticipantsLabelFromMatch(match bson.M) string {
	return compactLabelWithSep(
		" vs ",
		buildPairLabelFromRegistration(mapFromValue(match["pairA"]), stringFromValue(mapFromValue(match["tournament"])["nameDisplayMode"])),
		buildPairLabelFromRegistration(mapFromValue(match["pairB"]), stringFromValue(mapFromValue(match["tournament"])["nameDisplayMode"])),
	)
}

func buildPairLabelFromRegistration(registration bson.M, displayMode string) string {
	if len(registration) == 0 {
		return ""
	}
	if teamName := stringFromValue(registration["teamName"]); teamName != "" {
		return teamName
	}
	if label := firstNonEmptyString(stringFromValue(registration["label"]), stringFromValue(registration["displayName"]), stringFromValue(registration["title"])); label != "" {
		return label
	}
	player1 := pickRegistrationPlayerName(mapFromValue(registration["player1"]), displayMode)
	player2 := pickRegistrationPlayerName(mapFromValue(registration["player2"]), displayMode)
	return compactLabelWithSep(" / ", player1, player2)
}

func pickRegistrationPlayerName(player bson.M, displayMode string) string {
	if len(player) == 0 {
		return ""
	}
	user := mapFromValue(player["user"])
	normalizedMode := strings.ToLower(strings.TrimSpace(displayMode))
	if normalizedMode == "nickname" {
		return firstNonEmptyString(
			stringFromValue(player["nickname"]),
			stringFromValue(player["nickName"]),
			stringFromValue(user["nickname"]),
			stringFromValue(user["nickName"]),
			stringFromValue(player["shortName"]),
			stringFromValue(player["fullName"]),
			stringFromValue(player["name"]),
			stringFromValue(user["fullName"]),
			stringFromValue(user["name"]),
		)
	}
	return firstNonEmptyString(
		stringFromValue(player["fullName"]),
		stringFromValue(player["name"]),
		stringFromValue(user["fullName"]),
		stringFromValue(user["name"]),
		stringFromValue(player["nickname"]),
		stringFromValue(player["nickName"]),
		stringFromValue(user["nickname"]),
		stringFromValue(user["nickName"]),
		stringFromValue(player["shortName"]),
	)
}

func buildCourtLabelFromMatch(match, recording bson.M) string {
	if label := stringFromValue(match["courtLabel"]); label != "" {
		return label
	}
	court := mapFromValue(match["court"])
	if label := firstNonEmptyString(stringFromValue(court["name"]), stringFromValue(court["label"])); label != "" {
		return label
	}
	if number := int(numberFromValue(court["number"])); number > 0 {
		return "Court " + stringFromValue(number)
	}
	recordingCourt := firstNonEmptyMap(mapFromValue(recording["recordingCourtDoc"]), mapFromValue(recording["courtId"]))
	if label := firstNonEmptyString(stringFromValue(recordingCourt["label"]), stringFromValue(recordingCourt["name"])); label != "" {
		return label
	}
	if number := int(numberFromValue(recordingCourt["number"])); number > 0 {
		return "Court " + stringFromValue(number)
	}
	return ""
}

func accumulateMonitorSummary(summary, row map[string]any) {
	status := strings.TrimSpace(stringFromValue(row["status"]))
	switch status {
	case "recording":
		summary["recording"] = toInt(summary["recording"]) + 1
	case "uploading":
		summary["uploading"] = toInt(summary["uploading"]) + 1
	case "pending_export_window":
		summary["pendingExportWindow"] = toInt(summary["pendingExportWindow"]) + 1
	case "exporting":
		summary["exporting"] = toInt(summary["exporting"]) + 1
	case "ready":
		summary["ready"] = toInt(summary["ready"]) + 1
	case "failed":
		summary["failed"] = toInt(summary["failed"]) + 1
	}
	if status == "recording" || status == "uploading" || status == "pending_export_window" || status == "exporting" {
		summary["active"] = toInt(summary["active"]) + 1
	}
	summary["total"] = toInt(summary["total"]) + 1
	summary["totalDurationSeconds"] = normalizeNumber(numberFromValue(summary["totalDurationSeconds"]) + numberFromValue(row["durationSeconds"]))
	summary["totalSizeBytes"] = maxInt64(0, anyToInt64(summary["totalSizeBytes"])+anyToInt64(row["sizeBytes"]))
	segmentSummary := mapFromValue(row["segmentSummary"])
	summary["totalSegments"] = toInt(summary["totalSegments"]) + int(numberFromValue(segmentSummary["totalSegments"]))
	summary["uploadedSegments"] = toInt(summary["uploadedSegments"]) + int(numberFromValue(segmentSummary["uploadedSegments"]))
	pendingSegments := int(numberFromValue(segmentSummary["totalSegments"])) - int(numberFromValue(segmentSummary["uploadedSegments"]))
	if pendingSegments < 0 {
		pendingSegments = 0
	}
	summary["pendingSegments"] = toInt(summary["pendingSegments"]) + pendingSegments
}

func summarizeRecordingSegments(segments []any, defaultTargetID, defaultBucketName string) map[string]any {
	type progress struct {
		index           int
		uploadStatus    string
		isFinal         bool
		sizeBytes       int64
		durationSeconds float64
		payload         map[string]any
	}

	progresses := make([]progress, 0, len(segments))
	for _, item := range segments {
		segment := mapFromValue(item)
		if len(segment) == 0 {
			continue
		}
		meta := mapFromValue(segment["meta"])
		completedParts := arrayFromValue(meta["completedParts"])
		var completedBytes int64
		for _, part := range completedParts {
			completedBytes += anyToInt64(mapFromValue(part)["sizeBytes"])
		}
		totalSizeBytes := anyToInt64(meta["totalSizeBytes"])
		if totalSizeBytes == 0 {
			totalSizeBytes = anyToInt64(meta["segmentSizeBytes"])
		}
		if totalSizeBytes == 0 {
			totalSizeBytes = anyToInt64(segment["sizeBytes"])
		}
		partSizeBytes := anyToInt64(meta["partSizeBytes"])
		percent := 0
		if totalSizeBytes > 0 {
			percent = int((completedBytes * 100) / totalSizeBytes)
			if percent > 100 {
				percent = 100
			}
		} else if strings.TrimSpace(stringFromValue(segment["uploadStatus"])) == "uploaded" {
			percent = 100
		}
		totalParts := 0
		if partSizeBytes > 0 && totalSizeBytes > 0 {
			totalParts = int((totalSizeBytes + partSizeBytes - 1) / partSizeBytes)
		}
		progresses = append(progresses, progress{
			index:           int(numberFromValue(segment["index"])),
			uploadStatus:    stringFromValue(segment["uploadStatus"]),
			isFinal:         parseBool(strings.TrimSpace(stringFromValue(segment["isFinal"])), false),
			sizeBytes:       anyToInt64(segment["sizeBytes"]),
			durationSeconds: normalizeNumber(numberFromValue(segment["durationSeconds"])),
			payload: map[string]any{
				"index":              int(numberFromValue(segment["index"])),
				"objectKey":          stringFromValue(segment["objectKey"]),
				"storageTargetId":    emptyStringToNil(firstNonEmptyString(stringFromValue(segment["storageTargetId"]), defaultTargetID)),
				"bucketName":         emptyStringToNil(firstNonEmptyString(stringFromValue(segment["bucketName"]), defaultBucketName)),
				"etag":               emptyStringToNil(stringFromValue(segment["etag"])),
				"uploadStatus":       stringFromValue(segment["uploadStatus"]),
				"isFinal":            parseBool(strings.TrimSpace(stringFromValue(segment["isFinal"])), false),
				"sizeBytes":          anyToInt64(segment["sizeBytes"]),
				"durationSeconds":    normalizeNumber(numberFromValue(segment["durationSeconds"])),
				"uploadedAt":         timeFromValue(segment["uploadedAt"]),
				"completedPartCount": len(completedParts),
				"completedBytes":     completedBytes,
				"totalSizeBytes":     totalSizeBytes,
				"percent":            percent,
				"partSizeBytes":      partSizeBytes,
				"totalParts":         totalParts,
				"lastPartUploadedAt": timeFromValue(meta["lastPartUploadedAt"]),
				"startedAt":          timeFromValue(meta["startedAt"]),
			},
		})
	}
	sort.Slice(progresses, func(i, j int) bool { return progresses[i].index < progresses[j].index })

	detailedSegments := make([]map[string]any, 0, len(progresses))
	uploadedSegments := 0
	uploadingSegments := 0
	failedSegments := 0
	abortedSegments := 0
	totalUploadedBytes := int64(0)
	finalSegmentUploaded := false
	for _, item := range progresses {
		detailedSegments = append(detailedSegments, item.payload)
		switch item.uploadStatus {
		case "uploaded":
			uploadedSegments++
			totalUploadedBytes += item.sizeBytes
			if item.isFinal {
				finalSegmentUploaded = true
			}
		case "presigned", "uploading_parts":
			uploadingSegments++
		case "failed":
			failedSegments++
		case "aborted":
			abortedSegments++
		}
	}
	var latestSegment any
	var activeUploadSegment any
	if len(detailedSegments) > 0 {
		latestSegment = detailedSegments[len(detailedSegments)-1]
	}
	for index := len(progresses) - 1; index >= 0; index-- {
		if progresses[index].uploadStatus == "presigned" || progresses[index].uploadStatus == "uploading_parts" {
			activeUploadSegment = progresses[index].payload
			break
		}
	}
	return map[string]any{
		"totalSegments":        len(detailedSegments),
		"uploadedSegments":     uploadedSegments,
		"uploadingSegments":    uploadingSegments,
		"failedSegments":       failedSegments,
		"abortedSegments":      abortedSegments,
		"totalUploadedBytes":   totalUploadedBytes,
		"finalSegmentUploaded": finalSegmentUploaded,
		"segments":             detailedSegments,
		"latestSegment":        latestSegment,
		"activeUploadSegment":  activeUploadSegment,
	}
}

func buildStatusMeta(status string) map[string]any {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "recording":
		return map[string]any{"code": "recording", "color": "error", "label": "Recording"}
	case "uploading":
		return map[string]any{"code": "uploading", "color": "warning", "label": "Uploading"}
	case "pending_export_window":
		return map[string]any{"code": "pending_export_window", "color": "secondary", "label": "Cho khung gio dem"}
	case "exporting":
		return map[string]any{"code": "exporting", "color": "info", "label": "Exporting"}
	case "ready":
		return map[string]any{"code": "ready", "color": "success", "label": "Ready"}
	case "failed":
		return map[string]any{"code": "failed", "color": "error", "label": "Failed"}
	default:
		code := firstNonEmptyString(strings.ToLower(strings.TrimSpace(status)), "unknown")
		return map[string]any{"code": code, "color": "default", "label": firstNonEmptyString(status, "Unknown")}
	}
}

func buildModeLabel(mode string) string {
	switch strings.ToUpper(strings.TrimSpace(mode)) {
	case "STREAM_AND_RECORD":
		return "Livestream + Record"
	case "RECORD_ONLY":
		return "Record only"
	case "STREAM_ONLY":
		return "Livestream only"
	default:
		return firstNonEmptyString(mode, "Unknown")
	}
}

func estimateRecordingR2SourceBytes(recording bson.M) int64 {
	if nestedString(mapFromValue(recording["meta"]), "sourceCleanup", "status") == "completed" {
		return 0
	}
	total := int64(0)
	for _, item := range arrayFromValue(recording["segments"]) {
		segment := mapFromValue(item)
		meta := mapFromValue(segment["meta"])
		if stringFromValue(segment["uploadStatus"]) == "uploaded" {
			total += anyToInt64(segment["sizeBytes"])
			continue
		}
		for _, part := range arrayFromValue(meta["completedParts"]) {
			total += anyToInt64(mapFromValue(part)["sizeBytes"])
		}
	}
	return total
}

func buildExportPipelineInfo(recording bson.M, workerHealth map[string]any) map[string]any {
	recordingID := idStringFromValue(recording["_id"])
	exportPipeline := mapFromValue(mapFromValue(recording["meta"])["exportPipeline"])
	worker := mapFromValue(workerHealth["worker"])
	currentRecordingID := stringFromValue(worker["currentRecordingId"])
	alive := parseBool(strings.TrimSpace(stringFromValue(workerHealth["alive"])), false)
	inWorker := alive && currentRecordingID != "" && currentRecordingID == recordingID

	stage := stringFromValue(exportPipeline["stage"])
	status := stringFromValue(recording["status"])
	if stage == "" {
		switch status {
		case "pending_export_window":
			stage = "delayed_until_window"
		case "exporting":
			if inWorker {
				stage = "downloading"
			} else if alive {
				stage = "awaiting_queue_sync"
			} else {
				stage = "worker_offline"
			}
		case "failed":
			stage = "failed"
		case "ready":
			stage = "completed"
		}
	}

	stageLabels := map[string]string{
		"delayed_until_window": "Dang cho khung gio dem",
		"queued":               "Dang cho worker",
		"queued_retry":         "Dang doi retry",
		"awaiting_queue_sync":  "Dang dong bo trang thai queue",
		"downloading":          "Worker dang tai segment tu R2",
		"merging":              "Worker dang ghep video",
		"uploading_drive":      "Dang upload len Drive",
		"cleaning_r2":          "Dang don segment tren R2",
		"completed":            "Hoan tat",
		"failed":               "Export that bai",
		"stale_no_job":         "Export treo - khong co job trong queue",
		"worker_offline":       "Worker dang offline",
	}
	detail := stringFromValue(exportPipeline["detail"])
	if detail == "" {
		switch stage {
		case "delayed_until_window":
			detail = "Dang doi toi khung gio export dem."
		case "awaiting_queue_sync":
			detail = "Ban ghi vua vao exporting, dang cho queue/worker dong bo."
		case "worker_offline":
			detail = "Worker khong co heartbeat nen chua the xu ly export nay."
		case "failed":
			detail = firstNonEmptyString(stringFromValue(recording["error"]), stringFromValue(exportPipeline["lastError"]))
		}
	}

	return map[string]any{
		"stage":                emptyStringToNil(stage),
		"label":                emptyStringToNil(firstNonEmptyString(stageLabels[stage], stringFromValue(exportPipeline["label"]))),
		"detail":               emptyStringToNil(detail),
		"driveAuthMode":        emptyStringToNil(stringFromValue(exportPipeline["driveAuthMode"])),
		"queuePosition":        emptyStringToNil(stringFromValue(exportPipeline["queuePosition"])),
		"staleReason":          emptyStringToNil(stringFromValue(exportPipeline["staleReason"])),
		"jobId":                emptyStringToNil(stringFromValue(exportPipeline["queueJobId"])),
		"inWorker":             inWorker,
		"startedAt":            timeFromValue(exportPipeline["startedAt"]),
		"downloadStartedAt":    timeFromValue(exportPipeline["downloadStartedAt"]),
		"mergeStartedAt":       timeFromValue(exportPipeline["mergeStartedAt"]),
		"driveUploadStartedAt": timeFromValue(exportPipeline["driveUploadStartedAt"]),
		"completedAt":          timeFromValue(exportPipeline["completedAt"]),
		"failedAt":             timeFromValue(exportPipeline["failedAt"]),
		"scheduledExportAt":    timeFromValue(exportPipeline["scheduledExportAt"]),
	}
}

func buildMatchVBTCode(match bson.M) string {
	bracket := mapFromValue(match["bracket"])
	bracketType := strings.ToLower(firstNonEmptyString(stringFromValue(bracket["type"]), stringFromValue(match["format"])))
	round := int(numberFromValue(firstNonEmptyString(stringFromValue(match["rrRound"]), stringFromValue(match["round"]))))
	if round <= 0 {
		round = 1
	}
	order := int(numberFromValue(match["order"])) + 1
	if order <= 0 {
		order = 1
	}
	if isGroupBracketType(bracketType) {
		if poolIndex := resolvePoolIndex(mapFromValue(match["pool"])); poolIndex > 0 {
			return "V1-B" + stringFromValue(poolIndex) + "-T" + stringFromValue(order)
		}
	}
	return "V" + stringFromValue(round) + "-T" + stringFromValue(order)
}

func isGroupBracketType(bracketType string) bool {
	switch strings.ToLower(strings.TrimSpace(bracketType)) {
	case "group", "round_robin", "gsl", "groups", "rr":
		return true
	default:
		return false
	}
}

func resolvePoolIndex(pool bson.M) int {
	poolName := strings.ToUpper(strings.TrimSpace(stringFromValue(pool["name"])))
	if len(poolName) == 1 && poolName[0] >= 'A' && poolName[0] <= 'Z' {
		return int(poolName[0]-'A') + 1
	}
	for index := 0; index < len(poolName); index++ {
		if poolName[index] >= '0' && poolName[index] <= '9' {
			return int(numberFromValue(poolName[index:]))
		}
	}
	return 0
}

func buildRecordingDriveSettings(systemSettings bson.M) map[string]any {
	recordingDrive := mapFromValue(systemSettings["recordingDrive"])
	mode := "serviceAccount"
	if strings.TrimSpace(stringFromValue(recordingDrive["mode"])) == "oauthUser" {
		mode = "oauthUser"
	}
	return map[string]any{
		"enabled":       recordingDrive["enabled"] != false,
		"mode":          mode,
		"folderId":      emptyStringToNil(firstNonEmptyString(stringFromValue(recordingDrive["folderId"]), strings.TrimSpace(os.Getenv("GOOGLE_DRIVE_RECORDINGS_FOLDER_ID")))),
		"sharedDriveId": emptyStringToNil(firstNonEmptyString(stringFromValue(recordingDrive["sharedDriveId"]), strings.TrimSpace(os.Getenv("GOOGLE_DRIVE_RECORDINGS_SHARED_DRIVE_ID")))),
	}
}

func (s *Service) buildR2StorageSummary(ctx context.Context, recordings []bson.M) map[string]any {
	targets, err := s.repository.LoadStorageTargets(ctx)
	if err != nil {
		targets = nil
	}
	totalBytes := int64(0)
	hasTotalBytes := false
	usedBytes := int64(0)
	recordingsWithSource := 0
	usedByTarget := map[string]int64{}
	recordingsByTarget := map[string]int{}

	for _, recording := range recordings {
		sourceBytes := estimateRecordingR2SourceBytes(recording)
		if sourceBytes <= 0 {
			continue
		}
		usedBytes += sourceBytes
		recordingsWithSource++

		targetID := strings.TrimSpace(stringFromValue(recording["r2TargetId"]))
		if targetID == "" {
			for _, item := range arrayFromValue(recording["segments"]) {
				segment := mapFromValue(item)
				targetID = strings.TrimSpace(stringFromValue(segment["storageTargetId"]))
				if targetID != "" {
					break
				}
			}
		}
		if targetID != "" {
			usedByTarget[targetID] += sourceBytes
			recordingsByTarget[targetID]++
		}
	}

	targetBreakdown := make([]map[string]any, 0, len(targets))
	for _, target := range targets {
		if target.CapacityBytes > 0 {
			totalBytes += target.CapacityBytes
			hasTotalBytes = true
		}
		remainingBytes := any(nil)
		percentUsed := any(nil)
		if target.CapacityBytes > 0 {
			remaining := target.CapacityBytes - usedByTarget[target.ID]
			if remaining < 0 {
				remaining = 0
			}
			remainingBytes = remaining
			percent := int((usedByTarget[target.ID] * 100) / target.CapacityBytes)
			if percent > 100 {
				percent = 100
			}
			percentUsed = percent
		}
		targetBreakdown = append(targetBreakdown, map[string]any{
			"id":                       target.ID,
			"label":                    target.Label,
			"endpoint":                 target.Endpoint,
			"bucketName":               target.BucketName,
			"capacityBytes":            emptyInt64ToNil(target.CapacityBytes),
			"usedBytes":                usedByTarget[target.ID],
			"remainingBytes":           remainingBytes,
			"percentUsed":              percentUsed,
			"objectCount":              nil,
			"recordingsWithSourceOnR2": recordingsByTarget[target.ID],
			"configured":               target.CapacityBytes > 0,
			"measured":                 false,
			"enabled":                  target.Enabled,
		})
	}

	remainingBytes := any(nil)
	percentUsed := any(nil)
	totalValue := any(nil)
	if hasTotalBytes {
		totalValue = totalBytes
		remaining := totalBytes - usedBytes
		if remaining < 0 {
			remaining = 0
		}
		remainingBytes = remaining
		percent := int((usedBytes * 100) / totalBytes)
		if percent > 100 {
			percent = 100
		}
		percentUsed = percent
	}

	return map[string]any{
		"usedBytes":                         usedBytes,
		"remainingBytes":                    remainingBytes,
		"totalBytes":                        totalValue,
		"percentUsed":                       percentUsed,
		"configured":                        hasTotalBytes,
		"recordingsWithSourceOnR2":          recordingsWithSource,
		"estimatedUsedBytes":                usedBytes,
		"estimatedRecordingsWithSourceOnR2": recordingsWithSource,
		"source":                            "db_estimate",
		"scannedAt":                         nil,
		"objectCount":                       0,
		"configuredTargetCount":             len(targets),
		"scannedTargetCount":                0,
		"targetBreakdown":                   targetBreakdown,
		"scanError":                         nil,
	}
}

func sortMonitorRows(rows []map[string]any) {
	priority := map[string]int{
		"recording":             0,
		"uploading":             1,
		"pending_export_window": 2,
		"exporting":             3,
		"failed":                4,
		"ready":                 5,
	}
	sort.Slice(rows, func(i, j int) bool {
		leftStatus := stringFromValue(rows[i]["status"])
		rightStatus := stringFromValue(rows[j]["status"])
		leftPriority, leftFound := priority[leftStatus]
		rightPriority, rightFound := priority[rightStatus]
		if !leftFound {
			leftPriority = 99
		}
		if !rightFound {
			rightPriority = 99
		}
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		return toUnixMillis(rows[i]["updatedAt"]) > toUnixMillis(rows[j]["updatedAt"])
	})
}

func isTemporaryPlaybackReadyFromSummary(recording, segmentSummary map[string]any) bool {
	return timeFromValue(recording["finalizedAt"]) != nil &&
		toInt(segmentSummary["uploadedSegments"]) > 0 &&
		toInt(segmentSummary["uploadingSegments"]) == 0 &&
		toInt(segmentSummary["failedSegments"]) == 0
}

func compactLabel(parts ...string) string {
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			filtered = append(filtered, trimmed)
		}
	}
	return strings.Join(filtered, " - ")
}

func compactLabelWithSep(separator string, parts ...string) string {
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			filtered = append(filtered, trimmed)
		}
	}
	return strings.Join(filtered, separator)
}

func toUnixMillis(value any) int64 {
	if ts, ok := timeFromValue(value).(time.Time); ok {
		return ts.UnixMilli()
	}
	return 0
}

func toInt(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	default:
		return int(numberFromValue(value))
	}
}

func anyToInt64(value any) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case int32:
		return int64(typed)
	default:
		return int64(numberFromValue(value))
	}
}

func emptyInt64ToNil(value int64) any {
	if value == 0 {
		return nil
	}
	return value
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstNonEmptyMap(values ...bson.M) bson.M {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return bson.M{}
}
