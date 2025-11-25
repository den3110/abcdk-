// storage/local.go
package storage

import (
	"io"
	"os"
	"path/filepath"
	"time"
)

type LocalStorage struct {
	basePath string
}

func NewLocalStorage(basePath string) *LocalStorage {
	// Create storage directory
	os.MkdirAll(basePath, 0755)
	
	return &LocalStorage{
		basePath: basePath,
	}
}

func (ls *LocalStorage) SaveFile(srcPath, filename string) (string, error) {
	destPath := filepath.Join(ls.basePath, filename)
	
	// Copy file
	src, err := os.Open(srcPath)
	if err != nil {
		return "", err
	}
	defer src.Close()
	
	dest, err := os.Create(destPath)
	if err != nil {
		return "", err
	}
	defer dest.Close()
	
	if _, err := io.Copy(dest, src); err != nil {
		return "", err
	}
	
	return destPath, nil
}

func (ls *LocalStorage) GetFileInfo(filename string) (os.FileInfo, error) {
	filePath := filepath.Join(ls.basePath, filename)
	return os.Stat(filePath)
}

func (ls *LocalStorage) DeleteFile(filename string) error {
	filePath := filepath.Join(ls.basePath, filename)
	return os.Remove(filePath)
}

func (ls *LocalStorage) CleanupOldFiles(maxAge time.Duration) error {
	return filepath.Walk(ls.basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		
		if !info.IsDir() && time.Since(info.ModTime()) > maxAge {
			return os.Remove(path)
		}
		
		return nil
	})
}