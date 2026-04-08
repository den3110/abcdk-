# Observer VPS

This VPS is intended to handle five internal-only roles:

1. Backup metadata receiver
2. Realtime request/runtime observability
3. Read-only admin data API
4. Webhook and event inbox
5. Bastion or jump-host access

The codebase now includes a dedicated collector process at `backend/observerServer.js`.
It only mounts `/healthz` and `/api/observer/*`, so the VPS does not need to run
the full production API, socket layer, cron jobs, or media workers.

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

## Collector Configuration

Recommended `observer.env` on the VPS:

```env
NODE_ENV=production
TZ=Asia/Saigon
PORT=8787
OBSERVER_PORT=8787
OBSERVER_BIND_HOST=127.0.0.1
OBSERVER_API_KEY=replace-with-a-long-random-secret
OBSERVER_READ_API_KEY=replace-with-a-different-read-only-secret
MONGO_URI=mongodb://127.0.0.1:27017/pickletour_observer
MONGO_URI_PROD=mongodb://127.0.0.1:27017/pickletour_observer
```

`OBSERVER_BIND_HOST=127.0.0.1` keeps the collector private by default. Expose it
through SSH tunneling, Tailscale, WireGuard, or an authenticated reverse proxy only.

## Start The Collector

Install dependencies and start the minimal observer server:

```bash
npm ci
npm run observer:server
```

Systemd unit example is included in
`deploy/observer-vps/pickletour-observer.service`.

## Read-Only Endpoints

All read endpoints require the read key in `x-pkt-observer-key` or `Authorization: Bearer ...`.

```text
GET /api/observer/read/summary
GET /api/observer/read/events
GET /api/observer/read/runtime
GET /api/observer/read/backups
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
```

This is suitable for:

- production request forwarding from `httpLogger`
- periodic runtime snapshots from the main API
- third-party webhook audit copies
- backup completion metadata

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
