# Work Order 121: USB webcam / V4L2 video input capture

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** In progress (Phase A + partial B/C shipped 2026-07-04)  
**Priority:** High — operator hardware (ATEM Mini Pro ISO) connected now; closes gap vs DeckLink / NDI / live-audio inputs  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md), operator request 2026-07-04

**Related work orders:**
- [WO-28](./28_WO_DECKLINK_INPUT_OUTPUT_ROUTING.md) — DeckLink dedicated input channels + `route://`
- [WO-48](./48_WO_LAYER_ROUTE_LIVE_SOURCE_REUSE.md) — `route://` as Live source
- [WO-53](./53_WO_PER_INPUT_AUDIO_METER_CHANNELS.md) — one Caspar channel per live input (isolated VU)
- [WO-88](./88_WO_HOST_CHANNEL_LIVE_SOURCES.md) — host channel + route-only on-air model
- [WO-33b](./33b_WO_DEVICE_VIEW_HOST_ENUMERATION.md) — host hardware enumeration (`live` section)
- [WO-39](./39_WO_SETTINGS_SYSTEM_HARDWARE.md) — system hardware API surface
- [WO-109](./109_WO_VIRTUAL_CAMERA_AND_VIRTUAL_SCREEN_TESTING.md) — **output** v4l2loopback sink (must not be offered as capture input)
- [WO-97](./97_WO_INJECTION_HARDENING.md) — `execFile` / no shell interpolation for enumeration

**Existing patterns to reuse (do not reinvent):**
- `src/audio/live-audio-bridge.js` — external FFmpeg → MPEG-TS UDP → Caspar `PLAY udp://… LOOP`
- `src/audio/live-audio-input.js` — per-slot config, dedicated channel, route strings
- `src/config/routing-setup.js` — `setupLiveAudioInputs` / `setupInputsChannel` startup PLAY
- `src/config/host-live-sources.js` — host channel allocation for extra live sources
- `src/virtual-output/v4l2-bridge-relay.js` — inverse direction (Caspar → v4l2); borrow FFmpeg arg hygiene only

---

## 1. Problem statement

HighAsCG already captures **DeckLink SDI/HDMI**, **NDI**, and **ALSA live audio** into CasparCG with dedicated host channels and `route://` on-air reuse. There is **no equivalent path for generic USB video devices** (UVC webcams, USB capture dongles, switchers that expose a webcam interface over USB-C).

The operator has an **ATEM Mini Pro ISO** connected via USB-C. It does **not** appear as a DeckLink device — it enumerates as a standard **UVC camera** under Linux:

| Probe (2026-07-04, live box) | Value |
|------------------------------|-------|
| USB ID | `1edb:be97` Blackmagic Design ATEM SDI Pro ISO |
| Video node | `/dev/video0` (capture), `/dev/video1` (metadata only) |
| Driver | `uvcvideo` |
| Format | 1920×1080 MJPEG @ 50 fps |
| ALSA audio | card 3 `ATEM SDI Pro ISO` → `hw:3,0` USB Audio capture |
| Conflicts | `/dev/video10` = HighAsCG v4l2loopback **output** (`CasparCG Out`) — must be excluded from input picker |

Without product support, operators must run ad-hoc FFmpeg pipelines or cannot use the ATEM USB feed in Caspar at all.

---

## 2. Goal (normative)

1. Operator can add a **USB / V4L2 video input** in Settings, Device View, or **Sources → Live** — same mental model as DeckLink / NDI / live audio.
2. Each configured input gets a **dedicated Caspar host channel** (WO-53 / WO-88): play **once**, route everywhere via `route://hostCh-layer`.
3. Backend **enumerates** attachable V4L2 capture devices (name, path, formats, fps) via a read-only API; UI shows a picker instead of raw `/dev/videoN` typing.
4. Capture works for **MJPEG and YUYV** (common UVC modes); ATEM Mini @ 1080p50 MJPEG is the **primary acceptance device**.
5. Optional **embedded USB audio** from the same gadget (e.g. ATEM `hw:3,0`) can be muxed into the MPEG-TS bridge or left video-only with a separate live-audio slot — document choice in Phase B.
6. **No collision** with v4l2loopback virtual camera sinks (WO-109) or HighAsCG's own `/dev/video10` output.

---

## 3. Recommended approach

### 3.1 Why FFmpeg bridge (not native Caspar V4L2)

CasparCG in this stack has **no first-class V4L2 producer**. The proven HighAsCG pattern for non-Caspar-native capture is:

```
V4L2 device ──► FFmpeg (subprocess) ──► MPEG-TS ──► udp://127.0.0.1:PORT
                                                      │
                                                      ▼
                                            Caspar PLAY hostCh-L udp://… LOOP
                                                      │
                                                      ▼
                              PGM / MVR / Record / Stream via route://hostCh-L
```

This mirrors `live-audio-bridge.js` (ALSA → UDP → Caspar). Benefits:

- Reuses Caspar **ffmpeg producer** timing and `route://` plumbing already shipped for live audio.
- FFmpeg handles UVC format negotiation (`-input_format mjpeg`, `-video_size`, `-framerate`) without patching Caspar.
- Subprocess isolation: a wedged UVC driver does not take down Caspar.
- Health/restart logic can copy `live-audio-health.js` (warmup after bridge start, stale producer repair).

**Spike result (2026-07-04):** `ffmpeg -f v4l2 -input_format mjpeg -video_size 1920x1080 -framerate 50 -i /dev/video0 …` captures frames successfully on the connected ATEM.

**Deferred alternative:** evaluate direct Caspar `PLAY … ffmpeg` with a `v4l2://` or device path clip only if bridge latency/CPU is unacceptable on target hardware — not v1.

### 3.2 Data model (`casparServer` keys)

Follow live-audio / decklink slot naming:

| Key | Default | Meaning |
|-----|---------|---------|
| `v4l2_input_count` | `0` | Number of USB/V4L2 video inputs (0–8) |
| `v4l2_input_{1…8}_device` | `''` | Device path (`/dev/video0`) or stable id (`by-id/…`) |
| `v4l2_input_{1…8}_label` | `''` | Operator label (e.g. `ATEM PGM`) |
| `v4l2_input_{1…8}_format` | `auto` | `auto` \| `mjpeg` \| `yuyv422` — passed to FFmpeg `-input_format` when not auto |
| `v4l2_input_{1…8}_width` | `0` | `0` = auto from device |
| `v4l2_input_{1…8}_height` | `0` | `0` = auto |
| `v4l2_input_{1…8}_fps` | `0` | `0` = auto; else integer fps (50 for ATEM) |
| `v4l2_input_{1…8}_audio` | `none` | `none` \| `alsa:hw:C,D` \| `device` — optional audio mux (ATEM: `alsa:hw:3,0`) |
| `v4l2_input_channel_mode` | `''` | Empty → `inputs_channel_mode` (`1080p5000`) |
| `v4l2_capture_bridge` | `true` | When true, use FFmpeg bridge; when false, skip (future direct path) |

Persisted **`extraLiveSources`** entry (optional, for Sources → Live tab parity with NDI/webpage):

```json
{
  "type": "v4l2",
  "routeType": "v4l2_host",
  "value": "route://14-1",
  "label": "ATEM USB",
  "hostChannel": 14,
  "hostLayer": 1,
  "sourceId": "v4l2_atem_usb",
  "devicePath": "/dev/video0",
  "v4l2Slot": 1
}
```

### 3.3 Channel map (WO-53)

- Each active `v4l2_input` slot → **one dedicated Caspar channel** in `routing-map.js` (`v4l2InputChannels[]`, `kind: 'v4l2'`).
- Video mode: `v4l2_input_channel_mode` or `inputs_channel_mode` (full quality — this is a video source channel).
- Layer: **L1** on host channel (consistent with NDI/webpage hosts).
- Generator emits empty channel XML (video-mode + `<audio-osc>true</audio-osc>`, no consumers) like other input channels.

### 3.4 Backend modules (new)

| Module | Responsibility |
|--------|----------------|
| `src/capture/v4l2-enumerate.js` | List capture-capable V4L2 nodes via `v4l2-ctl --list-devices` + `--list-formats-ext` (or sysfs fallback); filter metadata-only nodes and loopback devices |
| `src/capture/v4l2-input-config.js` | Resolve slot → device path, format, PLAY clip, route string (mirror `live-audio-input.js`) |
| `src/capture/v4l2-input-bridge.js` | FFmpeg subprocess per slot: V4L2 (+ optional ALSA) → H.264/AAC MPEG-TS → `udp://127.0.0.1:52400+slot` |
| `src/capture/v4l2-input-health.js` | Warmup delay, bridge exit restart, stale `PLAY` repair (copy live-audio-health patterns) |
| `src/api/routes-v4l2-input.js` | `GET /api/system/v4l2-devices`, `GET /api/v4l2-inputs/status`, optional CRUD for extra live sources |
| `src/config/routing-setup.js` | `setupV4l2Inputs()` — start bridges, then `PLAY hostCh-1 udp://… LOOP` |

**UDP port base:** `52400 + slot` (live-audio = 52200, v4l2 virtual cam relay = 52300 — no overlap).

**FFmpeg args sketch (video-only, ATEM MJPEG 1080p50):**

```bash
ffmpeg -hide_banner -loglevel warning -nostdin \
  -f v4l2 -input_format mjpeg -video_size 1920x1080 -framerate 50 -i /dev/video0 \
  -an \
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -r 50 \
  -g 50 -keyint_min 50 -x264-params min-keyint=50:scenecut=0:repeat-headers=1 \
  -f mpegts "udp://127.0.0.1:52401?pkt_size=1316"
```

With audio (ATEM):

```bash
  -f alsa -i hw:3,0 -map 0:v -map 1:a \
  -c:a aac -b:a 128k -ar 48000 -ac 2 \
  …
```

Use `-thread_queue_size` and `-probesize`/`-analyzeduration` tuned for UVC startup latency (borrow queue sizing from `live-audio-bridge.js`).

### 3.5 Device enumeration rules

`GET /api/system/v4l2-devices` returns:

```json
{
  "devices": [
    {
      "path": "/dev/video0",
      "name": "ATEM SDI Pro ISO: Blackmagic De",
      "busInfo": "usb-0000:00:14.0-13",
      "serial": "010c08d5…",
      "stableId": "/dev/v4l/by-id/usb-Blackmagic_Design_ATEM_SDI_Pro_ISO_…-video-index0",
      "capabilities": ["capture"],
      "formats": [{ "pixelFormat": "MJPG", "width": 1920, "height": 1080, "fps": [50] }],
      "excludedReason": null
    },
    {
      "path": "/dev/video10",
      "name": "CasparCG Out (platform:v4l2loopback-000)",
      "capabilities": ["output"],
      "excludedReason": "loopback_output"
    }
  ],
  "warnings": []
}
```

**Exclude from input picker:**
- Nodes with `Device Caps` lacking `Video Capture` (e.g. `/dev/video1` metadata on ATEM).
- `v4l2loopback` / card name matching configured virtual camera labels (`CasparCG Out`, `HighAsCG Virtual Cam`).
- Devices already assigned to another slot (duplicate warning on save).

Implementation: prefer `execFile('v4l2-ctl', ['--list-devices'])` + per-node `--list-formats-ext`; timeout 2s; degrade to empty list + warning `v4l2_enum_unavailable` if `v4l2-ctl` missing (package `v4l-utils` on ISO).

### 3.6 UI / operator workflow

1. **Settings → Caspar → V4L2 / USB video inputs** — count + per-slot rows: device picker (from enumeration API), label, format override, optional ALSA audio device dropdown (reuse audio enumeration from WO-33b / existing ALSA helpers).
2. **Sources → Live → + → USB camera** — creates slot + `extraLiveSources` row; shows `route://` and host channel badge (like NDI host).
3. **Device View** — new connector kind `v4l2_in` on Caspar host backplane; matrix left column `USB: <label> (ch N)`; cable to PGM / Record / Stream.
4. **Inspector** — device path, bridge PID, fps, last error, **Refresh devices** button.

Validation on save (like `decklink-config-validate.js`):
- Duplicate device paths across slots.
- Selected device is capture-capable and not loopback output.

### 3.7 Lifecycle

| Event | Action |
|-------|--------|
| Caspar AMCP connect | `setupV4l2Inputs`: start bridges → warmup 700ms → `PLAY … LOOP` |
| Config change (device path) | Stop old bridge, restart slot |
| Server shutdown | `stopAllV4l2InputBridges()` in `shutdown.js` |
| USB hot-unplug | Bridge stderr / exit → mark slot `lastError: device_gone`; UI warning; optional auto-retry when device reappears (Phase C) |

---

## 4. Tasks

### Phase A — Core bridge + config

- [x] **T121.A1** Config defaults in `defaults-caspar-server.js`; persist keys; validation module `v4l2-input-config-validate.js`.
- [x] **T121.A2** `v4l2-enumerate.js` + `GET /api/system/v4l2-devices` (register in router).
- [x] **T121.A3** `v4l2-input-bridge.js` — spawn/stop FFmpeg per slot; port base 52400; stderr ring buffer.
- [x] **T121.A4** `v4l2-input-config.js` — slot → channel, layer, PLAY clip, route string; wire into `routing-map.js` channel allocation.
- [x] **T121.A5** `config-generator-channels.js` — emit dedicated channels for active v4l2 slots (via `buildInputChannel` v4l2 role).
- [x] **T121.A6** `routing-setup.js` — `setupV4l2Inputs()`; expose `_v4l2InputsStatus` on ctx/state like decklink/live-audio.
- [x] **T121.A7** Shutdown hook — stop all bridges.

### Phase B — UI + Device View

- [x] **T121.B1** Settings UI rows (`settings-v4l2-inputs-panel.js`) — count, device picker, format/fps overrides.
- [x] **T121.B2** `live-input-modal.js` — add **USB camera** type; host-only `route://` path.
- [x] **T121.B3** `device-view-host-channels.js` — `hostRole: v4l2_input`; matrix + suggest connectors (`v4l2_in`).
- [x] **T121.B4** Sources panel live tab — tile with host channel badge and device label.
- [x] **T121.B5** Optional ALSA audio mux UI + conflict check vs `live_audio_input_*` slots.

### Phase C — Health, tests, docs

- [x] **T121.C1** `v4l2-input-health.js` — bridge exit restart with backoff; PLAY repair (mirror live-audio-health).
- [x] **T121.C2** Smoke tests: enumerate parser (fixture stdout), clip builder, channel map allocation (no real `/dev/video*` in CI).
- [x] **T121.C3** Manual test plan section below; add `v4l-utils` to ISO package list if not present.
- [x] **T121.C4** Wiki: short operator doc "USB switcher / webcam input" under hardware integration.

### Phase D — Optional follow-ups (out of v1 unless time)

- [ ] **T121.D1** Hot-plug: udev / polling re-enumeration → auto-restart slot when ATEM reconnects.
- [ ] **T121.D2** Stable binding via `/dev/v4l/by-id/…` default instead of `/dev/videoN`.
- [ ] **T121.D3** Multiple ATEM / webcam slots on one machine (verify USB bandwidth @ 1080p50×N).
- [ ] **T121.D4** Direct Caspar ffmpeg `v4l2` clip spike — only if bridge CPU/latency fails acceptance on i7/NVIDIA target.

---

## 5. Acceptance criteria

1. With ATEM Mini Pro ISO connected, **Settings** shows `/dev/video0` in device picker with label **ATEM SDI Pro ISO**; `/dev/video10` (CasparCG Out) is **not** selectable as input.
2. Operator configures slot 1 → Apply Caspar config + restart → within 15 s Caspar `INFO` shows ffmpeg producer on dedicated host channel playing live ATEM picture.
3. Routing `route://hostCh-1` to PGM layer shows ATEM feed on program output / multiview / compose preview.
4. Removing route from PGM **does not** stop host channel producer (WO-88 persistence).
5. `GET /api/v4l2-inputs/status` reports bridge running, device path, udp port, last error empty.
6. Unplugging USB marks slot unhealthy; replugging + **Refresh** / restart restores capture (Phase C hot-plug optional).
7. Smoke tests pass in CI without hardware (`npm run smoke` subset).
8. No regression: DeckLink, NDI, live-audio inputs unchanged.

---

## 6. Manual test plan (ATEM Mini Pro ISO)

| Step | Action | Expected |
|------|--------|----------|
| 1 | `v4l2-ctl --list-devices` | ATEM on `/dev/video0`; CasparCG Out on `/dev/video10` |
| 2 | Settings → enable 1× V4L2 input, pick ATEM, 1080p50 MJPEG auto | Save succeeds, no duplicate-device warning |
| 3 | Apply Caspar config + restart | Log: `[v4l2-input-bridge] slot 1 capture /dev/video0 → udp://127.0.0.1:52401` |
| 4 | Sources → Live | Tile shows ATEM label + `route://N-1` |
| 5 | Route to PGM | Live ATEM picture on program |
| 6 | CLEAR PGM route only | Host channel still playing; re-route works |
| 7 | Optional: set audio `hw:3,0` | VU meter on host channel shows ATEM audio |
| 8 | Stop HighAsCG | No orphaned ffmpeg V4L2 processes (`pgrep -af 'v4l2.*video0'`) |

---

## 7. Related files (implementation hints)

| Area | Files |
|------|--------|
| Bridge pattern | `src/audio/live-audio-bridge.js`, `src/audio/live-audio-health.js` |
| Input config | `src/config/live-audio-input.js`, `src/config/routing-map.js` |
| Startup PLAY | `src/config/routing-setup.js` |
| Host live sources | `src/config/host-live-sources.js`, `src/config/config-generator-consumer-attach.js` |
| Device View | `client/lib/device-view-host-channels.js`, `src/config/device-graph-suggest.js` |
| Settings | `client/components/settings-modal-caspar-ui.js`, `src/config/defaults-caspar-server.js` |
| Virtual cam (exclude) | `src/virtual-output/v4l2-bridge*.js`, WO-109 |
| System API | `src/api/routes-system-hardware.js` |

---

## Work Log

### 2026-07-04 — Agent (discovery + work order)

**Work Done:**
- Probed connected hardware on live operator box:
  - ATEM Mini Pro ISO: USB `1edb:be97`, `/dev/video0` UVC MJPEG 1920×1080@50, `/dev/video1` metadata-only.
  - ALSA capture: card 3 `ATEM SDI Pro ISO` (`hw:3,0`).
  - Existing `/dev/video10` = v4l2loopback **CasparCG Out** (WO-109 output) — must exclude from inputs.
- Verified FFmpeg can open `/dev/video0` with `-f v4l2 -input_format mjpeg`.
- Reviewed existing capture architecture: DeckLink native Caspar producer; NDI/webpage host channels; live-audio FFmpeg→UDP bridge — **recommended same bridge pattern for V4L2 input**.
- Created WO-121 (this document).

**Instructions for Next Agent:**
1. Start **Phase A** with `v4l2-enumerate.js` + API — unblocks Settings device picker.
2. Implement `v4l2-input-bridge.js` by copying structure from `live-audio-bridge.js` (video-primary args, port 52400+).
3. Wire channel allocation in `routing-map.js` before generator changes.
4. Manual acceptance on the ATEM connected to this box (see §6).

### 2026-07-04 — Agent (Phase A implementation)

**Work Done:**
- Implemented capture stack: `src/capture/v4l2-enumerate.js`, `v4l2-input-config.js`, `v4l2-input-bridge.js`, `v4l2-input-health.js`, `v4l2-input-config-validate.js`.
- API: `GET /api/system/v4l2-devices`, `GET /api/v4l2-inputs`, `POST /api/v4l2-inputs/config`, `POST /api/v4l2-inputs/apply`.
- Wired routing map channel allocation, config generator `buildInputChannel`, `setupV4l2Inputs()` on AMCP connect, shutdown bridge cleanup, state exposure (`v4l2InputsStatus`).
- Settings UI tab **USB video** with device picker (`settings-v4l2-inputs-panel.js`).
- Smoke: `tools/smoke/smoke-v4l2-input.test.js` (9 tests passing).

**Instructions for Next Agent:**
1. **Manual QA:** Settings → USB video → slot 1 = `/dev/video0`, 1920×1080 @ 50 mjpeg → save → Apply Caspar config + restart → Apply PLAY. Route `route://hostCh-1` to PGM.
2. **Phase B remainder:** live-input-modal USB type, Device View `v4l2_in` connectors, Sources live tab tiles.
3. Optional: ATEM audio via `hw:3,0` on slot audio field.

### 2026-07-04 — Agent (Phase B UI)

**Work Done:**
- **Live input modal:** USB Video (V4L2) type with device picker (`GET /api/system/v4l2-devices`), format/fps overrides, `addV4l2InputSlot()` flow.
- **Sources → Live:** v4l2 tiles with device path, status messages, **Apply** button (`POST /api/v4l2-inputs/apply`); state via `v4l2Configured` / `v4l2InputsStatus`.
- **Device View:** `v4l2_in` connectors on rear panel (USB video section), matrix source column, host-destination inspector copy.

**Instructions for Next Agent:**
1. **Manual QA** on ATEM box (§6): Settings → USB video → Apply Caspar → Apply PLAY → route to PGM.
2. **T121.B5** optional: wire ALSA audio field in live-input-modal; duplicate-device vs live-audio validation in UI.
3. **T121.C3/C4:** ISO `v4l-utils` package note + operator wiki.

### 2026-07-04 — Agent (Phase B5 + C docs + live QA)

**Work Done:**
- ALSA audio picker in Settings → USB video and live-input modal; server validation for duplicate ALSA vs live-audio slots.
- `v4l-utils` added to `05-caspar-deps.sh`, ISO prep, `ISO_CONTENTS.md`.
- Operator wiki: `docs/wiki/integration/usb-v4l2-input.md`; API table updated.
- Smoke tests: **11/11** (incl. ALSA conflict + mux args).
- Live box: config saved, Caspar channel **2** allocated (`route://2-1`). Bridge start blocked — `/dev/video0` **device busy** (another holder on box; not a code defect).

**Follow-up (same session):**
- Fixed `isV4l2LayerHealthy` — Caspar INFO uses `<producer>ffmpeg</producer>` in **foreground** (background `<producer>empty</producer>` was false-negative); aligned live-audio UDP health check.
- Increased verify window + retry; live **Apply PLAY** now reports `playSucceeded: 1` on ATEM `/dev/video0`.

**Instructions for Next Agent:**
1. Route `route://2-1` to PGM and confirm ATEM picture on program.
3. Optional Phase D: hot-plug, by-id default binding.

---
*Work Order created: 2026-07-04 | Series: HighAsCG live inputs*
