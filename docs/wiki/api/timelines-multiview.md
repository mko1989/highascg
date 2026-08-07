# Multiview & NDI

## Timelines

**Full reference:** [timelines.md](timelines.md) — CRUD, transport (`play`/`pause`/`stop`/`seek`), `sendTo`, `take`, data model, WebSocket.

## Multiview

| Method | Path |
|--------|------|
| POST | `/api/multiview/apply` |

Applies multiview layout from persisted project/config (see `routes-multiview.js`).

## NDI

**Caspar:** required.

| Method | Path |
|--------|------|
| GET | `/api/ndi/list` |

Lists NDI sources available to Caspar/FFmpeg consumers.
