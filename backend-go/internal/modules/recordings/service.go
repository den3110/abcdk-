package recordings

import (
	"context"
	"errors"
	"io"
	"math"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

var (
	ErrMissingMatchID   = errors.New("matchId is required")
	ErrMissingFile      = errors.New("file is required")
	ErrInvalidMatchID   = errors.New("matchId must be a valid object id")
	ErrInvalidChunk     = errors.New("chunkIndex must be a valid integer")
	ErrRecordingMissing = errors.New("no recording for this match")
)

type RecordingDocument struct {
	ID                   primitive.ObjectID `bson:"_id" json:"_id"`
	Match                primitive.ObjectID `bson:"match" json:"match"`
	TotalChunks          int                `bson:"totalChunks" json:"totalChunks"`
	TotalSizeMB          float64            `bson:"totalSizeMB" json:"totalSizeMB"`
	FinalFilePath        string             `bson:"finalFilePath,omitempty" json:"finalFilePath,omitempty"`
	FinalFileSizeMB      float64            `bson:"finalFileSizeMB,omitempty" json:"finalFileSizeMB,omitempty"`
	FinalDurationSeconds float64            `bson:"finalDurationSeconds,omitempty" json:"finalDurationSeconds,omitempty"`
	Status               string             `bson:"status" json:"status"`
	HasFinalChunk        bool               `bson:"hasFinalChunk" json:"hasFinalChunk"`
	Meta                 bson.M             `bson:"meta,omitempty" json:"meta,omitempty"`
	CreatedAt            time.Time          `bson:"createdAt,omitempty" json:"createdAt,omitempty"`
	UpdatedAt            time.Time          `bson:"updatedAt,omitempty" json:"updatedAt,omitempty"`
}

type ChunkDocument struct {
	ID            primitive.ObjectID `bson:"_id" json:"_id"`
	Recording     primitive.ObjectID `bson:"recording" json:"recording"`
	Match         primitive.ObjectID `bson:"match" json:"match"`
	ChunkIndex    int                `bson:"chunkIndex" json:"chunkIndex"`
	IsFinal       bool               `bson:"isFinal" json:"isFinal"`
	FilePath      string             `bson:"filePath" json:"filePath"`
	FileSizeBytes int64              `bson:"fileSizeBytes" json:"fileSizeBytes"`
	FileSizeMB    float64            `bson:"fileSizeMB" json:"fileSizeMB"`
	Status        string             `bson:"status" json:"status"`
	CreatedAt     time.Time          `bson:"createdAt,omitempty" json:"createdAt,omitempty"`
	UpdatedAt     time.Time          `bson:"updatedAt,omitempty" json:"updatedAt,omitempty"`
}

type UploadResponse struct {
	OK            bool    `json:"ok"`
	MatchID       string  `json:"matchId"`
	FilePath      string  `json:"filePath"`
	FileSizeBytes int64   `json:"fileSizeBytes"`
	FileSizeMB    float64 `json:"fileSizeMB"`
	ChunkIndex    string  `json:"chunkIndex"`
	IsFinal       bool    `json:"isFinal"`
	DurationMs    int64   `json:"durationMs"`
}

type RecordingResponse struct {
	Recording *RecordingDocument `json:"recording"`
	Chunks    []ChunkDocument    `json:"chunks"`
}

type SaveChunkInput struct {
	MatchID    string
	ChunkIndex string
	IsFinal    bool
	File       io.Reader
}

type StoredFile struct {
	Path      string
	SizeBytes int64
	SizeMB    float64
}

type ChunkAggregate struct {
	CountChunks    int
	TotalSizeBytes int64
}

type RecordingTotalsUpdate struct {
	TotalChunks   int
	TotalSizeMB   float64
	HasFinalChunk bool
	Status        string
}

type UpsertChunkParams struct {
	RecordingID   primitive.ObjectID
	MatchID       primitive.ObjectID
	ChunkIndex    int
	IsFinal       bool
	FilePath      string
	FileSizeBytes int64
	FileSizeMB    float64
}

type Repository interface {
	EnsureRecording(ctx context.Context, matchID primitive.ObjectID) (*RecordingDocument, error)
	UpsertChunk(ctx context.Context, params UpsertChunkParams) (*ChunkDocument, error)
	AggregateChunks(ctx context.Context, recordingID primitive.ObjectID) (ChunkAggregate, error)
	UpdateRecordingTotals(ctx context.Context, recordingID primitive.ObjectID, update RecordingTotalsUpdate) (*RecordingDocument, error)
	FindRecordingByMatch(ctx context.Context, matchID primitive.ObjectID) (*RecordingDocument, error)
	ListChunksByRecording(ctx context.Context, recordingID primitive.ObjectID) ([]ChunkDocument, error)
}

type Store interface {
	SaveChunk(ctx context.Context, matchID, chunkIndex string, src io.Reader) (StoredFile, error)
}

type Service struct {
	repository Repository
	store      Store
	now        func() time.Time
}

func NewService(repository Repository, store Store) *Service {
	return &Service{
		repository: repository,
		store:      store,
		now:        time.Now,
	}
}

func (s *Service) SaveChunk(ctx context.Context, input SaveChunkInput) (*UploadResponse, error) {
	matchID := strings.TrimSpace(input.MatchID)
	if matchID == "" {
		return nil, ErrMissingMatchID
	}
	if input.File == nil {
		return nil, ErrMissingFile
	}

	matchObjectID, err := primitive.ObjectIDFromHex(matchID)
	if err != nil {
		return nil, ErrInvalidMatchID
	}

	chunkNumber, err := normalizeChunkIndex(input.ChunkIndex)
	if err != nil {
		return nil, err
	}
	normalizedChunkIndex := strconv.Itoa(chunkNumber)

	startedAt := s.now()
	storedFile, err := s.store.SaveChunk(ctx, matchID, normalizedChunkIndex, input.File)
	if err != nil {
		return nil, err
	}

	recording, err := s.repository.EnsureRecording(ctx, matchObjectID)
	if err != nil {
		return nil, err
	}

	if _, err := s.repository.UpsertChunk(ctx, UpsertChunkParams{
		RecordingID:   recording.ID,
		MatchID:       matchObjectID,
		ChunkIndex:    chunkNumber,
		IsFinal:       input.IsFinal,
		FilePath:      storedFile.Path,
		FileSizeBytes: storedFile.SizeBytes,
		FileSizeMB:    storedFile.SizeMB,
	}); err != nil {
		return nil, err
	}

	aggregate, err := s.repository.AggregateChunks(ctx, recording.ID)
	if err != nil {
		return nil, err
	}

	update := RecordingTotalsUpdate{
		TotalChunks: aggregate.CountChunks,
		TotalSizeMB: bytesToMB(aggregate.TotalSizeBytes),
	}
	if input.IsFinal {
		update.HasFinalChunk = true
		update.Status = "merging"
	}

	if _, err := s.repository.UpdateRecordingTotals(ctx, recording.ID, update); err != nil {
		return nil, err
	}

	return &UploadResponse{
		OK:            true,
		MatchID:       matchID,
		FilePath:      storedFile.Path,
		FileSizeBytes: storedFile.SizeBytes,
		FileSizeMB:    storedFile.SizeMB,
		ChunkIndex:    normalizedChunkIndex,
		IsFinal:       input.IsFinal,
		DurationMs:    time.Since(startedAt).Milliseconds(),
	}, nil
}

func (s *Service) GetRecordingByMatch(ctx context.Context, matchID string) (*RecordingResponse, error) {
	matchObjectID, err := primitive.ObjectIDFromHex(strings.TrimSpace(matchID))
	if err != nil {
		return nil, ErrInvalidMatchID
	}

	recording, err := s.repository.FindRecordingByMatch(ctx, matchObjectID)
	if err != nil {
		return nil, err
	}
	if recording == nil {
		return nil, ErrRecordingMissing
	}

	chunks, err := s.repository.ListChunksByRecording(ctx, recording.ID)
	if err != nil {
		return nil, err
	}

	return &RecordingResponse{
		Recording: recording,
		Chunks:    chunks,
	}, nil
}

func normalizeChunkIndex(raw string) (int, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, nil
	}

	index, err := strconv.Atoi(value)
	if err != nil || index < 0 {
		return 0, ErrInvalidChunk
	}
	return index, nil
}

func bytesToMB(sizeBytes int64) float64 {
	value := float64(sizeBytes) / (1024 * 1024)
	return math.Round(value*1000) / 1000
}
