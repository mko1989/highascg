# HighAsCG Master Technical Wiki

Developer reference compiled from production scripts, `src/api` routes, and smoke tests.

## Canonical API docs (OpenAPI-style)

For **complete HTTP endpoint coverage** (curl examples, OpenAPI YAML, per-topic pages), use the in-repo wiki:

| Index | Path |
|-------|------|
| **HTML wiki** | Open [`docs/wiki-site/index.html`](../../docs/wiki-site/index.html) in your browser |
| Wiki home | [`docs/wiki/README.md`](../../docs/wiki/README.md) |
| API overview | [`docs/wiki/api/README.md`](../../docs/wiki/api/README.md) |
| Project save/load + volume sync | [`docs/wiki/api/project.md`](../../docs/wiki/api/project.md) |
| Bridge + USB storage | [`docs/BRIDGE_DISK_AND_USB_EXFAT.md`](../../docs/BRIDGE_DISK_AND_USB_EXFAT.md) |

## Deep-dive chapters (this folder)

These chapters focus on **implementation mechanics** — exact payloads, bash sequences, and test harness details.

| Chapter | File | Topics |
|---------|------|--------|
| 1 | [WO_01_Document_API_Endpoints.md](WO_01_Document_API_Endpoints.md) | AMCP bridge, WebSocket, project save guards |
| 2 | [WO_02_Installation_And_Deployment_Guide.md](WO_02_Installation_And_Deployment_Guide.md) | `install-phase*.sh`, dev-push, NVIDIA pin |
| 3 | [WO_03_Hardware_And_OS_Hooks.md](WO_03_Hardware_And_OS_Hooks.md) | exFAT sync, GPU layout, staged Caspar, **project volume sync** |
| 4 | [WO_04_Testing_And_Smoke_Scripts.md](WO_04_Testing_And_Smoke_Scripts.md) | Offline AMCP tests, integration env vars, volume sync tests |

> **Caspar gate:** AMCP routes return `503` with `{ "error": "Caspar not connected" }` when Caspar is down. Settings, project disk I/O, hardware probes, and exFAT sync work without Caspar.
