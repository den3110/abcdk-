package programs

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
	"time"

	"backendgo/internal/runtime"

	"golang.org/x/net/websocket"
)

type relayRTMPStats struct {
	activeConnections int64
	totalConnections  uint64
	totalMessages     uint64
	startedAt         time.Time
}

func RunRelayRTMP(ctx context.Context) error {
	bundle, err := runtime.Bootstrap(ctx)
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = bundle.Close(closeCtx)
	}()

	stats := &relayRTMPStats{startedAt: time.Now().UTC()}
	mux := http.NewServeMux()
	mux.Handle("/ws/rtmp", websocket.Handler(func(conn *websocket.Conn) {
		atomic.AddInt64(&stats.activeConnections, 1)
		atomic.AddUint64(&stats.totalConnections, 1)
		defer atomic.AddInt64(&stats.activeConnections, -1)
		defer conn.Close()

		for {
			var payload []byte
			if err := websocket.Message.Receive(conn, &payload); err != nil {
				return
			}
			atomic.AddUint64(&stats.totalMessages, 1)
		}
	}))

	mux.HandleFunc("/rtmp/api/streams/stats", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":                true,
			"path":              "/ws/rtmp",
			"activeConnections": atomic.LoadInt64(&stats.activeConnections),
			"totalConnections":  atomic.LoadUint64(&stats.totalConnections),
			"totalMessages":     atomic.LoadUint64(&stats.totalMessages),
			"startedAt":         stats.startedAt,
			"uptimeSeconds":     int(time.Since(stats.startedAt).Seconds()),
		})
	})

	mux.HandleFunc("/dashboard", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = fmt.Fprintf(w, `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>RTMP Relay Dashboard</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; background: #0f172a; color: #e2e8f0; }
      pre { background: #111827; padding: 16px; border-radius: 12px; overflow: auto; }
      a { color: #93c5fd; }
    </style>
    <script>
      async function refreshStats() {
        const res = await fetch('/rtmp/api/streams/stats', { cache: 'no-store' });
        const data = await res.json();
        document.getElementById('stats').textContent = JSON.stringify(data, null, 2);
      }
      setInterval(refreshStats, 2000);
      window.addEventListener('load', refreshStats);
    </script>
  </head>
  <body>
    <h1>RTMP Relay Dashboard</h1>
    <p>WebSocket ingest path: <code>/ws/rtmp</code></p>
    <pre id="stats">Loading...</pre>
  </body>
</html>`)
	})

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":    "ok",
			"service":   bundle.Config.ServicePrefix + "-relay-rtmp",
			"port":      bundle.Config.RTMPPort,
			"startedAt": stats.startedAt,
		})
	})

	return runtime.RunHTTPServer(ctx, bundle.Config.ServicePrefix+"-relay-rtmp", bundle.Config.RTMPPort, mux)
}
