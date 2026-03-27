package main

import (
	"context"
	"log"
	"time"

	"backendgo/internal/config"
	"backendgo/internal/programs"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	if err := programs.RunBackgroundCommand(context.Background(), programs.BackgroundCommandSpec{
		Name:         cfg.ServicePrefix + "-worker-general",
		Role:         "general-worker",
		Port:         cfg.WorkerGeneralPort,
		TickInterval: 45 * time.Second,
		Message:      "general worker heartbeat placeholder ready for CCCD/SEO/notification job migration",
	}); err != nil {
		log.Fatal(err)
	}
}
