# Ingest, USB, plugins & modules

## Media ingest

**Caspar:** not required for upload/download.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ingest/upload` | Multipart/stream upload |
| POST | `/api/ingest/download` | Queue remote download |
| GET | `/api/ingest/download-status` | Download job status |
| GET | `/api/ingest/preview` | Preview URL/metadata (query) |

## USB import (WO-29)

| Method | Path |
|--------|------|
| GET | `/api/usb/drives` |
| POST | `/api/usb/mount` |
| GET | `/api/usb/browse` |
| GET | `/api/usb/import-status` |
| POST | `/api/usb/import` |
| POST | `/api/usb/import-cancel` |
| POST | `/api/usb/eject` |

### List USB drives

Returns mounted volumes (`drives`) and, on Linux, removable partitions that are plugged in but not yet mounted (`unmounted`).

```bash
curl -s http://127.0.0.1:4200/api/usb/drives | jq .
```

### Mount a removable volume (Linux)

```bash
curl -s -X POST http://127.0.0.1:4200/api/usb/mount \
  -H 'Content-Type: application/json' \
  -d '{"blockDevice":"/dev/sdb1"}' | jq .
```

Uses `udisksctl` (polkit / `plugdev` — no sudo). The Import from USB modal calls this when you click **Mount**.

## Plugins

| Method | Path |
|--------|------|
| GET | `/api/plugins` |
| POST | `/api/plugins/add` |

## Optional modules

Enabled modules register extra API prefixes. Discover enabled modules:

```bash
curl -s http://127.0.0.1:4200/api/modules | jq .
```

Built-in module API prefixes (when enabled in config):

| Prefix | Module |
|--------|--------|
| `/api/previs` | Previs / 3D |
| `/api/tracking` | Tracking |
| `/api/autofollow` | Auto-follow |
| `/api/cg-studio` | CG studio |

Each module implements its own paths under that prefix; see `src/*/register.js` and [MODULES.md](../../MODULES.md).
