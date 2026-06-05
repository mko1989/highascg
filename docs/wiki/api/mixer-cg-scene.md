# CG, scene & overlays

**Caspar:** required unless noted.

## Mixer

**Full reference:** [mixer.md](mixer.md) — all `/api/mixer/{command}` routes, `defer`/`commit`, `fill` stretch modes, `effect` types, UI selection sync.

## CG (HTML templates)

**Full reference:** [cg.md](cg.md)

## Scene

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scene/live` | Live program/preview scene IDs per channel |
| POST | `/api/scene/take` | **Full reference:** [scene-take.md](scene-take.md) |
| POST | `/api/scene/border-lines` | Returns AMCP lines for border preset |
| POST | `/api/scene/border-preset-crossfade` | Crossfade border lines |

### `GET /api/scene/live`

```bash
curl -s http://127.0.0.1:4200/api/scene/live | jq .
```

## FTB · LED test · PiP

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/ftb` | Fade to black |
| POST | `/api/led-test-card` | Startup/output test pattern |
| GET | `/api/pip-overlay/templates` | PiP template list |
| POST | `/api/pip-overlay/apply` | Apply PiP |
| POST | `/api/pip-overlay/update` | Update PiP |
| POST | `/api/pip-overlay/remove` | Remove PiP |

## Multiview

| Method | Path |
|--------|------|
| POST | `/api/multiview/apply` |

See [timelines.md](timelines.md) and [timelines-multiview.md](timelines-multiview.md).
