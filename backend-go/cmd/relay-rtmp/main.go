package main

import (
	"context"
	"log"

	"backendgo/internal/programs"
)

func main() {
	if err := programs.RunRelayRTMP(context.Background()); err != nil {
		log.Fatal(err)
	}
}
