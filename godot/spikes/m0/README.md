# M0 spike — Godot operator client trial (WO-595)

Godot draws a Caspar channel **from shared memory** inside its own scene, with UI drawn over the
video, freely placed atlas tiles, and the live texture on a 3D LED wall. Built and verified on the
dev Mac; this file is the runbook for the box. Results go into
[WO-595](../../../work/work-orders/595_WO_godot_m0_spike_on_box.md) "What was VERIFIED".

```
tools/hshm-bridge/   hshm_bridge.py (writer: test pattern or raw frames on stdin), hshm_probe.py (reader/validator)
caspar/modules/shm/  the real Caspar consumer + ABI (WO-594)
godot/spikes/m0/     this Godot project (GDScript reader — no native code needed for M0)
```

Keys: **1** canvas · **2** atlas · **3** previs · **F** fullscreen · **H** HUD · **Esc** quit (prints a
`[m0] SUMMARY {json}` line — paste it into the WO). Spike args go after `--`:
`--name=<surface> | --shm=<path>  --mode=canvas|atlas|previs  --model=<stage.glb>  --fullscreen
--screen=<n>  --quit-after=<s>  --screenshot=<png>  --log-every=<s>`.

## On the dev Mac (done 2026-10-17)

```
godot/spikes/m0/run-spike.sh canvas          # starts a 1920x1080@50 pattern bridge + the spike
SURFACE=pgm1 W=3072 H=1728 godot/spikes/m0/run-spike.sh previs
```
Use Godot **4.6.3** on this Intel Mac: 4.7.2's bundled MoltenVK 1.4.1 fails compute pipelines on Intel
Iris (2D works, 3D degrades). The box runs native Vulkan on NVIDIA — not affected (check M8b).

## On the box

### Prep (once)

1. **Godot 4.7.x** Linux x86_64 official build → `/opt/godot/godot` (pinned version, WO-599).
2. Mirror the Syncthing ignore line on the box's `.stignore`: `.godot` (does not sync between peers).
3. Run every output at the project rate (owner rule 17.10): with a 50 fps project the operator
   monitor runs at **50 Hz** — `xrandr --output <port> --mode 1920x1080 --rate 50`. Test 60 Hz too (M8).
4. Re-run the API probe on the box engine: `/opt/godot/godot --headless --script work/godot-port/desk-checks/check_api.gd`.

### Step 0a — synthetic pattern (no Caspar involvement)

```
godot/spikes/m0/run-spike.sh canvas --fullscreen --screen=<operator screen index>
godot/spikes/m0/run-spike.sh atlas  --fullscreen --screen=<n>
SURFACE=pgm1 W=3072 H=1728 godot/spikes/m0/run-spike.sh previs --fullscreen --screen=<n> \
  --model=$HOME/highascg/.highascg-previs/models/<id>.glb      # the owner's real stage (WO-17 store)
```
Repeat each with `--rendering-method mobile` and with `cp override.tuned.cfg override.cfg` (staging
buffer tuning — delete `override.cfg` afterwards).

### Step 0b — real ch5 content without the new consumer (adds ~2–4 frames encode/decode latency)

Uses the NVENC arguments proven by WO-319 (`src/preview/gui-stream-nvenc-args.js`; traps: `-format`
not `-f`, the stereo audio downmix is mandatory). Index 749 (reserved for diagnostics, WO-597) / port 5745 so it never collides with the
live gui-stream:
```
ADD 5-749 STREAM udp://127.0.0.1:5745?localport=5746 -filter:v format=yuv420p -codec:v h264_nvenc -preset:v p1 -tune:v ull -b:v 20000k -g:v 12 -filter:a aformat=channel_layouts=stereo,aresample=48000 -codec:a aac -b:a 128k -format mpegts
ffmpeg -hide_banner -hwaccel cuda -fflags nobuffer -flags low_delay \
  -i "udp://127.0.0.1:5745?fifo_size=1048576&overrun_nonfatal=1" -an -f rawvideo -pix_fmt bgra - \
  | python3 tools/hshm-bridge/hshm_bridge.py --name opgui --source stdin
NO_BRIDGE=1 godot/spikes/m0/run-spike.sh canvas --fullscreen --screen=<n>
REMOVE 5-749
```

### Step 1 — the real `shm` consumer (after `caspar/modules/shm/README.md` build)

```
ADD 5-740 SHM NAME opgui
python3 tools/hshm-bridge/hshm_probe.py --name opgui --duration 1800 --json   # M3 soak
NO_BRIDGE=1 godot/spikes/m0/run-spike.sh atlas --fullscreen --screen=<n>
# PGM (maintenance window only): ADD 1-741 SHM NAME pgm1 → SURFACE=pgm1 NO_BRIDGE=1 run-spike.sh previs …
```

## Measurements → WO-595 table

| M | How |
|---|-----|
| M1/M2 frame + upload time | HUD / SUMMARY `frame_ms_*`, `read_ms_*`, `upload_ms_*` at 1920×1080 and 3072×1728 |
| M3 gaps | `hshm_probe.py --duration 1800` (transport) and SUMMARY `gaps` (display: frames never shown) |
| M4 latency | SUMMARY `latency_ms_*` (publish → read, CLOCK_REALTIME on one machine) |
| M5 glass-to-glass | 240 fps phone video of the operator monitor next to a ch5 screen consumer; the pattern flashes a white square once per second |
| M6 Caspar CPU | `pidstat -p $(pgrep -f casparcg) 1` with / without `ADD 5-740 SHM` |
| M7 client CPU/GPU | `pidstat -p $(pgrep -f godot) 1`, `nvidia-smi dmon -s um` |
| M8 pacing | 50 Hz vs 60 Hz operator monitor; SUMMARY `frame_ms_p95/max` + eyes |
| M8b driver smoke | `godot --verbose …` log free of Vulkan errors on Forward+ and Mobile |
| M9/M10 failure | `systemctl restart casparcg-server` / `kill -9` the spike → HUD shows NO SIGNAL then recovers |
| M11 atlas drag | drag the PGM tile; journal shows **no** AMCP |
| M12 previs | the owner's stage model at ≥ 50 fps |

## Known spike limits (fixed in the production design, not here)

- GDScript reader opens the segment per read (stdio buffering would serve stale bytes otherwise) — the
  WO-596 GDExtension `mmap`s once.
- Display polling at the monitor rate: a frame is "not shown" when two arrive within one vsync
  (measured on the Mac: 0 transport gaps vs ~1.4 % display skips at 50 fps on a 60 Hz panel).
- BoxMesh UVs in the generated test stage map 1/6 of the frame per face; real stage meshes carry
  their own UVs (WO-607 UV mapper).
