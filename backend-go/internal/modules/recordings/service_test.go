package recordings

import (
	"bytes"
	"context"
	"testing"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type fakeRepository struct {
	recording *RecordingDocument
	chunks    map[int]ChunkDocument
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{
		chunks: map[int]ChunkDocument{},
	}
}

func (r *fakeRepository) EnsureRecording(_ context.Context, matchID primitive.ObjectID) (*RecordingDocument, error) {
	if r.recording == nil {
		r.recording = &RecordingDocument{
			ID:            primitive.NewObjectID(),
			Match:         matchID,
			Status:        "recording",
			HasFinalChunk: false,
		}
	}
	return r.recording, nil
}

func (r *fakeRepository) UpsertChunk(_ context.Context, params UpsertChunkParams) (*ChunkDocument, error) {
	chunk := ChunkDocument{
		ID:            primitive.NewObjectID(),
		Recording:     params.RecordingID,
		Match:         params.MatchID,
		ChunkIndex:    params.ChunkIndex,
		IsFinal:       params.IsFinal,
		FilePath:      params.FilePath,
		FileSizeBytes: params.FileSizeBytes,
		FileSizeMB:    params.FileSizeMB,
		Status:        "uploaded",
	}
	r.chunks[params.ChunkIndex] = chunk
	return &chunk, nil
}

func (r *fakeRepository) AggregateChunks(_ context.Context, _ primitive.ObjectID) (ChunkAggregate, error) {
	totalBytes := int64(0)
	for _, chunk := range r.chunks {
		totalBytes += chunk.FileSizeBytes
	}
	return ChunkAggregate{
		CountChunks:    len(r.chunks),
		TotalSizeBytes: totalBytes,
	}, nil
}

func (r *fakeRepository) UpdateRecordingTotals(_ context.Context, _ primitive.ObjectID, update RecordingTotalsUpdate) (*RecordingDocument, error) {
	r.recording.TotalChunks = update.TotalChunks
	r.recording.TotalSizeMB = update.TotalSizeMB
	if update.HasFinalChunk {
		r.recording.HasFinalChunk = true
		r.recording.Status = update.Status
	}
	return r.recording, nil
}

func (r *fakeRepository) FindRecordingByMatch(_ context.Context, matchID primitive.ObjectID) (*RecordingDocument, error) {
	if r.recording != nil && r.recording.Match == matchID {
		return r.recording, nil
	}
	return nil, nil
}

func (r *fakeRepository) ListChunksByRecording(_ context.Context, _ primitive.ObjectID) ([]ChunkDocument, error) {
	result := make([]ChunkDocument, 0, len(r.chunks))
	for _, chunk := range r.chunks {
		result = append(result, chunk)
	}
	return result, nil
}

func TestServiceSaveChunkLifecycle(t *testing.T) {
	store := NewDiskStore(t.TempDir())
	repository := newFakeRepository()
	service := NewService(repository, store)
	matchID := primitive.NewObjectID().Hex()

	first, err := service.SaveChunk(context.Background(), SaveChunkInput{
		MatchID:    matchID,
		ChunkIndex: "0",
		File:       bytes.NewReader([]byte("first")),
	})
	if err != nil {
		t.Fatalf("save first chunk: %v", err)
	}
	if !first.OK || first.ChunkIndex != "0" {
		t.Fatalf("unexpected first response: %#v", first)
	}
	if repository.recording.TotalChunks != 1 {
		t.Fatalf("expected 1 chunk, got %d", repository.recording.TotalChunks)
	}

	second, err := service.SaveChunk(context.Background(), SaveChunkInput{
		MatchID:    matchID,
		ChunkIndex: "0",
		File:       bytes.NewReader([]byte("updated")),
	})
	if err != nil {
		t.Fatalf("save repeated chunk: %v", err)
	}
	if second.FileSizeBytes != int64(len("updated")) {
		t.Fatalf("expected updated size, got %d", second.FileSizeBytes)
	}
	if repository.recording.TotalChunks != 1 {
		t.Fatalf("expected repeated chunk to remain 1, got %d", repository.recording.TotalChunks)
	}

	third, err := service.SaveChunk(context.Background(), SaveChunkInput{
		MatchID:    matchID,
		ChunkIndex: "1",
		IsFinal:    true,
		File:       bytes.NewReader([]byte("final")),
	})
	if err != nil {
		t.Fatalf("save final chunk: %v", err)
	}
	if !third.IsFinal {
		t.Fatal("expected final response to mark final chunk")
	}
	if repository.recording.TotalChunks != 2 {
		t.Fatalf("expected 2 total chunks, got %d", repository.recording.TotalChunks)
	}
	if repository.recording.Status != "merging" || !repository.recording.HasFinalChunk {
		t.Fatalf("expected recording to enter merging state, got %#v", repository.recording)
	}
}
