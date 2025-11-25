// config/config.go
package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	ServerPort    string
	StoragePath   string
	MaxFileSize   int64
	MaxConcurrent int
	RateLimit     int
	RateWindow    time.Duration
	DownloadTimeout time.Duration
}

func Load() *Config {
	return &Config{
		ServerPort:    getEnv("PORT", ":8001"),
		StoragePath:   getEnv("STORAGE_PATH", "./downloads"),
		MaxFileSize:   getEnvAsInt64("MAX_FILE_SIZE", 500*1024*1024), // 500MB
		MaxConcurrent: getEnvAsInt("MAX_CONCURRENT", 5),
		RateLimit:     getEnvAsInt("RATE_LIMIT", 100),
		RateWindow:    time.Minute * 10,
		DownloadTimeout: time.Minute * 15,
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvAsInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func getEnvAsInt64(key string, defaultValue int64) int64 {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.ParseInt(value, 10, 64); err == nil {
			return intValue
		}
	}
	return defaultValue
}