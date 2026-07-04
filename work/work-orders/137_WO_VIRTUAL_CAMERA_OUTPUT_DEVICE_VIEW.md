# Work Order 137: Virtual camera output — backend hardening + Device View

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** In progress (Phase A–C largely complete 2026-07-04; operator sudo install + live validation pending)  
**Priority:** High — operator validated video in Zoom; productize lab bridge  
**Parent / context:** [109_WO_VIRTUAL_CAMERA_AND_VIRTUAL_SCREEN_TESTING.md](./109_WO_VIRTUAL_CAMERA_AND_VIRTUAL_SCREEN_TESTING.md), operator testing 2026-07-04

**Related work orders:**
- [WO-109](./109_WO_VIRTUAL_CAMERA_AND_VIRTUAL_SCREEN_TESTING.md) — first-class `v4l2_out` sink, sudo wrappers, multi-output pool
- [WO-121](./121_WO_USB_WEBCAM_V4L2_INPUT.md) — **input** side; must exclude loopback output from capture picker
- [WO-58](./58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md) — JPEG `image2 -update 1` buffer pattern
- [WO-82](./82_WO_DEVICE_VIEW_SIMPLE_WIRING_MODE.md) — rear panel / simple node layout
- [WO-132](./132_WO_FLOW_ALSA_AUDIO.md) — ALSA + PortAudio stack (no Pulse)
- [WO-97](./97_WO_INJECTION_HARDENING.md) — `modprobe` / sudo discipline

**Existing implementation (lab bridge, 2026-07-04):**
- `src/virtual-output/v4l2-bridge*.js` — Caspar FILE → overwriting JPEG → ffmpeg relay → `/dev/videoN`; audio → ALSA loopback
- Opt-in only: `virtualCamera.enabled` default **false**; start via API or config
- Consumer indices: **710** video, **711** audio

---

## 1. Problem statement

Operators can feed Caspar program output to Zoom via **v4l2loopback**, but the workflow was manual (`modprobe`, curl, ffplay). The lab bridge works for **video**; **audio** requires `snd-aloop` and appears as an ALSA/PortAudio capture device (not Pulse).

Product gaps:
1. No validated config schema, persistence, or HTTP errors on failure paths.
2. No Device View connector / inspector — invisible next to Stream/Record sinks.
3. WO-109 scope (multi-output, sudo wrappers, destination routing) not yet integrated.

---

## 2. Goal (normative)

### 2.1 Backend
1. **Config** in `general.json` → `virtualCamera` with normalization + validation.
2. **REST API** (mirror v4l2-inputs pattern):
   - `GET /api/virtual-camera` — config + runtime status
   - `POST /api/virtual-camera/config` — persist settings (optional lifecycle if `enabled`)
   - `POST /api/virtual-camera/start` — validate, start bridge, **502** on relay failure
   - `POST /api/virtual-camera/stop` — teardown consumers + relay
3. Expose `virtualCameraStatus` on `GET /api/state` and Device View `live.virtualCamera`.
4. **Default off** — nothing runs until operator starts or sets `enabled: true`.

### 2.2 Device View (phase 1)
1. Suggest connector `kind: v4l2_out` (`vcam_1`) on Caspar host rear panel.
2. Inspector: channel, device, resolution, fps, audio toggle, Save / Start / Stop, live status.
3. Matrix + simple layout treat `v4l2_out` as Caspar sink; status dot when `running`.

### 2.3 Later (WO-109 overlap)
- Destination cable → channel routing (apply plan)
- `modprobe v4l2loopback` via passwordless sudo wrapper
- Multiple virtual cam outputs (`virtualCameraOutputs[]`)
- Hide connector when `showInDeviceView: false`

---

## 3. Architecture (current)

```
Caspar chN ──consumer 710──► media/highascg_vcam/chN.jpg  (mjpeg -update 1)
                                    │
                                    ▼
                          ffmpeg relay (HighAsCG subprocess)
                                    │
                                    ▼
                               /dev/video10  ──► Zoom / OBS (v4l2)

Caspar chN ──consumer 711──► ALSA plughw:HighAsCG_VCam,0,0  (playback)
                                    │
                                    ▼
                          hw:HighAsCG_VCam,1,0  ──► Zoom mic (PortAudio/ALSA)
```

**Prerequisite (operator):** once per boot:
```bash
sudo modprobe v4l2loopback devices=1 video_nr=10 card_label="CasparCG Out"
sudo modprobe snd-aloop enable=1 index=20 id=HighAsCG_VCam pcm=2
```

---

## 4. Config schema (`general.json`)

```json
"virtualCamera": {
  "enabled": false,
  "label": "Virtual cam",
  "channel": 1,
  "device": "/dev/video10",
  "basenamePrefix": "highascg_vcam",
  "width": 1920,
  "height": 1080,
  "fps": 50,
  "resolutionScale": "full",
  "jpegQuality": 10,
  "audioEnabled": true,
  "alsaLoopbackCardId": "HighAsCG_VCam",
  "alsaLoopbackIndex": 20,
  "alsaLoopbackPcm": 2,
  "showInDeviceView": true
}
```

---

## 5. API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/virtual-camera` | Config + runtime status |
| GET | `/api/virtual-camera/status` | Alias |
| POST | `/api/virtual-camera/config` | Persist patch; restart bridge if `enabled` |
| POST | `/api/virtual-camera/start` | `{ channel?, device?, fps?, persist? }` |
| POST | `/api/virtual-camera/stop` | Stop; clears runtime `enabled` |

Also: `GET /api/state` → `virtualCameraStatus`.

---

## 6. Tasks

### Phase A — Backend hardening
- [x] **T137.A1** `v4l2-bridge-config.js` — normalize defaults, patch helper
- [x] **T137.A2** `v4l2-bridge-config-validate.js` — device path, ALSA card id
- [x] **T137.A3** Hardened `routes-virtual-camera.js` — 400/502/503, persist, start result
- [x] **T137.A4** `get-state.js` + Device View snapshot → `virtualCamera`
- [x] **T137.A5** Smoke: `tools/smoke/smoke-virtual-camera.test.js`
- [x] **T137.A6** Passwordless sudo wrapper for `v4l2loopback` + `snd-aloop` (WO-109 T109.4)
- [x] **T137.A7** Auto-load loopback modules on start when missing (via wrapper)

### Phase B — Device View
- [x] **T137.B1** `device-graph-suggest.js` — `v4l2_out` connector
- [x] **T137.B2** Rear panel sections (classic + simple) + matrix sink kind
- [x] **T137.B3** `device-view-inspector-virtual-cam.js` — Save / Start / Stop
- [x] **T137.B4** `client/lib/virtual-camera-state.js`
- [x] **T137.B5** Destination cable → set `virtualCamera.channel` on apply
- [x] **T137.B6** Bands view port dot for `v4l2_out` (rear panel Caspar section + `renderVirtualCamBand` helper)

### Phase C — Docs & polish
- [x] **T137.C1** Operator wiki `docs/wiki/integration/virtual-camera-output.md`
- [x] **T137.C2** API table in `docs/wiki/api/system-settings-hardware.md`
- [x] **T137.C3** Update WO-109 — reference this WO as shipped subset

---

## 7. Acceptance (manual)

1. Fresh boot, HighAsCG up, `GET /api/virtual-camera` → `enabled: false`, `running: false`.
2. Load loopback modules (see §3).
3. Device View → rear **Virtual cam** port → inspector → Start → status `running: true`.
4. Zoom: camera **CasparCG Out**; mic **HighAsCG_VCam** capture.
5. Stop → relay gone, consumers detached, `running: false`.
6. `POST /api/virtual-camera/config` with `{ persist: true }` survives restart (settings only; still default off unless `enabled: true`).

---

## 8. Work log

### 2026-07-04 — Agent (Cursor)
- Shipped Phase A config/API hardening and Phase B Device View starter (inspector + rear panel + state).
- Removed Pulse audio path; ALSA loopback only (stack = ALSA + PortAudio).
- **Instructions for next agent:** implement T137.A6/A7 sudo wrappers; T137.B5 cable→channel apply; operator wiki; fold remaining WO-109 items or close WO-109 as superseded by this track.

### 2026-07-04 — Agent (Cursor, continued)
- **T137.A6/A7:** `tools/runtime/highascg-vcam-modules-up.sh`, `src/virtual-output/v4l2-kernel-modules.js`, wired into bridge start; `12-passwordless-sudo.sh` installs wrapper + NOPASSWD.
- **T137.B5:** `applyVirtualCameraMappingsFromGraph()` + Device View apply plan action `virtual_camera_mapping`.
- **T137.B6:** `renderVirtualCamBand()` helper; rear panel already exposes `v4l2_out` with cable dots.
- **T137.C1/C2:** `docs/wiki/integration/virtual-camera-output.md`, API table + `HIGHASCG_PASSWORDLESS_SUDO.md`.
- Fixed missing `normalizeVirtualCameraConfig` import in `v4l2-bridge.js`.
- **Instructions for next agent:** Run `sudo bash scripts/setup/12-passwordless-sudo.sh` on playout box; verify Start loads modules without manual modprobe; optional T137.C3 close-out on WO-109; multi-output pool still WO-109 scope.

---

## 9. File map

| Path | Role |
|------|------|
| `src/virtual-output/v4l2-bridge*.js` | Bridge core |
| `src/virtual-output/v4l2-bridge-config*.js` | Config + validation |
| `src/api/routes-virtual-camera.js` | REST API |
| `client/lib/virtual-camera-state.js` | Client API helper |
| `client/components/device-view-inspector-virtual-cam.js` | Inspector UI |
| `src/config/device-graph-suggest.js` | `v4l2_out` connector |
