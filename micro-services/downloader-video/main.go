// main.go
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"downloadervideo/handlers"
	"downloadervideo/downloader"
	"downloadervideo/storage"
	"downloadervideo/config"
)


func main() {
	// Load configuration
	cfg := config.Load()
	
	// Initialize services
	storageSvc := storage.NewLocalStorage(cfg.StoragePath) 
	downloadSvc := downloader.NewFacebookDownloader(*storageSvc, cfg)
	handler := handlers.NewHandler(downloadSvc, cfg)
	
	// Setup HTTP server
	server := &http.Server{
		Addr:         cfg.ServerPort,
		Handler:      handler.SetupRoutes(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	
	// Start server in goroutine
	go func() {
		log.Printf("🚀 Server starting on %s", cfg.ServerPort)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()
	
	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")
	
	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	
	log.Println("Server exited")
}