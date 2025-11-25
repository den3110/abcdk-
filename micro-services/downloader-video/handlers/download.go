// handlers/download.go
package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"downloadervideo/config"
	"downloadervideo/downloader"
	"downloadervideo/models"
)

type Handler struct {
	downloader *downloader.FacebookDownloader
	tasks      sync.Map
	cfg        *config.Config
}

func NewHandler(dl *downloader.FacebookDownloader, cfg *config.Config) *Handler {
	return &Handler{
		downloader: dl,
		cfg:        cfg,
	}
}

func (h *Handler) SetupRoutes() *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/download", h.rateLimit(h.handleDownload))
	mux.HandleFunc("/api/status/", h.handleStatus)
	mux.HandleFunc("/api/downloads/", h.handleDownloadFile)
	mux.HandleFunc("/health", h.handleHealth)

	return mux
}

func (h *Handler) handleDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req models.DownloadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Create task
	task := &models.DownloadTask{
		ID:        generateID(),
		Status:    "queued",
		Request:   &req,
		CreatedAt: time.Now(),
	}

	h.tasks.Store(task.ID, task)

	// Process in background
	go h.processDownload(task)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"task_id": task.ID,
		"status":  "queued",
		"message": "Download started",
	})
}

func (h *Handler) processDownload(task *models.DownloadTask) {
	task.Status = "downloading"
	h.tasks.Store(task.ID, task)

	ctx, cancel := context.WithTimeout(context.Background(), h.cfg.DownloadTimeout)
	defer cancel()

	result, err := h.downloader.DownloadVideo(ctx, task.Request)
	if err != nil {
		task.Status = "failed"
		task.Error = err.Error()
	} else {
		task.Status = "completed"
		task.Result = result
	}

	task.CompletedAt = time.Now()
	h.tasks.Store(task.ID, task)
}

func (h *Handler) handleStatus(w http.ResponseWriter, r *http.Request) {
	taskID := r.URL.Path[len("/api/status/"):]

	value, ok := h.tasks.Load(taskID)
	if !ok {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	}

	task := value.(*models.DownloadTask)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(task)
}

func (h *Handler) handleDownloadFile(w http.ResponseWriter, r *http.Request) {
	filename := r.URL.Path[len("/api/downloads/"):]

	// Security check - prevent directory traversal
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		http.Error(w, "Invalid filename", http.StatusBadRequest)
		return
	}

	filePath := filepath.Join(h.cfg.StoragePath, filename)

	// Serve file
	w.Header().Set("Content-Disposition", "attachment; filename="+filename)
	http.ServeFile(w, r, filePath)
}

func (h *Handler) rateLimit(next http.HandlerFunc) http.HandlerFunc {
	type clientLimit struct {
		count    int
		lastSeen time.Time
	}

	var (
		clients sync.Map
		mu      sync.Mutex
	)

	// Cleanup old clients
	go func() {
		for {
			time.Sleep(time.Minute)
			now := time.Now()
			clients.Range(func(key, value interface{}) bool {
				client := value.(*clientLimit)
				if now.Sub(client.lastSeen) > h.cfg.RateWindow {
					clients.Delete(key)
				}
				return true
			})
		}
	}()

	return func(w http.ResponseWriter, r *http.Request) {
		clientIP := getClientIP(r)

		mu.Lock()
		defer mu.Unlock()

		value, _ := clients.LoadOrStore(clientIP, &clientLimit{})
		client := value.(*clientLimit)

		if time.Since(client.lastSeen) > h.cfg.RateWindow {
			client.count = 0
		}

		if client.count >= h.cfg.RateLimit {
			http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
			return
		}

		client.count++
		client.lastSeen = time.Now()
		clients.Store(clientIP, client)

		next(w, r)
	}
}

// Helper functions
func generateID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}

func getClientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
		return strings.Split(ip, ",")[0]
	}
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	return r.RemoteAddr
}


func (h *Handler) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok",
		"time":   time.Now().Format(time.RFC3339),
	})
}