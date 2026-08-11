package main

import (
	"log"

	"backend/engine"
)

func main() {
	srv := engine.NewServer(":8081")
	if err := srv.Start(); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
