package recordingsv2

import (
	"os"
	"strings"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func serializeAICommentaryJob(jobDoc bson.M) map[string]any {
	if len(jobDoc) == 0 {
		return nil
	}
	match := buildEnrichedMatch(jobDoc)
	recording := mapFromValue(jobDoc["recordingDoc"])
	if len(recording) == 0 {
		recording = bson.M{
			"_id":          jobDoc["recording"],
			"status":       nil,
			"aiCommentary": bson.M{},
		}
	}
	scriptSegments := arrayFromValue(jobDoc["scriptSegments"])
	scriptPreview := make([]map[string]any, 0, len(scriptSegments))
	for index, segmentValue := range scriptSegments {
		segment := mapFromValue(segmentValue)
		text := strings.TrimSpace(stringFromValue(segment["text"]))
		if text == "" {
			continue
		}
		scriptPreview = append(scriptPreview, map[string]any{
			"segmentIndex": index,
			"startSec":     normalizeNumber(numberFromValue(segment["startSec"])),
			"endSec":       normalizeNumber(numberFromValue(segment["endSec"])),
			"sceneIndex":   emptyIntToNil(int(numberFromValue(segment["sceneIndex"]))),
			"windowKind":   emptyStringToNil(stringFromValue(segment["windowKind"])),
			"emotion":      emptyStringToNil(stringFromValue(segment["emotion"])),
			"energy":       emptyFloatToNil(numberFromValue(segment["energy"])),
			"text":         text,
		})
	}
	analysisPreview := mapFromValue(jobDoc["analysisPreview"])
	analysisPreview["scriptPreview"] = scriptPreview

	recordingSummary := buildAICommentarySummary(&RecordingDocument{
		ID:           objectIDFromAny(recording["_id"]),
		AICommentary: mapFromValue(recording["aiCommentary"]),
	})
	steps := make([]map[string]any, 0, len(arrayFromValue(jobDoc["steps"])))
	for _, stepValue := range arrayFromValue(jobDoc["steps"]) {
		step := mapFromValue(stepValue)
		steps = append(steps, map[string]any{
			"key":         stringFromValue(step["key"]),
			"label":       stringFromValue(step["label"]),
			"status":      stringFromValue(step["status"]),
			"startedAt":   timeFromValue(step["startedAt"]),
			"completedAt": timeFromValue(step["completedAt"]),
			"message":     stringFromValue(step["message"]),
			"error":       stringFromValue(step["error"]),
			"result":      step["result"],
		})
	}

	return map[string]any{
		"id":                idStringFromValue(firstNonNil(jobDoc["_id"], jobDoc["id"])),
		"recordingId":       firstNonEmptyString(idStringFromValue(recording["_id"]), idStringFromValue(jobDoc["recording"])),
		"matchId":           firstNonEmptyString(idStringFromValue(match["_id"]), idStringFromValue(jobDoc["match"])),
		"matchCode":         stringFromValue(match["code"]),
		"participantsLabel": buildParticipantsLabelFromMatch(match),
		"tournamentName":    stringFromValue(mapFromValue(match["tournament"])["name"]),
		"triggerMode":       firstNonEmptyString(stringFromValue(jobDoc["triggerMode"]), "manual"),
		"status":            firstNonEmptyString(stringFromValue(jobDoc["status"]), "queued"),
		"language":          emptyStringToNil(stringFromValue(jobDoc["language"])),
		"voicePreset":       emptyStringToNil(stringFromValue(jobDoc["voicePreset"])),
		"tonePreset":        emptyStringToNil(stringFromValue(jobDoc["tonePreset"])),
		"mixMode":           emptyStringToNil(stringFromValue(jobDoc["mixMode"])),
		"sourceFingerprint": emptyStringToNil(stringFromValue(jobDoc["sourceFingerprint"])),
		"settingsHash":      emptyStringToNil(stringFromValue(jobDoc["settingsHash"])),
		"progressPercent":   int(numberFromValue(jobDoc["progressPercent"])),
		"currentStepKey":    emptyStringToNil(stringFromValue(jobDoc["currentStepKey"])),
		"currentStepLabel":  emptyStringToNil(stringFromValue(jobDoc["currentStepLabel"])),
		"lastError":         stringFromValue(jobDoc["lastError"]),
		"summary":           mapFromValue(jobDoc["summary"]),
		"analysisPreview":   analysisPreview,
		"artifacts":         mapFromValue(jobDoc["artifacts"]),
		"requestedBy":       mapFromValue(jobDoc["requestedBy"]),
		"startedAt":         timeFromValue(jobDoc["startedAt"]),
		"finishedAt":        timeFromValue(jobDoc["finishedAt"]),
		"createdAt":         timeFromValue(jobDoc["createdAt"]),
		"updatedAt":         timeFromValue(jobDoc["updatedAt"]),
		"worker":            mapFromValue(jobDoc["worker"]),
		"recordingStatus":   emptyStringToNil(stringFromValue(recording["status"])),
		"recordingPlaybackUrl": firstNonNil(
			recordingSummary["dubbedPlaybackUrl"],
			nil,
		),
		"steps": steps,
	}
}

func buildAICommentaryVoicePresets() []map[string]any {
	return []map[string]any{
		{"id": "vi_male_pro", "language": "vi", "gender": "male", "label": "Vietnamese male pro"},
		{"id": "vi_female_pro", "language": "vi", "gender": "female", "label": "Vietnamese female pro"},
		{"id": "en_male_pro", "language": "en", "gender": "male", "label": "English male pro"},
		{"id": "en_female_pro", "language": "en", "gender": "female", "label": "English female pro"},
	}
}

func buildAICommentaryTonePresets() []map[string]any {
	return []map[string]any{
		{"id": "professional", "label": "Professional"},
		{"id": "energetic", "label": "Energetic"},
		{"id": "dramatic", "label": "Dramatic"},
	}
}

func buildAICommentaryGatewayHealth() map[string]any {
	scriptBaseURL := cleanGatewayBaseURL(strings.TrimSpace(os.Getenv("LIVE_RECORDING_AI_SCRIPT_BASE_URL")))
	scriptConfiguredModel := firstNonEmptyString(strings.TrimSpace(os.Getenv("LIVE_RECORDING_AI_SCRIPT_MODEL")), "gpt-5-codex-mini")
	scriptConfigured := scriptBaseURL != "" && strings.TrimSpace(os.Getenv("LIVE_RECORDING_AI_SCRIPT_API_KEY")) != ""
	ttsBaseURL := cleanGatewayBaseURL(strings.TrimSpace(os.Getenv("LIVE_RECORDING_AI_TTS_BASE_URL")))
	ttsConfiguredModel := firstNonEmptyString(strings.TrimSpace(os.Getenv("LIVE_RECORDING_AI_TTS_MODEL")), "gpt-4o-mini-tts")
	ttsConfigured := ttsBaseURL != "" && strings.TrimSpace(os.Getenv("LIVE_RECORDING_AI_TTS_API_KEY")) != ""

	script := map[string]any{
		"status":          ternaryString(scriptConfigured, "online", "not_configured"),
		"availableModels": []string{},
		"effectiveModel":  scriptConfiguredModel,
		"responsesUrl":    emptyStringToNil(joinGatewayPath(scriptBaseURL, "/responses")),
		"modelsUrl":       emptyStringToNil(joinGatewayPath(scriptBaseURL, "/models")),
		"message":         ternaryString(scriptConfigured, "Script gateway configured", "AI script route is not configured"),
	}
	tts := map[string]any{
		"status":         ternaryString(ttsConfigured, "online", "not_configured"),
		"speechUrl":      emptyStringToNil(joinGatewayPath(ttsBaseURL, "/audio/speech")),
		"effectiveModel": ttsConfiguredModel,
		"message":        ternaryString(ttsConfigured, "TTS gateway configured", "TTS gateway is not configured"),
	}
	overallStatus := "degraded"
	if scriptConfigured && ttsConfigured {
		overallStatus = "online"
	} else if !scriptConfigured || !ttsConfigured {
		overallStatus = "not_configured"
	}
	return map[string]any{
		"overallStatus": overallStatus,
		"script":        script,
		"tts":           tts,
		"presets": map[string]any{
			"voices": buildAICommentaryVoicePresets(),
			"tones":  buildAICommentaryTonePresets(),
		},
	}
}

func buildAICommentaryJobSteps() bson.A {
	steps := make(bson.A, 0, len(commentaryStepDefinitions))
	for _, step := range commentaryStepDefinitions {
		steps = append(steps, bson.M{
			"key":         step["key"],
			"label":       step["label"],
			"status":      "queued",
			"startedAt":   nil,
			"completedAt": nil,
			"message":     "",
			"error":       "",
			"result":      nil,
		})
	}
	return steps
}

func buildQueuedAICommentaryState(recording *RecordingDocument, jobID primitive.ObjectID, settings aiCommentarySettings, sourceFingerprint string) bson.M {
	current := mapFromValue(recording.AICommentary)
	return bson.M{
		"status":                "queued",
		"latestJobId":           jobID,
		"sourceDriveFileId":     firstNonEmptyString(strings.TrimSpace(recording.DriveFileID), stringFromValue(current["sourceDriveFileId"])),
		"language":              settings.DefaultLanguage,
		"voicePreset":           settings.DefaultVoicePreset,
		"tonePreset":            settings.DefaultTonePreset,
		"sourceFingerprint":     sourceFingerprint,
		"error":                 nil,
		"dubbedDriveFileId":     current["dubbedDriveFileId"],
		"dubbedDriveRawUrl":     current["dubbedDriveRawUrl"],
		"dubbedDrivePreviewUrl": current["dubbedDrivePreviewUrl"],
		"dubbedPlaybackUrl":     current["dubbedPlaybackUrl"],
		"outputSizeBytes":       current["outputSizeBytes"],
		"renderedAt":            current["renderedAt"],
	}
}

func normalizeRequestedBy(requestedBy bson.M) bson.M {
	userID := objectIDFromAny(requestedBy["userId"])
	name := firstNonEmptyString(stringFromValue(requestedBy["name"]), stringFromValue(requestedBy["fullName"]))
	return bson.M{
		"userId": firstNonNil(emptyObjectIDToNil(userID), nil),
		"name":   name,
		"email":  stringFromValue(requestedBy["email"]),
	}
}

func isFinishedLikeStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "finished", "ended", "stopped":
		return true
	default:
		return false
	}
}

func clampInt(value, minValue, maxValue, fallback int) int {
	if value == 0 {
		value = fallback
	}
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func cleanGatewayBaseURL(value string) string {
	next := strings.TrimRight(strings.TrimSpace(value), "/")
	next = strings.TrimSuffix(next, "/responses")
	next = strings.TrimSuffix(next, "/models")
	next = strings.TrimSuffix(next, "/audio/speech")
	return next
}

func joinGatewayPath(baseURL, suffix string) string {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return ""
	}
	return baseURL + suffix
}

func emptyFloatToNil(value float64) any {
	if value == 0 {
		return nil
	}
	return value
}

func emptyIntToNil(value int) any {
	if value == 0 {
		return nil
	}
	return value
}

func emptyObjectIDToNil(value primitive.ObjectID) any {
	if value == primitive.NilObjectID {
		return nil
	}
	return value
}
