package recordings

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type DiskStore struct {
	baseDir string
}

func NewDiskStore(baseDir string) *DiskStore {
	absoluteBaseDir, err := filepath.Abs(baseDir)
	if err != nil {
		absoluteBaseDir = baseDir
	}

	return &DiskStore{baseDir: absoluteBaseDir}
}

func (s *DiskStore) SaveChunk(_ context.Context, matchID, chunkIndex string, src io.Reader) (StoredFile, error) {
	matchDir := filepath.Join(s.baseDir, "recordings", matchID)
	if err := os.MkdirAll(matchDir, 0o755); err != nil {
		return StoredFile{}, err
	}

	savePath := filepath.Join(matchDir, fmt.Sprintf("chunk_%s.mp4", chunkIndex))
	file, err := os.Create(savePath)
	if err != nil {
		return StoredFile{}, err
	}
	defer file.Close()

	sizeBytes, err := io.Copy(file, src)
	if err != nil {
		return StoredFile{}, err
	}

	return StoredFile{
		Path:      savePath,
		SizeBytes: sizeBytes,
		SizeMB:    bytesToMB(sizeBytes),
	}, nil
}
