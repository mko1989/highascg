# AMCP bridge & server control

**Caspar:** required for all routes on this page.

Base: `http://<host>:4200`

## Playback (layer commands)

**Full reference:** [playback.md](playback.md) — `POST /api/play`, `/api/load`, `/api/loadbg`, pause/resume/stop/clear, call/swap, add/remove, `playbackMatrix`, clip/transition fields.

## AMCP bridge {#amcp-bridge}

### `POST /api/amcp/batch`

Preferred for multiple lines. **Do not** wrap in `BEGIN`/`COMMIT` in the array — the client adds batching.

```json
{
  "commands": [
    "CLEAR 1",
    "PLAY 1-10 AMB",
    "MIXER 1 COMMIT"
  ]
}
```

`MIXER {ch} COMMIT` must be **outside** BEGIN/COMMIT batches (send as its own line or after batch completes).

### `POST /api/amcp/raw-batch` · `POST /api/raw` · `POST /api/amcp/raw`

Sequential raw AMCP (max 4000 lines per raw-batch). Single line for `/api/raw`.

### `POST /api/print` · `POST /api/amcp/print`

Body: `{ "channel": 1 }`.

### Logging & server

| Method | Path | Body / notes |
|--------|------|----------------|
| POST | `/api/log/level` | `{ "level": "trace" }` |
| POST | `/api/log/category` | `{ "category": "calltrace", "enable": true }` |
| POST | `/api/ping` | — |
| POST | `/api/restart` | Restart Caspar |
| POST | `/api/kill` | Kill Caspar |
| POST | `/api/diag` | Diagnostics |
| POST | `/api/gl/gc` | GL garbage collect |
| POST | `/api/channel-grid` | Channel grid |
| POST | `/api/set` | Channel SET |
| POST | `/api/lock` | Channel lock |

## Related

- [Mixer, CG & scene](mixer-cg-scene.md)
- [State & channels](project-state-media.md#state--query)
