package main

import (
	"backendgo/internal/programs"
	"context"
	"log"
)

func main() {
	if err := programs.RunScheduler(context.Background()); err != nil {
		log.Fatal(err)
	}
}
