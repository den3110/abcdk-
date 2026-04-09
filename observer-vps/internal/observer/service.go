package observer

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	mongox "observer-vps/internal/infra/mongo"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

//go:embed dashboard/index.html
var dashboardFS embed.FS

const (
	eventsCollection      = "observer_events"
	runtimeCollection     = "observer_runtime_snapshots"
	backupCollection      = "observer_backup_snapshots"
	liveDevicesCollection = "observer_live_devices"
)

type service struct {
	cfg         Config
	client      *mongo.Client
	db          *mongo.Database
	events      *mongo.Collection
	runtime     *mongo.Collection
	backups     *mongo.Collection
	liveDevices *mongo.Collection
	startedAt   time.Time
	dashboard   []byte
}

func Run(ctx context.Context) error {
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}

	connectCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	client, db, err := mongox.Connect(connectCtx, cfg.MongoURI, cfg.MongoDatabase)
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, closeCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer closeCancel()
		_ = client.Disconnect(closeCtx)
	}()

	html, err := dashboardFS.ReadFile("dashboard/index.html")
	if err != nil {
		return fmt.Errorf("read embedded dashboard: %w", err)
	}

	svc := &service{
		cfg:         cfg,
		client:      client,
		db:          db,
		events:      db.Collection(eventsCollection),
		runtime:     db.Collection(runtimeCollection),
		backups:     db.Collection(backupCollection),
		liveDevices: db.Collection(liveDevicesCollection),
		startedAt:   time.Now().UTC(),
		dashboard:   html,
	}

	indexCtx, indexCancel := context.WithTimeout(ctx, 20*time.Second)
	defer indexCancel()
	if err := svc.ensureIndexes(indexCtx); err != nil {
		return err
	}

	return svc.serve(ctx)
}

func (s *service) serve(ctx context.Context) error {
	engine := gin.New()
	engine.Use(gin.Logger(), gin.Recovery())

	engine.GET("/", func(c *gin.Context) {
		c.Redirect(http.StatusTemporaryRedirect, "/dashboard")
	})
	engine.GET("/dashboard", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", s.dashboard)
	})
	engine.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"ok":        true,
			"service":   "pickletour-observer-go",
			"host":      s.cfg.BindHost,
			"port":      s.cfg.Port,
			"mongoDb":   s.cfg.MongoDatabase,
			"startedAt": s.startedAt,
			"now":       time.Now().UTC(),
		})
	})

	api := engine.Group("/api/observer")
	{
		api.POST("/ingest/events", s.requireIngestKey(), s.ingestEvents)
		api.POST("/ingest/runtime", s.requireIngestKey(), s.ingestRuntime)
		api.POST("/ingest/backups", s.requireIngestKey(), s.ingestBackups)
		api.POST("/ingest/live-devices/heartbeat", s.requireDeviceIngestAuth(), s.ingestLiveDeviceHeartbeat)
		api.POST("/ingest/live-devices/event", s.requireDeviceIngestAuth(), s.ingestLiveDeviceEvent)
		api.GET("/read/summary", s.requireReadKey(), s.getSummary)
		api.GET("/read/events", s.requireReadKey(), s.listEvents)
		api.GET("/read/runtime", s.requireReadKey(), s.listRuntime)
		api.GET("/read/backups", s.requireReadKey(), s.listBackups)
		api.GET("/read/live-devices", s.requireReadKey(), s.listLiveDevices)
	}

	server := &http.Server{
		Addr:              joinAddr(s.cfg.BindHost, s.cfg.Port),
		Handler:           engine,
		ReadHeaderTimeout: 10 * time.Second,
	}

	stopCtx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-stopCtx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("observer shutdown error: %v", err)
		}
	}()

	log.Printf("pickletour-observer-go listening on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func (s *service) ensureIndexes(ctx context.Context) error {
	groups := []struct {
		col    *mongo.Collection
		models []mongo.IndexModel
	}{
		{
			col: s.events,
			models: []mongo.IndexModel{
				{Keys: bson.D{{Key: "expireAt", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0)},
				{Keys: bson.D{{Key: "source", Value: 1}, {Key: "type", Value: 1}, {Key: "occurredAt", Value: -1}}},
				{Keys: bson.D{{Key: "category", Value: 1}, {Key: "level", Value: 1}, {Key: "occurredAt", Value: -1}}},
			},
		},
		{
			col: s.runtime,
			models: []mongo.IndexModel{
				{Keys: bson.D{{Key: "expireAt", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0)},
				{Keys: bson.D{{Key: "source", Value: 1}, {Key: "capturedAt", Value: -1}}},
			},
		},
		{
			col: s.backups,
			models: []mongo.IndexModel{
				{Keys: bson.D{{Key: "expireAt", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0)},
				{Keys: bson.D{{Key: "source", Value: 1}, {Key: "scope", Value: 1}, {Key: "capturedAt", Value: -1}}},
			},
		},
		{
			col: s.liveDevices,
			models: []mongo.IndexModel{
				{Keys: bson.D{{Key: "expireAt", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0)},
				{Keys: bson.D{{Key: "source", Value: 1}, {Key: "deviceId", Value: 1}}, Options: options.Index().SetUnique(true)},
				{Keys: bson.D{{Key: "source", Value: 1}, {Key: "lastSeenAt", Value: -1}}},
				{Keys: bson.D{{Key: "matchId", Value: 1}, {Key: "lastSeenAt", Value: -1}}},
			},
		},
	}
	for _, group := range groups {
		if _, err := group.col.Indexes().CreateMany(ctx, group.models); err != nil {
			return fmt.Errorf("ensure indexes for %s: %w", group.col.Name(), err)
		}
	}
	return nil
}

func (s *service) ingestEvents(c *gin.Context) {
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	source := s.extractSource(c, asString(body["source"]))
	incoming := toSlice(body["events"])
	if len(incoming) == 0 {
		if single := toMap(body["event"]); len(single) > 0 {
			incoming = []any{single}
		}
	}
	now := time.Now().UTC()
	docs := make([]any, 0, minInt(len(incoming), 500))
	for _, item := range incoming[:minInt(len(incoming), 500)] {
		event := toMap(item)
		if len(event) == 0 {
			continue
		}
		occurredAt := parseTime(firstNonNil(event["occurredAt"], event["ts"]))
		docs = append(docs, bson.M{
			"source":     source,
			"category":   defaultString(asString(event["category"]), "generic"),
			"type":       defaultString(asString(event["type"]), "event"),
			"level":      normalizeLevel(asString(event["level"]), "info"),
			"requestId":  asString(event["requestId"]),
			"method":     strings.ToUpper(asString(event["method"])),
			"path":       asString(event["path"]),
			"url":        asString(event["url"]),
			"statusCode": normalizeIntValue(event["statusCode"]),
			"durationMs": normalizeNumber(event["durationMs"]),
			"ip":         asString(event["ip"]),
			"tags":       normalizeTags(event["tags"]),
			"occurredAt": occurredAt,
			"receivedAt": now,
			"expireAt":   buildExpireAt(s.cfg.EventTTLDays, occurredAt),
			"payload":    toMap(event["payload"]),
			"createdAt":  now,
			"updatedAt":  now,
		})
	}
	if len(docs) > 0 {
		if _, err := s.events.InsertMany(c.Request.Context(), docs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": "Failed to save observer events", "error": err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "source": source, "accepted": len(docs)})
}

func (s *service) ingestRuntime(c *gin.Context) {
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	source := s.extractSource(c, asString(body["source"]))
	snapshot := toMap(body["snapshot"])
	if len(snapshot) == 0 {
		snapshot = body
	}
	runtimeObj := toMap(snapshot["runtime"])
	capturedAt := parseTime(firstNonNil(snapshot["capturedAt"], body["capturedAt"]))
	now := time.Now().UTC()
	result, err := s.runtime.InsertOne(c.Request.Context(), bson.M{
		"source":          source,
		"capturedAt":      capturedAt,
		"receivedAt":      now,
		"expireAt":        buildExpireAt(s.cfg.RuntimeTTLDays, capturedAt),
		"totals":          firstObject(runtimeObj["totals"], snapshot["totals"]),
		"hotPaths":        firstObject(runtimeObj["hotPaths"], snapshot["hotPaths"]),
		"process":         firstObject(runtimeObj["process"], snapshot["process"]),
		"endpoints":       firstSlice(runtimeObj["endpoints"], snapshot["endpoints"]),
		"recordingExport": toMap(snapshot["recordingExport"]),
		"payload":         snapshot,
		"createdAt":       now,
		"updatedAt":       now,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": "Failed to save runtime snapshot", "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "source": source, "id": formatID(result.InsertedID)})
}

func (s *service) ingestBackups(c *gin.Context) {
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	source := s.extractSource(c, asString(body["source"]))
	snapshot := toMap(body["snapshot"])
	if len(snapshot) == 0 {
		snapshot = body
	}
	capturedAt := parseTime(firstNonNil(snapshot["capturedAt"], snapshot["finishedAt"]))
	now := time.Now().UTC()
	result, err := s.backups.InsertOne(c.Request.Context(), bson.M{
		"source":      source,
		"scope":       defaultString(asString(snapshot["scope"]), "generic"),
		"backupType":  firstString(snapshot["backupType"], snapshot["type"]),
		"status":      defaultString(strings.ToLower(asString(snapshot["status"])), "unknown"),
		"capturedAt":  capturedAt,
		"receivedAt":  now,
		"expireAt":    buildExpireAt(s.cfg.BackupTTLDays, capturedAt),
		"sizeBytes":   normalizeNumber(snapshot["sizeBytes"]),
		"durationMs":  normalizeNumber(snapshot["durationMs"]),
		"manifestUrl": asString(snapshot["manifestUrl"]),
		"checksum":    asString(snapshot["checksum"]),
		"note":        asString(snapshot["note"]),
		"payload":     snapshot,
		"createdAt":   now,
		"updatedAt":   now,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": "Failed to save backup snapshot", "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "source": source, "id": formatID(result.InsertedID)})
}

func (s *service) getSummary(c *gin.Context) {
	source := strings.TrimSpace(c.Query("source"))
	minutes := clampInt(parseInt(c.DefaultQuery("minutes", "60"), 60), 5, 24*60)
	since := time.Now().UTC().Add(-time.Duration(minutes) * time.Minute)

	eventMatch := bson.M{"occurredAt": bson.M{"$gte": since}}
	if source != "" {
		eventMatch["source"] = source
	}
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: eventMatch}},
		{{Key: "$group", Value: bson.M{
			"_id":      bson.M{"category": "$category", "level": "$level", "type": "$type"},
			"count":    bson.M{"$sum": 1},
			"latestAt": bson.M{"$max": "$occurredAt"},
		}}},
		{{Key: "$sort", Value: bson.D{{Key: "count", Value: -1}, {Key: "latestAt", Value: -1}}}},
		{{Key: "$limit", Value: 25}},
	}
	cursor, err := s.events.Aggregate(c.Request.Context(), pipeline)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": "Failed to aggregate observer events", "error": err.Error()})
		return
	}
	defer cursor.Close(c.Request.Context())

	type bucket struct {
		ID struct {
			Category string `bson:"category"`
			Level    string `bson:"level"`
			Type     string `bson:"type"`
		} `bson:"_id"`
		Count    int64     `bson:"count"`
		LatestAt time.Time `bson:"latestAt"`
	}
	var bucketRows []bucket
	if err := cursor.All(c.Request.Context(), &bucketRows); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": "Failed to decode observer buckets", "error": err.Error()})
		return
	}

	totalRecentEvents, err := s.events.CountDocuments(c.Request.Context(), eventMatch)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": "Failed to count observer events", "error": err.Error()})
		return
	}
	errorMatch := bson.M{"occurredAt": bson.M{"$gte": since}, "level": "error"}
	if source != "" {
		errorMatch["source"] = source
	}
	errorRecentEvents, err := s.events.CountDocuments(c.Request.Context(), errorMatch)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": "Failed to count observer errors", "error": err.Error()})
		return
	}
	liveDeviceSummary := s.loadLiveDeviceSummary(c, source)

	runtimeFilter := bson.M{}
	backupFilter := bson.M{}
	if source != "" {
		runtimeFilter["source"] = source
		backupFilter["source"] = source
	}
	var latestRuntime bson.M
	_ = s.runtime.FindOne(c.Request.Context(), runtimeFilter, options.FindOne().SetSort(bson.D{{Key: "capturedAt", Value: -1}, {Key: "_id", Value: -1}})).Decode(&latestRuntime)

	backupCursor, err := s.backups.Find(c.Request.Context(), backupFilter, options.Find().SetSort(bson.D{{Key: "capturedAt", Value: -1}, {Key: "_id", Value: -1}}).SetLimit(10))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": "Failed to load backups", "error": err.Error()})
		return
	}
	defer backupCursor.Close(c.Request.Context())
	var latestBackups []bson.M
	if err := backupCursor.All(c.Request.Context(), &latestBackups); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": "Failed to decode backups", "error": err.Error()})
		return
	}

	buckets := make([]gin.H, 0, len(bucketRows))
	for _, row := range bucketRows {
		buckets = append(buckets, gin.H{
			"category": row.ID.Category,
			"level":    row.ID.Level,
			"type":     row.ID.Type,
			"count":    row.Count,
			"latestAt": row.LatestAt,
		})
	}
	backups := make([]gin.H, 0, len(latestBackups))
	for _, row := range latestBackups {
		backups = append(backups, gin.H{
			"id":          formatID(row["_id"]),
			"source":      asString(row["source"]),
			"scope":       asString(row["scope"]),
			"backupType":  asString(row["backupType"]),
			"status":      asString(row["status"]),
			"capturedAt":  row["capturedAt"],
			"sizeBytes":   normalizeNumber(row["sizeBytes"]),
			"manifestUrl": asString(row["manifestUrl"]),
			"note":        asString(row["note"]),
		})
	}

	var runtimeData any
	if len(latestRuntime) > 0 {
		runtimeData = gin.H{
			"id":              formatID(latestRuntime["_id"]),
			"source":          asString(latestRuntime["source"]),
			"capturedAt":      latestRuntime["capturedAt"],
			"totals":          firstObject(latestRuntime["totals"]),
			"process":         firstObject(latestRuntime["process"]),
			"hotPaths":        firstObject(latestRuntime["hotPaths"]),
			"endpoints":       firstSlice(latestRuntime["endpoints"]),
			"recordingExport": firstObject(latestRuntime["recordingExport"]),
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":            true,
		"source":        emptyStringToNil(source),
		"windowMinutes": minutes,
		"events": gin.H{
			"totalRecentEvents": totalRecentEvents,
			"errorRecentEvents": errorRecentEvents,
			"buckets":           buckets,
		},
		"runtime":   runtimeData,
		"backups":   backups,
		"liveDevices": liveDeviceSummary,
		"updatedAt": time.Now().UTC(),
	})
}

func (s *service) listEvents(c *gin.Context) {
	filter := bson.M{}
	if source := strings.TrimSpace(c.Query("source")); source != "" {
		filter["source"] = source
	}
	if category := strings.TrimSpace(c.Query("category")); category != "" {
		filter["category"] = category
	}
	if eventType := strings.TrimSpace(c.Query("type")); eventType != "" {
		filter["type"] = eventType
	}
	if level := normalizeLevel(c.Query("level"), ""); level != "" {
		filter["level"] = level
	}
	s.queryCollection(c, s.events, filter, clampInt(parseInt(c.DefaultQuery("limit", "100"), 100), 1, 500), func(row bson.M) gin.H {
		return gin.H{
			"id":         formatID(row["_id"]),
			"source":     asString(row["source"]),
			"category":   asString(row["category"]),
			"type":       asString(row["type"]),
			"level":      asString(row["level"]),
			"requestId":  asString(row["requestId"]),
			"method":     asString(row["method"]),
			"path":       asString(row["path"]),
			"url":        asString(row["url"]),
			"statusCode": normalizeIntValue(row["statusCode"]),
			"durationMs": normalizeNumber(row["durationMs"]),
			"ip":         asString(row["ip"]),
			"tags":       firstSlice(row["tags"]),
			"occurredAt": row["occurredAt"],
			"receivedAt": row["receivedAt"],
			"payload":    toMap(row["payload"]),
		}
	})
}

func (s *service) listRuntime(c *gin.Context) {
	filter := bson.M{}
	if source := strings.TrimSpace(c.Query("source")); source != "" {
		filter["source"] = source
	}
	s.queryCollection(c, s.runtime, filter, clampInt(parseInt(c.DefaultQuery("limit", "20"), 20), 1, 100), func(row bson.M) gin.H {
		return gin.H{
			"id":              formatID(row["_id"]),
			"source":          asString(row["source"]),
			"capturedAt":      row["capturedAt"],
			"receivedAt":      row["receivedAt"],
			"totals":          firstObject(row["totals"]),
			"hotPaths":        firstObject(row["hotPaths"]),
			"process":         firstObject(row["process"]),
			"endpoints":       firstSlice(row["endpoints"]),
			"recordingExport": firstObject(row["recordingExport"]),
		}
	})
}

func (s *service) listBackups(c *gin.Context) {
	filter := bson.M{}
	if source := strings.TrimSpace(c.Query("source")); source != "" {
		filter["source"] = source
	}
	if scope := strings.TrimSpace(c.Query("scope")); scope != "" {
		filter["scope"] = scope
	}
	if status := strings.ToLower(strings.TrimSpace(c.Query("status"))); status != "" {
		filter["status"] = status
	}
	s.queryCollection(c, s.backups, filter, clampInt(parseInt(c.DefaultQuery("limit", "50"), 50), 1, 200), func(row bson.M) gin.H {
		return gin.H{
			"id":          formatID(row["_id"]),
			"source":      asString(row["source"]),
			"scope":       asString(row["scope"]),
			"backupType":  asString(row["backupType"]),
			"status":      asString(row["status"]),
			"capturedAt":  row["capturedAt"],
			"receivedAt":  row["receivedAt"],
			"sizeBytes":   normalizeNumber(row["sizeBytes"]),
			"durationMs":  normalizeNumber(row["durationMs"]),
			"manifestUrl": asString(row["manifestUrl"]),
			"checksum":    asString(row["checksum"]),
			"note":        asString(row["note"]),
			"payload":     toMap(row["payload"]),
		}
	})
}

func (s *service) queryCollection(c *gin.Context, col *mongo.Collection, filter bson.M, limit int, mapper func(bson.M) gin.H) {
	cursor, err := col.Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "capturedAt", Value: -1}, {Key: "occurredAt", Value: -1}, {Key: "_id", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": "Failed to load rows", "error": err.Error()})
		return
	}
	defer cursor.Close(c.Request.Context())
	var rows []bson.M
	if err := cursor.All(c.Request.Context(), &rows); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": "Failed to decode rows", "error": err.Error()})
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		items = append(items, mapper(row))
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "items": items})
}

func (s *service) extractSource(c *gin.Context, explicit string) string {
	return s.extractSourceWithFallback(c, explicit, "pickletour-api")
}

func (s *service) extractSourceWithFallback(c *gin.Context, explicit, fallback string) string {
	if strings.TrimSpace(explicit) != "" {
		return strings.TrimSpace(explicit)
	}
	if header := strings.TrimSpace(c.GetHeader("x-pkt-observer-source")); header != "" {
		return header
	}
	return fallback
}

func bindJSONMap(c *gin.Context) (map[string]any, bool) {
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": "Invalid JSON body"})
		return nil, false
	}
	return body, true
}

func joinAddr(host, port string) string {
	if host == "" || host == "0.0.0.0" {
		return ":" + port
	}
	return net.JoinHostPort(host, port)
}

func parseTime(value any) time.Time {
	switch typed := value.(type) {
	case time.Time:
		return typed.UTC()
	case primitive.DateTime:
		return typed.Time().UTC()
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return time.Now().UTC()
		}
		if parsed, err := time.Parse(time.RFC3339, trimmed); err == nil {
			return parsed.UTC()
		}
		if parsed, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
			return parsed.UTC()
		}
	case float64:
		return time.UnixMilli(int64(typed)).UTC()
	case int64:
		return time.UnixMilli(typed).UTC()
	case int:
		return time.UnixMilli(int64(typed)).UTC()
	}
	return time.Now().UTC()
}

func buildExpireAt(ttlDays int, base time.Time) time.Time {
	if ttlDays <= 0 {
		ttlDays = 7
	}
	return base.UTC().Add(time.Duration(ttlDays) * 24 * time.Hour)
}

func normalizeLevel(value, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug", "info", "warn", "error":
		return strings.ToLower(strings.TrimSpace(value))
	case "":
		return fallback
	default:
		return fallback
	}
}

func normalizeTags(value any) []string {
	items := toSlice(value)
	if len(items) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if normalized := strings.TrimSpace(asString(item)); normalized != "" {
			out = append(out, normalized)
		}
	}
	sort.Strings(out)
	if len(out) > 12 {
		out = out[:12]
	}
	return out
}

func normalizeIntValue(value any) any {
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		if parsed, err := strconv.Atoi(strings.TrimSpace(typed)); err == nil {
			return parsed
		}
	}
	return nil
}

func normalizeNumber(value any) any {
	switch typed := value.(type) {
	case int, int32, int64, float64:
		return typed
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return nil
		}
		if strings.Contains(trimmed, ".") {
			if parsed, err := strconv.ParseFloat(trimmed, 64); err == nil {
				return parsed
			}
		}
		if parsed, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
			return parsed
		}
	}
	return nil
}

func toMap(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	case bson.M:
		return map[string]any(typed)
	case gin.H:
		return map[string]any(typed)
	default:
		return map[string]any{}
	}
}

func toSlice(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case bson.A:
		return []any(typed)
	case []string:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, item)
		}
		return out
	default:
		return []any{}
	}
}

func firstObject(values ...any) map[string]any {
	for _, value := range values {
		if object := toMap(value); len(object) > 0 {
			return object
		}
	}
	return map[string]any{}
}

func firstSlice(values ...any) []any {
	for _, value := range values {
		if items := toSlice(value); len(items) > 0 {
			return items
		}
	}
	return []any{}
}

func firstString(values ...any) string {
	for _, value := range values {
		if normalized := strings.TrimSpace(asString(value)); normalized != "" {
			return normalized
		}
	}
	return ""
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil && strings.TrimSpace(asString(value)) != "" {
			return value
		}
	}
	return nil
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func asString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case primitive.ObjectID:
		return typed.Hex()
	case fmt.Stringer:
		return typed.String()
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func parseInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}

func clampInt(value, minValue, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func formatID(value any) string {
	switch typed := value.(type) {
	case primitive.ObjectID:
		return typed.Hex()
	default:
		return asString(value)
	}
}

func emptyStringToNil(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
