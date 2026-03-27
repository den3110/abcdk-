package recordingsv2

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"os"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
)

var commentaryStepDefinitions = []map[string]any{
	{"key": "resolve_source", "label": "Preparing source", "progressPercent": 10},
	{"key": "analyze_video", "label": "Analyzing video", "progressPercent": 22},
	{"key": "analyze_audio", "label": "Analyzing audio", "progressPercent": 26},
	{"key": "write_script", "label": "Writing commentary script", "progressPercent": 30},
	{"key": "tts", "label": "Rendering voice", "progressPercent": 55},
	{"key": "mix_video", "label": "Mixing commentary video", "progressPercent": 78},
	{"key": "upload_drive", "label": "Uploading to Drive", "progressPercent": 92},
}

type aiCommentarySettings struct {
	Enabled                bool
	AutoGenerateAfterDrive bool
	DefaultLanguage        string
	DefaultVoicePreset     string
	DefaultTonePreset      string
	KeepOriginalAudioBed   bool
	AudioBedLevelDB        int
	DuckAmountDB           int
}

func (s *Service) GetAICommentaryMonitor(ctx context.Context) (map[string]any, int, error) {
	settingsDoc, err := s.repository.LoadSystemSettings(ctx)
	if err != nil {
		settingsDoc = bson.M{}
	}
	settings := loadAICommentarySettings(settingsDoc)

	activeJob, err := s.repository.FindActiveAICommentaryJob(ctx)
	if err != nil {
		return nil, 0, err
	}
	recentJobs, err := s.repository.ListRecentAICommentaryJobs(ctx, 8)
	if err != nil {
		return nil, 0, err
	}
	queuedCount, _ := s.repository.CountAICommentaryJobsByStatus(ctx, "queued")
	runningCount, _ := s.repository.CountAICommentaryJobsByStatus(ctx, "running")
	completedCount, _ := s.repository.CountAICommentaryJobsByStatus(ctx, "completed")
	failedCount, _ := s.repository.CountAICommentaryJobsByStatus(ctx, "failed")

	serializedJobs := make([]map[string]any, 0, len(recentJobs))
	for _, job := range recentJobs {
		serializedJobs = append(serializedJobs, serializeAICommentaryJob(job))
	}

	return map[string]any{
		"settings":      settings.asMap(),
		"gatewayHealth": buildAICommentaryGatewayHealth(),
		"presets": map[string]any{
			"voice": buildAICommentaryVoicePresets(),
			"tone":  buildAICommentaryTonePresets(),
		},
		"activeJob":  serializeAICommentaryJob(activeJob),
		"recentJobs": serializedJobs,
		"summary": map[string]any{
			"queued":    queuedCount,
			"running":   runningCount,
			"completed": completedCount,
			"failed":    failedCount,
		},
		"meta": map[string]any{
			"workerIdentity": firstNonEmptyString(strings.TrimSpace(os.Getenv("COMPUTERNAME")), "backend-go-worker-ai-commentary"),
			"tickMs":         maxInt64(5000, int64(numberFromValue(os.Getenv("LIVE_RECORDING_AI_COMMENTARY_WORKER_TICK_MS")))),
			"staleMs":        maxInt64(10*60*1000, int64(numberFromValue(os.Getenv("LIVE_RECORDING_AI_COMMENTARY_STALE_MS")))),
			"generatedAt":    time.Now().UTC(),
		},
	}, 200, nil
}

func (s *Service) QueueAICommentary(ctx context.Context, recordingID string, requestedBy bson.M, forceRerender bool) (map[string]any, int, error) {
	recording, statusCode, err := s.loadMutableRecording(ctx, recordingID)
	if err != nil || statusCode != 0 {
		return nil, statusCode, err
	}

	settingsDoc, err := s.repository.LoadSystemSettings(ctx)
	if err != nil {
		return nil, 0, err
	}
	settings := loadAICommentarySettings(settingsDoc)
	if !settings.Enabled {
		return map[string]any{"message": "AI commentary is disabled in system settings"}, 409, nil
	}
	if strings.ToLower(strings.TrimSpace(recording.Status)) != "ready" {
		return map[string]any{"message": "Only ready recordings can be dubbed with AI commentary"}, 409, nil
	}
	if strings.TrimSpace(recording.DriveFileID) == "" && strings.TrimSpace(recording.DriveRawURL) == "" {
		return map[string]any{"message": "Recording Drive source is not ready"}, 409, nil
	}

	match, err := s.repository.FindMatchByID(ctx, recording.Match)
	if err != nil {
		return nil, 0, err
	}
	if match == nil {
		return map[string]any{"message": "Recording match not found"}, 404, nil
	}
	if !isFinishedLikeStatus(match.Status) {
		return map[string]any{"message": "Only finished matches can be dubbed with AI commentary"}, 409, nil
	}

	activeJob, err := s.repository.FindActiveAICommentaryJobByRecording(ctx, recording.ID)
	if err != nil {
		return nil, 0, err
	}
	if activeJob != nil {
		return map[string]any{"message": "AI commentary job already exists for this recording"}, 409, nil
	}

	sourceFingerprint, settingsHash := buildAICommentaryFingerprint(recording, settings)
	currentSummary := buildAICommentarySummary(recording)
	if !forceRerender && parseBool(strings.TrimSpace(stringFromValue(currentSummary["ready"])), false) && stringFromValue(currentSummary["sourceFingerprint"]) == sourceFingerprint {
		return map[string]any{
			"queued":    false,
			"skipped":   true,
			"reason":    "already_rendered_for_same_source",
			"recording": currentSummary,
			"job":       nil,
			"settings":  settings.asMap(),
		}, 200, nil
	}

	completedJob, err := s.repository.FindCompletedAICommentaryJobByFingerprint(ctx, recording.ID, sourceFingerprint)
	if err != nil {
		return nil, 0, err
	}
	if completedJob != nil && !forceRerender {
		return map[string]any{
			"queued":    false,
			"skipped":   true,
			"reason":    "existing_completed_job",
			"recording": currentSummary,
			"job":       serializeAICommentaryJob(completedJob),
			"settings":  settings.asMap(),
		}, 200, nil
	}

	now := time.Now().UTC()
	job := bson.M{
		"recording":         recording.ID,
		"match":             recording.Match,
		"triggerMode":       "manual",
		"status":            "queued",
		"language":          settings.DefaultLanguage,
		"voicePreset":       settings.DefaultVoicePreset,
		"tonePreset":        settings.DefaultTonePreset,
		"mixMode":           settings.mixMode(),
		"sourceFingerprint": sourceFingerprint,
		"settingsHash":      settingsHash,
		"progressPercent":   0,
		"currentStepKey":    commentaryStepDefinitions[0]["key"],
		"currentStepLabel":  commentaryStepDefinitions[0]["label"],
		"lastError":         "",
		"requestedBy":       normalizeRequestedBy(requestedBy),
		"summary":           bson.M{},
		"analysisPreview":   bson.M{"sceneWindows": bson.A{}, "transcriptSnippets": bson.A{}},
		"artifacts":         bson.M{"outputSizeBytes": 0},
		"worker":            bson.M{"hostname": nil, "pid": nil, "startedAt": nil, "lastHeartbeatAt": nil},
		"steps":             buildAICommentaryJobSteps(),
		"startedAt":         nil,
		"finishedAt":        nil,
		"createdAt":         now,
		"updatedAt":         now,
	}
	jobID, err := s.repository.InsertAICommentaryJob(ctx, job)
	if err != nil {
		return nil, 0, err
	}

	recording.AICommentary = buildQueuedAICommentaryState(recording, jobID, settings, sourceFingerprint)
	if err := s.repository.SaveRecording(ctx, recording); err != nil {
		return nil, 0, err
	}

	return map[string]any{
		"queued":    true,
		"skipped":   false,
		"reason":    "",
		"recording": buildAICommentarySummary(recording),
		"job":       serializeAICommentaryJob(job),
		"settings":  settings.asMap(),
	}, 200, nil
}

func loadAICommentarySettings(systemSettings bson.M) aiCommentarySettings {
	liveRecording := mapFromValue(systemSettings["liveRecording"])
	ai := mapFromValue(liveRecording["aiCommentary"])
	settings := aiCommentarySettings{
		Enabled:                ai["enabled"] == true,
		AutoGenerateAfterDrive: ai["autoGenerateAfterDriveUpload"] != false,
		DefaultLanguage:        firstNonEmptyString(strings.ToLower(strings.TrimSpace(stringFromValue(ai["defaultLanguage"]))), "vi"),
		DefaultVoicePreset:     firstNonEmptyString(strings.TrimSpace(stringFromValue(ai["defaultVoicePreset"])), "vi_male_pro"),
		DefaultTonePreset:      firstNonEmptyString(strings.TrimSpace(stringFromValue(ai["defaultTonePreset"])), "professional"),
		KeepOriginalAudioBed:   ai["keepOriginalAudioBed"] != false,
		AudioBedLevelDB:        clampInt(int(numberFromValue(ai["audioBedLevelDb"])), -40, 0, -18),
		DuckAmountDB:           clampInt(int(numberFromValue(ai["duckAmountDb"])), -30, 0, -12),
	}
	if settings.DefaultLanguage != "vi" && settings.DefaultLanguage != "en" {
		settings.DefaultLanguage = "vi"
	}
	return settings
}

func (s aiCommentarySettings) asMap() map[string]any {
	return map[string]any{
		"enabled":                      s.Enabled,
		"autoGenerateAfterDriveUpload": s.AutoGenerateAfterDrive,
		"defaultLanguage":              s.DefaultLanguage,
		"defaultVoicePreset":           s.DefaultVoicePreset,
		"defaultTonePreset":            s.DefaultTonePreset,
		"keepOriginalAudioBed":         s.KeepOriginalAudioBed,
		"audioBedLevelDb":              s.AudioBedLevelDB,
		"duckAmountDb":                 s.DuckAmountDB,
	}
}

func (s aiCommentarySettings) mixMode() string {
	if s.KeepOriginalAudioBed {
		return "bed_duck"
	}
	return "narration_only"
}

func buildAICommentaryFingerprint(recording *RecordingDocument, settings aiCommentarySettings) (string, string) {
	sourceKey := firstNonEmptyString(strings.TrimSpace(recording.DriveFileID), strings.TrimSpace(recording.DriveRawURL), recording.ID.Hex())
	hash := sha1.Sum([]byte(strings.Join([]string{
		settings.DefaultLanguage,
		settings.DefaultVoicePreset,
		settings.DefaultTonePreset,
		stringFromValue(settings.KeepOriginalAudioBed),
		stringFromValue(settings.AudioBedLevelDB),
		stringFromValue(settings.DuckAmountDB),
	}, "|")))
	settingsHash := hex.EncodeToString(hash[:])[:16]
	return sourceKey + ":" + settingsHash, settingsHash
}
