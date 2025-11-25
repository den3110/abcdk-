// models/types.go
package models

import "time"

type DownloadRequest struct {
	URL     string `json:"url"`
	Quality string `json:"quality"` // "best", "1080p", "720p", etc
	Format  string `json:"format"`  // "mp4", "webm"
}

type DownloadResult struct {
	Success      bool      `json:"success"`
	FilePath     string    `json:"file_path"`
	FileSize     int64     `json:"file_size"`
	Title        string    `json:"title"`
	Duration     float64   `json:"duration"`
	Quality      string    `json:"quality"`
	DownloadedAt time.Time `json:"downloaded_at"`
	Error        string    `json:"error,omitempty"`
}

type VideoInfo struct {
	Title       string  `json:"title"`
	Duration    float64 `json:"duration"`
	Description string  `json:"description"`
	Uploader    string  `json:"uploader"`
	ViewCount   int64   `json:"view_count"`
	UploadDate  string  `json:"upload_date"`
}

type DownloadTask struct {
	ID          string           `json:"id"`
	Status      string           `json:"status"` // queued, downloading, completed, failed
	Request     *DownloadRequest `json:"request"`
	Result      *DownloadResult  `json:"result,omitempty"`
	Error       string           `json:"error,omitempty"`
	CreatedAt   time.Time        `json:"created_at"`
	CompletedAt time.Time        `json:"completed_at,omitempty"`
}