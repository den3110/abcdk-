package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
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

// ===== Config =====

// Dùng cho services: đơn giản là scan process name chứa mấy chữ này
var importantServices = []string{
	"nginx",
	"mongod",
	"docker",
	"pm2",
	"mysql",
}

// Log được whitelist để FE chọn
type LogFile struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Path  string `json:"-"`
}

var logFiles = []LogFile{
	{Key: "syslog", Label: "System log (/var/log/syslog)", Path: "/var/log/syslog"},
	{Key: "auth", Label: "Auth log (/var/log/auth.log)", Path: "/var/log/auth.log"},
	{Key: "nginx_access", Label: "Nginx access (/var/log/nginx/access.log)", Path: "/var/log/nginx/access.log"},
	{Key: "nginx_error", Label: "Nginx error (/var/log/nginx/error.log)", Path: "/var/log/nginx/error.log"},
	// đổi path này tuỳ server bạn
	{Key: "app", Label: "PickleTour app log (/var/www/pickletour/logs/app.log)", Path: "/var/www/pickletour/logs/app.log"},
}

// Terminal “an toàn” – chỉ cho FE chọn trong list này
type SafeCommand struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Cmd   string `json:"-"`
}

var safeCommands = []SafeCommand{
	{Key: "df", Label: "Disk usage (df -h)", Cmd: "df -h"},
	{Key: "free", Label: "Memory usage (free -m)", Cmd: "free -m"},
	{Key: "top", Label: "Top processes (top -b -n 1 | head -n 20)", Cmd: "top -b -n 1 | head -n 20"},
	{Key: "ps", Label: "Processes (ps aux --sort=-%mem | head -n 20)", Cmd: "ps aux --sort=-%mem | head -n 20"},
	{Key: "pm2", Label: "PM2 list", Cmd: "pm2 list"},
	{Key: "netstat", Label: "Ports (ss -tulnp | head -n 50)", Cmd: "ss -tulnp | head -n 50"},
}

// ===== Helpers =====

func findLogFile(key string) *LogFile {
	for _, lf := range logFiles {
		if lf.Key == key {
			return &lf
		}
	}
	return nil
}

func findSafeCommand(key string) *SafeCommand {
	for _, c := range safeCommands {
		if c.Key == key {
			return &c
		}
	}
	return nil
}

// ===== Handlers =====

// GET /api/admin/system/summary
func getSystemSummary(c *gin.Context) {
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
	cpuPercents, _ := cpu.PercentWithContext(ctx, time.Second, false) // overall usage trong ~1s

	var cpuBrand string
	var cpuCores, cpuPhys int32
	if len(cpuInfo) > 0 {
		cpuBrand = cpuInfo[0].ModelName
		cpuCores = cpuInfo[0].Cores
		// gopsutil không luôn trả physical cores rõ ràng, dùng cores tạm
		cpuPhys = cpuInfo[0].Cores
	}

	uptime := uint64(0)
	if hostInfo != nil {
		uptime = hostInfo.Uptime
	}

	c.JSON(http.StatusOK, gin.H{
		"hostname":        hostInfo.Hostname,
		"os":              hostInfo.OS,
		"platform":        hostInfo.Platform,
		"platformVersion": hostInfo.PlatformVersion,
		"kernelVersion":   hostInfo.KernelVersion,
		"uptimeSeconds":   uptime,
		"loadAvg": gin.H{
			"load1":  loadAvg.Load1,
			"load5":  loadAvg.Load5,
			"load15": loadAvg.Load15,
		},
		"cpu": gin.H{
			"brand":         cpuBrand,
			"cores":         cpuCores,
			"physicalCores": cpuPhys,
			"usagePercent": func() float64 {
				if len(cpuPercents) > 0 {
					return cpuPercents[0]
				}
				return 0
			}(),
		},
		"memory": gin.H{
			"total":       vm.Total,
			"available":   vm.Available,
			"used":        vm.Used,
			"usedPercent": vm.UsedPercent, // VirtualMemoryStat.UsedPercent đã tính sẵn :contentReference[oaicite:2]{index=2}
		},
	})
}

// GET /api/admin/system/disk
func getDiskUsage(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	partitions, err := disk.PartitionsWithContext(ctx, true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "disk.Partitions failed", "detail": err.Error()})
		return
	}

	var result []gin.H
	for _, p := range partitions {
		usage, err := disk.UsageWithContext(ctx, p.Mountpoint)
		if err != nil {
			continue
		}
		result = append(result, gin.H{
			"device":        p.Device,
			"mountpoint":    p.Mountpoint,
			"fstype":        p.Fstype,
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

// GET /api/admin/system/processes?sortBy=cpu|mem&limit=20
func getTopProcesses(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	sortBy := c.DefaultQuery("sortBy", "cpu")
	limitStr := c.DefaultQuery("limit", "20")
	limit, _ := strconv.Atoi(limitStr)
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

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

	for _, p := range procs {
		name, _ := p.NameWithContext(ctx)
		user, _ := p.UsernameWithContext(ctx)
		memPct, _ := p.MemoryPercentWithContext(ctx)
		memInfo, _ := p.MemoryInfoWithContext(ctx)
		cmdline, _ := p.CmdlineWithContext(ctx)
		// CPUPercent gopsutil cần 1 khoảng thời gian để đo; lần đầu có thể 0 hoặc gần 0
		cpuPct, _ := p.CPUPercentWithContext(ctx)

		list = append(list, procInfo{
			Pid:        p.Pid,
			Name:       name,
			User:       user,
			CPUPercent: cpuPct,
			MemPercent: memPct,
			MemRSS: func() uint64 {
				if memInfo != nil {
					return memInfo.RSS
				}
				return 0
			}(),
			Cmdline: cmdline,
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

// GET /api/admin/system/services
// Đơn giản: check xem có process nào có name chứa tên service không
func getServicesStatus(c *gin.Context) {
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

	statusMap := make(map[string]*svcStatus)

	for _, name := range importantServices {
		statusMap[name] = &svcStatus{Name: name, Running: false}
	}

	for _, p := range procs {
		name, _ := p.NameWithContext(ctx)
		memInfo, _ := p.MemoryInfoWithContext(ctx)
		cpuPct, _ := p.CPUPercentWithContext(ctx)

		lowerName := strings.ToLower(name)
		for _, svc := range importantServices {
			if strings.Contains(lowerName, strings.ToLower(svc)) {
				st := statusMap[svc]
				st.Running = true
				// cộng dồn
				st.CPUPercent += cpuPct
				if memInfo != nil {
					st.MemRSS += memInfo.RSS
				}
			}
		}
	}

	var result []svcStatus
	for _, st := range statusMap {
		result = append(result, *st)
	}

	c.JSON(http.StatusOK, result)
}

// GET /api/admin/system/network
func getNetworkSummary(c *gin.Context) {
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

	statsMap := make(map[string]gnet.IOCountersStat)
	for _, s := range stats {
		statsMap[s.Name] = s
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

	var result []ifaceInfo
	for _, iface := range ifaces {
		s := statsMap[iface.Name]
		var ip4, ip6 string
		for _, addr := range iface.Addrs {
			if strings.Contains(addr.Addr, ":") {
				if ip6 == "" {
					ip6 = addr.Addr
				}
			} else {
				if ip4 == "" {
					ip4 = addr.Addr
				}
			}
		}

		result = append(result, ifaceInfo{
			Name:        iface.Name,
			MTU:         iface.MTU,
			Hardware:    iface.HardwareAddr,
			Flags:       strings.Join(iface.Flags, ","),
			IPv4:        ip4,
			IPv6:        ip6,
			BytesSent:   s.BytesSent,
			BytesRecv:   s.BytesRecv,
			PacketsSent: s.PacketsSent,
			PacketsRecv: s.PacketsRecv,
		})
	}

	c.JSON(http.StatusOK, result)
}

// GET /api/admin/system/ports
// Cho đơn giản: gọi "ss -tulnp" (Linux) và trả raw text
func getOpenPorts(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	// ưu tiên ss, fallback sang netstat nếu cần :contentReference[oaicite:3]{index=3}
	cmd := exec.CommandContext(ctx, "ss", "-tulnp")
	out, err := cmd.CombinedOutput()
	if err != nil {
		// thử netstat
		cmd2 := exec.CommandContext(ctx, "netstat", "-tulpen")
		out2, err2 := cmd2.CombinedOutput()
		if err2 != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":    "ss/netstat failed",
				"detail":   err.Error(),
				"detail2":  err2.Error(),
				"combined": string(out) + "\n" + string(out2),
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"tool":   "netstat",
			"output": string(out2),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"tool":   "ss",
		"output": string(out),
	})
}

// GET /api/admin/system/logs/types
func getLogTypes(c *gin.Context) {
	type logTypeDTO struct {
		Key   string `json:"key"`
		Label string `json:"label"`
	}
	var list []logTypeDTO
	for _, lf := range logFiles {
		list = append(list, logTypeDTO{Key: lf.Key, Label: lf.Label})
	}
	c.JSON(http.StatusOK, list)
}

// GET /api/admin/system/logs/tail?type=syslog&lines=200
func getLogTail(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	logType := c.Query("type")
	linesStr := c.DefaultQuery("lines", "200")
	lines, _ := strconv.Atoi(linesStr)
	if lines <= 0 {
		lines = 200
	}
	if lines > 2000 {
		lines = 2000
	}

	lf := findLogFile(logType)
	if lf == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid log type"})
		return
	}

	// Gọi tail cho nhanh thay vì tự implement seek+scan :contentReference[oaicite:4]{index=4}
	cmd := exec.CommandContext(ctx, "tail", "-n", fmt.Sprintf("%d", lines), lf.Path)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Print(err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "tail failed",
			"detail": err.Error(),
			"path":   lf.Path,
			"output": string(out),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"type":  lf.Key,
		"label": lf.Label,
		"path":  lf.Path,
		"lines": lines,
		"text":  string(out),
	})
}

// GET /api/admin/system/commands
func getSafeCommandsHandler(c *gin.Context) {
	type dto struct {
		Key   string `json:"key"`
		Label string `json:"label"`
	}
	var list []dto
	for _, sc := range safeCommands {
		list = append(list, dto{Key: sc.Key, Label: sc.Label})
	}
	c.JSON(http.StatusOK, list)
}

// POST /api/admin/system/exec
// body: { "cmdKey": "df" }
type execRequest struct {
	CmdKey string `json:"cmdKey"`
}

func execSafeCommandHandler(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var body execRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json", "detail": err.Error()})
		return
	}

	sc := findSafeCommand(body.CmdKey)
	if sc == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "command not allowed"})
		return
	}

	// Chạy bằng /bin/sh -c cho phép lệnh có pipe/head
	cmd := exec.CommandContext(ctx, "bash", "-c", sc.Cmd)
	out, err := cmd.CombinedOutput()

	c.JSON(http.StatusOK, gin.H{
		"cmdKey": sc.Key,
		"label":  sc.Label,
		"cmd":    sc.Cmd,
		"output": string(out),
		"error": func() string {
			if err != nil {
				return err.Error()
			}
			return ""
		}(),
	})
}

// ===== Auth middleware (placeholder) =====

// Ở đây mình chỉ demo; bạn ghép vào hệ thống auth của bạn:
// - check JWT
// - check role admin
func adminAuthMiddleware(c *gin.Context) {
	// TODO: validate token, load user, check isAdmin
	// Nếu fail:
	// c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
	// return
	c.Next()
}

// ===== main =====

func main() {
	r := gin.Default()

	api := r.Group("/api/admin/system")
	api.Use(adminAuthMiddleware)

	api.GET("/summary", getSystemSummary)
	api.GET("/disk", getDiskUsage)
	api.GET("/processes", getTopProcesses)
	api.GET("/services", getServicesStatus)
	api.GET("/network", getNetworkSummary)
	api.GET("/ports", getOpenPorts)

	api.GET("/logs/types", getLogTypes)
	api.GET("/logs/tail", getLogTail)

	api.GET("/commands", getSafeCommandsHandler)
	api.POST("/exec", execSafeCommandHandler)

	port := os.Getenv("ADMIN_SYSTEM_PORT")
	if port == "" {
		port = "8003"
	}
	addr := ":" + port

	log.Printf("Admin system monitor listening at %s\n", addr)
	if err := r.Run(addr); err != nil {
		log.Fatal(err)
	}
}
