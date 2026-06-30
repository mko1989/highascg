# HighAsCG wiki

Operator and integrator documentation beyond the top-level [docs/](../README.md) guides.

## HTML wiki (browser UI)

Standalone static site — **not served by the playout server**. Open in any browser:

```text
docs/wiki-site/index.html
```

From the repo root:

```bash
npm run wiki:build    # after editing markdown under docs/
npm run wiki:open     # Linux/macOS shortcut
```

Or double-click `docs/wiki-site/index.html`. All page content is embedded in `assets/wiki-bundle.js` at build time (works with `file://` — no server required).

## Installation (from live USB)

| Page | Contents |
|------|----------|
| [**install/calamares-install-to-disk.md**](install/calamares-install-to-disk.md) | **Calamares** — **disable CSM**, launch, pick disk, **Erase** vs manual **`bios_grub`** + `/` |
| [../CALAMARES_INSTALL_TO_DISK.md](../CALAMARES_INSTALL_TO_DISK.md) | Full install guide (partition tables, rsync 11, session.log) |

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
| [**api/project.md**](api/project.md) | **Project** — save/load/bundle/sync, **USB/bridge volume catalog** |
| [**api/state-and-media.md**](api/state-and-media.md) | **State**, variables, media, thumbnails |
| [api/project-state-media.md](api/project-state-media.md) | Index → project + state pages |
| [**api/timelines.md**](api/timelines.md) | **Timelines** — CRUD, play/seek/take, sendTo |
| [api/timelines-multiview.md](api/timelines-multiview.md) | Multiview, NDI |
| [api/streaming-audio-osc.md](api/streaming-audio-osc.md) | WebRTC streams, RTMP/record, audio routing, OSC |
| [api/system-settings-hardware.md](api/system-settings-hardware.md) | Settings, GPU, Caspar config, logs, exFAT sync, device view |
| [**api/network-tailscale.md**](api/network-tailscale.md) | **Tailscale** — status, login, operator-monitor UI |
| [api/ingest-usb-plugins.md](api/ingest-usb-plugins.md) | Ingest, USB import, plugins, optional modules |

Legacy single-file overview (partial): [../api-reference.md](../api-reference.md) — prefer the wiki for completeness.
