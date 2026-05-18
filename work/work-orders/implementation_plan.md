# Low-Latency Tiered Preview Architecture

Replace the current SRT-only pipeline with a priority-based capture system that picks the lowest-latency method available.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Priority Chain                               │
│                                                                     │
│  Tier 1 (Local, lowest latency)                                     │
│  CasparCG → X11 Window → kmsgrab/x11grab → NVENC → go2rtc → WebRTC │
│                                                                     │
│  Tier 2 (Networked, low latency)                                    │
│  CasparCG → NDI output → ffmpeg libndi → NVENC → go2rtc → WebRTC   │
│                                                                     │
│  Tier 3 (Fallback, current)                                         │
│  CasparCG → ADD STREAM SRT → go2rtc ffmpeg:srt:// → WebRTC         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## User Review Required

> [!IMPORTANT]
> **Tier 1 (Local Capture)** works because go2rtc supports `exec:` sources — we spawn FFmpeg directly and pipe its output into go2rtc **without any intermediate protocol** (no SRT, no RTSP). This is the key to low latency: `ffmpeg → stdout → go2rtc → WebRTC` is essentially zero-copy at the mux level.

> [!WARNING]
> **NDI requires `libndi`** on the server. The install script already sets up NDI SDK v6, so `ffmpeg -f libndi_newtek_input` should work. However, CasparCG must have NDI consumers added to the target channels (via `ADD channel NDI "name"`).

## Proposed Changes

---

### [Component] Streaming Engine

#### [MODIFY] [go2rtc-manager.js](file:///Users/marcin/companion-module-dev/HighAsCG/src/streaming/go2rtc-manager.js)
- **Replace `generateYaml()`** with a tiered source generator:
  - **Tier 1 — `exec:` source** (local capture, no intermediate protocol):
    ```yaml
    streams:
      pgm_1:
        - "exec:ffmpeg -f x11grab -framerate 25 -i :0.0 -c:v h264_nvenc -preset p1 -tune ll -b:v 2000k -g 50 -f rtsp {output}"
    ```
    Active when `casparHost === '127.0.0.1'` or `streaming.captureMode === 'local'`.
  - **Tier 2 — `exec:` source** (NDI receiver):
    ```yaml
    streams:
      pgm_1:
        - "exec:ffmpeg -f libndi_newtek_input -i 'CasparCG Channel 1' -c:v h264_nvenc -preset p1 -tune ll -b:v 2000k -f rtsp {output}"
    ```
    Active when `streaming.captureMode === 'ndi'`.
  - **Tier 3 — current SRT** (fallback):
    ```yaml
    streams:
      pgm_1:
        - "ffmpeg:srt://host:port?mode=caller#video=h264#hardware"
    ```
    Active when `streaming.captureMode === 'srt'` or as final fallback.

#### [MODIFY] [caspar-ffmpeg-setup.js](file:///Users/marcin/companion-module-dev/HighAsCG/src/streaming/caspar-ffmpeg-setup.js)
- When `captureMode === 'local'`: **skip** `ADD STREAM` entirely (capture is external via x11grab).
- When `captureMode === 'ndi'`: send `ADD channel NDI "HighAsCG PGM"` instead of SRT consumers.
- When `captureMode === 'srt'`: keep current behavior.

#### [MODIFY] [stream-config.js](file:///Users/marcin/companion-module-dev/HighAsCG/src/streaming/stream-config.js)
- Add new config field: `streaming.captureMode: 'auto' | 'local' | 'ndi' | 'srt'`
- `auto` logic: if `casparHost === '127.0.0.1'` → try `local`, else if NDI available → `ndi`, else → `srt`.

---

### [Component] Settings UI

#### [MODIFY] [settings-modal.js](file:///Users/marcin/companion-module-dev/HighAsCG/web/components/settings-modal.js)
- **Capture tier** dropdown: `Auto`, `Local (kmsgrab/x11grab)`, `NDI`, `SRT`.
- **NDI source names**: `Auto` (FFmpeg discovery + CasparCG default pattern), `Pattern only`, `Custom` (PGM / Preview / Multiview strings).
- **Discover NDI sources** button — calls `GET /api/streaming/ndi-sources`.

---

### [Component] Installer

#### [MODIFY] [install.sh](file:///Users/marcin/companion-module-dev/HighAsCG/scripts/install.sh)
- Ensure `ffmpeg` is installed with `x11grab`, `kmsgrab` (via `libdrm`), and system `libndi` for FFmpeg’s NDI input where the package supports it.
- Audit table lists FFmpeg and prints whether `kmsgrab` / `x11grab` appear in `ffmpeg -devices`.
- **`casparcg` user** remains in `video` and `render` groups for DRM/KMS access (kmsgrab).

---

## Latency Comparison

| Mode | Encode | Transport | Decode | Est. Total |
|------|--------|-----------|--------|------------|
| **Local (x11grab)** | NVENC (~2ms) | stdout pipe (0ms) | WebRTC (~20ms) | **~25ms** |
| **NDI** | NVENC (~2ms) | NDI LAN (~5ms) | WebRTC (~20ms) | **~30ms** |
| **SRT (current)** | libx264 (~30ms) | SRT buffer (~100ms) | go2rtc re-encode (~30ms) + WebRTC (~20ms) | **~180ms+** |

## Decisions (resolved)

1. **kmsgrab vs x11grab**: **Default to `kmsgrab` with `x11grab` fallback** — implemented in `go2rtc-manager.js` (`detectLocalCaptureDevice`). The production **`install.sh`** installs `ffmpeg` (+ DRM libs), ensures the `casparcg` user is in `video`/`render`, and audits that FFmpeg exposes `kmsgrab` / `x11grab` devices where available.
2. **NDI channel naming**: **Auto-detect and custom** — `ndiNamingMode`: `auto` runs FFmpeg NDI source listing when possible and matches names like `CasparCG Channel N`; falls back to the standard pattern. `pattern` uses `ndiSourcePattern` only. `custom` uses per-channel `ndiChannelNames`. Settings UI + `/api/streaming/ndi-sources` for discovery.

## Verification Plan

### Automated Tests
- `npm run smoke` to verify config changes.
- Verify go2rtc YAML generation for each tier.

### Manual Verification
1. Run with `captureMode: 'local'` on the production server, verify WebRTC preview loads.
2. Run with `captureMode: 'ndi'` from a remote client, verify stream.
3. Verify `auto` mode correctly detects the environment.
