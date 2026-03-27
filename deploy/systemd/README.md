# Go Runtime Systemd Units

Install the built Go binaries under:

- `/var/www/pickletour/backend-go/bin/pickletour-api`
- `/var/www/pickletour/backend-go/bin/pickletour-relay-rtmp`
- `/var/www/pickletour/backend-go/bin/pickletour-scheduler`
- `/var/www/pickletour/backend-go/bin/pickletour-worker-recording-export`
- `/var/www/pickletour/backend-go/bin/pickletour-worker-ai-commentary`
- `/var/www/pickletour/backend-go/bin/pickletour-worker-general`

Copy the `.service` files in this directory to `/etc/systemd/system/`, then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pickletour-api
sudo systemctl enable --now pickletour-relay-rtmp
sudo systemctl enable --now pickletour-scheduler
sudo systemctl enable --now pickletour-worker-recording-export
sudo systemctl enable --now pickletour-worker-ai-commentary
sudo systemctl enable --now pickletour-worker-general
```
