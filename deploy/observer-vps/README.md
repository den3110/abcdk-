# Observer VPS

This VPS is intended to handle five internal-only roles:

1. Backup metadata receiver
2. Realtime request and runtime observability
3. Read-only admin data API
4. Webhook and event inbox
5. Bastion or jump-host access

Preferred deployment now is the dedicated Go collector:

- source: `observer-vps/cmd/observer`
- container image build: `observer-vps/Dockerfile`
- compose example: `deploy/observer-vps/docker-compose.observer.yml`

The main Node API remains the producer. It forwards request events and runtime
snapshots to the observer collector. The VPS only needs the Go observer image and Mongo.

## Source Server Configuration

Configure the production API to push request events and runtime snapshots to the VPS:

```env
OBSERVER_BASE_URL=http://127.0.0.1:8787
OBSERVER_API_KEY=replace-with-a-long-random-secret
OBSERVER_READ_API_KEY=replace-with-a-different-read-only-secret
OBSERVER_SOURCE_NAME=pickletour-api-main
OBSERVER_SINK_ENABLED=true
OBSERVER_RUNTIME_PUSH_ENABLED=true
OBSERVER_RUNTIME_PUSH_INTERVAL_MS=15000
```

If the observer box is on another host, replace `OBSERVER_BASE_URL` with the private
IP, Tailscale IP, or internal load-balancer URL of that VPS.

## Build And Push The Image

Build from the repo root:

```bash
docker build -f observer-vps/Dockerfile -t ghcr.io/your-org/pickletour-observer:latest .
docker push ghcr.io/your-org/pickletour-observer:latest
```

## Collector Configuration

Recommended `.env` on the VPS:

```env
NODE_ENV=production
OBSERVER_PORT=8787
OBSERVER_BIND_HOST=0.0.0.0
OBSERVER_API_KEY=replace-with-a-long-random-secret
OBSERVER_READ_API_KEY=replace-with-a-different-read-only-secret
JWT_SECRET=use-the-same-jwt-secret-as-main-backend-if-apps-send-direct-telemetry
MONGO_URI=mongodb://observer-mongo:27017/pickletour_observer
MONGO_URI_PROD=mongodb://observer-mongo:27017/pickletour_observer
MONGO_DB_NAME=pickletour_observer
OBSERVER_EVENT_TTL_DAYS=7
OBSERVER_RUNTIME_TTL_DAYS=14
OBSERVER_BACKUP_TTL_DAYS=60
OBSERVER_LIVE_DEVICE_TTL_DAYS=3
OBSERVER_LIVE_DEVICE_STALE_MS=30000
```

Nếu chạy bằng `docker compose` trong repo này, phải dùng hostname `observer-mongo`
như trên. Chỉ dùng `127.0.0.1` khi bạn không chạy Mongo trong container riêng và
observer process chạy trực tiếp trên host VPS.

Keep the published port private by default. Prefer one of these:

- bind Docker port to `127.0.0.1`
- expose only on Tailscale or WireGuard
- allow only the main server IP through the VPS firewall

## Run On The VPS

Copy these two files to the VPS:

- `deploy/observer-vps/docker-compose.observer.yml`
- `deploy/observer-vps/.env.example` as `.env`

Then start:

```bash
docker compose -f docker-compose.observer.yml up -d
docker compose -f docker-compose.observer.yml ps
curl http://127.0.0.1:8787/healthz
```

If you want a non-Docker fallback, a bare-metal systemd unit for the Go binary is
included in `deploy/observer-vps/pickletour-observer.service`.

Dashboard URL after tunnel or private access:

```text
GET /dashboard
```

## Read-Only Endpoints

All read endpoints require the read key in `x-pkt-observer-key`.

```text
GET /api/observer/read/summary
GET /api/observer/read/events
GET /api/observer/read/runtime
GET /api/observer/read/backups
GET /api/observer/read/live-devices
```

Example:

```bash
curl -H "x-pkt-observer-key: $OBSERVER_READ_API_KEY" \
  "http://127.0.0.1:8787/api/observer/read/summary?minutes=60"
```

## Event Inbox

Anything that should be accepted inbound and stored cheaply can post to:

```text
POST /api/observer/ingest/events
POST /api/observer/ingest/runtime
POST /api/observer/ingest/backups
POST /api/observer/ingest/live-devices/heartbeat
POST /api/observer/ingest/live-devices/event
```

This is suitable for:

- production request forwarding from `httpLogger`
- periodic runtime snapshots from the main API
- direct live-device telemetry from the iOS live app
- third-party webhook audit copies
- backup completion metadata

Direct app telemetry auth options:

- main backend uses `OBSERVER_API_KEY`
- live app can post directly with `Authorization: Bearer <app-jwt>`
- to allow that, set `JWT_SECRET` on the observer VPS to the same value as the main backend
- set `System Settings -> links.liveObserverUrl` to the private observer URL so the live app receives it from bootstrap
- keep `PTLiveObserverBaseURL` only as a local/dev fallback if needed

## Backup Metadata Push

The main server can publish backup metadata with:

```bash
npm run observer:backup-snapshot -- \
  --scope=mongodb \
  --type=mongodump \
  --status=ok \
  --sizeBytes=123456789 \
  --durationMs=45231 \
  --manifestUrl=s3://pickletour-backups/mongo/2026-04-08.tgz \
  --checksum=sha256:replace-me \
  --note=nightly-backup
```

That command uses the same `OBSERVER_BASE_URL` and `OBSERVER_API_KEY` env values
as the source server.

## Bastion Access

Keep the observer API private and access it through an SSH tunnel when needed:

```bash
ssh -L 8787:127.0.0.1:8787 user@observer-vps
```

After that, local tools or admin dashboards can query `http://127.0.0.1:8787`
without exposing the collector publicly.

## Health Check

```bash
curl http://127.0.0.1:8787/healthz
```
