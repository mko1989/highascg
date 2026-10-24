# WO-745 — Game source: a libretro core in an operator window, published as a Live-tab source (WO-738 §9)

**Status: DONE (24.10.26) as future development, detachable (see "How to remove"). Proven by
`tools/e2e/retro-source.sh` (PASS): test core, operator window, shm ring, real X key press reaching the core, ring
listed as a live source. A real NES core (FCEUmm, built from source) ran a blargg test ROM through the same window.
No core or ROM is bundled. On air it needs the WO-742 Caspar binary and the WO-744 server code (owner restarts).**

Parent: [WO-738 §9](./738_WO_godot_vj_engine_relayed_to_caspar.md). Chain: writer [WO-743](./743_WO_godot_shm_writer.md)
→ Live source [WO-744](./744_WO_shm_ring_live_source.md) → Caspar [WO-742](./742_WO_caspar_shm_producer.md).
Owner, 24.10: *"a small (if possible) either rom reader for old nintendo consoles, or something similar that can be
opened in a new window for the operator but become a source to use to display on the outputs"*; (/loop) *"try to make
those easily detachable"*.

## Investigation

- **Nothing on the box.** No libretro cores, no RetroArch, no SDL2 headers, no `libretro.h`. Godot is the obvious
  host: it already has the window, input and audio, and WO-743 already publishes Godot pixels into a ring.
- **libretro API v1** (`libretro.h`, MIT):
  - a core is one `.so` with about 25 `retro_*` entry points;
  - the frontend registers C callbacks (environment, video, audio, input), then `retro_load_game` and one
    `retro_run` per frame;
  - video arrives as 0RGB1555, RGB565 or XRGB8888 with a pitch; a NULL frame means "repeat the last" (dupe).
  - The callbacks carry no user pointer, so one core runs per process (the host refuses a second).
- **Separate process, never the kiosk.** Cores are third-party native code. If one crashes inside the kiosk, the
  on-air GUI goes with it. So the game window is its own small Godot project (`godot/retro/`), and only its ring
  reaches Caspar.
- **libretro.h is about 7800 lines.** Vendoring it would break the 500-line rule
  (`tools/ci/check-max-file-lines.js` scans `.h` under `godot/`). CMake downloads it into the build tree (excluded)
  from the pinned RetroArch tag `v1.19.1`, checked by SHA256 `a508b75e…`.
- **Caspar would smear a 256×240 frame** with its scaler (WO-738 §9). So the ring carries the picture enlarged by a
  whole factor with nearest filtering.
- **A killed window leaves its ring file.** SIGTERM ends Godot without `_exit_tree`. WO-744's lister ignores rings
  whose writer is dead, so it never shows as a source, but the file stays in `/dev/shm` until the next start with
  the same name, which reuses it.

## What was done

- `godot/extensions/hshm/src/retro/` (new library `libretrohost`, its own `.gdextension`, entry
  `retrohost_library_init`):
  - `retro_host.{h,cpp}` define `RetroHost` (RefCounted):
    - `load_core(core, system_dir, save_dir)`: dlopen, resolve every entry point, check the API version,
      environment before `retro_init`;
    - `load_game(path)`: from memory when the core does not need a full path;
    - `run_frame()`, `set_button(port, id, pressed)`, `unload()`;
    - picture: `get_frame()` / `get_image()` (RGBA8, from any of the three pixel formats; dupes keep the last);
    - sound: `take_audio()` (stereo floats, capped at 1 s);
    - getters: size, fps, sample rate, core name, error.
  - Environment: can-dupe, pixel format, system and save directories, log (warnings and up to stderr), input
    bitmasks, geometry. Everything else (core options, rumble, HW rendering) is refused.
- `godot/extensions/hshm/CMakeLists.txt`: a marked `WO-745` block (option `HSHM_RETRO`) with the hashed download.
  `libhshm` is untouched (md5 `deef6c73…`).
- `godot/retro/` (new Godot project, Compatibility renderer):
  - `retro_window.gd`, the window:
    - runs the core at its own fps (catches up at most 3 frames, then drops time);
    - shows it with nearest filtering, letterboxed in black;
    - publishes it to `--ring` (default `retro`), enlarged by `--scale` (default: the smallest whole factor reaching
      720 lines);
    - plays its sound through an AudioStreamGenerator;
    - on close, unlinks the ring and unloads the core;
    - the title says `source shm://<ring>`.
  - `retro_keys.gd`: RetroArch's keyboard layout (arrows; X = A, Z = B, S = X, A = Y, Q / W = L / R, Enter = Start,
    Shift = Select) and a positional gamepad layout. The left stick acts as the d-pad.
  - `install.sh` builds `hshm_sink` + `retrohost` and copies them into `godot/retro/addons/`. That path is in
    `.gitignore` and `.stignore` (mirror the `.stignore` line on the Mac).
  - `run-retro.sh --core <x_libretro.so> --game <file> [--ring name] [--scale N]`.
  - `tests/test_core.c`: a 50-line core (green, or red while A is held, plus a colour from the game file's first byte,
    plus a square wave).
- `tools/e2e/retro-source.sh` (new), on its own Xvfb display, as described below.

## How to remove (owner decision at the end)

- Delete `godot/retro/`, `godot/extensions/hshm/src/retro/` and `tools/e2e/retro-source.sh`.
- Delete the `WO-745` block at the end of `godot/extensions/hshm/CMakeLists.txt`.
- Delete the `WO-745` lines in `.gitignore` (3) and `.stignore` (2), and `godot/extensions/hshm/bin/libretrohost.*`
  (built, not committed).
- Nothing in the client or server references it. It reaches the outputs only through WO-744's generic ring listing.

## What was VERIFIED

- Built with `godot/retro/install.sh` (cmake targets `hshm_sink`, `retrohost`): 0 warnings. The test core builds with
  `-Wall -Wextra` clean.
- `tools/e2e/retro-source.sh` → **PASS** (3.2 s):
  - ring 800×720 (160×144 auto ×5);
  - (200,360) = `00 ff 00 ff` green;
  - (600,360) = `ff 40 40 ff`, colour from the game file, so the content reached the core;
  - columns 399 / 400 change colour with no blend in between (nearest);
  - window title `HighAsCG Retro — HighAsCG test core 1 — source shm://wo745-…`;
  - `xdotool keydown x` → the left half turns red `00 00 ff ff`; keyup → green: real X input reached the core as
    joypad A;
  - the WO-744 lister shows `{"name":"wo745-…","width":800,"height":720,"fps":60,"writer":"godot","signal":true}`.
- **Real core.** FCEUmm (libretro-fceumm `ac0d00a`, built from source in the scratchpad, not committed) with blargg's
  `full_palette.nes` (nes-test-roms, freely distributable):
  - 256×240 frames, published as 768×720 (auto ×3), palette colours in the ring;
  - window screenshot checked; 0 script errors;
  - listed as a live source.
- The box's kiosk, server and Caspar were untouched: everything ran on private Xvfb displays.
- Not done:
  - no gamepad was available to test (the mapping is code-reviewed only);
  - sound was produced but not listened to;
  - not on air;
  - `godot/retro/` scripts are not parsed by CI (it runs only the client project). The e2e catches a parse error, as
    happened once during the work (the `scale` name clash).

## Notes for the owner

- **Cores.** Build them from source, as here, or take them from the libretro buildbot. Most are GPL, which is fine as
  separate libraries. Some are non-commercial only (snes9x, for one), which matters on a box used for paid shows.
  **ROMs are the operator's own files.** Nothing is bundled.
- **Audio** stays on the operator's speakers: the ring carries video only (WO-738 §9).
