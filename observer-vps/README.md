# observer-vps

Go collector dành riêng cho VPS observer của PickleTour.

Chức năng chính:

- nhận log/runtime/backup từ server chính
- nhận telemetry trực tiếp từ app live
- lưu trạng thái máy live hiện tại để xem trên dashboard
- hiển thị cảnh báo overlay, memory pressure, thermal degrade, recovery state

Chạy local:

```bash
cd observer-vps
go run ./cmd/observer
```

Build image:

```bash
docker build -f observer-vps/Dockerfile -t ghcr.io/your-org/pickletour-observer:latest .
```
