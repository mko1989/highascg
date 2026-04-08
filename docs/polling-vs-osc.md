# Polling vs OSC in HighAsCG

CasparCG exposes rich state in two ways: **AMCP** (TCP, request/response) and **OSC** (UDP, push). HighAsCG uses OSC for real-time mixer, layer, playback, profiler, and output data where implemented, and keeps AMCP for commands and for **fallback** when OSC is off or incomplete.

**Related:** [osc-integration.md](./osc-integration.md)

---

## What OSC replaces (conceptually)

| AMCP / legacy approach | OSC source | Benefit |
|------------------------|------------|--------|
| `periodic-sync` → `INFO` / layer polling for status | `/channel/N/stage/layer/L/type`, `paused`, `time`, `frame`, … | Push updates at frame rate instead of every N seconds |
| `playback-tracker` matrix from command hooks only | `file/time`, `file/frame` on layers | Authoritative playback from server; works for external plays |
| `INFO` for clip progress | `file/time` (elapsed/total) | No TCP round-trip for progress |
| Companion variables from polled state | OSC-driven snapshot → variables | Finer-grained updates |
| Channel format from `INFO CONFIG` (where replaced) | `/channel/N/format` | Format changes without full config poll |
| *(No AMCP equivalent for live VU)* | `/channel/N/mixer/audio/M/dBFS` | **New** live mixer levels |
| Consumer health from `INFO` (where replaced) | `output/port/P/type`, `frame` | Push updates for outputs |

Exact behavior depends on build and config: some AMCP paths remain for **reconciliation**, **startup**, or when OSC is disabled.

---

## Performance comparison (typical)

| Aspect | AMCP polling | OSC push |
|--------|----------------|----------|
| Transport | TCP, synchronous commands per query | UDP, fire-and-forget |
| Cadence | User-defined interval (e.g. 3–30 s for full sync; OSC-aware paths may use longer intervals) | Frame rate for active addresses (often **25–60+ messages/sec** per hot channel) |
| Layer/channel cost | One or more `INFO`/`INFO channel-layer` per item per tick | Many small OSC messages; no per-query round trip |
| Suitability | Config, one-shot queries, fallback | Live meters, playback, layer state |

**Rule of thumb:** polling is appropriate for **occasional** consistency checks; OSC is appropriate for **continuous** UI and automation that must track **live** state.

---

## Periodic sync and OSC

`src/utils/periodic-sync.js` uses **config** (`periodic_sync_interval_sec`, `periodic_sync_interval_sec_osc`) and whether OSC is active:

- When **OSC is driving** state, expensive per-channel `INFO` loops can be **reduced or skipped** in favor of lighter CLS/TLS and **INFO CONFIG** style refresh on a longer cadence.
- When **OSC is off**, the app relies more on **AMCP** `INFO` and related polling to keep layer/channel state fresh.

Tune intervals via environment (see `index.js` / `HIGHASCG_PERIODIC_SYNC_*`) and persisted settings.

### `INFO 1` (or `INFO` on your program channel) every ~2 seconds

This is **not** the main periodic sync interval. **By default (OSC production)** this supplement is **off** — no periodic `INFO 1` spam. If you enable it (`startOscPlaybackInfoSupplement` in `src/utils/periodic-sync.js`), HighAsCG sends **`INFO` + program channel** on a fixed schedule for edge cases where OSC omits `file/time`.

**Why opt-in:** most installs get full playback data from OSC; AMCP `INFO` every ~2s was noisy in Caspar logs.

**Tune or enable**

| Goal | How |
|------|-----|
| OSC only (default) | Leave `osc_info_supplement_ms` unset / **`null`** / **`0`** (or omit `HIGHASCG_OSC_INFO_MS`) |
| Enable supplement | Set `osc_info_supplement_ms` ≥ **500** in `highascg.config.json` or env `HIGHASCG_OSC_INFO_MS` |

Minimum when enabled: **500** ms.

---

## Fallback when OSC is unavailable

1. **Listener disabled** (`--no-osc` only): no UDP bind; `oscState` is absent; REST `/api/osc/*` returns disabled messaging; WebSocket does not emit live OSC payloads.
2. **Caspar not sending** (wrong IP/port, firewall, Caspar config): listener runs but **no** or **stale** data; UI components should treat missing data as empty; **periodic-sync** and **AMCP** paths remain for reconciliation.
3. **Partial data**: e.g. non-FFmpeg layer — `file/time` may be absent; UI falls back to neutral/muted display (see individual components).

---

## When to prefer AMCP

- **Commands**: `PLAY`, `LOAD`, `CG`, mixer routes, etc. — always AMCP (or HTTP batching to AMCP).
- **One-shot** diagnostics: sometimes a single `INFO` or `VERSION` is simpler than inferring from OSC.
- **No UDP path**: networks that block UDP may require polling-only operation (not ideal for VU).

---

## Configuration pointers

- OSC listener: `config/osc` + env in [osc-integration.md](./osc-integration.md#highascg-configuration).
- Polling intervals: app settings + `HIGHASCG_PERIODIC_SYNC_SEC` / `HIGHASCG_PERIODIC_SYNC_OSC_SEC`.
- OSC + AMCP `INFO` supplement: `osc_info_supplement_ms` / `HIGHASCG_OSC_INFO_MS` (see section above).
