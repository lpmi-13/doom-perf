package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestStreamTelemetryCapsConcurrentStreams(t *testing.T) {
	hub := newTelemetryHub(1)
	hub.publish([]byte("event: telemetry\ndata: {}\n\n"))
	server := httptest.NewServer(streamTelemetry(hub))
	defer server.Close()

	client := server.Client()
	client.Timeout = 2 * time.Second

	first, err := client.Get(server.URL)
	if err != nil {
		t.Fatalf("open first stream: %v", err)
	}
	defer first.Body.Close()
	if first.StatusCode != http.StatusOK {
		t.Fatalf("first stream status = %d, want %d", first.StatusCode, http.StatusOK)
	}
	if _, err := io.ReadFull(first.Body, make([]byte, len("event: telemetry\n"))); err != nil {
		t.Fatalf("read first event prefix: %v", err)
	}

	second, err := client.Get(server.URL)
	if err != nil {
		t.Fatalf("open second stream: %v", err)
	}
	defer second.Body.Close()
	if second.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("second stream status = %d, want %d", second.StatusCode, http.StatusTooManyRequests)
	}
}

func TestStreamTelemetryDoesNotSetWildcardCORS(t *testing.T) {
	hub := newTelemetryHub(1)
	hub.publish([]byte("event: telemetry\ndata: {}\n\n"))
	server := httptest.NewServer(streamTelemetry(hub))
	defer server.Close()

	client := server.Client()
	client.Timeout = 2 * time.Second
	resp, err := client.Get(server.URL)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	defer resp.Body.Close()

	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want empty", got)
	}
}
