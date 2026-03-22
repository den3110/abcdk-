# Single Server Peak Notes

Muc tieu file nay la khoa topology cho `4 core / 8GB`:

- `API`: 2 PM2 cluster instances
- `RTMP relay`: process rieng
- `recording worker`: process rieng, `ffmpeg threads = 1`
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

Lenh PM2 tham khao:

```bash
pm2 start deploy/single-server-peak/ecosystem.peak.config.js
pm2 scale pickletour-recording-worker 0
pm2 scale pickletour-recording-worker 1
```

Y nghia:

- ban ngay: co the scale worker ve `0` neu muon cat hoan toan ffmpeg export
- ban dem: scale worker len `1` de merge/export queue
- neu van de worker chay ban ngay, export window van giu da so recording o trang thai `pending_export_window`

Runtime metrics sau deploy:

- `GET /api/admin/dashboard/peak-runtime`
- tra ve req/min + p95 latency theo endpoint, hot-path buckets, queue export, va worker health
