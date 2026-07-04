# WO-119 — Split server config, Caspar, replication & utils over 500 lines

> **⚠️ AGENT COLLABORATION PROTOCOL** — see [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)

**Parent:** [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)  
**Status:** Done  
**Priority:** **Medium**

**Touches:** `src/config/`, `src/caspar/`, `src/replication/`, `src/utils/`

---

## 1. Problem

| Lines | File |
|------:|------|
| 589 | `src/config/build-caspar-generator-config.js` |
| 554 | `src/config/decklink-output-resolve.js` |
| 546 | `src/replication/replication-service.js` |
| 524 | `src/utils/os-config.js` |
| 505 | `src/caspar/amcp-client.js` |
| 502 | `src/utils/gpu-topology-drm.js` |

---

## 2. Split plan

### 2.1 `build-caspar-generator-config.js` (589)

| New module | Responsibility |
|------------|----------------|
| `build-caspar-config-channels.js` | channel/consumer blocks |
| `build-caspar-config-routing.js` | routing map → Caspar XML/JSON |
| `build-caspar-config-decklink.js` | DeckLink device stanzas |

Existing pattern: keep single exported `buildCasparGeneratorConfig(ctx)` in aggregator.

### 2.2 `decklink-output-resolve.js` (554)

| New module | Responsibility |
|------------|----------------|
| `decklink-output-resolve-enum.js` | device/mode enumeration |
| `decklink-output-resolve-map.js` | output index → connector mapping |

### 2.3 `replication-service.js` (546)

| New module | Responsibility |
|------------|----------------|
| `replication-service-leader.js` | leader push, fanout |
| `replication-service-follower.js` | apply mirror, reconcile |
| `replication-service-shared.js` | role state, timers |

Prefer moving logic into existing `src/replication/*` modules rather than duplicating.

### 2.4 `os-config.js` (524)

| New module | Responsibility |
|------------|----------------|
| `os-config-xrandr.js` | xrandr read/write helpers |
| `os-config-nvidia.js` | nvidia-settings / persistence |
| `os-config-paths.js` | `/etc/highascg`, script paths |

### 2.5 `amcp-client.js` (505)

| New module | Responsibility |
|------------|----------------|
| `amcp-client-transport.js` | TCP connect, line protocol |
| `amcp-client-commands.js` | command builders used by routes/engine |
| `amcp-client-parse.js` | response parsing |

Align with `casparcg-connection` usage — don't duplicate library features.

### 2.6 `gpu-topology-drm.js` (502)

| New module | Responsibility |
|------------|----------------|
| `gpu-topology-drm-parse.js` | modetest/drm debug parse |
| `gpu-topology-drm-merge.js` | merge with xrandr topology |

---

## 3. Tasks

- [x] **T119.0** Split build-caspar-generator-config; run `npm run test:config-generator`.
- [x] **T119.1** Split decklink-output-resolve + gpu-topology-drm; GPU smokes pass.
- [x] **T119.2** Split replication-service; replication test suite pass.
- [x] **T119.3** Split os-config + amcp-client.
- [x] **T119.4** All six originals ≤ 500 lines.

---

## 4. Verification

```bash
npm run lint
npm run test:config-generator
npm run test:gpu-topology
npm run test:replication
npm run test:highascg:parity
```

---

## Work Log

### 2026-07-03 — Created

- **Instructions for Next Agent:** Split `build-caspar-generator-config.js` by output section — already implied by generator structure.

### 2026-07-03 — amcp-client + gpu-topology-drm

| File | Before | After |
|------|-------:|------:|
| `amcp-client.js` | 506 | 53 |
| `gpu-topology-drm.js` | 503 | 7 (hub) |

**amcp-client children:** `-static`, `-history`, `-transport`, `-commands`  
**gpu-topology-drm children:** `-parse`, `-rows`, `-merge`

`check:file-lines` — 14 files remain over 500.

### 2026-07-03 — build-caspar-generator-config

| File | Before | After |
|------|-------:|------:|
| `build-caspar-generator-config.js` | 590 | 166 |

**Children:** `build-caspar-config-routing.js`, `build-caspar-config-decklink.js`, `build-caspar-config-audio.js`

Also split `logs-modal.js` (571→414) + `logs-modal-filter.js` (WO-120 adjacent).

`check:file-lines` — 12 files remain over 500.

### 2026-07-03 — os-config + replication-service (+ decklink verify)

| File | Before | After |
|------|-------:|------:|
| `os-config.js` | 542 | 36 (hub) |
| `replication-service.js` | 579 | 259 |
| `decklink-output-resolve.js` | 555 | hub (prior session) |

**os-config children:** `-persist`, `-xrandr-apply`  
**replication-service children:** `-runtime`, `-status`

`check:file-lines` — 7 files remain over 500 (WO-120 only).
