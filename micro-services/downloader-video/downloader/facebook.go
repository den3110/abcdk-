// downloader/facebook.go
package downloader

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"downloadervideo/config"
	"downloadervideo/models"
	"downloadervideo/storage"
)

type FacebookDownloader struct {
	storage    storage.LocalStorage
	cfg        *config.Config
	httpClient *http.Client
}

func NewFacebookDownloader(storage storage.LocalStorage, cfg *config.Config) *FacebookDownloader {
	return &FacebookDownloader{
		storage: storage,
		cfg:     cfg,
		httpClient: &http.Client{
			Timeout:   cfg.DownloadTimeout,
			Transport: &http.Transport{MaxConnsPerHost: cfg.MaxConcurrent},
		},
	}
}

// DownloadVideo - Main download method
func (fd *FacebookDownloader) DownloadVideo(ctx context.Context, req *models.DownloadRequest) (*models.DownloadResult, error) {
	// Validate URL
	if err := fd.validateFacebookURL(req.URL); err != nil {
		return nil, err
	}

	// Extract video info
	videoInfo, err := fd.extractVideoInfo(ctx, req.URL)
	if err != nil {
		return nil, fmt.Errorf("failed to extract video info: %w", err)
	}

	// Validate video constraints
	if err := fd.validateVideoConstraints(videoInfo); err != nil {
		return nil, err
	}

	// Download using yt-dlp
	result, err := fd.downloadWithYtDlp(ctx, req.URL, videoInfo, req.Quality)
	if err != nil {
		return nil, fmt.Errorf("download failed: %w", err)
	}

	return result, nil
}

// extractVideoInfo - Extract video metadata using multiple methods
func (fd *FacebookDownloader) extractVideoInfo(ctx context.Context, videoURL string) (*models.VideoInfo, error) {
	// Method 1: Try yt-dlp for info extraction
	info, err := fd.extractWithYtDlp(ctx, videoURL)
	if err == nil {
		return info, nil
	}

	// Method 2: Fallback to direct HTTP parsing
	return fd.extractWithHTTP(ctx, videoURL)
}

// extractWithYtDlp - Use yt-dlp to get video info
func (fd *FacebookDownloader) extractWithYtDlp(ctx context.Context, videoURL string) (*models.VideoInfo, error) {
	cmd := exec.CommandContext(ctx, "yt-dlp",
		"--dump-json",
		"--no-download",
		videoURL,
	)

	output, err := cmd.Output()
	if err != nil {
		// log sơ qua để debug nếu cần
		log.Printf("[yt-dlp info] error: %v", err)
		log.Printf("[yt-dlp info] output:\n%s", string(output))
		return nil, err
	}

	var ytInfo map[string]interface{}
	if err := json.Unmarshal(output, &ytInfo); err != nil {
		return nil, err
	}

	return &models.VideoInfo{
		Title:       getString(ytInfo, "title"),
		Duration:    getFloat(ytInfo, "duration"),
		Description: getString(ytInfo, "description"),
		Uploader:    getString(ytInfo, "uploader"),
		ViewCount:   int64(getInt(ytInfo, "view_count")),
		UploadDate:  getString(ytInfo, "upload_date"),
	}, nil
}

// extractWithHTTP - Fallback HTTP parsing
func (fd *FacebookDownloader) extractWithHTTP(ctx context.Context, videoURL string) (*models.VideoInfo, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", videoURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	resp, err := fd.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	return fd.parseVideoInfoFromHTML(string(body))
}

// downloadWithYtDlp - Download video using yt-dlp
func (fd *FacebookDownloader) downloadWithYtDlp(
	ctx context.Context,
	videoURL string,
	info *models.VideoInfo,
	quality string,
) (*models.DownloadResult, error) {
	// Generate unique filename
	filename := fd.generateFilename(info.Title)
	outputPath := filepath.Join(fd.cfg.StoragePath, filename)

	// Build yt-dlp command
	args := []string{
		"-o", outputPath,
		"--format", fd.getFormatSelector(quality),
		"--no-part",
		"--http-chunk-size", "10M",
		"--retries", "3",
		"--fragment-retries", "3",
		"--socket-timeout", "30",
	}

	// Add additional options for better performance
	if quality != "audio_only" {
		args = append(args,
			"--write-thumbnail",
			"--write-info-json",
			"--write-description",
		)
	}

	args = append(args, videoURL)

	// ===== Lần 1: thử với format được yêu cầu =====
	log.Printf("[yt-dlp download] cmd: yt-dlp %v", args)
	cmd := exec.CommandContext(ctx, "yt-dlp", args...)

	output, err := cmd.CombinedOutput()
	if err != nil {
		outStr := string(output)
		log.Printf("[yt-dlp download] error: %v", err)
		log.Printf("[yt-dlp download] output:\n%s", outStr)

		// Nếu lỗi đúng kiểu "Requested format is not available"
		if strings.Contains(outStr, "Requested format is not available") {
			log.Printf("[yt-dlp download] requested format not available, fallback to best")

			// Build lại args với format fallback = "best"
			fallbackArgs := []string{
				"-o", outputPath,
				"--format", "best", // 👈 fallback
				"--no-part",
				"--http-chunk-size", "10M",
				"--retries", "3",
				"--fragment-retries", "3",
				"--socket-timeout", "30",
			}
			if quality != "audio_only" {
				fallbackArgs = append(fallbackArgs,
					"--write-thumbnail",
					"--write-info-json",
					"--write-description",
				)
			}
			fallbackArgs = append(fallbackArgs, videoURL)

			log.Printf("[yt-dlp download][fallback] cmd: yt-dlp %v", fallbackArgs)
			fallbackCmd := exec.CommandContext(ctx, "yt-dlp", fallbackArgs...)
			fallbackOutput, fallbackErr := fallbackCmd.CombinedOutput()
			if fallbackErr != nil {
				log.Printf("[yt-dlp download][fallback] error: %v", fallbackErr)
				log.Printf("[yt-dlp download][fallback] output:\n%s", string(fallbackOutput))
				return nil, fmt.Errorf("yt-dlp failed (fallback too): %w", fallbackErr)
			}

			log.Printf("[yt-dlp download][fallback] success.\n%s", string(fallbackOutput))
		} else {
			// Lỗi kiểu khác thì trả luôn
			return nil, fmt.Errorf("yt-dlp failed: %w", err)
		}
	} else {
		// Thành công lần 1
		log.Printf("[yt-dlp download] success.\n%s", string(output))
	}

	// Get file info (yt-dlp sẽ thêm .mp4 nếu ext là mp4)
	fileInfo, err := os.Stat(outputPath + ".mp4")
	if err != nil {
		return nil, err
	}

	return &models.DownloadResult{
		Success:      true,
		FilePath:     outputPath + ".mp4",
		FileSize:     fileInfo.Size(),
		Title:        info.Title,
		Duration:     info.Duration,
		Quality:      quality, // ở fallback thì quality là "mong muốn", thực tế là best
		DownloadedAt: time.Now(),
	}, nil
}

// Helper methods
func (fd *FacebookDownloader) validateFacebookURL(rawURL string) error {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}

	if !strings.Contains(parsedURL.Host, "facebook.com") &&
		!strings.Contains(parsedURL.Host, "fb.watch") {
		return fmt.Errorf("not a Facebook URL")
	}

	return nil
}

func (fd *FacebookDownloader) validateVideoConstraints(info *models.VideoInfo) error {
	// Check duration (30 minutes max)
	if info.Duration > 1800 {
		return fmt.Errorf("video too long: %f seconds", info.Duration)
	}

	return nil
}

func (fd *FacebookDownloader) getFormatSelector(quality string) string {
	switch quality {
	case "best":
		return "best[height<=1080]"
	case "1080p":
		return "best[height<=1080]"
	case "720p":
		return "best[height<=720]"
	case "480p":
		return "best[height<=480]"
	case "360p":
		return "best[height<=360]"
	case "audio_only":
		return "bestaudio"
	default:
		return "best[height<=720]"
	}
}

func (fd *FacebookDownloader) generateFilename(title string) string {
	// Clean filename
	reg := regexp.MustCompile(`[^a-zA-Z0-9\s-_]`)
	cleanTitle := reg.ReplaceAllString(title, "")
	cleanTitle = strings.ReplaceAll(cleanTitle, " ", "_")

	return fmt.Sprintf("%s_%d", cleanTitle, time.Now().Unix())
}

func (fd *FacebookDownloader) parseVideoInfoFromHTML(html string) (*models.VideoInfo, error) {
	// Basic regex extraction as fallback
	titleRegex := regexp.MustCompile(`<title>(.*?)</title>`)
	titleMatch := titleRegex.FindStringSubmatch(html)

	title := "Facebook Video"
	if len(titleMatch) > 1 {
		title = titleMatch[1]
	}

	return &models.VideoInfo{
		Title:    title,
		Duration: 0, // Unknown in fallback
	}, nil
}

/* ====== JSON helper functions cho yt-dlp ====== */

func getString(m map[string]interface{}, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}

	switch val := v.(type) {
	case string:
		return val
	case float64:
		// yt-dlp hay trả số kiểu float64
		return strconv.FormatFloat(val, 'f', -1, 64)
	case int:
		return strconv.Itoa(val)
	case int64:
		return strconv.FormatInt(val, 10)
	case bool:
		if val {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%v", v)
	}
}

func getFloat(m map[string]interface{}, key string) float64 {
	v, ok := m[key]
	if !ok || v == nil {
		return 0
	}

	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int:
		return float64(val)
	case int64:
		return float64(val)
	case string:
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			return f
		}
	}
	return 0
}

func getInt(m map[string]interface{}, key string) int {
	v, ok := m[key]
	if !ok || v == nil {
		return 0
	}

	switch val := v.(type) {
	case int:
		return val
	case int64:
		return int(val)
	case float64:
		return int(val)
	case float32:
		return int(val)
	case string:
		if n, err := strconv.Atoi(val); err == nil {
			return n
		}
	}
	return 0
}
