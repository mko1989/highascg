# OSC integration (CasparCG → HighAsCG)

HighAsCG listens for **Open Sound Control (OSC)** over **UDP** from CasparCG Server. **Production setups assume Caspar sends OSC to HighAsCG**; the UDP listener is always on except when the server is started with **`--no-osc`** (development or emergency). Caspar pushes channel mixer levels, stage/layer state, FFmpeg file timing, profiler timings, and output consumer status at frame rate. The Node app aggregates this in `OscState`, merges it into the main state manager, exposes **REST** and **WebSocket** APIs, and drives the web UI (VU strip, playback timer, etc.).

**Related:** [polling-vs-osc.md](./polling-vs-osc.md)

---

## Architecture

```
CasparCG Server
│
├── AMCP (TCP :5250)          commands / replies
│
└── OSC (UDP)  ──────────►  HighAsCG :listenPort (default **6251**; Caspar `<default-port>` stays **6250**)
         │
         ▼
    src/osc/osc-listener.js     UDP receive, parse bundles/messages
         │
         ▼
    src/osc/osc-state.js        aggregate per channel/layer, peak hold, throttled `change`
         │
         ├──► src/state/state-manager.js   updateFromOscSnapshot / clearOscMirror
         ├──► WebSocket `{ type: 'osc', data }`  (often ~20 Hz after throttle; optional delta payloads)
         ├──► src/osc/osc-variables.js     Companion-style variables when enabled
         └──► REST  /api/osc/*

         │  Browser
         ▼
    web/lib/osc-client.js       merges WS OSC payloads (full or delta)
         │
         └──► footer VU, playback-timer, now-playing, profiler-display, output-status, …
```

### Playback timer data flow (summary)

1. Caspar sends e.g. `/channel/1/stage/layer/10/file/time` with elapsed and total seconds.
2. `osc-state` stores `file.elapsed`, `file.duration`, computes `remaining` / `progress`.
3. Server broadcasts OSC snapshot (or delta) over WebSocket.
4. UI components subscribe via `OscClient` (`onLayerState`, `onAudioLevels`, …).

---

## CasparCG server configuration

Caspar must **send** OSC toward the machine running HighAsCG. Two common approaches:

1. **Predefined client** (persistent, no AMCP session required) — recommended for dedicated HighAsCG hosts.
2. **AMCP-associated client** — Caspar may also send OSC to the IP of an AMCP client (see Caspar wiki); HighAsCG’s generated config snippet prefers a predefined client.

### XML snippet (conceptual)

HighAsCG can emit a full `<osc>` block from the config generator (`buildOscConfigurationXml` in `src/config/config-generator.js`) when Companion/module `osc_port > 0`, including:

- `<default-port>` — Port Caspar uses for **its own** OSC server (incoming control). **Must not be the same UDP port** as HighAsCG’s listener on the **same machine**, or one process will fail to bind and you will see **no** OSC in the UI (`udpPacketsReceived` stays 0 in diagnostics).
- `<disable-send-to-amcp-clients>` — `false` if you want OSC mirrored to AMCP clients as well.
- `<predefined-clients><predefined-client>` — `<address>` must be the **IP** of the HighAsCG host (hostnames are not reliable per Caspar docs). `<port>` must equal HighAsCG **`osc.listenPort`** (where this app’s UDP listener binds — default **6251**).

Use **`GET /api/osc/config-hint`** for an XML fragment where `default-port` and predefined `port` are **split** correctly. Use **`GET /api/osc/diagnostics`** to confirm `udpPacketsReceived` increases while Caspar is running.

**Common mistake:** using the **same** UDP port for Caspar’s `<default-port>` (Caspar’s OSC server, typically **6250**) and HighAsCG’s listener — they must differ on one host. Defaults: Caspar **6250**, HighAsCG **6251**.

### Firewall

- Allow **UDP** inbound to HighAsCG’s `listenPort` from the CasparCG host.
- Ensure no other process binds the same UDP port on the HighAsCG machine.

---

## HighAsCG configuration

Defined in `config/default.js`, overridden by persisted `appSettings`, environment variables, CLI, and **Application Settings → Audio / OSC** in the web UI.

| Setting (concept) | Env / notes |
|-------------------|-------------|
| Listener on/off | **On by default.** Only **`--no-osc`** disables the UDP bind (not configurable via env/UI) |
| Listen port | `OSC_LISTEN_PORT` (default 6251) |
| Bind address | `OSC_BIND_ADDRESS` (default `0.0.0.0`) |
| Peak hold | `peakHoldMs` in config (UI) |
| WS delta mode | `HIGHASCG_OSC_WS_DELTA` / `config.osc.wsDeltaBroadcast` — partial channel updates on WS |

Implementation: `src/osc/osc-config.js` (`normalizeOscConfig`).

---

## REST API (OSC aggregate)

Base path: `/api/osc/`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/osc/state` | Full `OscState` snapshot (`channels`, `updatedAt`, …) |
| GET | `/api/osc/audio/:ch` | Audio mixer block for channel `ch` |
| GET | `/api/osc/layer/:ch/:layer` | Layer aggregate for channel/layer |
| GET | `/api/osc/profiler` | Per-channel profiler summaries |
| GET | `/api/osc/outputs` | Per-channel output port info |
| GET | `/api/osc/config-hint` | `text/xml` snippet for Caspar `casparcg.config` |

If the OSC listener is disabled, most endpoints return a small JSON payload indicating OSC is off; `config-hint` may still be generated for documentation.

Main HTTP state also includes `osc` and `ui` where applicable (`src/api/get-state.js`).

---

## WebSocket

Messages with `type: `'osc'` carry the aggregate snapshot or, when delta mode is enabled, a mergeable partial (`delta: true`, `channels: { "1": … }`). Clients should deep-merge by channel id when `delta` is set.

---

## OSC message reference (Caspar → HighAsCG)

Paths are OSC address patterns; `N` = channel (1-based), `L` = layer, `M` = mixer audio index (0-based), `P` = output port.

### Channel-level — `/channel/N/…`

| Address suffix | Args | Description |
|----------------|------|-------------|
| `format` | string | Video format (e.g. `1080p5000`) |
| `profiler/time` | float float | Actual vs expected frame time (s) |
| `output/port/P/type` | string | Consumer type: `screen`, `system-audio`, `decklink`, … |
| `output/port/P/frame` | int int | Frames written / max (file/stream) |

### Audio mixer — `/channel/N/mixer/audio/…`

| Address suffix | Args | Description |
|----------------|------|-------------|
| `nb_channels` | int | Audio channel count |
| `M/dBFS` | float | Level for mixer channel `M` (~25–60 updates/sec) |

### Stage / layer — `/channel/N/stage/layer/L/…`

| Address suffix | Args | Description |
|----------------|------|-------------|
| `time` | float | Seconds layer active |
| `frame` | int | Frames since layer started |
| `type` | string | Producer type (`ffmpeg`, `empty`, …) |
| `background/type` | string | LOADBG producer type |
| `profiler/time` | float float | Layer render actual/expected |
| `paused` | bool | Paused |

### FFmpeg producer — `/channel/N/stage/layer/L/…`

| Address suffix | Args | Description |
|----------------|------|-------------|
| `file/name` | string | Media name (relative) |
| `file/path` | string | Absolute path on server |
| **`file/time`** | **float float** | **Elapsed s, total s** — primary playback progress |
| `file/{stream-id}/fps` | float | Stream FPS |

Legacy / extra FFmpeg paths (still seen on some builds): `file/frame` (elapsed/total frames), `file/fps`, `file/video/*`, `file/audio/*`, `loop`, etc.

### HTML template — `/channel/N/stage/layer/L/host/…`

| Address suffix | Args | Description |
|----------------|------|-------------|
| `path`, `width`, `height`, `fps` | various | Template metadata |
| `buffer` | *(varies)* | Buffer state |

---

## Troubleshooting

| Symptom | Things to check |
|---------|-----------------|
| No OSC in UI / empty `osc` in state | Listener disabled (`--no-osc`, env, UI); Caspar not targeting this host:port; **UDP** firewall; wrong **IP** in predefined client (use numeric IP). |
| Port bind error | Another app using `listenPort`; try another port in UI + Caspar + firewall. |
| Stale or jumpy meters | Network loss; compare `emitIntervalMs` / `staleTimeoutMs`; verify Caspar is actually outputting (`nb_channels`, `dBFS`). |
| Playback timer blank or **stuck on last clip** | OSC not reaching app (`/api/osc/diagnostics`); wrong PGM channel. Newer Caspar uses `…/foreground/file/time`. Some codecs send sparse `file/time`; HighAsCG clears stale elapsed when **`foreground/producer`** or **`file/name`** / **`file/path`** changes so the header does not keep the previous clip’s time. |
| High CPU | Normal at high message rates; WS delta mode and throttling reduce broadcast size. |

---

## Reference files

| Path | Role |
|------|------|
| `src/osc/osc-listener.js` | UDP + parsing |
| `src/osc/osc-state.js` | Aggregation, peak hold, computed fields |
| `src/osc/osc-config.js` | Normalized config |
| `src/osc/osc-variables.js` | Variable bridge |
| `src/api/routes-osc.js` | REST |
| `src/config/config-generator.js` | Caspar `<osc>` XML for generated server config |
| `web/lib/osc-client.js` | Browser merge + subscriptions |

Caspar wiki (repo): `.reference/casparcg-wiki/Protocols/OSC-Protocol.md`
