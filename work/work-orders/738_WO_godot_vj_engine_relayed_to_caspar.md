# WO-738 — VJing in Godot, relayed to CasparCG (instead of the current shader work)

**Status: OPEN (24.10.26) — research answer written; owner chose path C (shared memory), §7. Nothing built yet.**

Owner 24.10: "lets add this https://godotengine.org/asset-library/asset/4506 for the future. answer in a new md file
on the server WHAT CAN BE DONE IN GODOT AND RELAYED TO CASPARCG FOR VJing instead of the current shader work"

## 1. Investigation — where the shader work stands today

- **Shaders run inside Caspar, as HTML templates.**
  - Each shader look is an HTML producer (`template/shaders/*.html`, 194 files) running ShaderToyLite (WebGL2) in
    Caspar's built-in Chromium (CEF).
  - Parameters arrive by `CG UPDATE`, audio over the server WebSocket.
  - The pieces: WO-266 FX + audio, WO-340 parameter UI, WO-344 thumbnails, WO-345 live workflow, WO-374 alpha keying,
    WO-376 camera channel.
- **GPU in CEF is opt-in and off on this box.**
  - The generated `config/casparcg.config` has `<html><enable-gpu>false</enable-gpu></html>`.
  - It is turned on by `operatorTools.cefEnableGpu` (WO-268), and Godot shows ⚠ on shaders while it is off (WO-661).
  - Without the GPU, WebGL renders through SwiftShader, on the CPU:
    - WO-587 measured rAF fps on SwiftShader (`starfield-dots-ii` reached 28 fps);
    - WO-586 recorded `vt220-at-night` taking 7 s a page.
  - WO-268 kept the GPU off by default because CEF's GPU process and Caspar's OpenGL mixer share the card.
- **What the HTML path can't do.** It renders one fragment shader per Chromium renderer process. It has no 3D scene,
  no particles, no compute, and no feedback beyond ShaderToyLite's buffers.
- **Pieces already on the box that a Godot path can reuse:**
  - Caspar's NDI producer and consumer are compiled in: `newtek_ndi_producer.cpp` and `newtek_ndi_consumer.cpp`
    appear in `bin/casparcg`'s strings, and `lib/libndi.so.6.3.2` is installed.
  - The shared-memory frame ring `caspar/modules/shm/` (WO-594): Caspar → `/dev/shm/highascg-<role>` → Godot. The
    writer and reader headers are `hshm_writer.h` and `hshm_reader.h`, and the reader runs natively in Godot through
    the `godot/extensions/hshm` GDExtension (WO-596).
  - Measured shm cost (WO-594, 23.10): a 1080p50 surface takes ~7 % of one core for the copy plus ~3 % for the
    readback. A 3072×1024 surface takes ~2.6× that.
  - Live Caspar channels and DeckLink inputs already arrive in Godot as textures (`pgmN`/`prvN`/`inN`/`chN` surfaces,
    WO-597/616). Godot can therefore process what Caspar plays, not only generate pictures.
  - The previs stage model and LED and screen geometry are already in Godot (WO-616 and onward). The Art-Net tap
    (WO-693) brings a lighting console's DMX in.
  - The GPU-saturation lesson (WO-500): when the GPU saturates, PGM played at 73 % of realtime. A heavy Godot scene on
    the same card can do that to on-air playback.

## 2. What Godot can make that the HTML shaders can't

| Area | Godot 4.7 feature | VJ use |
|---|---|---|
| Shader ports | canvas_item shaders (GLSL-like), multipass through `SubViewport` chains, ping-pong feedback viewports | The 194 Shadertoy-format shaders carry over. A converter wraps `mainImage` and maps `iTime`→`TIME`, `iResolution`→a uniform, `iChannelN`→`sampler2D` uniforms, `fragCoord`→`FRAGCOORD` (y flipped). Every shader runs on the GPU, never in SwiftShader |
| Live coding | `Shader.code` can be set at runtime (compile errors go to the log) | Edit a running shader with no restart, as WO-345 does today through CG UPDATE |
| Particles | `GPUParticles2D/3D`, particle shaders, attractors, SDF/heightfield collision, trails | Millions of particles that react to audio or DMX |
| 3D | glTF models and animation, volumetric fog, glow, SDFGI, real-time lights, cameras on paths | Stage-scale 3D scenes and camera moves; text in 3D |
| Compute | `RenderingDevice` compute shaders | Fluid, reaction-diffusion, boids, cellular automata at full resolution |
| Post | `CompositorEffect` chains | Bloom, chromatic aberration, datamosh-style feedback, color grading |
| Video in | the existing shm surfaces (`inN`, `pgmN`, `chN`) as textures | DeckLink cameras or a Caspar clip run through kaleidoscope, displacement, slit-scan or feedback, then sent back to Caspar. Godot only plays Theora natively, so clips stay in Caspar |
| Audio | `AudioEffectSpectrumAnalyzer` / `AudioEffectCapture` on a bus fed by `AudioStreamMicrophone`, or the program audio levels the server already broadcasts (WO-335) | Beat, band and onset reactivity. Reusing the server's analysis keeps one audio truth |
| Control | MIDI built in (`OS.open_midi_inputs`, `InputEventMIDI`), OSC over `PacketPeerUDP`, DMX through the WO-693 tap | Controllers and the lighting console drive visuals with no addon |
| Sequencing | `AnimationPlayer` tracks, keyframes, timecode | Programmed show cues next to free VJ jamming |
| Mapping | The previs stage camera and screen geometry | Render once for the real LED wall layout; pixel-map to each screen's crop |
| Content packs | `ProjectSettings.load_resource_pack()` + `PackedScene` | Each "VJ clip" is a `.pck` or `.tscn` loaded on demand, the way media files are today |
| Offline | Movie Maker mode (`--write-movie`, fixed fps, AVI/MJPEG or PNG sequence) | Pre-render heavy scenes to files. The existing HAP dialog converts them, and Caspar plays them as media |

## 3. How the picture gets into Caspar

| Path | Exists? | Latency | CPU / GPU cost | Alpha | Fit |
|---|---|---|---|---|---|
| **A. Pre-render** (Movie Maker → HAP → media) | Godot + HAP dialog: yes | none (offline) | none on air | PNG sequence: yes | **Zero on-air risk.** Not live, so no live reaction |
| **B. NDI** (Godot sender → Caspar `ndi://` producer) | Caspar side: yes. Godot side: a GDExtension around the libndi already in `lib/` | ~1–3 frames | GPU readback + SpeedHQ encode in Godot, decode in Caspar: more CPU than shm (measure) | NDI carries alpha (UYVA); check Caspar's producer keeps it | **Fastest to a live result.** Also works from another machine (a VJ laptop) |
| **C. Shared memory** (Godot writes the HASCGSHM ring → a new Caspar `shm` *producer*) | Ring + writer: yes. Caspar producer: new C++ plus a rebuild (WO-613 path) | <1 frame transport | Readback + one ~1.4 ms copy per 1080p frame at each end (WO-594 scale) | BGRA, yes | **Lowest cost and latency, same box only.** Mirrors the existing consumer |
| D. Zero-copy GPU share (Vulkan external memory → GL `EXT_memory_object_fd` + semaphores) | No | ~0 | no CPU copy | yes | Research. Godot is Vulkan and Caspar is OpenGL; the interop works on NVIDIA but is hard to make robust |
| E. v4l2loopback / SRT stream into the ffmpeg producer | Partly | v4l2: 1–2 frames; SRT: 100 ms+ | YUV conversions | no | Not recommended: a DKMS module that breaks on kernel upgrades (.4 just went to 7.0), no alpha |
| F. Control only (Godot drives existing Caspar layers: MIXER, CG UPDATE of shader parameters) | Yes (server API) | network RTT | negligible | n/a | Godot as the VJ *brain* (MIDI, beats, sequencing) while Caspar keeps rendering. Possible today |

Frame clock: Caspar's channel clock (DeckLink or system) and Godot's render loop are not locked together. With B
and C the producer takes the newest frame every tick, so a frame repeats or drops now and then. To stay smooth, cap
Godot at the channel rate (`Engine.max_fps`). Later, Godot can be paced from Caspar's OSC tick.

## 4. Constraints that apply to any Godot VJ path

- **A separate process, never the operator kiosk.** A crash or a UI hitch in the operator client must not freeze an
  output. This means a second Godot project (`godot/vj/`) with its own systemd or launcher entry.
  - It needs a real Vulkan context: `--headless` uses the dummy renderer and draws nothing.
  - It therefore runs a hidden or tiny window on `:0` and renders into a fixed-size `SubViewport`
    (`UPDATE_ALWAYS`).
- **GPU budget, measured.**
  - Cap the render size to the channel's and the fps to the channel rate.
  - Watch `nvidia-smi` and Caspar's realtime ratio (the WO-500 method) before anything goes on air.
  - The RTX PRO 4000 here has headroom. The 2080 SUPER on .4 has less.
- **Readback.**
  - `Viewport.get_texture().get_image()` stalls the GPU. Use `RenderingDevice.texture_get_data_async`; it exists
    since 4.4, so confirm it on 4.7 before relying on it.
- **Integration costs real work.** The look/take model, parameter UI, thumbnails and alpha keying exist for the HTML
  shaders. A Godot source needs the same: a Live-tab source row, parameters, and a thumbnail from its own surface.

## 5. Recommendation

1. **Keep the HTML shaders** for light backgrounds. They are integrated end to end. Turning on `cefEnableGpu`, after
   a GPU-contention check, removes the SwiftShader slowness for the heavy ones.
2. **P1 — B (NDI) with one Godot VJ scene**: a ported Shadertoy shader plus particles, audio-reactive from the
   server's levels.
   - Measure CPU, GPU and the PGM realtime ratio on this box.
   - No Caspar rebuild is needed, and the same scene can run on a laptop.
3. **P2 — C (shm producer)** once NDI's CPU or latency is the limit. It completes the shm loop in both directions,
   so Caspar inputs go → Godot FX → back to Caspar.
4. **A (pre-render)** any time, for scenes too heavy to risk live.
5. **F (control)** grows alongside: MIDI or OSC mappings that drive both Godot scenes and existing Caspar layers.

## 6. For the future — FlowKit (owner link)

[FlowKit](https://github.com/LexianDEV/FlowKit), Godot Asset Library #4506:
- **What it is:** an event-sheet visual scripting addon in the style of Clickteam Fusion and Construct ("when
  condition → do actions"), pure GDScript, MIT.
- **Versions:** made for Godot 4.5+. This box runs 4.7.2, so compatibility is untested.
- **Maturity:** the asset page shows v1.0 (25.11.2025). The repo has 205★, its last push was 23.10.2026, and 10
  issues are open.
- **Author's caveats:** the README says it was made with generative AI help, and the asset page advises against
  production use yet.
- **Possible fit here:** VJ rules an operator can read, such as "when beat → flash layer 3" or "when MIDI note 36 →
  next scene".
- **Catch:** its event sheets are edited in the Godot *editor* (a bottom panel) and saved as `.tres`. Operators run an
  exported or kiosk client and never the editor. The likely use is its runtime with an in-app sheet editor of our own.
  Re-evaluate when a Godot VJ process (P1) exists. Not installed.

## 7. Owner decision (24.10)

> "definitly shared memory. if it needs to be built so be it. i think it will be useful for future window grabbing
> from virtual screens"

- **Path C is the plan**: a Caspar `shm` producer that plays a HASCGSHM ring written by another process. It mirrors
  the WO-594 consumer and reuses `hshm_abi.h` and `hshm_writer.h`. NDI (B) is no longer the first step.
- **The producer stays generic, not Godot-specific.** Any writer feeds it the same way: the Godot VJ process, or
  later a window or virtual-screen grabber (XShm or XComposite capture of an X screen or window, written into the
  ring). The ring carries its size, format and frame sequence in its header, so the producer never needs to know who
  writes.
- Build order:
  1. The Caspar producer: `PLAY 1-10 SHM NAME <role>`, newest frame per tick, BGRA with straight or premultiplied
     alpha flagged in the header. Rebuild through the WO-613 path, with an offline test from a C writer.
  2. A Godot writer: a GDExtension next to `hshm` that does the readback and publishes into the ring.
  3. Server and client glue: the source in the Live tab, a lease (as for the surfaces), and teardown when the writer
     dies.
- A separate WO is to be opened when the work starts (after WO-739, the link-accept path).

## What was done

- This research answer; no code. Facts were checked on the box:
  - the CEF GPU flag in `config/casparcg.config`;
  - the NDI producer and consumer symbols in `bin/casparcg`;
  - `lib/libndi.so.6.3.2`;
  - the measured costs quoted from WO-594, WO-586/587 and WO-500.
- FlowKit facts come from its asset page and GitHub repo (via `gh api`).

## What was VERIFIED

Nothing runs yet; nothing to verify. Two claims are unverified and marked so above: `texture_get_data_async` on 4.7,
and alpha through Caspar's NDI producer.
