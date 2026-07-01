package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestParseTCPSockets(t *testing.T) {
	// Header line + one LISTEN (state 0A, empty queues), one ESTABLISHED (state
	// 01, tx_queue=0x100=256, rx_queue=0x40=64), one TIME-WAIT (state 06, empty).
	fixture := strings.Join([]string{
		"  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
		"   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0",
		"   1: 0100007F:1F90 0100007F:C1B4 01 00000100:00000040 00:00000000 00000000  1000        0 23456 1 0000000000000000 20 4 30 10 -1",
		"   2: 0100007F:0050 0A0A0A0A:D431 06 00000000:00000000 00:00000000 00000000     0        0 34567 1 0000000000000000 20 4 30 10 -1",
	}, "\n")

	var stats tcpSocketStats
	parseTCPSockets(strings.NewReader(fixture), &stats)

	if stats.states.Total != 3 {
		t.Fatalf("Total = %d, want 3", stats.states.Total)
	}
	if stats.states.Listen != 1 || stats.states.Established != 1 || stats.states.TimeWait != 1 {
		t.Fatalf("state counts = listen %d estab %d timewait %d, want 1/1/1",
			stats.states.Listen, stats.states.Established, stats.states.TimeWait)
	}
	if stats.sendQueue != 256 || stats.recvQueue != 64 {
		t.Fatalf("queues = send %d recv %d, want 256/64", stats.sendQueue, stats.recvQueue)
	}
	if stats.backlogged != 1 {
		t.Fatalf("backlogged = %d, want 1", stats.backlogged)
	}
	if len(stats.top) != 1 {
		t.Fatalf("top len = %d, want 1", len(stats.top))
	}
	got := stats.top[0]
	if got.State != "ESTAB" || got.SendQueueBytes != 256 || got.RecvQueueBytes != 64 {
		t.Fatalf("top[0] = %+v, want ESTAB 256/64", got)
	}
	if got.Local != "127.0.0.1:8080" {
		t.Fatalf("top[0].Local = %q, want 127.0.0.1:8080", got.Local)
	}
	if got.Remote != "127.0.0.1:49588" {
		t.Fatalf("top[0].Remote = %q, want 127.0.0.1:49588", got.Remote)
	}
}

func TestFinalizeTopSocketsSortsAndCaps(t *testing.T) {
	top := []socketTelemetry{
		{Local: "a", SendQueueBytes: 10, RecvQueueBytes: 0},
		{Local: "b", SendQueueBytes: 0, RecvQueueBytes: 500},
		{Local: "c", SendQueueBytes: 200, RecvQueueBytes: 200},
	}
	got := finalizeTopSockets(top, 2)
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	// Ranked by the larger of the two queues: b (500) then c (200).
	if got[0].Local != "b" || got[1].Local != "c" {
		t.Fatalf("order = %q,%q, want b,c", got[0].Local, got[1].Local)
	}
}

func TestReduceNetworkPicksNoisiestPrimary(t *testing.T) {
	previous := map[string]netCounter{
		"eth0":  {name: "eth0", rxBytes: 1000, txBytes: 1000, speedBps: 1e9},
		"wlan0": {name: "wlan0", rxBytes: 1000, txBytes: 1000, speedBps: 1e9},
	}
	// Over 1s: eth0 gains 1200 B/s total; wlan0 gains 5020 B/s total -> wlan0 wins
	// (both above the active floor, so both are listed).
	nets := []netCounter{
		{name: "eth0", rxBytes: 2000, txBytes: 1200, speedBps: 1e9},
		{name: "wlan0", rxBytes: 6000, txBytes: 1020, speedBps: 1e9},
	}
	result, _ := reduceNetwork(nets, previous, 1.0)

	if result.PrimaryInterface != "wlan0" {
		t.Fatalf("PrimaryInterface = %q, want wlan0", result.PrimaryInterface)
	}
	if len(result.Interfaces) != 2 {
		t.Fatalf("Interfaces len = %d, want 2", len(result.Interfaces))
	}
	// Busiest first.
	if result.Interfaces[0].Name != "wlan0" {
		t.Fatalf("Interfaces[0] = %q, want wlan0 (busiest first)", result.Interfaces[0].Name)
	}
	if result.RXBytesPerSecond != 6000 {
		t.Fatalf("RXBytesPerSecond = %v, want 6000", result.RXBytesPerSecond)
	}
}

func TestReduceNetworkHidesIdleInterfaces(t *testing.T) {
	previous := map[string]netCounter{
		"eth0":        {name: "eth0", rxBytes: 1000, txBytes: 1000, speedBps: 1e9},
		"veth-busy":   {name: "veth-busy", rxBytes: 1000, txBytes: 1000, speedBps: 1e9},
		"veth-idle":   {name: "veth-idle", rxBytes: 1000, txBytes: 1000, speedBps: 1e9},
		"veth-silent": {name: "veth-silent", rxBytes: 1000, txBytes: 1000, speedBps: 1e9},
	}
	// Over 1s: eth0 +9000 B/s (primary), veth-busy +4000 B/s (above the 1 KiB floor,
	// kept), veth-idle +100 B/s and veth-silent +0 (both below the floor, hidden).
	nets := []netCounter{
		{name: "eth0", rxBytes: 6000, txBytes: 5000, speedBps: 1e9},
		{name: "veth-busy", rxBytes: 4000, txBytes: 2000, speedBps: 1e9},
		{name: "veth-idle", rxBytes: 1100, txBytes: 1000, speedBps: 1e9},
		{name: "veth-silent", rxBytes: 1000, txBytes: 1000, speedBps: 1e9},
	}
	result, _ := reduceNetwork(nets, previous, 1.0)

	if result.PrimaryInterface != "eth0" {
		t.Fatalf("PrimaryInterface = %q, want eth0", result.PrimaryInterface)
	}
	names := make([]string, 0, len(result.Interfaces))
	for _, iface := range result.Interfaces {
		names = append(names, iface.Name)
	}
	if len(names) != 2 || names[0] != "eth0" || names[1] != "veth-busy" {
		t.Fatalf("kept interfaces = %v, want [eth0 veth-busy]", names)
	}
	// The hidden interfaces still count toward the aggregate throughput.
	if result.RXBytesPerSecond != 8100 {
		t.Fatalf("aggregate RXBytesPerSecond = %v, want 8100 (all interfaces)", result.RXBytesPerSecond)
	}
}
