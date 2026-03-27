# Single Server Peak Notes

Muc tieu file nay la khoa topology Go-native cho `4 core / 8GB`:

- `pickletour-api`: Go API process
- `pickletour-relay-rtmp`: Go relay process rieng
- `pickletour-worker-recording-export`: worker media rieng, `ffmpeg threads = 1`
- `pickletour-worker-ai-commentary`: worker AI rieng
- `pickletour-worker-general`: worker cho CCCD/SEO/notify va jobs khong phai media
- `pickletour-scheduler`: process schedule/cron dispatcher
- export recording ban ngay khong merge ngay, chi giu queue cho khung gio dem

Khuyen nghi env:

```env
LIVE_RECORDING_EXPORT_WINDOW_ENABLED=true
LIVE_RECORDING_EXPORT_WINDOW_TZ=Asia/Saigon
LIVE_RECORDING_EXPORT_WINDOW_START=00:00
LIVE_RECORDING_EXPORT_WINDOW_END=06:00
LIVE_RECORDING_FFMPEG_THREADS=1
LIVE_APP_COURT_RUNTIME_CACHE_TTL_MS=1500
LIVE_APP_MATCH_RUNTIME_CACHE_TTL_MS=2000
LIVE_APP_COURT_RUNTIME_WAIT_POLL_MS=5000
LIVE_APP_COURT_RUNTIME_STEADY_POLL_MS=10000
PEAK_RUNTIME_METRICS_WINDOW_MS=300000
PEAK_RUNTIME_METRICS_MAX_SAMPLES_PER_ENDPOINT=1500
```

Lenh systemd tham khao:

```bash
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pickletour-api pickletour-relay-rtmp pickletour-scheduler
sudo systemctl enable --now pickletour-worker-recording-export pickletour-worker-ai-commentary pickletour-worker-general

# scale recording export worker logic bang systemd:
sudo systemctl stop pickletour-worker-recording-export
sudo systemctl start pickletour-worker-recording-export
```

Docker Compose profiles:

```bash
# mac dinh cho box live: chi can Redis
docker compose up -d redis

# chi bat search stack khi can test
docker compose --profile search up -d elasticsearch kibana

# chi bat Redis Commander khi can debug
docker compose --profile ops up -d redis-commander
```

Y nghia:

- ban ngay: co the stop `pickletour-worker-recording-export` neu muon cat hoan toan ffmpeg export
- ban dem: start lai `pickletour-worker-recording-export` de merge/export queue
- neu van de worker chay ban ngay, export window van giu da so recording o trang thai `pending_export_window`

GraphQL audit:

- dung `deploy/single-server-peak/nginx.graphql-audit.conf` de log `/graphql` trong 7 ngay truoc cutover
- chi remove `/graphql` sau khi access log xac nhan khong con consumer

Runtime metrics sau deploy:

- `GET /api/admin/dashboard/peak-runtime`
- tra ve req/min + p95 latency theo endpoint, hot-path buckets, queue export, va worker health
