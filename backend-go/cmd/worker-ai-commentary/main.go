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
		Name:         cfg.ServicePrefix + "-worker-ai-commentary",
		Role:         "ai-commentary",
		Port:         cfg.WorkerAICommentaryPort,
		TickInterval: 30 * time.Second,
		Message:      "AI commentary worker heartbeat placeholder ready for Node queue cutover",
	}); err != nil {
		log.Fatal(err)
	}
}
