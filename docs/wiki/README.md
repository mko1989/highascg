# HighAsCG wiki

Operator and integrator documentation beyond the top-level [docs/](../README.md) guides.

## API reference (OpenAPI-style)

| Page | Contents |
|------|----------|
| [api/README.md](api/README.md) | Base URL, auth, Caspar gate, response format, WebSocket |
| [api/openapi.yaml](api/openapi.yaml) | OpenAPI 3.1 (core routes fully specified) |
| [**api/scene-take.md**](api/scene-take.md) | **`POST /api/scene/take`** — request/response schemas, PGM/PRV, examples |
| [**api/playback.md**](api/playback.md) | **Playback** — play/load/loadbg, transport, swap/call, playbackMatrix |
| [api/playback-and-amcp.md](api/playback-and-amcp.md) | AMCP batch/raw, print, restart, server control |
| [**api/mixer.md**](api/mixer.md) | **Mixer** — opacity/fill/crop, defer/commit, effects |
| [api/mixer-cg-scene.md](api/mixer-cg-scene.md) | FTB, LED test card, PiP |
| [**api/cg.md**](api/cg.md) | **CG** — `/api/cg/{command}` |
| [**api/project.md**](api/project.md) | **Project** — save/load/bundle/sync |
| [**api/state-and-media.md**](api/state-and-media.md) | **State**, variables, media, thumbnails |
| [api/project-state-media.md](api/project-state-media.md) | Index → project + state pages |
| [**api/timelines.md**](api/timelines.md) | **Timelines** — CRUD, play/seek/take, sendTo |
| [api/timelines-multiview.md](api/timelines-multiview.md) | Multiview, NDI |
| [api/streaming-audio-osc.md](api/streaming-audio-osc.md) | WebRTC streams, RTMP/record, audio routing, OSC |
| [api/system-settings-hardware.md](api/system-settings-hardware.md) | Settings, GPU, Caspar config, logs, exFAT sync, device view |
| [api/ingest-usb-plugins.md](api/ingest-usb-plugins.md) | Ingest, USB import, plugins, optional modules |

Legacy single-file overview (partial): [../api-reference.md](../api-reference.md) — prefer the wiki for completeness.
