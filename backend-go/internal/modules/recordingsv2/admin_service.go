package recordingsv2

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

var (
	redisOnce   sync.Once
	redisClient *redis.Client
)

func (s *Service) RetryExport(ctx context.Context, recordingID string) (map[string]any, int, error) {
	recording, statusCode, err := s.loadMutableRecording(ctx, recordingID)
	if err != nil || statusCode != 0 {
		return nil, statusCode, err
	}
	exportPipeline := mapFromValue(mapFromValue(recording.Meta)["exportPipeline"])
	allowedRetry := recording.Status == "pending_export_window" ||
		recording.Status == "failed" ||
		strings.TrimSpace(stringFromValue(exportPipeline["stage"])) == "stale_no_job" ||
		strings.TrimSpace(stringFromValue(exportPipeline["staleReason"])) == "stale_no_job" ||
		strings.TrimSpace(stringFromValue(exportPipeline["staleReason"])) == "worker_offline"
	if !allowedRetry {
		return map[string]any{
			"message": "Only failed, stale, or pending-window recordings can be retried",
		}, 409, nil
	}
	if len(uploadedSegments(recording)) == 0 {
		return map[string]any{
			"message": "Cannot retry export because recording has no uploaded segments",
		}, 400, nil
	}
	return s.FinalizeRecording(ctx, recordingID, true, "recording_export_retried")
}

func (s *Service) ForceExport(ctx context.Context, recordingID string) (map[string]any, int, error) {
	recording, statusCode, err := s.loadMutableRecording(ctx, recordingID)
	if err != nil || statusCode != 0 {
		return nil, statusCode, err
	}
	if recording.Status != "uploading" && recording.Status != "pending_export_window" {
		return map[string]any{
			"message": "Only uploading or pending-window recordings can be moved to exporting",
		}, 409, nil
	}
	if len(uploadedSegments(recording)) == 0 {
		return map[string]any{
			"message": "Cannot move to exporting because recording has no uploaded segments",
		}, 400, nil
	}
	pending := pendingSegments(recording)
	if len(pending) > 0 {
		return map[string]any{
			"message":         "Cannot move to exporting until all segments are uploaded",
			"pendingSegments": len(pending),
		}, 409, nil
	}
	reason := "recording_export_forced_from_uploading"
	if recording.Status == "pending_export_window" {
		reason = "recording_export_forced_from_pending_window"
	}
	return s.FinalizeRecording(ctx, recordingID, true, reason)
}

func (s *Service) GetWorkerHealth(ctx context.Context) (map[string]any, int, error) {
	client := getLiveRecordingRedisClient()
	key := firstNonEmptyString(strings.TrimSpace(os.Getenv("LIVE_RECORDING_WORKER_HEALTH_KEY")), "live-recording-worker:health")
	ttlSeconds := maxInt64(10, int64(numberFromValue(firstNonEmptyString(strings.TrimSpace(os.Getenv("LIVE_RECORDING_WORKER_HEALTH_TTL_SECONDS")), "30"))))
	intervalMs := maxInt64(5000, int64(numberFromValue(firstNonEmptyString(strings.TrimSpace(os.Getenv("LIVE_RECORDING_WORKER_HEALTH_INTERVAL_MS")), "10000"))))

	raw, getErr := client.Get(ctx, key).Result()
	if getErr == redis.Nil {
		return map[string]any{
			"ok":                  true,
			"alive":               false,
			"status":              "offline",
			"ttlSeconds":          -2,
			"lastHeartbeatAt":     nil,
			"heartbeatIntervalMs": intervalMs,
			"heartbeatTtlSeconds": ttlSeconds,
			"worker":              nil,
		}, 200, nil
	}
	if getErr != nil {
		return nil, 0, getErr
	}
	ttl, _ := client.TTL(ctx, key).Result()
	var worker map[string]any
	_ = json.Unmarshal([]byte(raw), &worker)
	lastHeartbeatAt := timeFromValue(worker["lastHeartbeatAt"])
	alive := false
	if ts, ok := lastHeartbeatAt.(time.Time); ok {
		alive = time.Since(ts) < time.Duration(ttlSeconds)*time.Second
	}
	status := "stale"
	if alive {
		status = firstNonEmptyString(stringFromValue(worker["status"]), "idle")
	}
	return map[string]any{
		"ok":                  true,
		"alive":               alive,
		"status":              status,
		"ttlSeconds":          int(ttl.Seconds()),
		"lastHeartbeatAt":     lastHeartbeatAt,
		"heartbeatIntervalMs": intervalMs,
		"heartbeatTtlSeconds": ttlSeconds,
		"worker":              worker,
	}, 200, nil
}

func getLiveRecordingRedisClient() *redis.Client {
	redisOnce.Do(func() {
		redisURL := firstNonEmptyString(strings.TrimSpace(os.Getenv("REDIS_URL")), "redis://127.0.0.1:6379")
		options, err := redis.ParseURL(redisURL)
		if err != nil {
			options = &redis.Options{
				Addr: "127.0.0.1:6379",
			}
		}
		redisClient = redis.NewClient(options)
	})
	return redisClient
}
