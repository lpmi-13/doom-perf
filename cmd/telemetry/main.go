package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const sampleInterval = time.Second
const defaultMaxTelemetryStreams = 64

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
	SwapUsedBytes         uint64  `json:"swapUsedBytes"`
	SwapPagesPerSecond    float64 `json:"swapPagesPerSecond"`
	SwapInPagesPerSecond  float64 `json:"swapInPagesPerSecond"`
	SwapOutPagesPerSecond float64 `json:"swapOutPagesPerSecond"`
	OOMKillsPerSecond     float64 `json:"oomKillsPerSecond"`
}

type storageTelemetry struct {
	resourceUSE
	QueueDepth          float64 `json:"queueDepth"`
	AwaitMillis         float64 `json:"awaitMillis"`
	ReadBytesPerSecond  float64 `json:"readBytesPerSecond"`
	WriteBytesPerSecond float64 `json:"writeBytesPerSecond"`
}

type networkTelemetry struct {
	resourceUSE
	RXBytesPerSecond float64 `json:"rxBytesPerSecond"`
	TXBytesPerSecond float64 `json:"txBytesPerSecond"`
	DropsPerSecond   float64 `json:"dropsPerSecond"`
	ErrorsPerSecond  float64 `json:"errorsPerSecond"`
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
	memSaturation := clamp(maxFloat(swapRate/2500, maxFloat(memUtil-0.90, 0)*5))
	memErrors := clamp(oomRate)

	storage, disks, err := sampleStorage(s.disk, elapsed)
	if err != nil {
		return telemetry{}, err
	}
	network, nets, err := sampleNetwork(s.net, elapsed)
	if err != nil {
		return telemetry{}, err
	}

	s.lastAt = now
	s.cpu = cpu
	s.cpuCores = currentCPUCores
	s.swapPages = swapPages
	s.swapIn = swapInPages
	s.swapOut = swapOutPages
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
			SwapUsedBytes:         swapUsed,
			SwapPagesPerSecond:    swapRate,
			SwapInPagesPerSecond:  swapInRate,
			SwapOutPagesPerSecond: swapOutRate,
			OOMKillsPerSecond:     oomRate,
		},
		Storage: storage,
		Network: network,
	}, nil
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

func sampleStorage(previous map[string]diskCounter, elapsed float64) (storageTelemetry, map[string]diskCounter, error) {
	disks, err := readDiskCounters()
	if err != nil {
		return storageTelemetry{}, nil, err
	}

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

		result.Utilization = maxFloat(result.Utilization, util)
		result.QueueDepth = maxFloat(result.QueueDepth, queueDepth)
		result.AwaitMillis = maxFloat(result.AwaitMillis, await)
		result.ReadBytesPerSecond += float64(disk.readSectors-old.readSectors) * 512 / elapsed
		result.WriteBytesPerSecond += float64(disk.writeSectors-old.writeSectors) * 512 / elapsed
	}
	result.Saturation = clamp(result.QueueDepth/8 + result.AwaitMillis/250)
	return result, current, nil
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

	current := make(map[string]netCounter, len(nets))
	var result networkTelemetry
	var capacity float64
	for _, net := range nets {
		current[net.name] = net
		capacity += net.speedBps
		old, ok := previous[net.name]
		if !ok {
			continue
		}

		result.RXBytesPerSecond += counterRate(net.rxBytes, old.rxBytes, elapsed)
		result.TXBytesPerSecond += counterRate(net.txBytes, old.txBytes, elapsed)
		result.DropsPerSecond += counterRate(net.rxDrops+net.txDrops, old.rxDrops+old.txDrops, elapsed)
		result.ErrorsPerSecond += counterRate(net.rxErrors+net.txErrors, old.rxErrors+old.txErrors, elapsed)
	}
	if capacity > 0 {
		result.Utilization = clamp((result.RXBytesPerSecond + result.TXBytesPerSecond) * 8 / capacity)
	}
	result.Saturation = clamp(result.DropsPerSecond / 100)
	result.Errors = clamp(result.ErrorsPerSecond / 50)
	return result, current, nil
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
