package recordings

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestDiskStoreSaveChunk(t *testing.T) {
	store := NewDiskStore(t.TempDir())
	content := []byte("recording-bytes")

	stored, err := store.SaveChunk(context.Background(), "match-1", "7", bytes.NewReader(content))
	if err != nil {
		t.Fatalf("save chunk: %v", err)
	}

	expectedPath := filepath.Join(store.baseDir, "recordings", "match-1", "chunk_7.mp4")
	if stored.Path != expectedPath {
		t.Fatalf("expected path %s, got %s", expectedPath, stored.Path)
	}
	if stored.SizeBytes != int64(len(content)) {
		t.Fatalf("expected size %d, got %d", len(content), stored.SizeBytes)
	}
	if _, err := os.Stat(stored.Path); err != nil {
		t.Fatalf("expected file to exist: %v", err)
	}
}
