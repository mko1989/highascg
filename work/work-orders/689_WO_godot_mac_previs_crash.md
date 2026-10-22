# WO-689 — Godot client crashes on the owner's Mac when the Previs tab opens

**Status: OPEN (22.10; does not reproduce on the box; waiting for the Mac crash log / renderer test)**

Owner, 22.10: *"the client crashes when i go into previs"* — *"i meant it crashes on my mac"*. Mac Pro 2020, Intel
(AMD GPU), client prerelease `client_2026-10-22_221506` (macOS universal; Vulkan through MoltenVK on Intel).

## Investigation (22.10)

- Box, released Linux build from the same prerelease, off-box mode (`--server=http://192.168.0.23:4200`),
  `--tab=1` (Previs), 1280×760: 30 s on Forward+ (Vulkan) and 30 s on `--rendering-method gl_compatibility`, both
  with `--verbose`. Neither crashed. No errors in the logs, only glTF stride warnings. So the cause is either the
  macOS / MoltenVK / AMD driver path or something only the Mac build does. It is not the shared GDScript.
- A crash, as opposed to a script error, in a release build points at native code. Previs is the first tab that
  renders 3D (`features/previs/previs_stage.gd`):
  - Forward+ with glow (`previs_stage.gd:31`), linear tonemap, and one DirectionalLight3D;
  - fixtures: up to 64 SpotLight3D (`fixtures_3d_model.gd:12`); gobo projectors turn shadow maps on
    (`fixtures_3d.gd:420`);
  - custom shaders: `led_screen.gdshader`, `fixtures_3d.gd:17` (blend_add), tracking person shaders;
  - glTF meshes built at runtime from server data.
- Needed from the Mac to go further:
  - the macOS crash report (`~/Library/Logs/DiagnosticReports/HighAsCG*.ips`);
  - the Godot log (`~/Library/Application Support/Godot/app_userdata/HighAsCG Operator/logs/godot.log`);
  - whether `--rendering-method gl_compatibility` avoids the crash.
