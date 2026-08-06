package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestReduceStorageAggregatesIopsAndRanksDevices(t *testing.T) {
	previous := map[string]diskCounter{
		"sda":   {name: "sda"},
		"nvme0": {name: "nvme0"},
	}
	// Over 1s: sda does 100 reads + 20 writes = 120 IOPS; nvme0 does 400 + 100 =
	// 500 IOPS. Aggregate = 620 IOPS, and nvme0 ranks first (busiest).
	disks := []diskCounter{
		{name: "sda", reads: 100, writes: 20, ioMillis: 500, weightedIO: 1000},
		{name: "nvme0", reads: 400, writes: 100, ioMillis: 900, weightedIO: 4000},
	}
	result, _ := reduceStorage(disks, previous, 1.0)

	if result.IOPS != 620 {
		t.Fatalf("aggregate IOPS = %v, want 620", result.IOPS)
	}
	if len(result.Devices) != 2 {
		t.Fatalf("Devices len = %d, want 2", len(result.Devices))
	}
	if result.Devices[0].Name != "nvme0" || result.Devices[1].Name != "sda" {
		t.Fatalf("device order = %q,%q, want nvme0,sda (busiest first)", result.Devices[0].Name, result.Devices[1].Name)
	}
	if result.Devices[0].IOPS != 500 {
		t.Fatalf("nvme0 IOPS = %v, want 500", result.Devices[0].IOPS)
	}
	// util is the max over devices (nvme0's 0.9 > sda's 0.5).
	if result.Utilization != 0.9 {
		t.Fatalf("Utilization = %v, want 0.9 (busiest device)", result.Utilization)
	}
}

func TestReadDeviceQueueCapPrefersSpecificSource(t *testing.T) {
	write := func(base, rel, val string) {
		p := filepath.Join(base, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(val+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// SATA/SCSI queue_depth wins over everything else.
	sata := t.TempDir()
	write(sata, "device/queue_depth", "31")
	write(sata, "mq/0/nr_tags", "256")
	write(sata, "queue/nr_requests", "128")
	if got := readDeviceQueueCap(sata); got != 31 {
		t.Fatalf("SATA cap = %d, want 31 (device/queue_depth)", got)
	}

	// No SCSI attribute (NVMe): sum the per-hw-queue tags.
	nvme := t.TempDir()
	write(nvme, "mq/0/nr_tags", "1023")
	write(nvme, "mq/1/nr_tags", "1023")
	write(nvme, "queue/nr_requests", "1023")
	if got := readDeviceQueueCap(nvme); got != 2046 {
		t.Fatalf("NVMe cap = %d, want 2046 (sum of mq/*/nr_tags)", got)
	}

	// Neither queue_depth nor mq tags: fall back to nr_requests.
	basic := t.TempDir()
	write(basic, "queue/nr_requests", "64")
	if got := readDeviceQueueCap(basic); got != 64 {
		t.Fatalf("fallback cap = %d, want 64 (queue/nr_requests)", got)
	}

	// Nothing exposed: unknown rim.
	if got := readDeviceQueueCap(t.TempDir()); got != 0 {
		t.Fatalf("bare device cap = %d, want 0 (unknown)", got)
	}
}

func TestReduceStorageSplitsDeviceAndSchedulerQueue(t *testing.T) {
	previous := map[string]diskCounter{
		"sda":   {name: "sda"},
		"nvme0": {name: "nvme0"},
	}
	// Over 1s: nvme0 is the busiest by in-flight (24 vs sda's 4). aqu-sz comes
	// from weightedIO: nvme0 = 30000/1000 = 30, sda = 5000/1000 = 5.
	//   device tier   = busiest in-flight = 24, its cap = 32.
	//   scheduler tier= max(aqu-sz - in-flight) = max(30-24, 5-4) = 6.
	disks := []diskCounter{
		{name: "sda", reads: 10, weightedIO: 5000, inFlight: 4, queueCap: 32},
		{name: "nvme0", reads: 20, weightedIO: 30000, inFlight: 24, queueCap: 32},
	}
	result, _ := reduceStorage(disks, previous, 1.0)

	if result.QueueDepth != 30 {
		t.Fatalf("QueueDepth = %v, want 30 (busiest aqu-sz)", result.QueueDepth)
	}
	if result.DeviceQueue != 24 {
		t.Fatalf("DeviceQueue = %v, want 24 (busiest in-flight)", result.DeviceQueue)
	}
	if result.DeviceQueueCap != 32 {
		t.Fatalf("DeviceQueueCap = %v, want 32 (busiest device's cap)", result.DeviceQueueCap)
	}
	if result.SchedBacklog != 6 {
		t.Fatalf("SchedBacklog = %v, want 6 (aqu-sz - in-flight, busiest)", result.SchedBacklog)
	}
}

// r_await / w_await must be taken as a coherent pair from the worst-await device,
// not an independent per-direction max (which could pull the two lanes from
// different devices and make a read-vs-write comparison meaningless).
func TestReduceStorageAwaitPairsWithWorstDevice(t *testing.T) {
	previous := map[string]diskCounter{
		"sda":   {name: "sda"},
		"nvme0": {name: "nvme0"},
	}
	// sda:   await = (300+100)/(10+10)   = 20.0 ms  (r_await 30, w_await 10)
	// nvme0: await = (100+5000)/(100+100) = 25.5 ms  (r_await 1,  w_await 50)  <- WORST
	// nvme0 is the worst-await device, so both lanes must read nvme0's pair
	// (r_await 1, w_await 50). An independent per-direction max would instead
	// report r_await 30 (from sda) -- the incoherence this pairing avoids.
	disks := []diskCounter{
		{name: "sda", reads: 10, readMillis: 300, writes: 10, writeMillis: 100},
		{name: "nvme0", reads: 100, readMillis: 100, writes: 100, writeMillis: 5000},
	}
	result, _ := reduceStorage(disks, previous, 1.0)

	if result.AwaitMillis != 25.5 {
		t.Fatalf("AwaitMillis = %v, want 25.5 (worst device nvme0)", result.AwaitMillis)
	}
	if result.ReadAwaitMillis != 1 {
		t.Fatalf("ReadAwaitMillis = %v, want 1 (nvme0's r_await, not sda's 30)", result.ReadAwaitMillis)
	}
	if result.WriteAwaitMillis != 50 {
		t.Fatalf("WriteAwaitMillis = %v, want 50 (nvme0's w_await)", result.WriteAwaitMillis)
	}
}

// When no device exposes an in-flight gauge, the device tier reads zero but the
// rim (cap) still falls back to the first device that publishes queue_depth, so
// the alcove can draw the empty basin at its true height.
func TestReduceStorageDeviceCapFallsBackWhenIdle(t *testing.T) {
	previous := map[string]diskCounter{"sda": {name: "sda"}}
	disks := []diskCounter{
		{name: "sda", reads: 10, weightedIO: 2000, inFlight: 0, queueCap: 31},
	}
	result, _ := reduceStorage(disks, previous, 1.0)
	if result.DeviceQueue != 0 {
		t.Fatalf("DeviceQueue = %v, want 0 (idle)", result.DeviceQueue)
	}
	if result.DeviceQueueCap != 31 {
		t.Fatalf("DeviceQueueCap = %v, want 31 (fallback rim)", result.DeviceQueueCap)
	}
}

func TestReduceStorageCapsDeviceBank(t *testing.T) {
	previous := map[string]diskCounter{}
	disks := make([]diskCounter, 0, maxDiskDevices+2)
	for i := range maxDiskDevices + 2 {
		name := fmt.Sprintf("dev%d", i)
		previous[name] = diskCounter{name: name}
		// Higher-indexed devices are busier so ranking is unambiguous.
		disks = append(disks, diskCounter{name: name, reads: uint64((i + 1) * 10)})
	}
	result, _ := reduceStorage(disks, previous, 1.0)
	if len(result.Devices) != maxDiskDevices {
		t.Fatalf("Devices len = %d, want %d (capped)", len(result.Devices), maxDiskDevices)
	}
	// Aggregate still counts every device, not just the kept bank.
	var wantIops float64
	for i := range maxDiskDevices + 2 {
		wantIops += float64((i + 1) * 10)
	}
	if result.IOPS != wantIops {
		t.Fatalf("aggregate IOPS = %v, want %v (all devices)", result.IOPS, wantIops)
	}
}

// A modern kernel exposes the reclaim counters under BOTH spellings at once --
// by actor (pgscan_kswapd/pgscan_direct) and by type (pgscan_anon/pgscan_file) --
// and they are two partitions of the same events, summing to the same total.
// Adding all of them would double the figure and halve the derived %vmeff, so
// readScanStealCounters must pick one partition. These are real 6.8 values.
func TestReadScanStealCountersDoesNotDoubleCountBothSpellings(t *testing.T) {
	vmstat := map[string]uint64{
		"pgscan_kswapd":          11860028,
		"pgscan_direct":          455268,
		"pgscan_khugepaged":      0,
		"pgscan_direct_throttle": 0,
		"pgscan_anon":            1456692,
		"pgscan_file":            10858604,
		"pgsteal_kswapd":         10686833,
		"pgsteal_direct":         351378,
		"pgsteal_khugepaged":     0,
		"pgsteal_anon":           666043,
		"pgsteal_file":           10372168,
	}
	scan, steal := readScanStealCounters(vmstat)

	// by-actor is preferred; by-type sums to the identical total, so either answer
	// is correct -- what must NOT happen is the two being added together.
	if scan != 12315296 {
		t.Fatalf("scan = %d, want 12315296 (by-actor total, not actor+type)", scan)
	}
	if steal != 11038211 {
		t.Fatalf("steal = %d, want 11038211 (by-actor total, not actor+type)", steal)
	}
	// Guard the invariant directly: both spellings must agree on this input.
	if byType := vmstat["pgscan_anon"] + vmstat["pgscan_file"]; byType != scan {
		t.Fatalf("by-type scan %d != by-actor scan %d; fixture no longer exercises the trap", byType, scan)
	}
}

// pgscan_direct_throttle counts throttling EVENTS, not scanned pages, but it sits
// under the pgscan_direct prefix -- so a prefix sum must exclude it by name.
func TestReadScanStealCountersExcludesDirectThrottle(t *testing.T) {
	vmstat := map[string]uint64{
		"pgscan_direct":          1000,
		"pgscan_direct_throttle": 7,
		"pgsteal_direct":         400,
	}
	scan, steal := readScanStealCounters(vmstat)

	if scan != 1000 {
		t.Fatalf("scan = %d, want 1000 (throttle events excluded)", scan)
	}
	if steal != 400 {
		t.Fatalf("steal = %d, want 400", steal)
	}
}

// Pre-5.9 kernels have no anon/file split; pre-4.8 ones spell the actor counters
// per zone. Both must still produce a total.
func TestReadScanStealCountersHandlesPerZoneAndTypeOnlySpellings(t *testing.T) {
	perZone := map[string]uint64{
		"pgscan_kswapd_dma":     10,
		"pgscan_kswapd_normal":  90,
		"pgscan_direct_normal":  25,
		"pgsteal_kswapd_dma":    5,
		"pgsteal_kswapd_normal": 45,
		"pgsteal_direct_normal": 10,
	}
	scan, steal := readScanStealCounters(perZone)
	if scan != 125 || steal != 60 {
		t.Fatalf("per-zone scan/steal = %d/%d, want 125/60", scan, steal)
	}

	// Type-only: the by-actor sum is zero, so the fallback must engage.
	typeOnly := map[string]uint64{
		"pgscan_anon":  300,
		"pgscan_file":  700,
		"pgsteal_anon": 120,
		"pgsteal_file": 480,
	}
	scan, steal = readScanStealCounters(typeOnly)
	if scan != 1000 || steal != 600 {
		t.Fatalf("type-only scan/steal = %d/%d, want 1000/600", scan, steal)
	}
}
