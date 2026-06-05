# Streaming, audio & OSC

## WebRTC / preview streams

| Method | Path | Caspar | Description |
|--------|------|--------|-------------|
| GET | `/api/streams` | optional | Pipeline status, ports |
| GET | `/api/streaming/ndi-sources` | optional | NDI source names for streaming UI |
| POST | `/api/streaming/toggle` | optional | Start/stop consumers |
| POST | `/api/streaming/restart` | optional | Restart streaming |

```bash
curl -s http://127.0.0.1:4200/api/streams | jq .
```

## Streaming channel (RTMP / record)

| Method | Path |
|--------|------|
| GET | `/api/streaming-channel` |
| POST | `/api/streaming-channel/rtmp` |
| POST | `/api/streaming-channel/record` |

## Audio

Most routes work **without Caspar** for enumeration; routing to Caspar needs AMCP when applying filters.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/audio/devices` | ALSA/PipeWire devices |
| GET | `/api/audio/portaudio-devices` | PortAudio enumeration |
| GET | `/api/audio/live-inputs` | Live input config |
| POST | `/api/audio/config` | Persist `audioRouting` |
| POST | `/api/audio/volume` | Layer/master volume |
| POST | `/api/audio/route` | Route buses |
| POST | `/api/audio/default-device` | Default output device |
| POST | `/api/audio/monitor-source` | Browser monitor bus |
| POST | `/api/audio/solo` | Solo layers |
| POST | `/api/audio/live-inputs/apply` | Apply live inputs to Caspar |
| POST | `/api/audio/live-inputs/config` | Save live input mapping |

```bash
curl -s http://127.0.0.1:4200/api/audio/devices | jq .
```

## OSC (Caspar → HighAsCG)

UDP listener on **`OSC_LISTEN_PORT`** (default **6251**). HTTP exposes aggregated state:

| Method | Path |
|--------|------|
| GET | `/api/osc/state` |
| GET | `/api/osc/diagnostics` |
| GET | `/api/osc/profiler` |
| GET | `/api/osc/outputs` |
| GET | `/api/osc/config-hint` |

See [osc-integration.md](../../osc-integration.md).

## Artnet

| Method | Path |
|--------|------|
| GET | `/api/artnet/input` |
