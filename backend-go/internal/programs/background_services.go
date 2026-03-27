package programs

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"backendgo/internal/modules/recordingsv2"
	"backendgo/internal/runtime"

	"github.com/redis/go-redis/v9"
)

type BackgroundCommandSpec struct {
	Name         string
	Role         string
	Port         string
	TickInterval time.Duration
	Message      string
}

func RunBackgroundCommand(ctx context.Context, spec BackgroundCommandSpec) error {
	bundle, err := runtime.Bootstrap(ctx)
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = bundle.Close(closeCtx)
	}()

	return runtime.RunBackgroundService(ctx, bundle, runtime.BackgroundServiceSpec{
		Name:         spec.Name,
		Role:         spec.Role,
		Port:         spec.Port,
		TickInterval: spec.TickInterval,
		TickTimeout:  spec.TickInterval,
		OnTick: func(_ context.Context, bundle *runtime.Bundle) error {
			if spec.Message != "" {
				log.Printf("%s: %s [mongo=%s redisReady=%t]", spec.Name, spec.Message, bundle.Config.MongoDatabase, bundle.Config.RedisURL != "")
			}
			return nil
		},
	})
}

func RunScheduler(ctx context.Context) error {
	bundle, err := runtime.Bootstrap(ctx)
	if err != nil {
		return err
	}
	defer closeBundle(bundle)

	service := recordingsv2.NewService(recordingsv2.NewMongoRepository(bundle.Database), nil)
	name := bundle.Config.ServicePrefix + "-scheduler"

	return runtime.RunBackgroundService(ctx, bundle, runtime.BackgroundServiceSpec{
		Name:         name,
		Role:         "scheduler",
		Port:         bundle.Config.SchedulerPort,
		TickInterval: time.Minute,
		TickTimeout:  time.Minute,
		OnTick: func(tickCtx context.Context, bundle *runtime.Bundle) error {
			promoted, err := service.PromoteDueScheduledExports(tickCtx, time.Now().UTC())
			if err != nil {
				return err
			}
			if promoted > 0 {
				log.Printf("%s promoted %d recording(s) from pending_export_window to exporting", name, promoted)
			}
			sweepResult, err := service.RunAutoExportSweep(tickCtx, time.Now().UTC())
			if err != nil {
				return err
			}
			if len(sweepResult.QueuedRecordingIDs) > 0 {
				log.Printf("%s auto-queued %d idle recording(s) after %d minute(s) without segment activity", name, len(sweepResult.QueuedRecordingIDs), sweepResult.TimeoutMinutes)
			}
			if len(sweepResult.Failures) > 0 {
				log.Printf("%s auto-export sweep encountered %d failure(s)", name, len(sweepResult.Failures))
			}
			return nil
		},
	})
}

func RunRecordingExportWorker(ctx context.Context) error {
	bundle, err := runtime.Bootstrap(ctx)
	if err != nil {
		return err
	}
	defer closeBundle(bundle)

	service := recordingsv2.NewService(recordingsv2.NewMongoRepository(bundle.Database), nil)
	name := bundle.Config.ServicePrefix + "-worker-recording-export"

	return runtime.RunBackgroundService(ctx, bundle, runtime.BackgroundServiceSpec{
		Name:         name,
		Role:         "recording-export",
		Port:         bundle.Config.WorkerRecordingExportPort,
		TickInterval: 10 * time.Second,
		TickTimeout:  6 * time.Hour,
		OnTick: func(tickCtx context.Context, bundle *runtime.Bundle) error {
			result, err := service.ProcessNextExport(tickCtx, func(progress recordingsv2.ExportWorkerProgress) {
				progressCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_ = writeRecordingWorkerHeartbeat(progressCtx, bundle.Config.RedisURL, bundle.StartedAt, recordingWorkerHeartbeat{
					Status:              firstNonEmptyString(strings.TrimSpace(progress.Status), "running"),
					CurrentRecordingID:  progress.CurrentRecordingID,
					CurrentJobStartedAt: progress.CurrentJobStartedAt,
					CurrentStage:        progress.Stage,
				})
			})
			if err != nil {
				return err
			}
			return writeRecordingWorkerHeartbeat(tickCtx, bundle.Config.RedisURL, bundle.StartedAt, recordingWorkerHeartbeat{
				Status:              firstNonEmptyString(strings.TrimSpace(result.Status), "idle"),
				CurrentRecordingID:  result.CurrentRecordingID,
				CurrentJobStartedAt: result.CurrentJobStartedAt,
				LastCompletedAt:     result.LastCompletedAt,
				LastFailedAt:        result.LastFailedAt,
				LastFailedReason:    result.LastFailedReason,
				ExportingCount:      result.ExportingCount,
				PendingWindowCount:  result.PendingWindowCount,
			})
		},
	})
}

type recordingWorkerHeartbeat struct {
	Status              string `json:"status"`
	CurrentRecordingID  string `json:"currentRecordingId,omitempty"`
	CurrentJobStartedAt any    `json:"currentJobStartedAt,omitempty"`
	CurrentStage        string `json:"currentStage,omitempty"`
	LastCompletedAt     any    `json:"lastCompletedAt,omitempty"`
	LastFailedAt        any    `json:"lastFailedAt,omitempty"`
	LastFailedReason    string `json:"lastFailedReason,omitempty"`
	ExportingCount      int64  `json:"exportingCount"`
	PendingWindowCount  int64  `json:"pendingWindowCount"`
}

func writeRecordingWorkerHeartbeat(ctx context.Context, redisURL string, startedAt time.Time, heartbeat recordingWorkerHeartbeat) error {
	client, err := redisClientFromURL(redisURL)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()

	now := time.Now().UTC()
	ttlSeconds := maxInt64(10, int64(numberFromEnv("LIVE_RECORDING_WORKER_HEALTH_TTL_SECONDS", 30)))
	payload := map[string]any{
		"workerName":          "live-recording-export-worker",
		"queueName":           emptyStringToNil(strings.TrimSpace(os.Getenv("LIVE_RECORDING_EXPORT_QUEUE_NAME"))),
		"status":              firstNonEmptyString(strings.TrimSpace(heartbeat.Status), "idle"),
		"hostname":            firstNonEmptyString(strings.TrimSpace(os.Getenv("COMPUTERNAME")), strings.TrimSpace(os.Getenv("HOSTNAME")), "backend-go"),
		"pid":                 os.Getpid(),
		"startedAt":           startedAt.UTC(),
		"lastHeartbeatAt":     now,
		"currentRecordingId":  emptyStringToNil(strings.TrimSpace(heartbeat.CurrentRecordingID)),
		"currentJobStartedAt": heartbeat.CurrentJobStartedAt,
		"currentStage":        emptyStringToNil(strings.TrimSpace(heartbeat.CurrentStage)),
		"lastCompletedAt":     heartbeat.LastCompletedAt,
		"lastFailedAt":        heartbeat.LastFailedAt,
		"lastFailedReason":    emptyStringToNil(strings.TrimSpace(heartbeat.LastFailedReason)),
		"exportingCount":      heartbeat.ExportingCount,
		"pendingWindowCount":  heartbeat.PendingWindowCount,
		"service":             "recording-export",
	}
	serialized, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	key := firstNonEmptyString(strings.TrimSpace(os.Getenv("LIVE_RECORDING_WORKER_HEALTH_KEY")), "live-recording-worker:health")
	return client.Set(ctx, key, serialized, time.Duration(ttlSeconds)*time.Second).Err()
}

func redisClientFromURL(redisURL string) (*redis.Client, error) {
	options, err := redis.ParseURL(firstNonEmptyString(strings.TrimSpace(redisURL), "redis://127.0.0.1:6379/0"))
	if err != nil {
		return nil, err
	}
	return redis.NewClient(options), nil
}

func closeBundle(bundle *runtime.Bundle) {
	closeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = bundle.Close(closeCtx)
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func numberFromEnv(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	numeric, err := strconv.Atoi(value)
	if err == nil && numeric > 0 {
		return numeric
	}
	return fallback
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func emptyStringToNil(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
