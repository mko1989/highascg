# USB / V4L2 video input

Capture UVC webcams and USB switchers (e.g. **ATEM Mini Pro ISO**) on a dedicated Caspar host channel. By default Caspar opens the device directly via **`PLAY … v4l2:///dev/videoN LOOP`** (ffmpeg producer). An optional FFmpeg UDP bridge (`v4l2_capture_bridge: true`) remains for legacy setups.

## Requirements

- **`v4l-utils`** on the playout host (`v4l2-ctl --list-devices`). Included in `scripts/setup/05-caspar-deps.sh` and live ISO prep.
- Device must expose a **capture** node (not metadata-only). Loopback outputs such as **CasparCG Out** (`/dev/video10`) are excluded automatically.

## Quick setup (ATEM Mini Pro ISO)

1. **Settings → USB video** — set count = 1, pick `/dev/video0` (not `/dev/video1`).
2. Format **mjpeg**, 1920×1080, **50** fps if auto fails.
3. Optional audio: use a separate **live-audio** slot on the same ALSA card (V4L2 direct capture is video-only).
4. **Save** → **Apply Caspar config + restart** (required when count increases).
5. **Apply PLAY** (Settings tab or Sources → Live tile).
6. Drag **`route://hostCh-N`** from **Sources → Live** onto PGM or multiview.

Or: **Sources → Live → +** → **USB Video (V4L2)** — adds a slot and starts capture when channels exist.

## Architecture

| Piece | Role |
|-------|------|
| Direct (default) | Caspar ffmpeg producer → `v4l2:///dev/videoN` |
| Optional bridge | `v4l2-input-bridge.js` → UDP `52400 + slot` when `v4l2_capture_bridge` is true |
| Caspar channel | One dedicated host channel per slot (`kind: v4l2`) |
| On-air | `route://` only — do not PLAY V4L2 directly on program layers |

## API

| Method | Path |
|--------|------|
| GET | `/api/system/v4l2-devices?refresh=1` |
| GET | `/api/v4l2-inputs` |
| POST | `/api/v4l2-inputs/config` |
| POST | `/api/v4l2-inputs/apply` |

Status is also exposed as `v4l2InputsStatus` in `GET /api/state`.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Empty device list | `v4l2-ctl --list-devices`; install `v4l-utils` |
| ATEM missing | USB cable; `ls -l /dev/video*` |
| Black picture after route | **Apply PLAY**; AMCP connected; `INFO hostCh-1` shows `v4l2://` and advancing time |
| `non-existing PPS` in Caspar log | Disable UDP bridge — use direct `v4l2://` (default) |
| Duplicate device warning | Only one slot per `/dev/videoN` |
| ALSA conflict warning | Same `hw:C,D` cannot be live-audio and V4L2 mux simultaneously |

## Related

- Work order: `work/work-orders/121_WO_USB_WEBCAM_V4L2_INPUT.md`
- Virtual camera **output** (loopback): [virtual-camera-output.md](./virtual-camera-output.md) — do not use `/dev/video10` as input
