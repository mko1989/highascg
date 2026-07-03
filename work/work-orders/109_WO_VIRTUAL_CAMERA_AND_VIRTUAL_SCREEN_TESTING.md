# Work Order 109: Virtual camera sink + virtual screen inputs (testing lab)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Not started
**Priority:** Medium — enables Zoom/Teams/WebRTC testing and headless ffmpeg source development without extra hardware
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md), operator request 2026-07-02 (v4l2loopback install blocked by DKMS; desire for first-class HighAsCG sinks)

**Related / builds on:**
- [27_WO_STREAMING_CHANNEL.md](./27_WO_STREAMING_CHANNEL.md) — FFmpeg bridge patterns, quality presets
- [37_WO_SIMULATION_PLACEHOLDERS.md](./37_WO_SIMULATION_PLACEHOLDERS.md) — virtual sources for offline prep
- [39_WO_SETTINGS_SYSTEM_HARDWARE.md](./39_WO_SETTINGS_SYSTEM_HARDWARE.md) — system hardware API surface
- [58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md](./58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md) — FFmpeg subprocess hygiene
- [97_WO_INJECTION_HARDENING.md](./97_WO_INJECTION_HARDENING.md) — sudoers allowlist discipline (`NOPASSWD` wrappers only)
- [103_WO_CLIENT_XSS_HARDENING.md](./103_WO_CLIENT_XSS_HARDENING.md) — escape labels in new UI
- `docs/HIGHASCG_PASSWORDLESS_SUDO.md` — document new wrappers here
- `src/streaming/stream-config.js` — existing `x11grab` / `x11Display` capture options
- `src/config/device-graph-suggest.js` — sink connector patterns (`stream_out`, `record_out`, `audio_out`)
- `src/api/device-view-apply.js` — destination → sink apply planning
- `src/config/host-live-sources.js` — host channel allocation for live ffmpeg/NDI/webpage sources

---

## 1. Problem statement (from 2026-07-02 operator testing)

### 1.1 Virtual camera is manual and outside HighAsCG
- Operators follow ad-hoc steps: `apt install v4l2loopback-dkms`, `modprobe v4l2loopback …`, FFmpeg `x11grab` to `/dev/videoN`, pick **CasparCG Out** in Zoom.
- On the live **nvidia-595** box, `v4l2loopback-dkms` post-install **fails** because a kernel-bundled module already exists at `/lib/modules/*/kernel/v4l2loopback/v4l2loopback.ko.zst` — DKMS refuses install without `--force`, leaving dpkg half-configured (`iF`). The module **does** load and `/dev/video10` works, but the workflow is fragile and undocumented in-product.
- CasparCG has **no native V4L2 consumer** in this build; bridging requires a separate FFmpeg process. Nothing in Device View represents “virtual webcam” as an output destination.

### 1.2 No virtual displays for ffmpeg sources
- Testing Caspar **ffmpeg producers** against predictable video (bars, browser, HTML) currently needs a physical monitor or hacking `DISPLAY=:0` window grabs.
- Operators want **ephemeral virtual desktops** (Xvfb or equivalent) that HighAsCG creates on demand and exposes as **live ffmpeg inputs** (x11grab) — useful for integration tests, Zoom rehearsal, and multiview prototyping without extra GPUs.

### 1.3 Requirements from operator (normative intent)
1. **Virtual camera = HighAsCG sink** — appears in Device View / routing matrix like `stream_out` / `record_out`; created **only when explicitly added** in the UI or config.
2. **Ephemeral lifecycle** — does **not** need to survive reboots; tear down loopback device + FFmpeg bridge when sink is removed or server stops.
3. **Passwordless sudo** — backend may call `sudo -n` via **pinned wrapper scripts** (WO-97 pattern) to `modprobe`/`rmmod` v4l2loopback with **allow-listed** options only.
4. **Virtual screens** — dynamically created displays fed into Caspar via **ffmpeg producer** (x11grab), same ephemeral discipline.

---

## 2. Goal (normative)

### 2.1 Virtual camera sink (`v4l2_out`)
1. Operator adds a **Virtual camera** output on the Caspar host (Settings and/or Device View **Add sink**).
2. HighAsCG allocates a `video_nr` (e.g. 10–19 pool), loads v4l2loopback for that device, starts an **FFmpeg bridge** from the **routed Caspar video** (mapped destination → this sink) into `/dev/videoN`.
3. The V4L2 device appears with a stable label (e.g. `HighAsCG Virtual Cam 1`) visible to Zoom, OBS, Chrome, `v4l2-ctl --list-devices`.
4. Removing the sink or stopping the server **stops FFmpeg**, **unloads** the loopback instance (best-effort `rmmod` when last instance gone).
5. Status API reports: device path, label, bridge PID, source route, fps/resolution, last error.

### 2.2 Virtual screen inputs (`virtual_screen_in`)
1. Operator adds a **Virtual screen** source with resolution + fps (templates: 1080p25, 720p50, custom).
2. Backend starts **Xvfb** (or Xephyr) on an allocated display number (e.g. `:90+`), optionally a **test pattern** or blank root window.
3. Device View exposes a **source connector**; routing to a Caspar layer issues **`PLAY … ffmpeg`** with an x11grab clip targeting that display (reuse live-audio-input / host-live-sources subprocess patterns).
4. Tear down display server when source removed or idle timeout (configurable, default: immediate on remove).

### 2.3 Security & packaging
- No broad `NOPASSWD: modprobe` — only `/usr/local/lib/highascg/highascg-v4l2loopback-up.sh` and `…-down.sh` with **fixed argv** validated inside the script (`video_nr`, `card_label`, `exclusive_caps` from an allow-list file or env file written by root-owned helper).
- Document fragments in `scripts/setup/12-passwordless-sudo.sh` + `docs/HIGHASCG_PASSWORDLESS_SUDO.md`.
- ISO note: prefer **kernel-bundled** v4l2loopback OR document `dkms install --force` — do not block feature on dpkg configure success.

---

## 3. Recommended approach

### 3.1 Data model
```json
{
  "virtualCameraOutputs": [
    {
      "id": "vcam_1",
      "label": "Zoom PGM",
      "enabled": true,
      "videoNr": 10,
      "v4l2Label": "HighAsCG Virtual Cam 1",
      "width": 1920,
      "height": 1080,
      "fps": 25,
      "pixelFormat": "yuv420p",
      "captureMode": "x11grab",
      "x11Display": ":0",
      "x11Window": "caspar_screen_1"
    }
  ],
  "virtualScreens": [
    {
      "id": "vscr_1",
      "label": "Test pattern 1080p",
      "width": 1920,
      "height": 1080,
      "fps": 25,
      "display": ":90",
      "pattern": "smpte"
    }
  ]
}
```
- Persist in `highascg.config.json` (project or general — TBD in T109.1; default **general** for lab rigs).
- Device graph connectors: `kind: 'v4l2_out'` (sink), `kind: 'virtual_screen_in'` (source on `caspar_host`).

### 3.2 Backend modules (new)
| Module | Responsibility |
|--------|----------------|
| `src/virtual-output/v4l2-loopback-manager.js` | Allocate `video_nr`, call sudo wrapper, track `/dev/videoN`, refcount instances |
| `src/virtual-output/v4l2-ffmpeg-bridge.js` | Spawn/monitor FFmpeg x11grab → v4l2 (reuse stream subprocess helpers) |
| `src/virtual-input/virtual-screen-manager.js` | Spawn/kill Xvfb, optional `ffmpeg -f lavfi testsrc` fullscreen on that DISPLAY |
| `src/virtual-input/virtual-screen-ffmpeg.js` | Build Caspar `PLAY` clip for x11grab from virtual display |
| `src/api/routes-virtual-io.js` | CRUD + start/stop/status; wire into device-view snapshot `live.virtualIo` |
| `scripts/system/highascg-v4l2loopback-up.sh` | `modprobe v4l2loopback devices=1 video_nr=N card_label=… exclusive_caps=1` |
| `scripts/system/highascg-v4l2loopback-down.sh` | `modprobe -r v4l2loopback` when safe (refcount 0) |

### 3.3 UI
- **Device View** Caspar backplane: icon row for `v4l2_out` (webcam glyph); inspector shows device path, bridge status, **Test in ffplay** hint.
- **Add sink** menu: Virtual camera (alongside Stream / Record).
- **Add source** menu: Virtual screen → resolution template modal.
- **Routing matrix**: new sink column / source row types.
- **Settings → Virtual I/O** (or under System hardware): list active virtual cameras/screens, manual stop, dependency note (v4l2loopback kernel module).

### 3.4 Apply / routing integration
- Extend `collectDestinationOutputEdges` / `applyStreamRecordMappingsFromGraph` pattern for `v4l2_out`: when edge connects destination → `vcam_1`, set bridge source to that destination's Caspar channel/layer (or screen consumer geometry from `screen_N_*` + window title heuristics).
- Virtual screen sources: extend `host-live-sources.js` or `extraLiveSources` with `routeType: 'virtual_screen'` and dedicated channel from `suggestNextHostChannel`.

### 3.5 FFmpeg bridge sketch (virtual camera)
```bash
# Pseudocode — actual args built server-side, no shell interpolation
ffmpeg -f x11grab -draw_mouse 0 -framerate 25 -video_size 1920x1080 \
  -i :0.0+<offset> -f v4l2 -pix_fmt yuv420p /dev/video10
```
- Prefer **window ID** grab when Caspar screen consumer window is findable (`xdotool search --name` with allow-listed title prefix); fallback to configured `x,y,width,height` from screen destination layout.
- Reuse `stream-capture-tier.js` probing for x11grab availability.

### 3.6 Virtual screen sketch
```bash
Xvfb :90 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset
DISPLAY=:90 ffmpeg -f lavfi -i smptebars=size=1920x1080:rate=25 -f null - &
# Caspar PLAY clip (server-generated):
# ffmpeg -f x11grab -framerate 25 -video_size 1920x1080 -i :90.0 -f matroska pipe:0
```

---

## 4. Tasks

### Phase A — Virtual camera sink (core)
- [ ] **T109.1** Config schema: `virtualCameraOutputs[]`; defaults empty; validation (unique `videoNr` 10–31, label length).
- [ ] **T109.2** Sudo wrappers `highascg-v4l2loopback-up.sh` / `…-down.sh` + sudoers fragments + `HIGHASCG_PASSWORDLESS_SUDO.md` entries.
- [ ] **T109.3** `v4l2-loopback-manager.js` — dynamic load/unload, handle pre-installed kernel module (skip DKMS dependency).
- [ ] **T109.4** `v4l2-ffmpeg-bridge.js` — start/stop/restart on route change; stderr log ring; exit auto-restart with backoff.
- [ ] **T109.5** API: `GET/POST /api/virtual-io/cameras`, `POST …/start|stop`, status in device-view `live.virtualIo.cameras`.
- [ ] **T109.6** Device graph: `kind: v4l2_out` in `device-graph-suggest.js`; apply path in `device-view-apply.js` / output mapping.
- [ ] **T109.7** Client: backplane marker, inspector, add-sink UX, routing matrix column.

### Phase B — Virtual screen inputs
- [ ] **T109.8** Config schema: `virtualScreens[]`; display number pool `:90`–`:99`.
- [ ] **T109.9** `virtual-screen-manager.js` — Xvfb lifecycle, optional smpte/color-grid pattern child process.
- [ ] **T109.10** Caspar ffmpeg clip builder + `PLAY` integration (host channel allocation).
- [ ] **T109.11** API: `GET/POST /api/virtual-io/screens`; expose in Sources / Device View as `virtual_screen_in`.
- [ ] **T109.12** Client: add-source modal (resolution templates), inspector status (DISPLAY, fps, PID).

### Phase C — Testing & docs
- [ ] **T109.13** Smoke: wrapper rejects bad `video_nr`; manager refcount; ffmpeg clip builder unit tests (no real X11 in CI).
- [ ] **T109.14** Manual test plan doc section: Zoom/OBS pick virtual cam; `ffplay -f v4l2 /dev/video10`; PLAY virtual screen on layer; reboot confirms **no** stale devices (ephemeral).
- [ ] **T109.15** Installer: ensure `v4l2loopback` kernel module or utils present on ISO; document DKMS `--force` workaround in `docs/MANUAL_INSTALL.md` (one paragraph, link WO-109).

### Phase D — Optional follow-ups (out of v1 scope unless time)
- [ ] **T109.16** PipeWire `v4l2loopback` compatibility check (some desktops prefer PipeWire camera portal).
- [ ] **T109.17** Audio into virtual camera (PCM via separate Pulse sink — defer).
- [ ] **T109.18** CEF webpage on virtual screen DISPLAY for HTML source testing.

---

## 5. Acceptance criteria

1. Operator adds **Virtual camera** sink in Device View, cables PGM destination to it, clicks Apply/Start → within 10 s Zoom lists **HighAsCG Virtual Cam N** and shows Caspar picture.
2. Removing the sink stops FFmpeg and removes the loopback device from `v4l2-ctl --list-devices` (or marks disconnected).
3. **No interactive sudo password** on start/stop when installer sudoers fragment is present.
4. Operator adds **Virtual screen** 1920×1080@25, routes to Caspar layer → `INFO` shows ffmpeg producer; multiview/preview shows test pattern or grab from `:90`.
5. Server restart clears all virtual cameras/screens (no auto-respawn) unless operator re-adds them — confirms ephemeral policy.
6. `sudo -n` failure surfaces a clear UI error linking to `docs/HIGHASCG_PASSWORDLESS_SUDO.md`.
7. WO-97 discipline: no new sudo wildcards; wrappers are fixed-path only.

---

## 6. Rollout / risk notes

- **X11 grab fragility:** Wayland-only sessions break x11grab — detect `XDG_SESSION_TYPE` and warn; lab boxes are X11/nodm today.
- **Caspar window identification:** screen consumer window titles vary by build — prefer geometry from `screen_N_x/y/width/height` over title search when possible.
- **v4l2loopback DKMS vs kernel module:** feature must work when `modprobe v4l2loopback` succeeds regardless of dpkg state; do not call `apt install` from runtime.
- **Resource leaks:** refcount virtual cameras; kill orphaned Xvfb on server shutdown (`src/index.js` teardown hook).
- **Security:** `video_nr` and display numbers must be server-allocated integers — never pass raw user strings to modprobe/Xvfb argv.
- Coordinate with [108_WO_GPU_PORTS_LAYOUT_SINGLE_SOURCE_OF_TRUTH.md](./108_WO_GPU_PORTS_LAYOUT_SINGLE_SOURCE_OF_TRUTH.md) if virtual camera grab targets a specific `gpu_pN` / `screen_N` binding.

---

## 7. Manual test checklist (operator)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Add Virtual camera sink, route PGM → sink, Start | `/dev/video10` (or allocated NR) exists |
| 2 | `v4l2-ctl --list-devices` | **HighAsCG Virtual Cam 1** listed |
| 3 | Zoom → Video → Camera | Select virtual cam; PGM visible |
| 4 | Remove sink | Device gone from list; Zoom falls back |
| 5 | Add Virtual screen 1080p25 | Xvfb on `:90` |
| 6 | PLAY virtual screen on input layer | Caspar shows bars/pattern |
| 7 | Reboot server | No virtual devices until re-added |

---

## Work Log

### 2026-07-02 — Initial WO (virtual camera / virtual screen testing lab)

- Captured operator goal: **dynamic HighAsCG sink** for V4L2 virtual camera (no reboot persistence), **passwordless sudo** for loopback setup, and **virtual desktops** as Caspar ffmpeg inputs.
- Documented current pain: manual `v4l2loopback-dkms` / DKMS conflict on nvidia-595 box; ad-hoc FFmpeg bridge; no Device View representation.
- Proposed `v4l2_out` + `virtual_screen_in` connector kinds, backend managers, pinned sudo wrappers (WO-97), and phased tasks T109.1–T109.18.
- **Instructions for Next Agent:** Start **T109.1–T109.4** (config + sudo wrappers + loopback manager + ffmpeg bridge) as a vertical slice before UI — prove `/dev/videoN` + bridge from Caspar screen consumer on the live box. Then T109.6–T109.7 for Device View sink. Phase B (virtual screens) can parallel after Xvfb manager lands.
