package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const sampleInterval = time.Second
const defaultMaxTelemetryStreams = 64

// netIfaceActiveBytesPerSecond is the rx+tx floor for an interface to appear in
// the per-interface list. It hides the swarm of idle virtual interfaces (veth*,
// etc.) a container host carries, keeping the network terminal short and
// meaningful. The aggregate totals and primary-interface pick still see every
// interface; the primary is always shown even when quiet.
const netIfaceActiveBytesPerSecond = 1024.0

type resourceUSE struct {
	Utilization float64 `json:"utilization"`
	Saturation  float64 `json:"saturation"`
	Errors      float64 `json:"errors"`
}

type cpuTelemetry struct {
	resourceUSE
	Load1                    float64            `json:"load1"`
	Load5                    float64            `json:"load5"`
	Load15                   float64            `json:"load15"`
	RunQueue                 int                `json:"runQueue"`
	Blocked                  int                `json:"blocked"`
	RunQueuePressure         float64            `json:"runQueuePressure"`
	LoadPressure             float64            `json:"loadPressure"`
	LogicalCPUs              int                `json:"logicalCpus"`
	User                     float64            `json:"user"`
	System                   float64            `json:"system"`
	Idle                     float64            `json:"idle"`
	IOWait                   float64            `json:"iowait"`
	Steal                    float64            `json:"steal"`
	ContextSwitchesPerSecond float64            `json:"contextSwitchesPerSecond"`
	InterruptsPerSecond      float64            `json:"interruptsPerSecond"`
	Cores                    []cpuCoreTelemetry `json:"cores"`
}

type cpuCoreTelemetry struct {
	ID          int     `json:"id"`
	Utilization float64 `json:"utilization"`
	User        float64 `json:"user"`
	System      float64 `json:"system"`
	Idle        float64 `json:"idle"`
	IOWait      float64 `json:"iowait"`
	Steal       float64 `json:"steal"`
}

type memoryTelemetry struct {
	resourceUSE
	TotalBytes            uint64  `json:"totalBytes"`
	AvailableBytes        uint64  `json:"availableBytes"`
	FreeBytes             uint64  `json:"freeBytes"`
	BuffersBytes          uint64  `json:"buffersBytes"`
	CachedBytes           uint64  `json:"cachedBytes"`
	SwapTotalBytes        uint64  `json:"swapTotalBytes"`
	SwapFreeBytes         uint64  `json:"swapFreeBytes"`
	SwapUsedBytes         uint64  `json:"swapUsedBytes"`
	SwapPagesPerSecond    float64 `json:"swapPagesPerSecond"`
	SwapInPagesPerSecond  float64 `json:"swapInPagesPerSecond"`
	SwapOutPagesPerSecond float64 `json:"swapOutPagesPerSecond"`
	MinorFaultsPerSecond  float64 `json:"minorFaultsPerSecond"`
	MajorFaultsPerSecond  float64 `json:"majorFaultsPerSecond"`
	// PressureAvailable is false on kernels without /proc/pressure/memory (no PSI /
	// CONFIG_PSI), so a consumer can distinguish "no reclaim stalls" from "this
	// host can't report pressure at all" rather than reading the zeroed fields.
	PressureAvailable  bool                  `json:"pressureAvailable"`
	PressureSomeAvg10  float64               `json:"pressureSomeAvg10"`
	PressureSomeAvg60  float64               `json:"pressureSomeAvg60"`
	PressureSomeAvg300 float64               `json:"pressureSomeAvg300"`
	PressureSomeTotal  uint64                `json:"pressureSomeTotal"`
	PressureFullAvg10  float64               `json:"pressureFullAvg10"`
	PressureFullAvg60  float64               `json:"pressureFullAvg60"`
	PressureFullAvg300 float64               `json:"pressureFullAvg300"`
	PressureFullTotal  uint64                `json:"pressureFullTotal"`
	OOMKills           uint64                `json:"oomKills"`
	OOMKillsPerSecond  float64               `json:"oomKillsPerSecond"`
	TopRSS             []rssProcessTelemetry `json:"topRss,omitempty"`
}

type rssProcessTelemetry struct {
	PID      int    `json:"pid"`
	RSSBytes uint64 `json:"rssBytes"`
	Command  string `json:"command"`
	// OOMScore is the kernel's current OOM "badness" for the process
	// (/proc/<pid>/oom_score, ~0..1000). Higher means the OOM killer is more
	// likely to pick it next, so it doubles as a "closeness to being killed".
	OOMScore int `json:"oomScore"`
}

type pressureLineTelemetry struct {
	Avg10  float64
	Avg60  float64
	Avg300 float64
	Total  uint64
}

type storageTelemetry struct {
	resourceUSE
	QueueDepth          float64 `json:"queueDepth"`
	AwaitMillis         float64 `json:"awaitMillis"`
	ReadBytesPerSecond  float64 `json:"readBytesPerSecond"`
	WriteBytesPerSecond float64 `json:"writeBytesPerSecond"`
	// IOPS is the aggregate completed-operations rate (reads+writes/s) across all
	// real block devices; Devices carries the per-device breakdown (busiest first)
	// that feeds the per-device IOPS counter bank and its `iostat -x` terminal.
	IOPS    float64               `json:"iops"`
	Devices []diskDeviceTelemetry `json:"devices,omitempty"`
	// Root-filesystem capacity (`df /`): the disk-usage cistern. UsedRatio matches
	// df's capacity% (reserved blocks excluded from the denominator).
	UsedBytes  uint64  `json:"usedBytes"`
	TotalBytes uint64  `json:"totalBytes"`
	AvailBytes uint64  `json:"availBytes"`
	UsedRatio  float64 `json:"usedRatio"`
}

type diskDeviceTelemetry struct {
	Name        string  `json:"name"`
	IOPS        float64 `json:"iops"`
	Utilization float64 `json:"utilization"`
}

type networkTelemetry struct {
	resourceUSE
	RXBytesPerSecond float64 `json:"rxBytesPerSecond"`
	TXBytesPerSecond float64 `json:"txBytesPerSecond"`
	DropsPerSecond   float64 `json:"dropsPerSecond"`
	ErrorsPerSecond  float64 `json:"errorsPerSecond"`
	// PrimaryInterface is the noisiest real NIC this sample (highest rx+tx); the
	// packet grove binds to it so the in-world lanes track the main interface
	// rather than the aggregate. Interfaces carries the per-NIC breakdown (busiest
	// first) that feeds the `sar -n DEV`-style interface terminal.
	PrimaryInterface string                  `json:"primaryInterface,omitempty"`
	Interfaces       []netInterfaceTelemetry `json:"interfaces,omitempty"`
	// TCP socket census + send/recv-queue backlog from /proc/net/tcp{,6}: the
	// socket-state patch panel and the SendQ/RecvQ standpipe instruments.
	TCP               tcpStateTelemetry `json:"tcp"`
	SendQueueBytes    uint64            `json:"sendQueueBytes"`
	RecvQueueBytes    uint64            `json:"recvQueueBytes"`
	BackloggedSockets int               `json:"backloggedSockets"`
	TopSockets        []socketTelemetry `json:"topSockets,omitempty"`
}

type netInterfaceTelemetry struct {
	Name             string  `json:"name"`
	RXBytesPerSecond float64 `json:"rxBytesPerSecond"`
	TXBytesPerSecond float64 `json:"txBytesPerSecond"`
}

// tcpStateTelemetry counts sockets by TCP state (the `ss -tan state ...` /
// `ss -s` census). The USE read is connection load: a healthy server holds many
// ESTABLISHED; a pile of TIME-WAIT / SYN-RECV / CLOSE-WAIT is a leak or backlog.
type tcpStateTelemetry struct {
	Established uint64 `json:"established"`
	SynSent     uint64 `json:"synSent"`
	SynRecv     uint64 `json:"synRecv"`
	FinWait1    uint64 `json:"finWait1"`
	FinWait2    uint64 `json:"finWait2"`
	TimeWait    uint64 `json:"timeWait"`
	Close       uint64 `json:"close"`
	CloseWait   uint64 `json:"closeWait"`
	LastAck     uint64 `json:"lastAck"`
	Listen      uint64 `json:"listen"`
	Closing     uint64 `json:"closing"`
	Total       uint64 `json:"total"`
}

// socketTelemetry is one backlogged socket for the SendQ/RecvQ terminal's
// `ss -tmn`-style top list (only sockets with a non-empty queue are kept).
type socketTelemetry struct {
	Local          string `json:"local"`
	Remote         string `json:"remote"`
	State          string `json:"state"`
	SendQueueBytes uint64 `json:"sendQueueBytes"`
	RecvQueueBytes uint64 `json:"recvQueueBytes"`
}

type telemetry struct {
	Timestamp     int64            `json:"timestamp"`
	Host          string           `json:"host"`
	Health        float64          `json:"health"`
	UptimeSeconds float64          `json:"uptimeSeconds"`
	CPU           cpuTelemetry     `json:"cpu"`
	Memory        memoryTelemetry  `json:"memory"`
	Storage       storageTelemetry `json:"storage"`
	Network       networkTelemetry `json:"network"`
}

type cpuCounter struct {
	total      uint64
	idle       uint64 // idle + iowait, used for utilization
	userTime   uint64 // user + nice
	systemTime uint64 // system + irq + softirq
	idleTime   uint64 // idle only
	iowaitTime uint64
	stealTime  uint64
}

type cpuCoreCounter struct {
	id int
	cpuCounter
}

type diskCounter struct {
	name         string
	reads        uint64
	readSectors  uint64
	readMillis   uint64
	writes       uint64
	writeSectors uint64
	writeMillis  uint64
	ioMillis     uint64
	weightedIO   uint64
}

type netCounter struct {
	name     string
	rxBytes  uint64
	rxErrors uint64
	rxDrops  uint64
	txBytes  uint64
	txErrors uint64
	txDrops  uint64
	speedBps float64
}

type sampler struct {
	lastAt    time.Time
	cpu       cpuCounter
	cpuCores  map[int]cpuCounter
	disk      map[string]diskCounter
	net       map[string]netCounter
	swapPages uint64
	swapIn    uint64
	swapOut   uint64
	minFaults uint64
	majFaults uint64
	oomKills  uint64
	ctxt      uint64
	intr      uint64
}

type telemetryHub struct {
	mu          sync.Mutex
	maxStreams  int
	subscribers map[chan []byte]struct{}
	latest      []byte
	sampler     sampler
}

func main() {
	addr := os.Getenv("DOOM_TELEMETRY_ADDR")
	if addr == "" {
		addr = "127.0.0.1:9999"
	}

	hub := newTelemetryHub(telemetryStreamLimit())
	hub.start(context.Background())

	mux := http.NewServeMux()
	mux.HandleFunc("/telemetry", streamTelemetry(hub))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 3 * time.Second,
	}

	log.Printf("telemetry SSE listening on http://%s/telemetry", addr)
	err := server.ListenAndServe()
	if !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func telemetryStreamLimit() int {
	raw := strings.TrimSpace(os.Getenv("DOOM_TELEMETRY_MAX_STREAMS"))
	if raw == "" {
		return defaultMaxTelemetryStreams
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 {
		log.Printf("invalid DOOM_TELEMETRY_MAX_STREAMS=%q; using %d", raw, defaultMaxTelemetryStreams)
		return defaultMaxTelemetryStreams
	}
	return limit
}

func newTelemetryHub(maxStreams int) *telemetryHub {
	if maxStreams < 1 {
		maxStreams = defaultMaxTelemetryStreams
	}
	return &telemetryHub{
		maxStreams:  maxStreams,
		subscribers: make(map[chan []byte]struct{}),
		sampler: sampler{
			cpuCores: make(map[int]cpuCounter),
			disk:     make(map[string]diskCounter),
			net:      make(map[string]netCounter),
		},
	}
}

func (h *telemetryHub) start(ctx context.Context) {
	go func() {
		h.sampleAndPublish()
		ticker := time.NewTicker(sampleInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.sampleAndPublish()
			}
		}
	}()
}

func (h *telemetryHub) subscribe() (<-chan []byte, func(), bool) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if len(h.subscribers) >= h.maxStreams {
		return nil, nil, false
	}

	events := make(chan []byte, 2)
	h.subscribers[events] = struct{}{}
	if h.latest != nil {
		events <- h.latest
	}

	var once sync.Once
	unsubscribe := func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			if _, ok := h.subscribers[events]; ok {
				delete(h.subscribers, events)
				close(events)
			}
		})
	}
	return events, unsubscribe, true
}

func (h *telemetryHub) publish(event []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()

	next := append([]byte(nil), event...)
	h.latest = next
	for events := range h.subscribers {
		select {
		case events <- next:
		default:
			select {
			case <-events:
			default:
			}
			select {
			case events <- next:
			default:
			}
		}
	}
}

func (h *telemetryHub) sampleAndPublish() {
	snapshot, err := h.sampler.sample(time.Now())
	if err != nil {
		log.Printf("telemetry sample failed: %v", err)
		return
	}

	payload, err := json.Marshal(snapshot)
	if err != nil {
		log.Printf("telemetry encoding failed: %v", err)
		return
	}

	h.publish([]byte(fmt.Sprintf("event: telemetry\ndata: %s\n\n", payload)))
}

func streamTelemetry(hub *telemetryHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		events, unsubscribe, ok := hub.subscribe()
		if !ok {
			http.Error(w, "too many telemetry streams", http.StatusTooManyRequests)
			return
		}
		defer unsubscribe()

		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("X-Accel-Buffering", "no")

		for {
			select {
			case <-r.Context().Done():
				return
			case event, ok := <-events:
				if !ok {
					return
				}
				if _, err := w.Write(event); err != nil {
					return
				}
				flusher.Flush()
			}
		}
	}
}

func (s *sampler) sample(now time.Time) (telemetry, error) {
	host, _ := os.Hostname()
	elapsed := now.Sub(s.lastAt).Seconds()
	if elapsed <= 0 {
		elapsed = sampleInterval.Seconds()
	}

	cpu, cpuCores, err := readCPUCounters()
	if err != nil {
		return telemetry{}, err
	}
	load1, load5, load15, runQueue := readLoad()
	logicalCPUs := max(len(cpuCores), max(runtime.NumCPU(), 1))
	cpuUtil := cpuUtilization(cpu, s.cpu)
	cpuUser, cpuSystem, cpuIdle, cpuIOWait, cpuSteal := cpuBreakdown(cpu, s.cpu)
	statExtras, _ := readKeyValues("/proc/stat")
	blocked := int(statExtras["procs_blocked"])
	ctxt := statExtras["ctxt"]
	intr := statExtras["intr"]
	ctxtRate := counterRate(ctxt, s.ctxt, elapsed)
	intrRate := counterRate(intr, s.intr, elapsed)
	coreTelemetry := make([]cpuCoreTelemetry, 0, len(cpuCores))
	currentCPUCores := make(map[int]cpuCounter, len(cpuCores))
	for _, core := range cpuCores {
		prev := s.cpuCores[core.id]
		currentCPUCores[core.id] = core.cpuCounter
		coreUser, coreSystem, coreIdle, coreIOWait, coreSteal := cpuBreakdown(core.cpuCounter, prev)
		coreTelemetry = append(coreTelemetry, cpuCoreTelemetry{
			ID:          core.id,
			Utilization: cpuUtilization(core.cpuCounter, prev),
			User:        coreUser,
			System:      coreSystem,
			Idle:        coreIdle,
			IOWait:      coreIOWait,
			Steal:       coreSteal,
		})
	}
	runQueuePressure := clamp(float64(max(runQueue-logicalCPUs, 0)) / float64(logicalCPUs))
	loadPressure := clamp(maxFloat(load1-float64(logicalCPUs), 0) / float64(logicalCPUs))
	cpuSaturation := maxFloat(runQueuePressure, loadPressure)

	meminfo, err := readKeyValues("/proc/meminfo")
	if err != nil {
		return telemetry{}, err
	}
	vmstat, err := readKeyValues("/proc/vmstat")
	if err != nil {
		return telemetry{}, err
	}
	memTotal := meminfo["MemTotal"] * 1024
	memAvailable := meminfo["MemAvailable"] * 1024
	if memAvailable == 0 {
		memAvailable = meminfo["MemFree"] * 1024
	}
	memUtil := 0.0
	if memTotal > 0 {
		memUtil = clamp(1 - float64(memAvailable)/float64(memTotal))
	}
	memFree := meminfo["MemFree"] * 1024
	memBuffers := meminfo["Buffers"] * 1024
	memCached := meminfo["Cached"] * 1024
	swapTotal := meminfo["SwapTotal"] * 1024
	swapFree := meminfo["SwapFree"] * 1024
	swapUsed := uint64(0)
	if swapTotal > swapFree {
		swapUsed = swapTotal - swapFree
	}
	swapInPages := vmstat["pswpin"]
	swapOutPages := vmstat["pswpout"]
	swapPages := swapInPages + swapOutPages
	oomKills := vmstat["oom_kill"]
	swapRate := counterRate(swapPages, s.swapPages, elapsed)
	swapInRate := counterRate(swapInPages, s.swapIn, elapsed)
	swapOutRate := counterRate(swapOutPages, s.swapOut, elapsed)
	oomRate := counterRate(oomKills, s.oomKills, elapsed)
	// Page faults from /proc/vmstat: pgmajfault needed a disk/swap read (a real
	// saturation signal), the remaining pgfault are minor faults served from RAM
	// (workload context). Guard the subtraction against a counter reset.
	majFaults := vmstat["pgmajfault"]
	totalFaults := vmstat["pgfault"]
	minFaults := uint64(0)
	if totalFaults > majFaults {
		minFaults = totalFaults - majFaults
	}
	minFaultRate := counterRate(minFaults, s.minFaults, elapsed)
	majFaultRate := counterRate(majFaults, s.majFaults, elapsed)
	psiSome, psiFull, psiAvailable := readPressure("/proc/pressure/memory")
	topRSS := readTopRSSProcesses(5)
	// Major faults contribute to saturation (thrashing refaults from disk/swap);
	// ~200 majflt/s reads as fully saturated, alongside swap churn and PSI.
	memSaturation := clamp(maxFloat(swapRate/2500, maxFloat(majFaultRate/200, maxFloat(psiSome.Avg10/100, maxFloat(psiFull.Avg10/20, maxFloat(memUtil-0.90, 0)*5)))))
	memErrors := clamp(oomRate)

	storage, disks, err := sampleStorage(s.disk, elapsed)
	if err != nil {
		return telemetry{}, err
	}
	network, nets, err := sampleNetwork(s.net, elapsed)
	if err != nil {
		return telemetry{}, err
	}
	tcp := readTCPSockets(5)
	network.TCP = tcp.states
	network.SendQueueBytes = tcp.sendQueue
	network.RecvQueueBytes = tcp.recvQueue
	network.BackloggedSockets = tcp.backlogged
	network.TopSockets = tcp.top

	s.lastAt = now
	s.cpu = cpu
	s.cpuCores = currentCPUCores
	s.swapPages = swapPages
	s.swapIn = swapInPages
	s.swapOut = swapOutPages
	s.minFaults = minFaults
	s.majFaults = majFaults
	s.oomKills = oomKills
	s.ctxt = ctxt
	s.intr = intr
	s.disk = disks
	s.net = nets

	worst := maxFloat(
		resourceSeverity(cpuUtil, cpuSaturation, 0),
		resourceSeverity(memUtil, memSaturation, memErrors),
		resourceSeverity(storage.Utilization, storage.Saturation, storage.Errors),
		resourceSeverity(network.Utilization, network.Saturation, network.Errors),
	)

	return telemetry{
		Timestamp:     now.UnixMilli(),
		Host:          host,
		Health:        clamp(1 - worst),
		UptimeSeconds: readUptime(),
		CPU: cpuTelemetry{
			resourceUSE:              resourceUSE{Utilization: cpuUtil, Saturation: cpuSaturation},
			Load1:                    load1,
			Load5:                    load5,
			Load15:                   load15,
			RunQueue:                 runQueue,
			Blocked:                  blocked,
			RunQueuePressure:         runQueuePressure,
			LoadPressure:             loadPressure,
			LogicalCPUs:              logicalCPUs,
			User:                     cpuUser,
			System:                   cpuSystem,
			Idle:                     cpuIdle,
			IOWait:                   cpuIOWait,
			Steal:                    cpuSteal,
			ContextSwitchesPerSecond: ctxtRate,
			InterruptsPerSecond:      intrRate,
			Cores:                    coreTelemetry,
		},
		Memory: memoryTelemetry{
			resourceUSE:           resourceUSE{Utilization: memUtil, Saturation: memSaturation, Errors: memErrors},
			TotalBytes:            memTotal,
			AvailableBytes:        memAvailable,
			FreeBytes:             memFree,
			BuffersBytes:          memBuffers,
			CachedBytes:           memCached,
			SwapTotalBytes:        swapTotal,
			SwapFreeBytes:         swapFree,
			SwapUsedBytes:         swapUsed,
			SwapPagesPerSecond:    swapRate,
			SwapInPagesPerSecond:  swapInRate,
			SwapOutPagesPerSecond: swapOutRate,
			MinorFaultsPerSecond:  minFaultRate,
			MajorFaultsPerSecond:  majFaultRate,
			PressureAvailable:     psiAvailable,
			PressureSomeAvg10:     psiSome.Avg10,
			PressureSomeAvg60:     psiSome.Avg60,
			PressureSomeAvg300:    psiSome.Avg300,
			PressureSomeTotal:     psiSome.Total,
			PressureFullAvg10:     psiFull.Avg10,
			PressureFullAvg60:     psiFull.Avg60,
			PressureFullAvg300:    psiFull.Avg300,
			PressureFullTotal:     psiFull.Total,
			OOMKills:              oomKills,
			OOMKillsPerSecond:     oomRate,
			TopRSS:                topRSS,
		},
		Storage: storage,
		Network: network,
	}, nil
}

func readPressure(path string) (some, full pressureLineTelemetry, available bool) {
	content, err := os.ReadFile(path)
	if err != nil {
		return some, full, false
	}
	available = true
	for _, line := range strings.Split(string(content), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		var pressure pressureLineTelemetry
		for _, field := range fields[1:] {
			if value, ok := strings.CutPrefix(field, "avg10="); ok {
				pressure.Avg10, _ = strconv.ParseFloat(value, 64)
				continue
			}
			if value, ok := strings.CutPrefix(field, "avg60="); ok {
				pressure.Avg60, _ = strconv.ParseFloat(value, 64)
				continue
			}
			if value, ok := strings.CutPrefix(field, "avg300="); ok {
				pressure.Avg300, _ = strconv.ParseFloat(value, 64)
				continue
			}
			if value, ok := strings.CutPrefix(field, "total="); ok {
				pressure.Total, _ = strconv.ParseUint(value, 10, 64)
			}
		}
		switch fields[0] {
		case "some":
			some = pressure
		case "full":
			full = pressure
		}
	}
	return some, full, available
}

func readTopRSSProcesses(limit int) []rssProcessTelemetry {
	if limit <= 0 {
		return nil
	}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}

	var processes []rssProcessTelemetry
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid <= 0 {
			continue
		}
		rssKB, name := readProcStatus(pid)
		if rssKB == 0 {
			continue
		}
		command := readProcCommand(pid)
		if command == "" {
			command = name
		}
		processes = append(processes, rssProcessTelemetry{
			PID:      pid,
			RSSBytes: rssKB * 1024,
			Command:  command,
			OOMScore: readProcOomScore(pid),
		})
	}

	for i := 1; i < len(processes); i++ {
		current := processes[i]
		j := i - 1
		for j >= 0 && processes[j].RSSBytes < current.RSSBytes {
			processes[j+1] = processes[j]
			j--
		}
		processes[j+1] = current
	}
	if len(processes) > limit {
		processes = processes[:limit]
	}
	return processes
}

func readProcStatus(pid int) (rssKB uint64, name string) {
	content, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return 0, ""
	}
	for _, line := range strings.Split(string(content), "\n") {
		if value, ok := strings.CutPrefix(line, "Name:"); ok {
			name = strings.TrimSpace(value)
			continue
		}
		if value, ok := strings.CutPrefix(line, "VmRSS:"); ok {
			fields := strings.Fields(value)
			if len(fields) > 0 {
				rssKB, _ = strconv.ParseUint(fields[0], 10, 64)
			}
		}
	}
	return rssKB, name
}

// readProcOomScore reads the kernel's current OOM badness for a process from
// /proc/<pid>/oom_score (a single integer, ~0..1000). It is the heuristic the
// OOM killer uses to choose a victim, so a rising value means the process is
// closer to being killed. Missing/unreadable (e.g. the process exited) -> 0.
func readProcOomScore(pid int) int {
	content, err := os.ReadFile(fmt.Sprintf("/proc/%d/oom_score", pid))
	if err != nil {
		return 0
	}
	score, err := strconv.Atoi(strings.TrimSpace(string(content)))
	if err != nil || score < 0 {
		return 0
	}
	return score
}

func readProcCommand(pid int) string {
	content, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	if err != nil {
		return ""
	}
	parts := strings.Split(strings.TrimRight(string(content), "\x00"), "\x00")
	var fields []string
	for _, part := range parts {
		if part != "" {
			fields = append(fields, part)
		}
	}
	command := strings.Join(fields, " ")
	if len(command) > 80 {
		return command[:77] + "..."
	}
	return command
}

func readCPUCounters() (cpuCounter, []cpuCoreCounter, error) {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return cpuCounter{}, nil, err
	}
	defer file.Close()

	var aggregate cpuCounter
	var hasAggregate bool
	var cores []cpuCoreCounter
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 0 || !strings.HasPrefix(fields[0], "cpu") {
			continue
		}

		counter, err := cpuCounterFromFields(fields)
		if err != nil {
			return cpuCounter{}, nil, err
		}
		if fields[0] == "cpu" {
			aggregate = counter
			hasAggregate = true
			continue
		}

		id, err := strconv.Atoi(strings.TrimPrefix(fields[0], "cpu"))
		if err == nil && id >= 0 {
			cores = append(cores, cpuCoreCounter{id: id, cpuCounter: counter})
		}
	}
	if err := scanner.Err(); err != nil {
		return cpuCounter{}, nil, err
	}
	if !hasAggregate {
		return cpuCounter{}, nil, fmt.Errorf("read /proc/stat: missing cpu line")
	}
	return aggregate, cores, nil
}

func cpuCounterFromFields(fields []string) (cpuCounter, error) {
	if len(fields) < 6 {
		return cpuCounter{}, fmt.Errorf("read /proc/stat: malformed %s line", fields[0])
	}
	var values []uint64
	for _, field := range fields[1:] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return cpuCounter{}, err
		}
		values = append(values, value)
	}
	var total uint64
	for _, value := range values {
		total += value
	}
	// /proc/stat cpu fields: user nice system idle iowait irq softirq steal ...
	counter := cpuCounter{
		total:      total,
		idle:       values[3] + values[4],
		userTime:   values[0] + values[1],
		systemTime: values[2],
		idleTime:   values[3],
		iowaitTime: values[4],
	}
	if len(values) > 5 {
		counter.systemTime += values[5]
	}
	if len(values) > 6 {
		counter.systemTime += values[6]
	}
	if len(values) > 7 {
		counter.stealTime = values[7]
	}
	return counter, nil
}

// cpuBreakdown returns the fraction of the interval spent in user, system, idle,
// iowait and steal, computed from the delta between two /proc/stat cpu snapshots.
func cpuBreakdown(current, previous cpuCounter) (user, system, idle, iowait, steal float64) {
	total := current.total - previous.total
	if previous.total == 0 || total == 0 {
		return 0, 0, 0, 0, 0
	}
	frac := func(c, p uint64) float64 {
		if c < p {
			return 0
		}
		return clamp(float64(c-p) / float64(total))
	}
	return frac(current.userTime, previous.userTime),
		frac(current.systemTime, previous.systemTime),
		frac(current.idleTime, previous.idleTime),
		frac(current.iowaitTime, previous.iowaitTime),
		frac(current.stealTime, previous.stealTime)
}

func cpuUtilization(current, previous cpuCounter) float64 {
	total := current.total - previous.total
	idle := current.idle - previous.idle
	if previous.total == 0 || total == 0 || idle > total {
		return 0
	}
	return clamp(1 - float64(idle)/float64(total))
}

func readLoad() (float64, float64, float64, int) {
	content, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0, 0
	}
	fields := strings.Fields(string(content))
	if len(fields) < 4 {
		return 0, 0, 0, 0
	}
	load1, _ := strconv.ParseFloat(fields[0], 64)
	load5, _ := strconv.ParseFloat(fields[1], 64)
	load15, _ := strconv.ParseFloat(fields[2], 64)
	running, _, _ := strings.Cut(fields[3], "/")
	runQueue, _ := strconv.Atoi(running)
	return load1, load5, load15, runQueue
}

func readUptime() float64 {
	content, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(content))
	if len(fields) < 1 {
		return 0
	}
	seconds, _ := strconv.ParseFloat(fields[0], 64)
	return seconds
}

func readKeyValues(path string) (map[string]uint64, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	values := make(map[string]uint64)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(strings.TrimSuffix(scanner.Text(), ":"))
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err == nil {
			values[strings.TrimSuffix(fields[0], ":")] = value
		}
	}
	return values, scanner.Err()
}

// maxDiskDevices caps the per-device breakdown to the busiest few, matching the
// engine's fixed IOPS counter-bank column count (DOOMPERF_STORAGE_DEV_SLOTS).
const maxDiskDevices = 4

func sampleStorage(previous map[string]diskCounter, elapsed float64) (storageTelemetry, map[string]diskCounter, error) {
	disks, err := readDiskCounters()
	if err != nil {
		return storageTelemetry{}, nil, err
	}
	result, current := reduceStorage(disks, previous, elapsed)
	result.UsedBytes, result.TotalBytes, result.AvailBytes, result.UsedRatio = sampleRootFilesystem()
	return result, current, nil
}

// reduceStorage folds per-device diskstats deltas into the aggregate USE signals,
// aggregate IOPS, and a per-device breakdown (busiest first, capped). Pure (no
// /proc or statfs read) so it is unit-testable with fixture counters.
func reduceStorage(disks []diskCounter, previous map[string]diskCounter, elapsed float64) (storageTelemetry, map[string]diskCounter) {
	current := make(map[string]diskCounter, len(disks))
	var result storageTelemetry
	for _, disk := range disks {
		current[disk.name] = disk
		old, ok := previous[disk.name]
		if !ok {
			continue
		}

		ioMillis := disk.ioMillis - old.ioMillis
		weightedIO := disk.weightedIO - old.weightedIO
		reads := disk.reads - old.reads
		writes := disk.writes - old.writes
		ios := reads + writes
		await := 0.0
		if ios > 0 {
			await = float64((disk.readMillis-old.readMillis)+(disk.writeMillis-old.writeMillis)) / float64(ios)
		}
		util := clamp(float64(ioMillis) / (elapsed * 1000))
		queueDepth := float64(weightedIO) / (elapsed * 1000)
		iops := float64(ios) / elapsed

		result.Utilization = maxFloat(result.Utilization, util)
		result.QueueDepth = maxFloat(result.QueueDepth, queueDepth)
		result.AwaitMillis = maxFloat(result.AwaitMillis, await)
		result.ReadBytesPerSecond += float64(disk.readSectors-old.readSectors) * 512 / elapsed
		result.WriteBytesPerSecond += float64(disk.writeSectors-old.writeSectors) * 512 / elapsed
		result.IOPS += iops
		result.Devices = append(result.Devices, diskDeviceTelemetry{
			Name:        disk.name,
			IOPS:        iops,
			Utilization: util,
		})
	}
	result.Saturation = clamp(result.QueueDepth/8 + result.AwaitMillis/250)
	sort.SliceStable(result.Devices, func(i, j int) bool {
		return result.Devices[i].IOPS > result.Devices[j].IOPS
	})
	if len(result.Devices) > maxDiskDevices {
		result.Devices = result.Devices[:maxDiskDevices]
	}
	return result, current
}

// sampleRootFilesystem reports `df /` capacity for the disk-usage cistern. On any
// statfs error it returns zeros (the cistern simply reads empty). UsedRatio
// matches df's capacity% by excluding root-reserved blocks from the denominator.
func sampleRootFilesystem() (used, total, avail uint64, usedRatio float64) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err != nil {
		return 0, 0, 0, 0
	}
	bsize := uint64(stat.Bsize)
	total = stat.Blocks * bsize
	avail = stat.Bavail * bsize
	used = (stat.Blocks - stat.Bfree) * bsize
	if used+avail > 0 {
		usedRatio = clamp(float64(used) / float64(used+avail))
	}
	return used, total, avail, usedRatio
}

func readDiskCounters() ([]diskCounter, error) {
	file, err := os.Open("/proc/diskstats")
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var disks []diskCounter
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 14 {
			continue
		}
		name := fields[2]
		if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") || strings.HasPrefix(name, "zram") {
			continue
		}
		if _, err := os.Stat(filepath.Join("/sys/block", name)); err != nil {
			continue
		}
		values := make([]uint64, 0, len(fields)-3)
		for _, field := range fields[3:] {
			value, err := strconv.ParseUint(field, 10, 64)
			if err != nil {
				values = nil
				break
			}
			values = append(values, value)
		}
		if len(values) < 11 {
			continue
		}
		disks = append(disks, diskCounter{
			name:         name,
			reads:        values[0],
			readSectors:  values[2],
			readMillis:   values[3],
			writes:       values[4],
			writeSectors: values[6],
			writeMillis:  values[7],
			ioMillis:     values[9],
			weightedIO:   values[10],
		})
	}
	return disks, scanner.Err()
}

func sampleNetwork(previous map[string]netCounter, elapsed float64) (networkTelemetry, map[string]netCounter, error) {
	nets, err := readNetCounters()
	if err != nil {
		return networkTelemetry{}, nil, err
	}
	result, current := reduceNetwork(nets, previous, elapsed)
	return result, current, nil
}

// reduceNetwork folds per-interface counter deltas into aggregate throughput, a
// per-NIC breakdown (busiest first), and the noisiest interface as primary. Pure
// (no /proc read) so it is unit-testable with fixture counters.
func reduceNetwork(nets []netCounter, previous map[string]netCounter, elapsed float64) (networkTelemetry, map[string]netCounter) {
	current := make(map[string]netCounter, len(nets))
	var result networkTelemetry
	var capacity float64
	// Track the noisiest interface (highest rx+tx) as the primary; init below -1
	// so the first NIC always wins even when every interface is idle.
	busiest := -1.0
	for _, net := range nets {
		current[net.name] = net
		capacity += net.speedBps
		old, ok := previous[net.name]
		if !ok {
			continue
		}

		rx := counterRate(net.rxBytes, old.rxBytes, elapsed)
		tx := counterRate(net.txBytes, old.txBytes, elapsed)
		result.RXBytesPerSecond += rx
		result.TXBytesPerSecond += tx
		result.DropsPerSecond += counterRate(net.rxDrops+net.txDrops, old.rxDrops+old.txDrops, elapsed)
		result.ErrorsPerSecond += counterRate(net.rxErrors+net.txErrors, old.rxErrors+old.txErrors, elapsed)
		result.Interfaces = append(result.Interfaces, netInterfaceTelemetry{
			Name:             net.name,
			RXBytesPerSecond: rx,
			TXBytesPerSecond: tx,
		})
		if rx+tx > busiest {
			busiest = rx + tx
			result.PrimaryInterface = net.name
		}
	}
	// Busiest first, so the interface terminal leads with the primary NIC.
	sort.SliceStable(result.Interfaces, func(i, j int) bool {
		a := result.Interfaces[i]
		b := result.Interfaces[j]
		return a.RXBytesPerSecond+a.TXBytesPerSecond > b.RXBytesPerSecond+b.TXBytesPerSecond
	})
	// Hide interfaces that aren't moving data (idle veths and the like); always keep
	// the primary so the list is never empty.
	kept := result.Interfaces[:0]
	for _, iface := range result.Interfaces {
		if iface.Name == result.PrimaryInterface || iface.RXBytesPerSecond+iface.TXBytesPerSecond >= netIfaceActiveBytesPerSecond {
			kept = append(kept, iface)
		}
	}
	result.Interfaces = kept
	if capacity > 0 {
		result.Utilization = clamp((result.RXBytesPerSecond + result.TXBytesPerSecond) * 8 / capacity)
	}
	result.Saturation = clamp(result.DropsPerSecond / 100)
	result.Errors = clamp(result.ErrorsPerSecond / 50)
	return result, current
}

func readNetCounters() ([]netCounter, error) {
	file, err := os.Open("/proc/net/dev")
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var nets []netCounter
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		name, stats, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		if name == "lo" || name == "" {
			continue
		}
		fields := strings.Fields(stats)
		if len(fields) < 16 {
			continue
		}
		values := make([]uint64, 0, len(fields))
		for _, field := range fields {
			value, err := strconv.ParseUint(field, 10, 64)
			if err != nil {
				values = nil
				break
			}
			values = append(values, value)
		}
		if len(values) < 16 {
			continue
		}
		nets = append(nets, netCounter{
			name:     name,
			rxBytes:  values[0],
			rxErrors: values[2],
			rxDrops:  values[3],
			txBytes:  values[8],
			txErrors: values[10],
			txDrops:  values[11],
			speedBps: interfaceSpeed(name),
		})
	}
	return nets, scanner.Err()
}

func interfaceSpeed(name string) float64 {
	content, err := os.ReadFile(filepath.Join("/sys/class/net", name, "speed"))
	if err == nil {
		mbps, parseErr := strconv.ParseFloat(strings.TrimSpace(string(content)), 64)
		if parseErr == nil && mbps > 0 {
			return mbps * 1_000_000
		}
	}
	return 1_000_000_000
}

// tcpStateNames maps the hex `st` column of /proc/net/tcp to a short label. The
// values are the kernel's TCP states (include/net/tcp_states.h).
var tcpStateNames = map[uint64]string{
	1:  "ESTAB",
	2:  "SYN-SENT",
	3:  "SYN-RECV",
	4:  "FIN-WAIT1",
	5:  "FIN-WAIT2",
	6:  "TIME-WAIT",
	7:  "CLOSE",
	8:  "CLOSE-WAIT",
	9:  "LAST-ACK",
	10: "LISTEN",
	11: "CLOSING",
	12: "NEW-SYN-RECV",
}

// tcpSocketStats accumulates the /proc/net/tcp{,6} census across both address
// families before it is finalized into the network telemetry fields.
type tcpSocketStats struct {
	states     tcpStateTelemetry
	sendQueue  uint64
	recvQueue  uint64
	backlogged int
	top        []socketTelemetry
}

// readTCPSockets reads both /proc/net/tcp and /proc/net/tcp6, returning the TCP
// state census, aggregate send/recv-queue backlog, and the `limit` most
// backlogged sockets (by max queue). Missing files (no IPv6, restricted proc)
// are skipped rather than fatal.
func readTCPSockets(limit int) tcpSocketStats {
	var stats tcpSocketStats
	for _, path := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		file, err := os.Open(path)
		if err != nil {
			continue
		}
		parseTCPSockets(file, &stats)
		file.Close()
	}
	stats.top = finalizeTopSockets(stats.top, limit)
	return stats
}

// parseTCPSockets scans one /proc/net/tcp-format stream, folding each socket's
// state and tx_queue:rx_queue into stats. The header row and malformed lines are
// skipped. Exposed (unexported) for unit tests with fixture data.
func parseTCPSockets(r io.Reader, stats *tcpSocketStats) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		// sl local_address rem_address st tx_queue:rx_queue ...
		if len(fields) < 5 {
			continue
		}
		state, err := strconv.ParseUint(fields[3], 16, 16)
		if err != nil {
			continue // header ("st") or malformed
		}
		txHex, rxHex, ok := strings.Cut(fields[4], ":")
		if !ok {
			continue
		}
		sendQ, err := strconv.ParseUint(txHex, 16, 64)
		if err != nil {
			continue
		}
		recvQ, err := strconv.ParseUint(rxHex, 16, 64)
		if err != nil {
			continue
		}

		stats.states.Total++
		switch state {
		case 1:
			stats.states.Established++
		case 2:
			stats.states.SynSent++
		case 3:
			stats.states.SynRecv++
		case 4:
			stats.states.FinWait1++
		case 5:
			stats.states.FinWait2++
		case 6:
			stats.states.TimeWait++
		case 7:
			stats.states.Close++
		case 8:
			stats.states.CloseWait++
		case 9:
			stats.states.LastAck++
		case 10:
			stats.states.Listen++
		case 11:
			stats.states.Closing++
		}
		stats.sendQueue += sendQ
		stats.recvQueue += recvQ
		if sendQ > 0 || recvQ > 0 {
			stats.backlogged++
			stats.top = append(stats.top, socketTelemetry{
				Local:          parseSocketEndpoint(fields[1]),
				Remote:         parseSocketEndpoint(fields[2]),
				State:          tcpStateNames[state],
				SendQueueBytes: sendQ,
				RecvQueueBytes: recvQ,
			})
		}
	}
}

// finalizeTopSockets sorts the backlogged sockets by their largest queue
// (send or recv) and keeps at most limit of them.
func finalizeTopSockets(top []socketTelemetry, limit int) []socketTelemetry {
	maxQueue := func(s socketTelemetry) uint64 {
		if s.SendQueueBytes > s.RecvQueueBytes {
			return s.SendQueueBytes
		}
		return s.RecvQueueBytes
	}
	sort.SliceStable(top, func(i, j int) bool { return maxQueue(top[i]) > maxQueue(top[j]) })
	if limit >= 0 && len(top) > limit {
		top = top[:limit]
	}
	return top
}

// parseSocketEndpoint decodes a /proc/net/tcp "ADDR:PORT" token (hex, host byte
// order) into a readable endpoint. IPv4 (8 hex chars) is rendered dotted-quad;
// IPv6 (32 hex chars) is abbreviated to "[v6]" since only the port carries
// signal for the queue readout. The port is always decoded to decimal.
func parseSocketEndpoint(token string) string {
	addrHex, portHex, ok := strings.Cut(token, ":")
	if !ok {
		return token
	}
	port, err := strconv.ParseUint(portHex, 16, 32)
	if err != nil {
		return token
	}
	switch len(addrHex) {
	case 8:
		v, err := strconv.ParseUint(addrHex, 16, 32)
		if err != nil {
			break
		}
		return fmt.Sprintf("%d.%d.%d.%d:%d", byte(v), byte(v>>8), byte(v>>16), byte(v>>24), port)
	case 32:
		return fmt.Sprintf("[v6]:%d", port)
	}
	return fmt.Sprintf("%s:%d", addrHex, port)
}

func counterRate(current, previous uint64, elapsed float64) float64 {
	if previous == 0 || current < previous || elapsed <= 0 {
		return 0
	}
	return float64(current-previous) / elapsed
}

func resourceSeverity(values ...float64) float64 {
	var worst float64
	for _, value := range values {
		worst = maxFloat(worst, value)
	}
	return clamp(worst)
}

func clamp(value float64) float64 {
	return math.Max(0, math.Min(1, value))
}

func maxFloat(values ...float64) float64 {
	var largest float64
	for _, value := range values {
		largest = math.Max(largest, value)
	}
	return largest
}
