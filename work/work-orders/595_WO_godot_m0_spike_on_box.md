**Status: IN PROGRESS (2026-10-17) — trial BUILT and verified on the dev Mac (owner: no box available now; "create the trial here and then i will move it to the box"). Box steps (runbook `godot/spikes/m0/README.md`) still to run. Parent: [WO-593](./593_WO_godot_client_port_epic.md). GATE: the full port (WO-598…610) does not start until this WO records GO.**

# WO-595 — M0 spike: Godot on the box, video from shared memory, UI over video, 3D previs quad

Owner, 17.10: "i like godot for the native 3d previz which i wanted to include in the future and
this future might be now. i want to try porting the client to godot." This WO is the "try": the
smallest set of experiments, run **on the production box** (outside show hours), whose results
decide GO / NO-GO for the port before any feature code is written.

## Investigation (what is already known, and what only the box can answer)

Ecosystem research (sources + confidence per item): [`godot-ecosystem-research.md`](../godot-port/inventory/godot-ecosystem-research.md).

Known (desk-verified 2026-10-17, see [WO-593](./593_WO_godot_client_port_epic.md) §Investigation):

- Godot **4.6.3-stable** (dev Mac) exposes every API the design needs — headless ClassDB probe
  (`work/godot-port/desk-checks/check_api.gd`), all `yes`: `Texture2DRD`, `AtlasTexture`,
  `RenderingDevice.texture_update(texture:RID, layer:int, data:PackedByteArray)`,
  `RenderingDevice.texture_create_from_extension(...)`, `DATA_FORMAT_B8G8R8A8_UNORM`,
  `TEXTURE_USAGE_CAN_UPDATE_BIT`, `GLTFDocument.append_from_file/append_from_buffer/generate_scene`,
  `FBXDocument`, `WebSocketPeer`, `HTTPRequest`, `PacketPeerUDP`, `GraphEdit`, `Window.files_dropped`,
  `DisplayServer.screen_get_position/size/refresh_rate`, `DisplayServer.file_dialog_show`.
  There is **no** built-in shared-memory class (`SharedMemory` → NO) → a GDExtension is required
  for the production path (WO-596); GDScript `FileAccess` on `/dev/shm/...` works for the spike.
- GDScript-only frame read (dev Mac i5 laptop): 1920×1080 **1.46 ms**, 3072×1728 **7.77 ms** avg
  (`bench_read.gd`, 300 reads). 50 fps budget = 20 ms → the GDScript path is enough for ch5 in M0.
- Caspar side: the `shm` consumer is one memcpy of a frame Caspar already reads back
  ([WO-594](./594_WO_caspar_shm_frame_consumer.md) §1); the channel must never wait on it (§3).

Only the box can answer:

1. Does Godot 4.6 (Vulkan, Forward+ or Mobile) run cleanly under **Openbox / X11 / NVIDIA 595**
   with no compositor — vsync, tearing, multi-monitor placement at the operator port, focus?
2. What does a per-frame `texture_update` of 8.3 MB (ch5) and 21.2 MB (ch1) cost on the RTX PRO 4000
   (main-thread time, GPU time, stalls)? Desk measurement impossible (headless = dummy renderer).
3. Real glass-to-glass latency of shm vs. today's screen consumer, side by side.
4. Does the stack survive Caspar restart / client kill / channel re-init without touching air?

## Plan

### Step 0 — Godot side alone (no Caspar change; can start day 1)

- Install Godot **4.7.x** Linux x86_64 (official build; latest stable is `4.7.2-stable` ✔ git
  ls-remote 2026-10-17 — the 4.6 line gets no more feature patches) under `/opt/godot/` on the box.
  The ClassDB probe was run on 4.6.3; re-run `check_api.gd` on 4.7.x first (4.7 changed some APIs).
- Run every scene under **both Forward+ and Mobile** (the RD/`Texture2DRD` path does not exist in the
  Compatibility renderer — research risk 3); set `rendering/rendering_device/staging_buffer/*`
  (`block_size_kb`, `max_size_mb` ≥ 3 frames, `texture_upload_region_size_px`) and record which
  values were used — `texture_update` copies on the CPU in 64 px tiles by default (research risk 1).
- `tools/hshm-bridge/hshm_bridge.py` (~120 LOC, spike-only): reads raw BGRA frames on stdin
  (`ffmpeg ... -f rawvideo -pix_fmt bgra -`) and writes them using the exact [WO-594 ABI](./594_WO_caspar_shm_frame_consumer.md#shared-memory-abi-v1-hshm_abih)
  into `/dev/shm/highascg-<name>` (same seqlock protocol). Sources:
  - (a) synthetic: `ffmpeg -re -f lavfi -i testsrc2=size=1920x1080:rate=50 ...` (+ a frame
    counter burned in, for gap/latency checks);
  - (b) real ch5 content: Caspar `ADD 5-749 STREAM udp://127.0.0.1:<port> -codec:v h264_nvenc
    -preset:v p1 -tune:v ll -format mpegts` (NVENC pattern already proven by WO-145/WO-319) →
    `ffmpeg -hwaccel cuda -i udp://… -f rawvideo -pix_fmt bgra -` → bridge. Adds ~2–4 frames of
    encode/decode latency — fine for proving the Godot side, NOT for the latency measurement.
- Godot spike project `godot/spikes/m0/` (later deleted or kept as a fixture):
  - `ShmReader.gd` — `FileAccess.open("/dev/shm/highascg-opgui")`, per `_process`: read header
    `latest` (`seek` + `get_64`), seqlock check, `get_buffer`, then
    `RenderingDevice.texture_update()` into a `Texture2DRD` (BGRA8, `CAN_UPDATE|SAMPLING`).
  - Scene A "canvas": fullscreen window on the operator monitor, full-window `TextureRect` showing
    the texture, 3 `Label`s + a tally-border shader drawn **over** the video, FPS/latency HUD
    (latency = now − slot `publish_ns`).
  - Scene B "atlas": 4 `AtlasTexture`s with `region` = the 4 quadrants of ch5; one tile draggable
    with the mouse at 50 fps; others animate size/position continuously — **no AMCP traffic**.
  - Scene C "previs": `GLTFDocument.append_from_file()` of a real stage `.glb` (the one already
    persisted by WO-17's `/api/previs/models`, or a box with a 16:9 face) → `StandardMaterial3D`
    with `albedo_texture` = the live `Texture2DRD`; orbit camera.

### Step 1 — real transport (after WO-594 T2 lands)

- Swap the bridge for the real `ADD 5-740 SHM NAME opgui`; repeat Scene A/B measurements.
- Add `ADD 1-741 SHM NAME ch1` (PGM, 3072×1728) **only in a maintenance window**; Scene C on it.

### Step 2 — measurements (record raw numbers in "Verified")

| # | Measurement | Tool | Pass |
|---|-------------|------|------|
| M1 | Godot frame time with shm upload, ch5 1080p50 | Godot profiler + `Performance` monitors | < 4 ms main thread |
| M2 | Same with ch1 3072×1728@50 (previs) | idem | < 8 ms (GDScript) / < 3 ms (WO-596 native) |
| M3 | Seq gaps over 30 min (reader side) | HUD counter | 0 |
| M4 | publish → present latency | HUD (`publish_ns`) | ≤ 1 frame + vsync wait (≤ 40 ms) |
| M5 | Glass-to-glass vs. ch5 screen consumer side by side | 240 fps phone camera on both | ≤ 1 frame behind |
| M6 | Caspar CPU added by shm consumer | `pidstat -p <caspar> 1` | < 3 % of one core |
| M7 | Godot process CPU / GPU / VRAM | `pidstat`, `nvidia-smi dmon` | < 15 % core, < 10 % GPU, < 500 MB |
| M8 | Window on correct monitor at boot, fullscreen, no tearing; **pacing** with the operator monitor at 60 Hz vs 50 Hz, and with other monitors at different refresh rates (godotengine/godot#62821: X11/NVIDIA FIFO vsync stutters to the slowest display) | eyes + `xrandr` + frame-time graph | smooth at 50 Hz; decide monitor-rate policy |
| M8b | NVIDIA Blackwell + driver 595 smoke: Forward+ and Mobile, multi-window, `--verbose` log clean | log | no Vulkan errors (no community reports exist for this combo — research risk 8) |
| M9 | `kill -9` Caspar / `systemctl restart casparcg-server` | eyes + log | UI stays, "NO SIGNAL", reattach < 2 s |
| M10 | `kill -9` Godot | Caspar log/OSC | channel unaffected; client restart < 1 s (systemd user unit) |
| M11 | Atlas tile drag at 50 fps | eyes | video stays glued to the tile, zero lag |
| M12 | glTF stage + live texture | eyes + FPS | ≥ 50 fps, no stutter |

### Step 3 — decision

GO if M1–M12 pass (M2 may pass via the native path). Record the decision in WO-593 and in
`work/OPEN_ISSUES.md`. NO-GO → this WO and WO-593 become DEPRECATED with the reason; the
kiosk stays (and WO-594 may still be kept for the web client's in-browser video, see
`work/LOCALHOST_CHANNEL_VIEW.md`).

## Box safety (house rules)

- Run only outside show hours; ch1/ch3 shm only in a maintenance window (on-air channels).
- The spike never touches `config/casparcg.config` generation: consumers are added by AMCP with
  reserved indices 740–749 and removed afterwards.
- `godot/.godot/` (editor import cache) must be in `.gitignore` **and** `.stignore` before the
  project is created on any peer (Syncthing fight risk — CLAUDE.md). Mirror `.stignore` on the Mac.

## What was done (2026-10-17, dev Mac)

| Path | What |
|------|------|
| `tools/hshm-bridge/hshm_abi.py` | Python writer/reader mirroring `caspar/modules/shm/hshm_abi.h` |
| `tools/hshm-bridge/hshm_bridge.py` | step-0 writer: built-in test pattern (4 coloured quadrants, sweeping bar, 32-bit frame counter as pixel blocks, 1 Hz white flash) or raw BGRA on stdin (ffmpeg) |
| `tools/hshm-bridge/hshm_probe.py` | reader/validator: fps, gaps, laps, latency, `--check-pattern` decodes the counter from pixels (torn-frame proof) |
| `godot/spikes/m0/` | Godot project: `shm_reader.gd` (GDScript reader), `shm_texture.gd` (`Texture2DRD` BGRA8 + `texture_update`, ImageTexture fallback), `mode_canvas/atlas/previs.gd`, `stats.gd` (HUD, periodic log, `[m0] SUMMARY` JSON), `tools/make_test_stage.gd` (writes a test `.glb`), `run-spike.sh`, `override.tuned.cfg`, `README.md` (box runbook) |

Bugs found and fixed while building (kept here because they will recur in production code):
1. **Stale reads through `FileAccess`:** stdio buffering + `fseek` inside the current buffer served the
   old `latest` → frames stopped after 4 reads. Fix: fresh handle per read in the spike; the WO-596
   GDExtension must `mmap` (never buffered file I/O).
2. **Control sizing:** `set_anchors_preset()` keeps zero offsets → everything collapsed; use
   `set_anchors_and_offsets_preset()`.
3. **`AtlasTexture` regions are ignored by 3D materials** → sub-regions on meshes need UV
   scale/offset (or the WO-607 UV mapper), not AtlasTexture.
4. Freeing the RD texture at quit races the last draw → let process exit release it.

## What was VERIFIED (dev Mac: i5-1038NG7, Intel Iris Plus, 60 Hz panel, Godot 4.6.3 Forward+ on Vulkan/MoltenVK 1.2.9)

| Check | Result |
|-------|--------|
| Transport, 1080p50 pattern, probe `--check-pattern` 6 s | 300 frames, 49.99 fps, **0 gaps, 0 torn**, latency p50 1.86 / p95 3.25 ms; bridge work 1.64 ms/frame |
| Transport, 3072×1728@50 | 250 frames, **0 torn**, p50 5.64 ms (1 gap = Python probe too slow at 21 MB/frame) |
| Transport, ffmpeg `testsrc2` → stdin | 201 frames / 4 s, 0 gaps, 0 torn |
| Godot headless reader (no GPU), 8 s | 400 frames (50 fps), read p50 1.85 ms, 1 startup gap |
| **Canvas** (RD BGRA8 path, `bgra_supported=true`) | 60 fps render, read p50 2.7 ms, **upload p50 0.96 ms**, UI over video ✔ (screenshot: tally border, labels, translucent bar over live pattern; colours correct ⇒ BGRA order right) |
| **Atlas** | 4 tiles from one texture, live, animated + draggable, upload p50 0.95 ms ✔ |
| **Previs** procedural stage | live texture on LED wall + side screen (UV-scaled quadrant), glow ✔; 60 fps after a one-time ~2 s shader-compile stall on first run |
| **Previs runtime glTF** (`make_test_stage.gd` → `.glb`) | `GLTFDocument` load: 4 meshes, 2 tagged `LED_Screen_*` by name, live video on both ✔ |
| **PGM size** 3072×1728@50 in previs | 58.4 fps avg, read p50 5.39 ms (GDScript), **upload p50 2.72 / p95 3.67 ms** |
| Staging-buffer tuning (`override.tuned.cfg`) at 3072×1728 | no measurable change on MoltenVK (2.37 vs 2.44 ms) → re-measure on the box |
| Display skips vs transport gaps (concurrent, 14 s) | probe (1 ms poll) **1 gap/698** (startup) vs Godot (60 Hz poll) **10/687** ⇒ transport lossless; skips = 50 fps writer jitter vs 60 Hz vsync ⇒ supports the owner's "all outputs at project rate" rule |
| Writer loss/recovery (bridge stops 3 s, new writer) | NO SIGNAL within 0.5 s, auto-reattach to the new segment (generation/inode) ✔ |
| Godot **4.7.2** | API probe: 76/76 present. Headless reader ✔ (250 frames/5 s). Windowed on this Mac: bundled **MoltenVK 1.4.1 fails compute pipelines on Intel Iris** ("AIR builtin function was called but no definition was found") → 2D works (canvas 58 fps), 3D degraded (~15 fps). Mac-only (MoltenVK); the box uses native Vulkan on NVIDIA → **M8b** must confirm. Dev on this Mac: use 4.6.3 for 3D. |
| `run-spike.sh` | starts bridge, finds Godot, runs, cleans the bridge up ✔ |

Not verified (box only): everything in the M1–M12 table on NVIDIA/Linux/X11, the real Caspar
consumer, 50 Hz pacing, Blackwell driver, glass-to-glass, CPU budgets.
