# Virtual camera output (v4l2loopback)

Feed Caspar program output to **Zoom**, **OBS**, or other apps as a **V4L2 webcam** plus an optional **ALSA virtual mic**. HighAsCG uses the same safe JPEG buffer pattern as compose preview — Caspar writes a single overwriting JPEG; an ffmpeg relay pushes frames to **v4l2loopback**.

**Default:** off until the operator starts from Device View or the API.

## Requirements

- **`v4l2loopback`** kernel module (video device, typically `/dev/video10`)
- **`snd-aloop`** when audio is enabled (ALSA loopback card `HighAsCG_VCam`)
- **FFmpeg** on the playout host
- Caspar **AMCP connected**

No PulseAudio / PipeWire — audio uses **ALSA loopback + PortAudio** capture only.

## Quick setup

1. **Device View → rear panel → Virtual cam** — open inspector.
2. Set **channel**, resolution, fps; enable **Include audio** if needed.
3. **Save settings** → **Start virtual cam**.
4. In Zoom/OBS:
   - Camera: **CasparCG Out** (or label from config)
   - Mic (optional): **HighAsCG_VCam** / loopback capture (`hw:HighAsCG_VCam,1,0`)

Or cable a **destination** (PGM) to the **Virtual cam** port on the rear panel, **Apply Caspar config** — that sets `virtualCamera.channel` from the cabled source.

## Kernel modules

Modules load automatically on **Start** when passwordless sudo is configured:

```bash
sudo bash scripts/setup/12-passwordless-sudo.sh
```

This installs `/usr/local/lib/highascg/highascg-vcam-modules-up.sh` and a `NOPASSWD` rule. HighAsCG writes `/run/highascg/vcam-modules.conf` then runs the wrapper via `sudo -n`.

Manual one-time per boot (if sudo wrapper not installed):

```bash
sudo modprobe v4l2loopback devices=1 video_nr=10 card_label="CasparCG Out"
sudo modprobe snd-aloop enable=1 index=20 id=HighAsCG_VCam pcm=2
```

## Architecture

```
Caspar chN ──consumer 710──► media/highascg_vcam/chN.jpg  (mjpeg -update 1)
                                    │
                                    ▼
                          ffmpeg relay (HighAsCG subprocess)
                                    │
                                    ▼
                               /dev/video10  ──► Zoom / OBS

Caspar chN ──consumer 711──► ALSA plughw:HighAsCG_VCam,0,0  (playback)
                                    │
                                    ▼
                          hw:HighAsCG_VCam,1,0  ──► Zoom mic
```

| Piece | Role |
|-------|------|
| Consumer **710** | Caspar FILE consumer → overwriting JPEG |
| Consumer **711** | Caspar ALSA consumer → loopback playback |
| ffmpeg relay | Reads JPEG → v4l2loopback device |
| `virtualCamera.enabled` | Runtime gate — default **false** |

## Config (`general.json` → `virtualCamera`)

| Key | Default | Notes |
|-----|---------|-------|
| `enabled` | `false` | Runtime; cleared on Stop |
| `channel` | `1` | Caspar source channel |
| `device` | `/dev/video10` | v4l2loopback node |
| `width` / `height` | `1920` / `1080` | Full program resolution |
| `fps` | `50` | Relay frame rate |
| `audioEnabled` | `true` | ALSA loopback mic |
| `alsaLoopbackCardId` | `HighAsCG_VCam` | Card id for `snd-aloop` |
| `showInDeviceView` | `true` | Rear panel connector |

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/virtual-camera` | Config + runtime status |
| GET | `/api/virtual-camera/status` | Alias |
| POST | `/api/virtual-camera/config` | Persist settings |
| POST | `/api/virtual-camera/start` | Start bridge (loads modules if needed) |
| POST | `/api/virtual-camera/stop` | Stop bridge |

Status also on `GET /api/state` → `virtualCameraStatus` and Device View `live.virtualCamera`.

```bash
curl -s http://127.0.0.1:4200/api/virtual-camera/status | python3 -m json.tool
curl -s -X POST http://127.0.0.1:4200/api/virtual-camera/start \
  -H 'Content-Type: application/json' -d '{"channel":1}' | python3 -m json.tool
```

**HTTP errors:** `503` if Caspar disconnected; `502` if relay fails after start.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `/dev/video10` missing | Run sudo setup script; `ls -l /dev/video10` |
| Start returns module error | `sudo -n /usr/local/lib/highascg/highascg-vcam-modules-up.sh` after conf exists |
| Video black in Zoom | Bridge running? `ffplay -f v4l2 -video_size 1920x1080 /dev/video10` |
| No audio in Zoom | `snd-aloop` loaded? `aplay -l \| grep HighAsCG_VCam`; pick loopback **capture** in app |
| Wrong channel | Inspector channel vs cabled destination — Apply after cabling |
| Disk fill | Bridge is opt-in; no unix-socket sink |

## Related

- Work order: `work/work-orders/137_WO_VIRTUAL_CAMERA_OUTPUT_DEVICE_VIEW.md`
- USB **input** (exclude loopback): [usb-v4l2-input.md](./usb-v4l2-input.md)
- Passwordless sudo: [HIGHASCG_PASSWORDLESS_SUDO.md](../../HIGHASCG_PASSWORDLESS_SUDO.md)
