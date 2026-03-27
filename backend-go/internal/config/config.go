package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port                      string
	APIPort                   string
	RTMPPort                  string
	SchedulerPort             string
	WorkerRecordingExportPort string
	WorkerAICommentaryPort    string
	WorkerGeneralPort         string
	JWTSecret                 string
	MongoURI                  string
	MongoDatabase             string
	UploadsDir                string
	NodeEnv                   string
	RedisURL                  string
	ServicePrefix             string
	GraphQLDeprecationMode    string
}

func Load() (Config, error) {
	_ = godotenv.Load("backend-go/.env", ".env")

	nodeEnv := getenv("NODE_ENV", "development")
	mongoURI := resolveMongoURI(nodeEnv)
	if mongoURI == "" {
		return Config{}, fmt.Errorf("mongo uri not configured for NODE_ENV=%s", nodeEnv)
	}

	mongoDatabase, err := resolveMongoDatabase(mongoURI, os.Getenv("MONGO_DB_NAME"))
	if err != nil {
		return Config{}, err
	}

	uploadsDir, err := resolveUploadsDir(os.Getenv("UPLOADS_DIR"))
	if err != nil {
		return Config{}, err
	}

	jwtSecret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if jwtSecret == "" {
		return Config{}, errors.New("JWT_SECRET is required")
	}

	return Config{
		Port:                      getenv("BACKEND_GO_PORT", "8005"),
		APIPort:                   getenv("BACKEND_GO_PORT", "8005"),
		RTMPPort:                  getenv("BACKEND_GO_RTMP_PORT", getenv("RTMP_PORT", "5002")),
		SchedulerPort:             getenv("BACKEND_GO_SCHEDULER_PORT", "8010"),
		WorkerRecordingExportPort: getenv("BACKEND_GO_RECORDING_EXPORT_PORT", "8011"),
		WorkerAICommentaryPort:    getenv("BACKEND_GO_AI_COMMENTARY_PORT", "8012"),
		WorkerGeneralPort:         getenv("BACKEND_GO_WORKER_GENERAL_PORT", "8013"),
		JWTSecret:                 jwtSecret,
		MongoURI:                  mongoURI,
		MongoDatabase:             mongoDatabase,
		UploadsDir:                uploadsDir,
		NodeEnv:                   nodeEnv,
		RedisURL:                  resolveRedisURL(),
		ServicePrefix:             getenv("BACKEND_GO_SERVICE_PREFIX", "pickletour"),
		GraphQLDeprecationMode:    getenv("GRAPHQL_DEPRECATION_MODE", "audit"),
	}, nil
}

func getenv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func resolveMongoURI(nodeEnv string) string {
	if strings.EqualFold(nodeEnv, "production") {
		if value := strings.TrimSpace(os.Getenv("MONGO_URI_PROD")); value != "" {
			return value
		}
	}
	return strings.TrimSpace(os.Getenv("MONGO_URI"))
}

func resolveMongoDatabase(mongoURI, explicit string) (string, error) {
	if value := strings.TrimSpace(explicit); value != "" {
		return value, nil
	}

	parsed, err := url.Parse(mongoURI)
	if err != nil {
		return "", fmt.Errorf("invalid mongo uri: %w", err)
	}

	name := strings.Trim(parsed.Path, "/")
	if name == "" {
		return "", errors.New("mongo database name is missing; set MONGO_DB_NAME or include db name in uri")
	}

	return name, nil
}

func resolveRedisURL() string {
	for _, key := range []string{"REDIS_URL", "REDIS_URI"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}

	return "redis://127.0.0.1:6379/0"
}

func resolveUploadsDir(raw string) (string, error) {
	if value := strings.TrimSpace(raw); value != "" {
		return filepath.Abs(value)
	}

	projectRoot, err := detectProjectRoot()
	if err != nil {
		return "", err
	}

	return filepath.Abs(filepath.Join(projectRoot, "uploads"))
}

func detectProjectRoot() (string, error) {
	if value := strings.TrimSpace(os.Getenv("PROJECT_ROOT")); value != "" {
		return value, nil
	}

	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	if filepath.Base(cwd) == "backend-go" {
		return filepath.Dir(cwd), nil
	}

	if _, err := os.Stat(filepath.Join(cwd, "backend-go")); err == nil {
		return cwd, nil
	}

	return cwd, nil
}
