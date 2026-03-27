package recordingsv2

import (
	"context"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func (s *Service) GetMonitorSnapshot(ctx context.Context) (map[string]any, int, error) {
	recordings, err := s.repository.ListMonitorRecordings(ctx)
	if err != nil {
		return nil, 0, err
	}

	systemSettings, err := s.repository.LoadSystemSettings(ctx)
	if err != nil {
		systemSettings = bson.M{}
	}

	workerHealth, _, workerErr := s.GetWorkerHealth(ctx)
	if workerErr != nil {
		workerHealth = map[string]any{
			"ok":     false,
			"alive":  false,
			"status": "offline",
		}
	}

	driveSettings := buildRecordingDriveSettings(systemSettings)
	rows := make([]map[string]any, 0, len(recordings))
	for _, recording := range recordings {
		rows = append(rows, s.buildMonitorRow(recording, workerHealth, driveSettings))
	}
	sortMonitorRows(rows)

	summary := map[string]any{
		"total":                0,
		"active":               0,
		"recording":            0,
		"uploading":            0,
		"pendingExportWindow":  0,
		"exporting":            0,
		"ready":                0,
		"failed":               0,
		"totalDurationSeconds": 0.0,
		"totalSizeBytes":       int64(0),
		"totalSegments":        0,
		"uploadedSegments":     0,
		"pendingSegments":      0,
	}
	for _, row := range rows {
		accumulateMonitorSummary(summary, row)
	}
	summary["r2Storage"] = s.buildR2StorageSummary(ctx, recordings)

	return map[string]any{
		"summary": summary,
		"rows":    rows,
		"meta": map[string]any{
			"realtimeMode":    "event-driven",
			"lastEventAt":     nil,
			"lastEventReason": "bootstrap",
			"lastEventMode":   "event",
			"lastPublishAt":   nil,
			"lastPublishMode": "event",
			"lastReconcileAt": nil,
			"workerHealth":    workerHealth,
			"exportQueue":     map[string]any{},
			"driveSettings":   driveSettings,
			"generatedAt":     time.Now().UTC(),
		},
	}, 200, nil
}

func (s *Service) buildMonitorRow(recording bson.M, workerHealth map[string]any, driveSettings map[string]any) map[string]any {
	match := buildEnrichedMatch(recording)
	participantsLabel := buildParticipantsLabelFromMatch(match)
	tournamentName := stringFromValue(mapFromValue(match["tournament"])["name"])
	bracket := mapFromValue(match["bracket"])
	bracketName := stringFromValue(bracket["name"])
	bracketStage := stringFromValue(bracket["stage"])
	courtLabel := buildCourtLabelFromMatch(match, recording)
	segmentSummary := summarizeRecordingSegments(arrayFromValue(recording["segments"]), stringFromValue(recording["r2TargetId"]), stringFromValue(recording["r2BucketName"]))
	status := strings.TrimSpace(stringFromValue(recording["status"]))
	exportPipeline := buildExportPipelineInfo(recording, workerHealth)
	driveAuthMode := firstNonEmptyString(
		stringFromValue(exportPipeline["driveAuthMode"]),
		stringFromValue(driveSettings["mode"]),
		"serviceAccount",
	)

	recordingID := idStringFromValue(recording["_id"])
	competitionLabel := compactLabel(
		tournamentName,
		compactLabel(bracketName, bracketStage),
		courtLabel,
	)

	return map[string]any{
		"id":                     recordingID,
		"recordingId":            recordingID,
		"recordingSessionId":     stringFromValue(recording["recordingSessionId"]),
		"status":                 status,
		"statusMeta":             buildStatusMeta(status),
		"mode":                   stringFromValue(recording["mode"]),
		"modeLabel":              buildModeLabel(stringFromValue(recording["mode"])),
		"quality":                stringFromValue(recording["quality"]),
		"matchId":                firstNonEmptyString(idStringFromValue(match["_id"]), idStringFromValue(recording["match"])),
		"matchCode":              firstNonEmptyString(buildMatchVBTCode(match), stringFromValue(match["code"])),
		"participantsLabel":      firstNonEmptyString(participantsLabel, "Unknown match"),
		"tournamentName":         tournamentName,
		"tournamentStatus":       stringFromValue(mapFromValue(match["tournament"])["status"]),
		"bracketName":            bracketName,
		"bracketStage":           bracketStage,
		"courtLabel":             courtLabel,
		"competitionLabel":       competitionLabel,
		"createdAt":              timeFromValue(recording["createdAt"]),
		"updatedAt":              timeFromValue(recording["updatedAt"]),
		"finalizedAt":            timeFromValue(recording["finalizedAt"]),
		"readyAt":                timeFromValue(recording["readyAt"]),
		"durationSeconds":        normalizeNumber(numberFromValue(recording["durationSeconds"])),
		"sizeBytes":              anyToInt64(recording["sizeBytes"]),
		"exportAttempts":         toInt(recording["exportAttempts"]),
		"playbackUrl":            buildRecordingPlaybackURL(recordingID),
		"temporaryPlaybackUrl":   buildRecordingTemporaryPlaybackURL(recordingID),
		"temporaryPlaybackReady": isTemporaryPlaybackReadyFromSummary(recording, segmentSummary),
		"rawStreamUrl":           buildRecordingRawStreamURL(recordingID),
		"rawStatusUrl":           buildRecordingRawStatusURL(recordingID),
		"rawStreamAvailable":     stringFromValue(recording["driveFileId"]) != "" || stringFromValue(recording["driveRawUrl"]) != "",
		"driveRawUrl":            emptyStringToNil(stringFromValue(recording["driveRawUrl"])),
		"drivePreviewUrl":        emptyStringToNil(stringFromValue(recording["drivePreviewUrl"])),
		"driveFileId":            emptyStringToNil(stringFromValue(recording["driveFileId"])),
		"driveAuthMode":          driveAuthMode,
		"r2SourceBytes":          estimateRecordingR2SourceBytes(recording),
		"r2TargetId":             emptyStringToNil(stringFromValue(recording["r2TargetId"])),
		"r2BucketName":           emptyStringToNil(stringFromValue(recording["r2BucketName"])),
		"scheduledExportAt":      firstNonNil(timeFromValue(recording["scheduledExportAt"]), exportPipeline["scheduledExportAt"]),
		"sourceCleanupStatus":    emptyStringToNil(nestedString(mapFromValue(recording["meta"]), "sourceCleanup", "status")),
		"aiCommentary": buildAICommentarySummary(&RecordingDocument{
			ID:           objectIDFromAny(recording["_id"]),
			AICommentary: mapFromValue(recording["aiCommentary"]),
		}),
		"exportPipeline": exportPipeline,
		"error":          stringFromValue(recording["error"]),
		"segmentSummary": segmentSummary,
	}
}

func buildEnrichedMatch(root bson.M) bson.M {
	match := mapFromValue(root["matchDoc"])
	if len(match) == 0 {
		return bson.M{}
	}
	match["pairA"] = attachRegistrationUsers(mapFromValue(root["pairA"]), mapFromValue(root["pairAPlayer1User"]), mapFromValue(root["pairAPlayer2User"]))
	match["pairB"] = attachRegistrationUsers(mapFromValue(root["pairB"]), mapFromValue(root["pairBPlayer1User"]), mapFromValue(root["pairBPlayer2User"]))
	match["court"] = firstNonEmptyMap(mapFromValue(root["courtDoc"]), mapFromValue(root["recordingCourtDoc"]))
	match["bracket"] = mapFromValue(root["bracketDoc"])
	match["tournament"] = mapFromValue(root["tournamentDoc"])
	return match
}

func attachRegistrationUsers(registration, player1User, player2User bson.M) bson.M {
	if len(registration) == 0 {
		return bson.M{}
	}
	player1 := mapFromValue(registration["player1"])
	if len(player1) > 0 && len(player1User) > 0 {
		player1["user"] = player1User
		registration["player1"] = player1
	}
	player2 := mapFromValue(registration["player2"])
	if len(player2) > 0 && len(player2User) > 0 {
		player2["user"] = player2User
		registration["player2"] = player2
	}
	return registration
}

func objectIDFromAny(value any) primitive.ObjectID {
	switch typed := value.(type) {
	case primitive.ObjectID:
		return typed
	default:
		objectID, err := primitive.ObjectIDFromHex(idStringFromValue(value))
		if err != nil {
			return primitive.NilObjectID
		}
		return objectID
	}
}
