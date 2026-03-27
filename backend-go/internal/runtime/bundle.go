package runtime

import (
	"context"
	"fmt"
	"time"

	"backendgo/internal/config"
	mongox "backendgo/internal/infra/mongo"

	"go.mongodb.org/mongo-driver/mongo"
)

type Bundle struct {
	Config      config.Config
	MongoClient *mongo.Client
	Database    *mongo.Database
	StartedAt   time.Time
}

func Bootstrap(ctx context.Context) (*Bundle, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	connectCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	client, database, err := mongox.Connect(connectCtx, cfg.MongoURI, cfg.MongoDatabase)
	if err != nil {
		return nil, fmt.Errorf("connect mongo: %w", err)
	}

	return &Bundle{
		Config:      cfg,
		MongoClient: client,
		Database:    database,
		StartedAt:   time.Now().UTC(),
	}, nil
}

func (b *Bundle) Close(ctx context.Context) error {
	if b == nil || b.MongoClient == nil {
		return nil
	}
	return b.MongoClient.Disconnect(ctx)
}
