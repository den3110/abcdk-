package main

import (
	"context"
	"log"

	"observer-vps/internal/observer"
)

func main() {
	if err := observer.Run(context.Background()); err != nil {
		log.Fatal(err)
	}
}
