package main

import (
	"context"
	"log"

	"backendgo/internal/programs"
)

func main() {
	if err := programs.RunAPI(context.Background()); err != nil {
		log.Fatal(err)
	}
}
