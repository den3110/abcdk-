// micro-services/uploadservice/main.go
package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
)

// ✅ Hàm tìm base directory (uploads cùng cấp micro-services)
func getUploadsBaseDir() string {
	// Ưu tiên env variable
	if dir := os.Getenv("UPLOADS_DIR"); dir != "" {
		return dir
	}

	// Fallback: tính từ executable location
	// /abcdk-/micro-services/uploadservice/uploadservice
	// → /abcdk-/uploads
	ex, err := os.Executable()
	if err != nil {
		log.Fatal("Cannot get executable path:", err)
	}

	// /abcdk-/micro-services/uploadservice/uploadservice
	// → /abcdk-/micro-services/uploadservice
	exDir := filepath.Dir(ex)

	// → /abcdk-/micro-services
	microServicesDir := filepath.Dir(exDir)

	// → /abcdk-
	projectRoot := filepath.Dir(microServicesDir)

	// → /abcdk-/uploads
	uploadsDir := filepath.Join(projectRoot, "uploads")

	log.Printf("📁 Uploads base dir: %s", uploadsDir)
	return uploadsDir
}

func saveChunk(c *gin.Context) {
	start := time.Now()

	// Parse form
	matchId := c.PostForm("matchId")
	chunkIndex := c.PostForm("chunkIndex")
	isFinal := c.PostForm("isFinal")

	if matchId == "" {
		c.JSON(400, gin.H{"error": "matchId required"})
		return
	}

	// Get file
	file, err := c.FormFile("file")
	if err != nil {
		log.Print(err)
		c.JSON(400, gin.H{"error": "no file"})
		return
	}

	// ✅ Create directory: /abcdk-/uploads/recordings/{matchId}/
	baseDir := getUploadsBaseDir()
	matchDir := filepath.Join(baseDir, "recordings", matchId)

	if err := os.MkdirAll(matchDir, 0755); err != nil {
		log.Printf("❌ mkdir failed: %v", err)
		c.JSON(500, gin.H{"error": "mkdir failed", "detail": err.Error()})
		return
	}

	// Generate filename
	filename := fmt.Sprintf("chunk_%s.mp4", chunkIndex)
	savePath := filepath.Join(matchDir, filename)

	// ✅ STREAM to disk (không buffer vào memory)
	src, err := file.Open()
	if err != nil {
		c.JSON(500, gin.H{"error": "cannot open file"})
		return
	}
	defer src.Close()

	dst, err := os.Create(savePath)
	if err != nil {
		log.Printf("❌ create file failed: %v", err)
		c.JSON(500, gin.H{"error": "cannot create file", "detail": err.Error()})
		return
	}
	defer dst.Close()

	// Stream with 32KB buffer
	written, err := io.Copy(dst, src)
	if err != nil {
		log.Printf("❌ write failed: %v", err)
		c.JSON(500, gin.H{"error": "write failed", "detail": err.Error()})
		return
	}

	duration := time.Since(start)
	speedMBps := float64(written) / (1024 * 1024) / duration.Seconds()

	log.Printf("✅ Saved: match=%s, chunk=%s, size=%.2fMB, speed=%.2fMB/s, path=%s",
		matchId, chunkIndex, float64(written)/(1024*1024), speedMBps, savePath)

	// ✅ Return info cho Node.js (THÊM matchId)
	c.JSON(200, gin.H{
		"ok":            true,
		"matchId":       matchId, // ← THÊM DÒN NÀY
		"filePath":      savePath,
		"fileSizeBytes": written,
		"fileSizeMB":    float64(written) / (1024 * 1024),
		"chunkIndex":    chunkIndex,
		"isFinal":       isFinal == "1" || isFinal == "true",
		"durationMs":    duration.Milliseconds(),
	})
}

func healthCheck(c *gin.Context) {
	uploadsDir := getUploadsBaseDir()

	// Check if uploads dir exists and writable
	testFile := filepath.Join(uploadsDir, ".health_check")
	canWrite := true
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		canWrite = false
	} else {
		if f, err := os.Create(testFile); err != nil {
			canWrite = false
		} else {
			f.Close()
			os.Remove(testFile)
		}
	}

	c.JSON(200, gin.H{
		"status":     "ok",
		"service":    "upload",
		"uptime":     time.Since(startTime).String(),
		"uploadsDir": uploadsDir,
		"canWrite":   canWrite,
	})
}

var startTime = time.Now()

func main() {
	// ✅ Kiểm tra uploads dir ngay khi start
	uploadsDir := getUploadsBaseDir()
	recordingsDir := filepath.Join(uploadsDir, "recordings")

	if err := os.MkdirAll(recordingsDir, 0755); err != nil {
		log.Fatalf("❌ Cannot create uploads directory: %v", err)
	}

	log.Printf("✅ Uploads directory ready: %s", recordingsDir)

	// ✅ Lấy port trước để dùng trong route index
	port := os.Getenv("UPLOAD_SERVICE_PORT")
	if port == "" {
		port = "8004"
	}

	r := gin.Default()

	// Limit buffer size
	r.MaxMultipartMemory = 8 << 20 // 8MB max

	// CORS (production nên bỏ hoặc limit origin)
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Next()
	})

	// ✅ Route index
	r.GET("/", func(c *gin.Context) {
		c.String(200, fmt.Sprintf("server run on port %s", port))
	})

	r.GET("/health", healthCheck)
	r.POST("/save-chunk", saveChunk)
	r.POST("/chunk", saveChunk)

	log.Printf("🚀 Upload service starting on :%s", port)
	if err := r.Run("127.0.0.1:" + port); err != nil {
		log.Fatal(err)
	}
}
