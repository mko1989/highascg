# WO-876 — Visuals: a classic game as a scene / layer (libretro window → ring → effects)

**Area:** godot-client, engine
**Status: IN PROGRESS (31.10: Game scene + launcher + core installer, pipeline proven on Xvfb with the test core; waits for the owner to install cores and drop ROMs)**

Owner, 31.10: *"Also as part of the visuals I'd like to implement a classic games emulator, so I can run contra Mario or
whatever use it as a layer in visuals with effects etc, but play normally on the operator monitor with keyboard/gamepad
input. Find open source projects that we can borrow from and start building it in."*

## 1. Investigation

- **We already have the emulator host.** [WO-745](./745_WO_retro_game_source_libretro.md) (DONE 24.10) built `RetroHost`
  (C++ GDExtension, dlopens any libretro core) and `godot/retro/` — an operator window with RetroArch's keyboard layout and
  a gamepad map, sound through an AudioStreamGenerator, and the picture published as shm ring `--ring` (whole-factor
  enlarged, nearest). It runs as **its own process** on purpose: a crashing third-party core cannot take the GUI down.
  `tools/e2e/retro-source.sh` still PASSES today (test core, ring 800×720, a real X key reaching the core, Live-tab listing).
- **The client already reads rings** (`video/shm_native.gd` + `video/shm_texture.gd`, WO-595/596): HshmSource uploads a
  ring frame straight into an RD texture on the render thread. So "a game in the Visuals" = the window publishes a ring,
  a Visuals scene reads it — no core inside the GUI process.
- **Third-party Godot libretro bindings** (checked by a research subagent, repo pages opened): RetroXR/libretro-godot (MIT,
  active 2026-10-27, SCons + SDL3/Vulkan, HW-render cores), Skurdt/SK.Libretro.Godot (MIT, 2026-03), 8f00ff
  libretro-godot4-frontend (Unlicense, WIP, 2025-03), ammliee/gdlibretro (2023, Windows, no licence). None adds anything
  the in-house host lacks for 2D consoles; RetroXR is the one to borrow from if HW-rendered cores (N64/PSX GL) are ever
  wanted. No usable pure-GDScript NES emulator exists (too slow anyway).
- **Cores** (libretro repos, GitHub API): fceumm (GPL-2, 2026-10-11, proven in WO-745), nestopia (GPL-2, 2026-10-30),
  mesen (GPL-3, buildbot only), bsnes-mercury (GPL-3), mgba (MPL-2.0), gambatte (GPL-2), snes9x and Genesis Plus GX
  (non-commercial licences — not for paid shows). Ubuntu's archive ships `libretro-nestopia`, `-bsnes-mercury-*`,
  `-mgba`, `-gambatte`, `-snes9x`, `-genesisplusgx`, … but they depend on RetroArch; `apt-get download` + `dpkg-deb -x`
  takes only the `.so`, from the signed archive, without root. Nothing is installed on the box yet.
- Building a core from source in-session was refused by the session's safety classifier (external code) — the owner
  installs cores with the script below.

## 2. What was done

- `godot/client/features/visuals/game_launcher.gd` (new): ROMs from `~/.highascg/retro/games` and `~/highascg/media/games`
  (unzipped; by extension), the core by extension in preference order (`.nes` → nestopia, fceumm, mesen; `.sfc/.smc` →
  bsnes-mercury balanced, snes9x; `.gb/.gbc/.gba` → mgba, gambatte, sameboy; Sega → genesis_plus_gx) from
  `~/.highascg/retro/cores`; `play(rom, screen)` opens WO-745's window (`OS.create_process`, the same Godot binary,
  `--screen` = the screen this client is on, `--ring visuals-game`); one window at a time; `ready_error()` says why not.
- `scenes/game.gd` (new) "Game": reads ring `highascg-visuals-game` (native HshmSource, GDScript reader fallback) into a
  3D screen. speed = CRT (scanlines on the game's own lines — the console line count recovered from the ring size —,
  barrel, vignette), pulse = zoom, spin = the screen floats/tilts, amount = opacity, glow = brightness (whites bloom),
  burst = glitch (row jitter + colour split), the smoothed bass (WO-875) splits the colours slightly. The palette is never
  rotated (as WO-874). Layer 2 keys black out so the sprites float over the main scene. No ring / dead writer = not drawn.
- Page (`visuals_page.gd`): a Game row (ROM picker + Play/Stop) and a status line, shown when Game is the scene or layer 2.
  Tab: Play/Stop, a new pick while playing restarts the window, a 1 s status tick (window closed by hand → Play again,
  "Starting…", the controls once the ring is live), the window closes with the tab. Model: SCENES + `game` (ROM path).
- `godot/retro/get-cores.sh` (new): Nestopia + bsnes-mercury balanced + mGBA from Ubuntu's packages into
  `~/.highascg/retro/cores`; `--with-noncommercial` adds Genesis Plus GX and Snes9x.
- Probe: `--probe-visuals-shots` adds game, tunnel+game, game+spectrum.

## 3. What was VERIFIED

- Godot suite 24012/0, incl. `test_game_launcher.gd` (ROM listing and filtering, core preference and fallbacks, the window's
  command line, refusals with reasons, console line counts, no ring → nothing drawn, layer-2 keying, the bass split) and
  the stage's every-scene test (Game and Spectrum step 40 frames with bursts as main and layer 2).
- Xvfb end to end (scratchpad `w876/`): WO-745's window with the in-repo test core published `/dev/shm/highascg-visuals-game`
  (800×720); the Visuals probe showed it as the Game scene (tilted screen, scanlines, curvature, burst glitch rows), over the
  tunnel as keyed layer 2, and under the Spectrum layer; canvas GPU 0.13–0.15 ms.
- Not yet: a real core and ROM (owner: `godot/retro/get-cores.sh`, ROMs in `~/.highascg/retro/games`), Play from the GUI
  on the operator screen, a gamepad, the game on air through Send.
