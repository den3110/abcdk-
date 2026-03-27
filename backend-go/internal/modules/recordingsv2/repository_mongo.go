package recordingsv2

import (
	"context"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	liveMultiSourceAppSettingKey     = "liveMultiSourcePlayback"
	recordingStorageTargetsConfigKey = "liveRecordingStorageTargets"
)

type MongoRepository struct {
	recordings       *mongo.Collection
	matches          *mongo.Collection
	systemSettings   *mongo.Collection
	configs          *mongo.Collection
	aiCommentaryJobs *mongo.Collection
	appSettings      *mongo.Collection
}

type appSettingDocument struct {
	Key   string `bson:"key"`
	Value bson.M `bson:"value"`
}

func NewMongoRepository(database *mongo.Database) *MongoRepository {
	return &MongoRepository{
		recordings:       database.Collection("liverecordingv2"),
		matches:          database.Collection("matches"),
		systemSettings:   database.Collection("systemsettings"),
		configs:          database.Collection("configs"),
		aiCommentaryJobs: database.Collection("liverecordingaicommentaryjobs"),
		appSettings:      database.Collection("appsettings"),
	}
}

func (r *MongoRepository) FindByMatch(ctx context.Context, matchID primitive.ObjectID) (*RecordingDocument, error) {
	findOptions := options.FindOne().SetSort(bson.D{{Key: "createdAt", Value: -1}})

	var recording RecordingDocument
	err := r.recordings.FindOne(ctx, bson.M{"match": matchID}, findOptions).Decode(&recording)
	if err == mongo.ErrNoDocuments {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &recording, nil
}

func (r *MongoRepository) FindByID(ctx context.Context, recordingID primitive.ObjectID) (*RecordingDocument, error) {
	var recording RecordingDocument
	err := r.recordings.FindOne(ctx, bson.M{"_id": recordingID}).Decode(&recording)
	if err == mongo.ErrNoDocuments {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &recording, nil
}

func (r *MongoRepository) FindNextExportCandidate(ctx context.Context) (*RecordingDocument, error) {
	var recording RecordingDocument
	err := r.recordings.FindOne(ctx, bson.M{
		"status": "exporting",
	}, options.FindOne().SetSort(bson.D{
		{Key: "finalizedAt", Value: 1},
		{Key: "createdAt", Value: 1},
		{Key: "_id", Value: 1},
	})).Decode(&recording)
	if err == mongo.ErrNoDocuments {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &recording, nil
}

func (r *MongoRepository) ListAutoExportCandidates(ctx context.Context) ([]*RecordingDocument, error) {
	cursor, err := r.recordings.Find(ctx, bson.M{
		"status": bson.M{
			"$in": bson.A{"recording", "uploading"},
		},
	}, options.Find().SetSort(bson.D{
		{Key: "updatedAt", Value: 1},
		{Key: "createdAt", Value: 1},
		{Key: "_id", Value: 1},
	}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var docs []RecordingDocument
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}

	result := make([]*RecordingDocument, 0, len(docs))
	for index := range docs {
		recording := docs[index]
		result = append(result, &recording)
	}
	return result, nil
}

func (r *MongoRepository) FindByRecordingSessionID(ctx context.Context, recordingSessionID string) (*RecordingDocument, error) {
	var recording RecordingDocument
	err := r.recordings.FindOne(ctx, bson.M{"recordingSessionId": strings.TrimSpace(recordingSessionID)}).Decode(&recording)
	if err == mongo.ErrNoDocuments {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &recording, nil
}

func (r *MongoRepository) FindMatchByID(ctx context.Context, matchID primitive.ObjectID) (*MatchDocument, error) {
	var match MatchDocument
	err := r.matches.FindOne(ctx, bson.M{"_id": matchID}, options.FindOne().SetProjection(bson.M{
		"_id":        1,
		"court":      1,
		"courtLabel": 1,
		"code":       1,
		"status":     1,
	})).Decode(&match)
	if err == mongo.ErrNoDocuments {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &match, nil
}

func (r *MongoRepository) InsertRecording(ctx context.Context, recording *RecordingDocument) error {
	if recording == nil {
		return mongo.ErrNilDocument
	}
	now := time.Now().UTC()
	if recording.ID == primitive.NilObjectID {
		recording.ID = primitive.NewObjectID()
	}
	if recording.CreatedAt == nil {
		recording.CreatedAt = &now
	}
	recording.UpdatedAt = &now
	_, err := r.recordings.InsertOne(ctx, recording)
	return err
}

func (r *MongoRepository) SaveRecording(ctx context.Context, recording *RecordingDocument) error {
	if recording == nil {
		return mongo.ErrNilDocument
	}
	now := time.Now().UTC()
	recording.UpdatedAt = &now
	_, err := r.recordings.ReplaceOne(ctx, bson.M{"_id": recording.ID}, recording)
	return err
}

func (r *MongoRepository) UpdateMatchVideo(ctx context.Context, matchID primitive.ObjectID, videoURL string) error {
	_, err := r.matches.UpdateOne(ctx, bson.M{"_id": matchID}, bson.M{
		"$set": bson.M{
			"video": strings.TrimSpace(videoURL),
		},
	})
	return err
}

func (r *MongoRepository) LoadLivePlaybackConfig(ctx context.Context) (LivePlaybackConfig, error) {
	cfg := defaultLivePlaybackConfigFromEnv()

	storageTargets, err := r.findAppSetting(ctx, recordingStorageTargetsConfigKey)
	if err == nil {
		applyStorageTargetsConfig(&cfg, storageTargets)
	}

	liveMultiSource, err := r.findAppSetting(ctx, liveMultiSourceAppSettingKey)
	if err == nil {
		applyLiveMultiSourceConfig(&cfg, liveMultiSource)
	}

	return normalizeLivePlaybackConfig(cfg), nil
}

func (r *MongoRepository) LoadStorageTargets(ctx context.Context) ([]StorageTarget, error) {
	defaults := storageTargetsFromEnv()
	stored, err := r.findAppSetting(ctx, recordingStorageTargetsConfigKey)
	if err != nil {
		return defaults, err
	}
	normalizedStored := normalizeStorageTargets(arrayFromValue(stored["targets"]))
	if len(normalizedStored) > 0 {
		return normalizedStored, nil
	}
	return defaults, nil
}

func (r *MongoRepository) LoadSystemSettings(ctx context.Context) (bson.M, error) {
	var doc bson.M
	err := r.systemSettings.FindOne(ctx, bson.M{"_id": "system"}).Decode(&doc)
	if err == mongo.ErrNoDocuments {
		return bson.M{}, nil
	}
	if err != nil {
		return nil, err
	}
	return doc, nil
}

func (r *MongoRepository) LoadConfigValues(ctx context.Context, keys ...string) (map[string]string, error) {
	normalizedKeys := make([]string, 0, len(keys))
	seen := map[string]struct{}{}
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		normalizedKeys = append(normalizedKeys, key)
	}
	if len(normalizedKeys) == 0 {
		return map[string]string{}, nil
	}

	cursor, err := r.configs.Find(ctx, bson.M{
		"key": bson.M{"$in": normalizedKeys},
	}, options.Find().SetProjection(bson.M{
		"key":      1,
		"value":    1,
		"isSecret": 1,
	}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var docs []struct {
		Key      string `bson:"key"`
		Value    string `bson:"value"`
		IsSecret bool   `bson:"isSecret"`
	}
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}

	values := make(map[string]string, len(normalizedKeys))
	for _, doc := range docs {
		values[doc.Key] = strings.TrimSpace(doc.Value)
	}
	return values, nil
}

func (r *MongoRepository) ListMonitorRecordings(ctx context.Context) ([]bson.M, error) {
	cursor, err := r.recordings.Aggregate(ctx, buildMonitorRecordingsPipeline())
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var docs []bson.M
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}
	return docs, nil
}

func (r *MongoRepository) FindActiveAICommentaryJob(ctx context.Context) (bson.M, error) {
	docs, err := r.aggregateAICommentaryJobs(ctx, bson.M{
		"status": bson.M{"$in": bson.A{"queued", "running"}},
	}, bson.D{{Key: "createdAt", Value: 1}}, 1)
	if err != nil {
		return nil, err
	}
	if len(docs) == 0 {
		return nil, nil
	}
	return docs[0], nil
}

func (r *MongoRepository) ListRecentAICommentaryJobs(ctx context.Context, limit int64) ([]bson.M, error) {
	return r.aggregateAICommentaryJobs(ctx, bson.M{}, bson.D{{Key: "createdAt", Value: -1}}, limit)
}

func (r *MongoRepository) CountAICommentaryJobsByStatus(ctx context.Context, status string) (int64, error) {
	return r.aiCommentaryJobs.CountDocuments(ctx, bson.M{
		"status": strings.TrimSpace(status),
	})
}

func (r *MongoRepository) FindActiveAICommentaryJobByRecording(ctx context.Context, recordingID primitive.ObjectID) (bson.M, error) {
	var doc bson.M
	err := r.aiCommentaryJobs.FindOne(ctx, bson.M{
		"recording": recordingID,
		"status": bson.M{
			"$in": bson.A{"queued", "running"},
		},
	}, options.FindOne().SetSort(bson.D{{Key: "createdAt", Value: 1}})).Decode(&doc)
	if err == mongo.ErrNoDocuments {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return doc, nil
}

func (r *MongoRepository) FindCompletedAICommentaryJobByFingerprint(ctx context.Context, recordingID primitive.ObjectID, sourceFingerprint string) (bson.M, error) {
	var doc bson.M
	err := r.aiCommentaryJobs.FindOne(ctx, bson.M{
		"recording":         recordingID,
		"sourceFingerprint": strings.TrimSpace(sourceFingerprint),
		"status":            "completed",
	}, options.FindOne().SetSort(bson.D{{Key: "createdAt", Value: -1}})).Decode(&doc)
	if err == mongo.ErrNoDocuments {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return doc, nil
}

func (r *MongoRepository) InsertAICommentaryJob(ctx context.Context, job bson.M) (primitive.ObjectID, error) {
	if job == nil {
		return primitive.NilObjectID, mongo.ErrNilDocument
	}
	if _, ok := job["_id"]; !ok {
		job["_id"] = primitive.NewObjectID()
	}
	_, err := r.aiCommentaryJobs.InsertOne(ctx, job)
	if err != nil {
		return primitive.NilObjectID, err
	}
	return job["_id"].(primitive.ObjectID), nil
}

func (r *MongoRepository) PromoteScheduledExports(ctx context.Context, before time.Time) (int64, error) {
	now := before.UTC()
	result, err := r.recordings.UpdateMany(ctx, bson.M{
		"status":            "pending_export_window",
		"scheduledExportAt": bson.M{"$lte": now},
	}, bson.M{
		"$set": bson.M{
			"status":                            "exporting",
			"scheduledExportAt":                 nil,
			"readyAt":                           nil,
			"error":                             "",
			"meta.exportPipeline.stage":         "queued",
			"meta.exportPipeline.label":         "Dang cho worker",
			"meta.exportPipeline.updatedAt":     now,
			"meta.exportPipeline.error":         nil,
			"meta.exportPipeline.staleReason":   nil,
			"meta.exportPipeline.publishReason": "scheduled_export_window_released",
		},
		"$unset": bson.M{
			"meta.exportPipeline.scheduledExportAt": "",
		},
	})
	if err != nil {
		return 0, err
	}
	return result.ModifiedCount, nil
}

func (r *MongoRepository) CountRecordingsByStatus(ctx context.Context, status string) (int64, error) {
	return r.recordings.CountDocuments(ctx, bson.M{
		"status": strings.TrimSpace(status),
	})
}

func (r *MongoRepository) findAppSetting(ctx context.Context, key string) (bson.M, error) {
	var doc appSettingDocument
	err := r.appSettings.FindOne(ctx, bson.M{"key": key}).Decode(&doc)
	if err == mongo.ErrNoDocuments {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return doc.Value, nil
}

func (r *MongoRepository) aggregateAICommentaryJobs(ctx context.Context, filter bson.M, sortBy bson.D, limit int64) ([]bson.M, error) {
	pipeline := mongo.Pipeline{}
	if len(filter) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: filter}})
	}
	pipeline = append(pipeline, bson.D{{Key: "$sort", Value: sortBy}})
	if limit > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$limit", Value: limit}})
	}
	pipeline = append(pipeline,
		lookupStage("liverecordingv2", "recording", "_id", "recordingDoc"),
		unwindStage("$recordingDoc"),
		lookupStage("matches", "match", "_id", "matchDoc"),
		unwindStage("$matchDoc"),
		lookupStage("registrations", "matchDoc.pairA", "_id", "pairA"),
		unwindStage("$pairA"),
		lookupStage("registrations", "matchDoc.pairB", "_id", "pairB"),
		unwindStage("$pairB"),
		lookupStage("users", "pairA.player1.user", "_id", "pairAPlayer1User"),
		unwindStage("$pairAPlayer1User"),
		lookupStage("users", "pairA.player2.user", "_id", "pairAPlayer2User"),
		unwindStage("$pairAPlayer2User"),
		lookupStage("users", "pairB.player1.user", "_id", "pairBPlayer1User"),
		unwindStage("$pairBPlayer1User"),
		lookupStage("users", "pairB.player2.user", "_id", "pairBPlayer2User"),
		unwindStage("$pairBPlayer2User"),
		lookupStage("tournaments", "matchDoc.tournament", "_id", "tournamentDoc"),
		unwindStage("$tournamentDoc"),
	)

	cursor, err := r.aiCommentaryJobs.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var docs []bson.M
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}
	return docs, nil
}

func buildMonitorRecordingsPipeline() mongo.Pipeline {
	return mongo.Pipeline{
		bson.D{{Key: "$sort", Value: bson.D{{Key: "updatedAt", Value: -1}, {Key: "createdAt", Value: -1}}}},
		lookupStage("matches", "match", "_id", "matchDoc"),
		unwindStage("$matchDoc"),
		lookupStage("registrations", "matchDoc.pairA", "_id", "pairA"),
		unwindStage("$pairA"),
		lookupStage("registrations", "matchDoc.pairB", "_id", "pairB"),
		unwindStage("$pairB"),
		lookupStage("users", "pairA.player1.user", "_id", "pairAPlayer1User"),
		unwindStage("$pairAPlayer1User"),
		lookupStage("users", "pairA.player2.user", "_id", "pairAPlayer2User"),
		unwindStage("$pairAPlayer2User"),
		lookupStage("users", "pairB.player1.user", "_id", "pairBPlayer1User"),
		unwindStage("$pairBPlayer1User"),
		lookupStage("users", "pairB.player2.user", "_id", "pairBPlayer2User"),
		unwindStage("$pairBPlayer2User"),
		lookupStage("courts", "matchDoc.court", "_id", "courtDoc"),
		unwindStage("$courtDoc"),
		lookupStage("courts", "courtId", "_id", "recordingCourtDoc"),
		unwindStage("$recordingCourtDoc"),
		lookupStage("brackets", "matchDoc.bracket", "_id", "bracketDoc"),
		unwindStage("$bracketDoc"),
		lookupStage("tournaments", "matchDoc.tournament", "_id", "tournamentDoc"),
		unwindStage("$tournamentDoc"),
	}
}

func lookupStage(from, localField, foreignField, as string) bson.D {
	return bson.D{{Key: "$lookup", Value: bson.D{
		{Key: "from", Value: from},
		{Key: "localField", Value: localField},
		{Key: "foreignField", Value: foreignField},
		{Key: "as", Value: as},
	}}}
}

func unwindStage(path string) bson.D {
	return bson.D{{Key: "$unwind", Value: bson.D{
		{Key: "path", Value: path},
		{Key: "preserveNullAndEmptyArrays", Value: true},
	}}}
}

func storageTargetsFromEnv() []StorageTarget {
	explicit := parseExplicitStorageTargetsFromEnv()
	if len(explicit) > 0 {
		return explicit
	}
	fallback := buildFallbackStorageTargetFromEnv()
	if fallback == nil {
		return nil
	}
	return []StorageTarget{*fallback}
}

func parseExplicitStorageTargetsFromEnv() []StorageTarget {
	raw := strings.TrimSpace(os.Getenv("R2_RECORDINGS_TARGETS_JSON"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("R2_RECORDINGS_TARGETS"))
	}
	if raw == "" {
		return nil
	}

	var parsed []map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil
	}
	values := make([]any, 0, len(parsed))
	for _, item := range parsed {
		values = append(values, item)
	}
	return normalizeStorageTargets(values)
}

func buildFallbackStorageTargetFromEnv() *StorageTarget {
	endpoint := firstNonEmptyString(strings.TrimSpace(os.Getenv("R2_RECORDINGS_ENDPOINT")), strings.TrimSpace(os.Getenv("R2_ENDPOINT")))
	accessKeyID := firstNonEmptyString(strings.TrimSpace(os.Getenv("R2_RECORDINGS_ACCESS_KEY_ID")), strings.TrimSpace(os.Getenv("R2_ACCESS_KEY_ID")))
	secretAccessKey := firstNonEmptyString(strings.TrimSpace(os.Getenv("R2_RECORDINGS_SECRET_ACCESS_KEY")), strings.TrimSpace(os.Getenv("R2_SECRET_ACCESS_KEY")))
	bucketName := firstNonEmptyString(strings.TrimSpace(os.Getenv("R2_RECORDINGS_BUCKET_NAME")), strings.TrimSpace(os.Getenv("R2_BUCKET_NAME")))
	if endpoint == "" || accessKeyID == "" || secretAccessKey == "" || bucketName == "" {
		return nil
	}

	targets := normalizeStorageTargets([]any{map[string]any{
		"id":              firstNonEmptyString(strings.TrimSpace(os.Getenv("R2_RECORDINGS_TARGET_LABEL")), "default"),
		"label":           firstNonEmptyString(strings.TrimSpace(os.Getenv("R2_RECORDINGS_TARGET_LABEL")), "default"),
		"endpoint":        endpoint,
		"accessKeyId":     accessKeyID,
		"secretAccessKey": secretAccessKey,
		"bucketName":      bucketName,
		"publicBaseUrl":   strings.TrimSpace(os.Getenv("LIVE_RECORDING_PUBLIC_CDN_BASE_URL")),
		"capacityBytes": firstNonEmptyString(
			strings.TrimSpace(os.Getenv("R2_RECORDINGS_STORAGE_TOTAL_BYTES")),
			strings.TrimSpace(os.Getenv("R2_STORAGE_TOTAL_BYTES")),
		),
		"enabled": true,
	}})
	if len(targets) == 0 {
		return nil
	}
	return &targets[0]
}

func normalizeStorageTargets(items []any) []StorageTarget {
	result := make([]StorageTarget, 0, len(items))
	seen := map[string]struct{}{}
	for index, item := range items {
		target := normalizeStorageTarget(mapFromValue(item), index)
		if target.ID == "" {
			continue
		}
		if _, exists := seen[target.ID]; exists {
			continue
		}
		seen[target.ID] = struct{}{}
		result = append(result, target)
	}
	return result
}

func normalizeStorageTarget(raw bson.M, index int) StorageTarget {
	id := firstNonEmptyString(strings.TrimSpace(stringFromValue(raw["id"])), "default_"+strconv.Itoa(index+1))
	return StorageTarget{
		ID:              id,
		Label:           firstNonEmptyString(strings.TrimSpace(stringFromValue(raw["label"])), id),
		Endpoint:        strings.TrimSpace(stringFromValue(raw["endpoint"])),
		AccessKeyID:     strings.TrimSpace(stringFromValue(raw["accessKeyId"])),
		SecretAccessKey: strings.TrimSpace(stringFromValue(raw["secretAccessKey"])),
		BucketName:      firstNonEmptyString(strings.TrimSpace(stringFromValue(raw["bucketName"])), strings.TrimSpace(stringFromValue(raw["bucket"]))),
		PublicBaseURL:   normalizePublicBaseURL(firstNonEmptyString(strings.TrimSpace(stringFromValue(raw["publicBaseUrl"])), strings.TrimSpace(stringFromValue(raw["cdnBaseUrl"])))),
		CapacityBytes:   int64(numberFromValue(firstNonEmptyString(strings.TrimSpace(stringFromValue(raw["capacityBytes"])), strings.TrimSpace(stringFromValue(raw["capacity"])), strings.TrimSpace(stringFromValue(raw["maxBytes"]))))),
		Enabled:         parseBool(strings.TrimSpace(stringFromValue(raw["enabled"])), true),
	}
}

func defaultLivePlaybackConfigFromEnv() LivePlaybackConfig {
	return normalizeLivePlaybackConfig(LivePlaybackConfig{
		Enabled:             parseBoolEnv("LIVE_MULTI_SOURCE_ENABLED", false),
		DelaySeconds:        normalizeDelaySeconds(strings.TrimSpace(os.Getenv("LIVE_SERVER2_DELAY_SECONDS")), 60),
		ManifestName:        normalizeManifestName(strings.TrimSpace(os.Getenv("LIVE_SERVER2_MANIFEST_NAME")), "live-manifest.json"),
		GlobalPublicBaseURL: normalizePublicBaseURL(strings.TrimSpace(os.Getenv("LIVE_RECORDING_PUBLIC_CDN_BASE_URL"))),
		TargetPublicBaseURL: parseEnvTargetPublicBaseURLs(),
	})
}

func normalizeLivePlaybackConfig(cfg LivePlaybackConfig) LivePlaybackConfig {
	if cfg.TargetPublicBaseURL == nil {
		cfg.TargetPublicBaseURL = map[string]string{}
	}
	cfg.DelaySeconds = normalizeDelaySeconds(cfg.DelaySeconds, 60)
	cfg.ManifestName = normalizeManifestName(cfg.ManifestName, "live-manifest.json")
	cfg.GlobalPublicBaseURL = normalizePublicBaseURL(cfg.GlobalPublicBaseURL)

	normalizedTargets := make(map[string]string, len(cfg.TargetPublicBaseURL))
	for key, value := range cfg.TargetPublicBaseURL {
		normalizedKey := strings.TrimSpace(key)
		normalizedValue := normalizePublicBaseURL(value)
		if normalizedKey == "" || normalizedValue == "" {
			continue
		}
		normalizedTargets[normalizedKey] = normalizedValue
	}
	cfg.TargetPublicBaseURL = normalizedTargets
	return cfg
}

func applyStorageTargetsConfig(cfg *LivePlaybackConfig, raw bson.M) {
	if cfg == nil {
		return
	}
	for targetID, publicBaseURL := range collectTargetPublicBaseURLs(raw) {
		cfg.TargetPublicBaseURL[targetID] = publicBaseURL
	}
}

func applyLiveMultiSourceConfig(cfg *LivePlaybackConfig, raw bson.M) {
	if cfg == nil || raw == nil {
		return
	}

	if enabled, ok := raw["enabled"].(bool); ok {
		cfg.Enabled = enabled
	}
	if delaySeconds := numberFromValue(raw["delaySeconds"]); delaySeconds > 0 {
		cfg.DelaySeconds = normalizeDelaySeconds(delaySeconds, 60)
	}
	if manifestName := normalizeManifestName(stringFromValue(raw["manifestName"]), ""); manifestName != "" {
		cfg.ManifestName = manifestName
	}
	if globalPublicBaseURL := normalizePublicBaseURL(stringFromValue(raw["globalPublicBaseUrl"])); globalPublicBaseURL != "" {
		cfg.GlobalPublicBaseURL = globalPublicBaseURL
	}
	for targetID, publicBaseURL := range collectTargetPublicBaseURLs(raw) {
		cfg.TargetPublicBaseURL[targetID] = publicBaseURL
	}
}

func collectTargetPublicBaseURLs(raw bson.M) map[string]string {
	result := map[string]string{}
	if raw == nil {
		return result
	}

	for _, item := range arrayFromValue(raw["targets"]) {
		target := mapFromValue(item)
		targetID := strings.TrimSpace(stringFromValue(target["id"]))
		publicBaseURL := normalizePublicBaseURL(firstNonEmptyString(
			stringFromValue(target["publicBaseUrl"]),
			stringFromValue(target["cdnBaseUrl"]),
		))
		if targetID == "" || publicBaseURL == "" {
			continue
		}
		result[targetID] = publicBaseURL
	}

	return result
}

func parseEnvTargetPublicBaseURLs() map[string]string {
	result := map[string]string{}
	raw := strings.TrimSpace(os.Getenv("R2_RECORDINGS_TARGETS_JSON"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("R2_RECORDINGS_TARGETS"))
	}
	if raw == "" {
		return result
	}

	var targets []map[string]any
	if err := json.Unmarshal([]byte(raw), &targets); err != nil {
		return result
	}

	for _, target := range targets {
		targetID := strings.TrimSpace(stringFromValue(target["id"]))
		publicBaseURL := normalizePublicBaseURL(firstNonEmptyString(
			stringFromValue(target["publicBaseUrl"]),
			stringFromValue(target["cdnBaseUrl"]),
		))
		if targetID == "" || publicBaseURL == "" {
			continue
		}
		result[targetID] = publicBaseURL
	}

	return result
}
