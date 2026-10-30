# WO-686 — Godot client ready for Windows / macOS / Linux (a GUI on another machine)

**Area:** godot-client
**Status: DONE (22.10, Godot `--test` 21055/0 + `--check`; all three exports built on the box; the Linux export run windowed against the box over the LAN). Owner QA: run the Windows .exe and the macOS .app on real machines.**

Owner, 22.10: *"Prepare the Godot client for multi platform."* Follows [WO-670](./670_WO_server_network_and_remote_godot.md),
whose P1 left "Windows / macOS export presets (nothing to test them on here)" open.

## Investigation (22.10)

Already portable (no change needed):
- Server address: `core/config.gd` (`--server=`, `HIGHASCG_SERVER`, A/B profiles editable in the header's
  connection menu, `app/connection_menu.gd`), plain HTTP + WS.
- Video: off-box the JPEG feed replaces shm (`video/video_feed.gd`, WO-670 P1); `video_surfaces.gd` only touches
  `/dev/shm` on Linux. The hshm GDExtension is loaded through `ClassDB` (`video/shm_native.gd:13`), so a platform
  without its library falls back cleanly.
- Media: an off-box drop / "Add media files" uploads over HTTP when the server refuses a local-path ingest
  (`features/live/media_ingest.gd` `upload_plan`).
- Keys: undo (`core/project_undo.gd:101`) and Devices undo use `is_command_or_control_pressed()`.
- `/proc` reads in `app/perf_overlay.gd` return "" when the file is missing.
- Rendering: Forward+ (Vulkan on Linux / Windows, Metal on macOS); `shm_texture.gd`'s RenderingDevice path needs
  Forward+ or Mobile, which every desktop target has.

Gaps:
1. **Box-only start-up runs on any machine.** `app/main.gd` `_apply_window_args` places the window from the box's
   `/api/system/operator-display` and always calls `_screen_question` → `app/boot_question.gd`. A GUI on a laptop
   would show the WO-645 launcher ("Start operator here / Run headless") and WO-638 boot prompts. Its answer re-lays
   the **box's** X screens (`{"boot": "prepare"|"resolve"}`) from the laptop's screen indices, and "Run headless"
   quits the laptop's client. The operator dock already gates itself on a loopback origin
   (`app/operator_dock_model.gd:20`); `video_feed.gd:113` has its own copy of the same check.
2. **`$HOME` is not set on Windows** (`%USERPROFILE%` is). File dialogs start in "" there:
   `features/devices/file_pick.gd:27`, `features/live/media_add_menu.gd:58`, `features/live/media_download.gd:45`,
   `app/header_project.gd:173`.
3. **Ctrl-only gestures** (macOS users press ⌘): previs ⌃D duplicate and ctrl-click add-to-selection
   (`features/previs/previs_tab.gd:282,287,307`), tracking ctrl-click pick (`features/previs/tracking/tracking_view.gd:466`).
4. **No export presets** (`godot/client/export_presets.cfg` missing) and no export script. Export templates for
   4.7.2 are not installed on the box (`~/.local/share/godot/export_templates/` absent).
5. hshm binaries are built per machine and not committed; only `libhshm.linux.template_debug.x86_64.so` exists. A
   Windows / macOS build has no use for it (the feed is used off-box), so it is excluded there.
6. **Found while exporting: raw `res://` reads come back empty in an export.** The font
   (`app/theme_builder.gd:50`), icons (`app/ui_icons.gd:14`, `features/devices/port_icon.gd:38`) and PNGs
   (`app/connection_eye.gd:47`) are read with `FileAccess.get_file_as_bytes` on purpose (running from source has no
   import step). An export packs only the *imported* copies of files that have a `.import`, so the first Linux
   export logged 10 × `Image::_load_from_buffer: buffer_size == 0` and would have drawn no icons and the default
   font. An `include_filter` does not help: Godot skips files that have an importer.
7. macOS universal / arm64 exports refuse to build without `rendering/textures/vram_compression/import_etc2_astc`.

## What was done (22.10)

- `core/platform.gd` (new, pure): `is_local_origin` (one loopback check, IPv6 brackets included), `home_dir`
  (`$HOME` → `%USERPROFILE%` → the Documents folder's parent), `start_dir` (OS downloads → ~/Downloads → home).
- Box-only start-up gated on a loopback origin:
  - `app/main.gd` `_apply_window_args`: the box's operator monitor is looked up only on the box (`--screen` still wins);
  - `app/boot_question.gd` `ask`: no launcher / boot prompt / autostart-quit off-box.
  - `video/video_feed.gd` `wanted` and `app/operator_dock_model.gd` `wanted` use `Platform.is_local_origin`.
- File dialogs: `file_pick.gd`, `media_add_menu.gd` → `Platform.start_dir()`; `media_download.gd`,
  `header_project.gd` → `Platform.home_dir()`.
- ⌘ on macOS: previs duplicate (⌘D / Ctrl+D) and add-to-selection click, tracking pick click use
  `is_command_or_control_pressed()`.
- `export_presets.cfg` (new): Linux x86_64, Windows x86_64 (no rcedit / codesign), macOS universal (ad-hoc signed,
  not notarized, `org.highascg.operator`). All exclude `tests/*` and `addons/hshm/*`; exports go to `godot/export/`
  (git-ignored, now also in `.stignore`).
- Every `assets/**/*.import` set to `importer="keep"` (38 files, committed for the first time; they were untracked
  per-machine files). Godot then exports the raw files as they are, so the runtime raw reads work in every build;
  nothing loads these assets as imported resources (no `load()` / `.tscn` reference to `assets/`).
- `project.godot`: `import_etc2_astc=true` (macOS requirement).
- `godot/export-client.sh` (new): exports every preset (or the named ones) and writes a `.sha256` per build;
  `--fetch-templates` downloads the official templates for `godot/GODOT_VERSION` (4.7.2) into the user data dir. It
  checks Godot's result and the "export failed" line, not just the file (a failed Linux export left a binary behind).
- `.gitignore` / `.stignore`: Godot 4.4+ writes a `.uid` next to every script on import / export (457 appeared); the
  client never tracked them, so they are ignored. **Mirror the two `.stignore` lines on the Mac.**

## What was VERIFIED (22.10)

- Godot `tests/run_tests.gd` 21055 passed, 0 failed (+11 in `test_platform.gd`); `run-client.sh --check` boot OK;
  no file over 500 lines.
- Source client headless against `http://192.168.0.23:4200` (the box's LAN address = an off-box client): settings /
  state / project / WS ok, `video_native: false` (feed path).
- Templates installed (`~/.local/share/godot/export_templates/4.7.2.stable`, 2.0 GB). `godot/export-client.sh`:
  Linux 73 MB, Windows 107 MB (PE32+ x86-64 GUI), macOS 60 MB zip.
- Linux export run headless and windowed against the LAN address: connects, no image errors; screenshot shows the
  Rewir font, logo and status eyes, previs 3D. The only error line ("3 resources still in use at exit") appears
  from source too.
- Packs contain the raw font / logo / icons and `core/platform.gd`, no `tests/` and no `addons/hshm`.
- macOS bundle: `HighAsCG Operator.app`, Mach-O universal (x86_64 + arm64), `_CodeSignature` present,
  `CFBundleIdentifier org.highascg.operator`.
- The running box GUI (pid 688983) untouched.

Not verified (nothing to run them on here; no wine): the Windows .exe and the macOS .app themselves. Owner QA:
- Windows: SmartScreen warns (unsigned) → More info → Run anyway. macOS: right-click → Open the first time (ad-hoc
  signed, not notarized), or `xattr -cr "HighAsCG Operator.app"`.
- First start points at 127.0.0.1: right-click the connection eye (top right) → A/B hosts → the box's IP, or start
  with `-- --server=http://<box>:4200`.
- Check: pictures in PGM / PRV (JPEG feed), Rewir font and icons, a media file added from the laptop uploads,
  ⌘D duplicates a stage object on the Mac, no "Start operator here" prompt on the laptop.
