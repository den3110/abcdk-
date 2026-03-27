package adminsystem

import (
	"context"
	"fmt"
	"net/http"
	"os/exec"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
)

type Dependencies struct {
	AuthMiddleware gin.HandlerFunc
	Runner         Runner
}

type Module struct {
	authMiddleware gin.HandlerFunc
	handler        *Handler
}

type Handler struct {
	runner            Runner
	importantServices []string
	logFiles          []LogFile
	safeCommands      []SafeCommand
}

type LogFile struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Path  string `json:"-"`
}

type SafeCommand struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Cmd   string `json:"-"`
}

type Runner interface {
	Command(ctx context.Context, name string, args ...string) ([]byte, error)
	Shell(ctx context.Context, command string) ([]byte, error)
}

type OSRunner struct{}

func (OSRunner) Command(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	return cmd.CombinedOutput()
}

func (OSRunner) Shell(ctx context.Context, command string) ([]byte, error) {
	if runtime.GOOS == "windows" {
		cmd := exec.CommandContext(ctx, "powershell", "-Command", command)
		return cmd.CombinedOutput()
	}

	cmd := exec.CommandContext(ctx, "bash", "-lc", command)
	return cmd.CombinedOutput()
}

func New(deps Dependencies) *Module {
	runner := deps.Runner
	if runner == nil {
		runner = OSRunner{}
	}

	return &Module{
		authMiddleware: deps.AuthMiddleware,
		handler: &Handler{
			runner: runner,
			importantServices: []string{
				"nginx",
				"mongod",
				"redis",
				"docker",
				"pickletour-api",
				"pickletour-relay-rtmp",
				"pickletour-scheduler",
				"pickletour-worker-recording-export",
				"pickletour-worker-ai-commentary",
				"pickletour-worker-general",
				"mysql",
			},
			logFiles: []LogFile{
				{Key: "syslog", Label: "System log (/var/log/syslog)", Path: "/var/log/syslog"},
				{Key: "auth", Label: "Auth log (/var/log/auth.log)", Path: "/var/log/auth.log"},
				{Key: "nginx_access", Label: "Nginx access (/var/log/nginx/access.log)", Path: "/var/log/nginx/access.log"},
				{Key: "nginx_error", Label: "Nginx error (/var/log/nginx/error.log)", Path: "/var/log/nginx/error.log"},
				{Key: "app", Label: "PickleTour app log (/var/www/pickletour/logs/app.log)", Path: "/var/www/pickletour/logs/app.log"},
			},
			safeCommands: []SafeCommand{
				{Key: "df", Label: "Disk usage (df -h)", Cmd: "df -h"},
				{Key: "free", Label: "Memory usage (free -m)", Cmd: "free -m"},
				{Key: "top", Label: "Top processes (top -b -n 1 | head -n 20)", Cmd: "top -b -n 1 | head -n 20"},
				{Key: "ps", Label: "Processes (ps aux --sort=-%mem | head -n 20)", Cmd: "ps aux --sort=-%mem | head -n 20"},
				{Key: "services", Label: "Go services (systemctl list-units 'pickletour*')", Cmd: "systemctl list-units 'pickletour*' --no-pager"},
				{Key: "api_journal", Label: "API journal (journalctl -u pickletour-api -n 200)", Cmd: "journalctl -u pickletour-api -n 200 --no-pager"},
				{Key: "scheduler_journal", Label: "Scheduler journal (journalctl -u pickletour-scheduler -n 200)", Cmd: "journalctl -u pickletour-scheduler -n 200 --no-pager"},
				{Key: "worker_recording_export_journal", Label: "Recording export worker journal", Cmd: "journalctl -u pickletour-worker-recording-export -n 200 --no-pager"},
				{Key: "netstat", Label: "Ports (ss -tulnp | head -n 50)", Cmd: "ss -tulnp | head -n 50"},
			},
		},
	}
}

func (m *Module) Register(group *gin.RouterGroup) {
	if m.authMiddleware != nil {
		group.Use(m.authMiddleware)
	}

	group.GET("/summary", m.handler.getSystemSummary)
	group.GET("/disk", m.handler.getDiskUsage)
	group.GET("/processes", m.handler.getTopProcesses)
	group.POST("/processes/:pid/kill", m.handler.killProcessHandler)
	group.GET("/services", m.handler.getServicesStatus)
	group.POST("/services/:name/action", m.handler.serviceActionHandler)
	group.GET("/network", m.handler.getNetworkSummary)
	group.GET("/ports", m.handler.getOpenPorts)
	group.GET("/logs/types", m.handler.getLogTypes)
	group.GET("/logs/tail", m.handler.getLogTail)
	group.GET("/commands", m.handler.getSafeCommandsHandler)
	group.POST("/exec", m.handler.execSafeCommandHandler)
}

func (h *Handler) getSystemSummary(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()

	vm, err := mem.VirtualMemoryWithContext(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "mem.VirtualMemory failed", "detail": err.Error()})
		return
	}

	hostInfo, _ := host.InfoWithContext(ctx)
	loadAvg, _ := load.AvgWithContext(ctx)
	cpuInfo, _ := cpu.InfoWithContext(ctx)
	cpuPercents, _ := cpu.PercentWithContext(ctx, time.Second, false)

	var cpuBrand string
	var cpuCores int32
	if len(cpuInfo) > 0 {
		cpuBrand = cpuInfo[0].ModelName
		cpuCores = cpuInfo[0].Cores
	}

	usagePercent := 0.0
	if len(cpuPercents) > 0 {
		usagePercent = cpuPercents[0]
	}

	c.JSON(http.StatusOK, gin.H{
		"hostname": safeHostField(hostInfo, func(info *host.InfoStat) string { return info.Hostname }),
		"os":       safeHostField(hostInfo, func(info *host.InfoStat) string { return info.OS }),
		"platform": safeHostField(hostInfo, func(info *host.InfoStat) string { return info.Platform }),
		"platformVersion": safeHostField(hostInfo, func(info *host.InfoStat) string {
			return info.PlatformVersion
		}),
		"kernelVersion": safeHostField(hostInfo, func(info *host.InfoStat) string { return info.KernelVersion }),
		"uptimeSeconds": safeHostUptime(hostInfo),
		"loadAvg": gin.H{
			"load1":  loadAvg.Load1,
			"load5":  loadAvg.Load5,
			"load15": loadAvg.Load15,
		},
		"cpu": gin.H{
			"brand":         cpuBrand,
			"cores":         cpuCores,
			"physicalCores": cpuCores,
			"usagePercent":  usagePercent,
		},
		"memory": gin.H{
			"total":       vm.Total,
			"available":   vm.Available,
			"used":        vm.Used,
			"usedPercent": vm.UsedPercent,
		},
	})
}

func (h *Handler) getDiskUsage(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	partitions, err := disk.PartitionsWithContext(ctx, true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "disk.Partitions failed", "detail": err.Error()})
		return
	}

	result := make([]gin.H, 0, len(partitions))
	for _, partition := range partitions {
		usage, err := disk.UsageWithContext(ctx, partition.Mountpoint)
		if err != nil {
			continue
		}

		result = append(result, gin.H{
			"device":        partition.Device,
			"mountpoint":    partition.Mountpoint,
			"fstype":        partition.Fstype,
			"total":         usage.Total,
			"used":          usage.Used,
			"usedPercent":   usage.UsedPercent,
			"inodesTotal":   usage.InodesTotal,
			"inodesUsed":    usage.InodesUsed,
			"inodesUsedPct": usage.InodesUsedPercent,
		})
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) getTopProcesses(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	sortBy := c.DefaultQuery("sortBy", "cpu")
	limit := parsePositiveInt(c.DefaultQuery("limit", "20"), 20, 100)

	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "process.Processes failed", "detail": err.Error()})
		return
	}

	type procInfo struct {
		Pid        int32   `json:"pid"`
		Name       string  `json:"name"`
		User       string  `json:"user"`
		CPUPercent float64 `json:"cpuPercent"`
		MemPercent float32 `json:"memPercent"`
		MemRSS     uint64  `json:"memRss"`
		Cmdline    string  `json:"command"`
	}

	list := make([]procInfo, 0, len(procs))
	for _, proc := range procs {
		name, _ := proc.NameWithContext(ctx)
		user, _ := proc.UsernameWithContext(ctx)
		memPct, _ := proc.MemoryPercentWithContext(ctx)
		memInfo, _ := proc.MemoryInfoWithContext(ctx)
		cmdline, _ := proc.CmdlineWithContext(ctx)
		cpuPct, _ := proc.CPUPercentWithContext(ctx)

		memRSS := uint64(0)
		if memInfo != nil {
			memRSS = memInfo.RSS
		}

		list = append(list, procInfo{
			Pid:        proc.Pid,
			Name:       name,
			User:       user,
			CPUPercent: cpuPct,
			MemPercent: memPct,
			MemRSS:     memRSS,
			Cmdline:    cmdline,
		})
	}

	switch strings.ToLower(sortBy) {
	case "mem":
		sort.Slice(list, func(i, j int) bool {
			return list[i].MemRSS > list[j].MemRSS
		})
	default:
		sort.Slice(list, func(i, j int) bool {
			return list[i].CPUPercent > list[j].CPUPercent
		})
	}

	if len(list) > limit {
		list = list[:limit]
	}

	c.JSON(http.StatusOK, list)
}

func (h *Handler) getServicesStatus(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "process.Processes failed", "detail": err.Error()})
		return
	}

	type svcStatus struct {
		Name       string  `json:"name"`
		Running    bool    `json:"running"`
		CPUPercent float64 `json:"cpuPercent"`
		MemRSS     uint64  `json:"memRss"`
	}

	statusMap := make(map[string]*svcStatus, len(h.importantServices))
	for _, name := range h.importantServices {
		statusMap[name] = &svcStatus{Name: name}
	}

	for _, proc := range procs {
		name, _ := proc.NameWithContext(ctx)
		memInfo, _ := proc.MemoryInfoWithContext(ctx)
		cpuPct, _ := proc.CPUPercentWithContext(ctx)

		lowerName := strings.ToLower(name)
		for _, serviceName := range h.importantServices {
			if strings.Contains(lowerName, strings.ToLower(serviceName)) {
				status := statusMap[serviceName]
				status.Running = true
				status.CPUPercent += cpuPct
				if memInfo != nil {
					status.MemRSS += memInfo.RSS
				}
			}
		}
	}

	result := make([]svcStatus, 0, len(statusMap))
	for _, status := range statusMap {
		result = append(result, *status)
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) getNetworkSummary(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	ifaces, err := gnet.InterfacesWithContext(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "net.Interfaces failed", "detail": err.Error()})
		return
	}

	stats, err := gnet.IOCountersWithContext(ctx, true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "net.IOCounters failed", "detail": err.Error()})
		return
	}

	statsByName := make(map[string]gnet.IOCountersStat, len(stats))
	for _, stat := range stats {
		statsByName[stat.Name] = stat
	}

	type ifaceInfo struct {
		Name        string `json:"name"`
		MTU         int    `json:"mtu"`
		Hardware    string `json:"hardwareAddr"`
		Flags       string `json:"flags"`
		IPv4        string `json:"ipv4"`
		IPv6        string `json:"ipv6"`
		BytesSent   uint64 `json:"bytesSent"`
		BytesRecv   uint64 `json:"bytesRecv"`
		PacketsSent uint64 `json:"packetsSent"`
		PacketsRecv uint64 `json:"packetsRecv"`
	}

	result := make([]ifaceInfo, 0, len(ifaces))
	for _, iface := range ifaces {
		var ipv4 string
		var ipv6 string
		for _, addr := range iface.Addrs {
			if strings.Contains(addr.Addr, ":") {
				if ipv6 == "" {
					ipv6 = addr.Addr
				}
				continue
			}
			if ipv4 == "" {
				ipv4 = addr.Addr
			}
		}

		stat := statsByName[iface.Name]
		result = append(result, ifaceInfo{
			Name:        iface.Name,
			MTU:         iface.MTU,
			Hardware:    iface.HardwareAddr,
			Flags:       strings.Join(iface.Flags, ","),
			IPv4:        ipv4,
			IPv6:        ipv6,
			BytesSent:   stat.BytesSent,
			BytesRecv:   stat.BytesRecv,
			PacketsSent: stat.PacketsSent,
			PacketsRecv: stat.PacketsRecv,
		})
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) getOpenPorts(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	output, err := h.runner.Command(ctx, "ss", "-tulnp")
	if err == nil {
		c.JSON(http.StatusOK, gin.H{"tool": "ss", "output": string(output)})
		return
	}

	fallbackOutput, fallbackErr := h.runner.Command(ctx, "netstat", "-tulpen")
	if fallbackErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":    "ss/netstat failed",
			"detail":   err.Error(),
			"detail2":  fallbackErr.Error(),
			"combined": string(output) + "\n" + string(fallbackOutput),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"tool": "netstat", "output": string(fallbackOutput)})
}

func (h *Handler) getLogTypes(c *gin.Context) {
	type dto struct {
		Key   string `json:"key"`
		Label string `json:"label"`
	}

	result := make([]dto, 0, len(h.logFiles))
	for _, file := range h.logFiles {
		result = append(result, dto{Key: file.Key, Label: file.Label})
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) getLogTail(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	logType := c.Query("type")
	lines := parsePositiveInt(c.DefaultQuery("lines", "200"), 200, 2000)

	logFile := h.findLogFile(logType)
	if logFile == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid log type"})
		return
	}

	output, err := h.runner.Command(ctx, "tail", "-n", fmt.Sprintf("%d", lines), logFile.Path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "tail failed",
			"detail": err.Error(),
			"type":   logFile.Key,
			"path":   logFile.Path,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"type":  logFile.Key,
		"label": logFile.Label,
		"path":  logFile.Path,
		"lines": lines,
		"text":  string(output),
	})
}

func (h *Handler) getSafeCommandsHandler(c *gin.Context) {
	type dto struct {
		Key   string `json:"key"`
		Label string `json:"label"`
	}

	result := make([]dto, 0, len(h.safeCommands))
	for _, command := range h.safeCommands {
		result = append(result, dto{Key: command.Key, Label: command.Label})
	}

	c.JSON(http.StatusOK, result)
}

type execRequest struct {
	CmdKey string `json:"cmdKey"`
}

func (h *Handler) execSafeCommandHandler(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var body execRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json", "detail": err.Error()})
		return
	}

	command := h.findSafeCommand(body.CmdKey)
	if command == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "command not allowed"})
		return
	}

	output, err := h.runner.Shell(ctx, command.Cmd)
	c.JSON(http.StatusOK, gin.H{
		"cmdKey": command.Key,
		"label":  command.Label,
		"cmd":    command.Cmd,
		"output": string(output),
		"error": func() string {
			if err != nil {
				return err.Error()
			}
			return ""
		}(),
	})
}

type killProcessRequest struct {
	Signal string `json:"signal"`
}

func (h *Handler) killProcessHandler(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	pid := strings.TrimSpace(c.Param("pid"))
	if _, err := strconv.Atoi(pid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid pid"})
		return
	}

	var body killProcessRequest
	_ = bindJSONIfPresent(c, &body)

	signal := normalizeSignal(body.Signal)
	output, err := h.runner.Command(ctx, "kill", "-s", signal, pid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "kill failed",
			"detail": err.Error(),
			"output": string(output),
			"pid":    pid,
			"signal": signal,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"pid":    pid,
		"signal": signal,
		"status": "ok",
		"output": string(output),
	})
}

type serviceActionRequest struct {
	Action string `json:"action"`
}

func (h *Handler) serviceActionHandler(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "service name required"})
		return
	}
	if !h.isImportantService(name) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "service not allowed"})
		return
	}

	var body serviceActionRequest
	_ = bindJSONIfPresent(c, &body)

	action := strings.ToLower(strings.TrimSpace(body.Action))
	if action == "" {
		action = "restart"
	}

	commandName := ""
	args := []string{}
	switch action {
	case "restart":
		commandName = "systemctl"
		args = []string{"restart", name}
	case "start":
		commandName = "systemctl"
		args = []string{"start", name}
	case "stop":
		commandName = "systemctl"
		args = []string{"stop", name}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported action"})
		return
	}

	output, err := h.runner.Command(ctx, commandName, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "service action failed",
			"detail": err.Error(),
			"output": string(output),
			"name":   name,
			"action": action,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"name":   name,
		"action": action,
		"output": string(output),
	})
}

func (h *Handler) findLogFile(key string) *LogFile {
	for _, file := range h.logFiles {
		if file.Key == key {
			copy := file
			return &copy
		}
	}
	return nil
}

func (h *Handler) findSafeCommand(key string) *SafeCommand {
	for _, command := range h.safeCommands {
		if command.Key == key {
			copy := command
			return &copy
		}
	}
	return nil
}

func (h *Handler) isImportantService(name string) bool {
	for _, serviceName := range h.importantServices {
		if strings.EqualFold(serviceName, name) {
			return true
		}
	}
	return false
}

func parsePositiveInt(raw string, fallback, max int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		value = fallback
	}
	if value > max {
		return max
	}
	return value
}

func bindJSONIfPresent(c *gin.Context, target any) error {
	if c.Request.ContentLength == 0 {
		return nil
	}
	return c.ShouldBindJSON(target)
}

func normalizeSignal(raw string) string {
	signal := strings.ToUpper(strings.TrimSpace(raw))
	if signal == "" {
		return "SIGTERM"
	}

	switch signal {
	case "KILL":
		return "SIGKILL"
	case "TERM":
		return "SIGTERM"
	case "INT":
		return "SIGINT"
	default:
		return signal
	}
}

func safeHostField(info *host.InfoStat, getter func(*host.InfoStat) string) string {
	if info == nil {
		return ""
	}
	return getter(info)
}

func safeHostUptime(info *host.InfoStat) uint64 {
	if info == nil {
		return 0
	}
	return info.Uptime
}
