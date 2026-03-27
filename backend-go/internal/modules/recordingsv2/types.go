package recordingsv2

import (
	"context"
	"io"
	"net/http"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type RecordingDocument struct {
	ID                 primitive.ObjectID  `bson:"_id"`
	Match              primitive.ObjectID  `bson:"match"`
	CourtID            *primitive.ObjectID `bson:"courtId,omitempty"`
	Mode               string              `bson:"mode"`
	Quality            string              `bson:"quality"`
	RecordingSessionID string              `bson:"recordingSessionId"`
	Status             string              `bson:"status"`
	Segments           []SegmentDocument   `bson:"segments"`
	DurationSeconds    float64             `bson:"durationSeconds"`
	SizeBytes          int64               `bson:"sizeBytes"`
	R2TargetID         string              `bson:"r2TargetId"`
	R2BucketName       string              `bson:"r2BucketName"`
	R2ManifestKey      string              `bson:"r2ManifestKey"`
	R2Prefix           string              `bson:"r2Prefix"`
	DriveFileID        string              `bson:"driveFileId"`
	DriveRawURL        string              `bson:"driveRawUrl"`
	DrivePreviewURL    string              `bson:"drivePreviewUrl"`
	PlaybackURL        string              `bson:"playbackUrl"`
	ExportAttempts     int                 `bson:"exportAttempts"`
	FinalizedAt        *time.Time          `bson:"finalizedAt,omitempty"`
	ScheduledExportAt  *time.Time          `bson:"scheduledExportAt,omitempty"`
	ReadyAt            *time.Time          `bson:"readyAt,omitempty"`
	Error              string              `bson:"error"`
	Meta               bson.M              `bson:"meta,omitempty"`
	AICommentary       bson.M              `bson:"aiCommentary,omitempty"`
	CreatedAt          *time.Time          `bson:"createdAt,omitempty"`
	UpdatedAt          *time.Time          `bson:"updatedAt,omitempty"`
}

type SegmentDocument struct {
	Index           int        `bson:"index"`
	ObjectKey       string     `bson:"objectKey"`
	StorageTargetID string     `bson:"storageTargetId"`
	BucketName      string     `bson:"bucketName"`
	UploadStatus    string     `bson:"uploadStatus"`
	ETag            string     `bson:"etag"`
	SizeBytes       int64      `bson:"sizeBytes"`
	DurationSeconds float64    `bson:"durationSeconds"`
	IsFinal         bool       `bson:"isFinal"`
	UploadedAt      *time.Time `bson:"uploadedAt,omitempty"`
	Meta            bson.M     `bson:"meta,omitempty"`
}

type LivePlaybackConfig struct {
	Enabled             bool
	DelaySeconds        int
	ManifestName        string
	GlobalPublicBaseURL string
	TargetPublicBaseURL map[string]string
}

type MatchDocument struct {
	ID         primitive.ObjectID  `bson:"_id"`
	CourtID    *primitive.ObjectID `bson:"court,omitempty"`
	CourtLabel string              `bson:"courtLabel,omitempty"`
	Code       string              `bson:"code,omitempty"`
	Status     string              `bson:"status,omitempty"`
}

type StorageTarget struct {
	ID              string
	Label           string
	Endpoint        string
	AccessKeyID     string
	SecretAccessKey string
	BucketName      string
	PublicBaseURL   string
	CapacityBytes   int64
	Enabled         bool
}

type RecordingQueueDecision struct {
	Enabled        bool
	ShouldQueueNow bool
	DelayMs        int64
	ScheduledAt    *time.Time
	Timezone       string
	WindowStart    string
	WindowEnd      string
}

type Repository interface {
	FindByMatch(ctx context.Context, matchID primitive.ObjectID) (*RecordingDocument, error)
	FindByID(ctx context.Context, recordingID primitive.ObjectID) (*RecordingDocument, error)
	FindNextExportCandidate(ctx context.Context) (*RecordingDocument, error)
	ListAutoExportCandidates(ctx context.Context) ([]*RecordingDocument, error)
	FindByRecordingSessionID(ctx context.Context, recordingSessionID string) (*RecordingDocument, error)
	FindMatchByID(ctx context.Context, matchID primitive.ObjectID) (*MatchDocument, error)
	InsertRecording(ctx context.Context, recording *RecordingDocument) error
	SaveRecording(ctx context.Context, recording *RecordingDocument) error
	UpdateMatchVideo(ctx context.Context, matchID primitive.ObjectID, videoURL string) error
	LoadStorageTargets(ctx context.Context) ([]StorageTarget, error)
	LoadLivePlaybackConfig(ctx context.Context) (LivePlaybackConfig, error)
	LoadSystemSettings(ctx context.Context) (bson.M, error)
	LoadConfigValues(ctx context.Context, keys ...string) (map[string]string, error)
	ListMonitorRecordings(ctx context.Context) ([]bson.M, error)
	FindActiveAICommentaryJob(ctx context.Context) (bson.M, error)
	ListRecentAICommentaryJobs(ctx context.Context, limit int64) ([]bson.M, error)
	CountAICommentaryJobsByStatus(ctx context.Context, status string) (int64, error)
	FindActiveAICommentaryJobByRecording(ctx context.Context, recordingID primitive.ObjectID) (bson.M, error)
	FindCompletedAICommentaryJobByFingerprint(ctx context.Context, recordingID primitive.ObjectID, sourceFingerprint string) (bson.M, error)
	InsertAICommentaryJob(ctx context.Context, job bson.M) (primitive.ObjectID, error)
	PromoteScheduledExports(ctx context.Context, before time.Time) (int64, error)
	CountRecordingsByStatus(ctx context.Context, status string) (int64, error)
}

type RedirectDecision struct {
	RedirectURL       string
	StatusCode        int
	Payload           map[string]any
	Stream            *DriveStreamResult
	FileLabel         string
	FallbackSizeBytes int64
}

type DriveProxy interface {
	Probe(ctx context.Context, fileID string) (*DriveProbeResult, error)
	Stream(ctx context.Context, fileID, rangeHeader string) (*DriveStreamResult, error)
	UploadFile(ctx context.Context, filePath, fileName, mimeType string) (*DriveUploadResult, error)
}

type DriveProbeResult struct {
	DriveAuthMode string
	StatusCode    int
	ContentType   string
	ContentLength string
	ContentRange  string
	AcceptRanges  string
	CheckedAt     time.Time
}

type DriveStreamResult struct {
	StatusCode    int
	Headers       http.Header
	Body          io.ReadCloser
	DriveAuthMode string
}

type DriveUploadResult struct {
	FileID        string
	RawURL        string
	PreviewURL    string
	DriveAuthMode string
	SizeBytes     int64
}
