package observer

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	NodeEnv              string
	BindHost             string
	Port                 string
	MongoURI             string
	MongoDatabase        string
	APIKey               string
	ReadAPIKey           string
	JWTSecret            string
	EventTTLDays         int
	RuntimeTTLDays       int
	BackupTTLDays        int
	LiveDeviceTTLDays    int
	LiveDeviceStaleMs    int
	LiveDeviceSourceName string
}

func LoadConfig() (Config, error) {
	_ = godotenv.Load("observer-vps/.env", ".env")

	nodeEnv := getenv("NODE_ENV", "production")
	mongoURI := resolveMongoURI(nodeEnv)
	if mongoURI == "" {
		return Config{}, fmt.Errorf("mongo uri not configured for NODE_ENV=%s", nodeEnv)
	}

	mongoDatabase, err := resolveMongoDatabase(mongoURI, os.Getenv("MONGO_DB_NAME"))
	if err != nil {
		return Config{}, err
	}

	apiKey := strings.TrimSpace(os.Getenv("OBSERVER_API_KEY"))
	if apiKey == "" {
		return Config{}, errors.New("OBSERVER_API_KEY is required")
	}

	readKey := strings.TrimSpace(os.Getenv("OBSERVER_READ_API_KEY"))
	if readKey == "" {
		readKey = apiKey
	}

	return Config{
		NodeEnv:              nodeEnv,
		BindHost:             getenv("OBSERVER_BIND_HOST", "0.0.0.0"),
		Port:                 getenv("OBSERVER_PORT", getenv("PORT", "8787")),
		MongoURI:             mongoURI,
		MongoDatabase:        mongoDatabase,
		APIKey:               apiKey,
		ReadAPIKey:           readKey,
		JWTSecret:            strings.TrimSpace(os.Getenv("JWT_SECRET")),
		EventTTLDays:         getenvInt("OBSERVER_EVENT_TTL_DAYS", 7),
		RuntimeTTLDays:       getenvInt("OBSERVER_RUNTIME_TTL_DAYS", 14),
		BackupTTLDays:        getenvInt("OBSERVER_BACKUP_TTL_DAYS", 60),
		LiveDeviceTTLDays:    getenvInt("OBSERVER_LIVE_DEVICE_TTL_DAYS", 3),
		LiveDeviceStaleMs:    getenvInt("OBSERVER_LIVE_DEVICE_STALE_MS", 30_000),
		LiveDeviceSourceName: getenv("OBSERVER_LIVE_DEVICE_SOURCE_NAME", "pickletour-live-app"),
	}, nil
}

func getenv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func getenvInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
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
