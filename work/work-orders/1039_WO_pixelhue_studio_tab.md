# WO-1039 — PixelHue main tab: the owner's PixelHue Studio as native panels

**Area:** pixelhue, godot-client
**Status: IN PROGRESS (11.11 — foundation DONE 9b779736: vendored Studio engine in the server, `/api/pixelhue/studio/*`, the tab shell; panels being built)**

Owner, 11.11: *"Add basically the whole pixelhue studio ui under pixelhue tab (when one connected) that will be after
devices in the main tabs."*

The Godot client has no web view, so the Studio UI is rebuilt as native panels. The Studio **engine** is not rebuilt:
a pinned, unmodified copy of github.com/mko1989/pixelhue-studio runs inside the HighAsCG server.

## What exists (foundation)

- `src/pixelhue/vendor/pixelhue-studio/` — Studio `server.js`, `lib/`, `public/` (the web UI: **the reference for
  every panel**), `README.md`. Never edit it.
- `src/pixelhue/studio-bridge.js`, `src/api/routes-pixelhue-studio.js` — Studio's API for the switcher set in
  Devices ▸ PixelHue:
  - `GET  /api/pixelhue/studio/<resource>[?query]` = Studio `GET /api/<resource>` (a read)
  - `POST /api/pixelhue/studio/<resource>` + JSON body = Studio `PUT /api/<resource>` (a write)
  - the server adds Studio's `session`; a client never sends one. Errors come back as `{ "error": "<sentence>" }`
    with Studio's status. Raw file routes (EDID file import / export, gallery upload) are not bridged.
- `godot/client/features/pixelhue/pixelhue_tab.gd` — the main tab: header (device, status line, Refresh) and one
  sub-tab per panel script, loaded when the file exists.
- `godot/client/features/pixelhue/studio_api.gd` — `StudioApi.read(Api, "programming")`,
  `StudioApi.write(Api, "programming", {…})` → `{ok, data, error}`.

## Panel contract (each panel is one unit of work)

| Sub-tab | Entry script | Studio UI to port (`public/`) | Studio resources |
|---|---|---|---|
| Device | `device_panel.gd` | device-ui.js, device-maintenance-ui.js, device-extras-ui.js, self-test-ui.js, source-backup-ui.js | device, device-action, self-test, source-backup |
| Inputs | `inputs_panel.gd` | inputs.js, input-advanced.js, input-edid-ui.js (timing only) | inputs, input-advanced, input-timing |
| Outputs | `outputs_panel.gd` | outputs-ui.js, output-advanced.js | outputs, output-capacity, output-advanced |
| Screens | `screens_panel.gd` | screens-ui.js, screen-extras-ui.js | screens |
| Programming | `programming_panel.gd` | programming-ui.js, program-stage.js, program-sync.js, layer-inspector.js, layer-tools.js, layer-effects-ui.js, layer-presets-ui.js, presets-ui.js, source-tabs.js, group-geometry.js | programming, programming/geometry, programming/sources, gallery (list + thumbs) |
| MVR | `mvr_panel.gd` | app.js (MVR part), editor.js, mvr-geometry.js, mvr-sync.js, mvr-reconcile.js, mvr-sources.js, mvr-templates.js | state, windows, mvr-layers, mvr-templates |
| Audio | `audio_panel.gd` | audio-ui.js | audio |

Rules for every panel:

1. **Files:** only `godot/client/features/pixelhue/<area>_*.gd` and `godot/client/tests/test_pixelhue_<area>*.gd`
   (`<area>` = device, inputs, outputs, screens, programming, mvr, audio). Nothing else is touched.
2. **Entry script** `<area>_panel.gd`: `extends` a Control; `func refresh() -> void` re-reads from the switcher (the
   tab calls it when the sub-tab is shown and on Refresh); `signal status(text: String)` for the header line
   (errors in Studio's own words, "Saved", …).
3. **Logic is pure and tested:** request bodies, validation, geometry, labels live in `<area>_model.gd`
   (`extends RefCounted`, static functions, no autoloads); tests in `tests/test_pixelhue_<area>.gd`
   (`extends RefCounted`, `var t`, `func test_*()` using `t.eq(actual, expected, "why")` / `t.ok(cond, "why")`).
   Request bodies must match what Studio's `public/*.js` sends and `lib/*.js` accepts.
4. **Limits:** 500 lines per file; typed GDScript, tabs; `var x: T = dict.get(...)` (no `:=` on an untyped value).
5. **Number fields** follow RULES.md: `res://core/numeric_field.gd` `NF.math_line(le, as_int, lo, hi)` right after
   `LineEdit.new()`. Look and helpers: `res://app/theme_builder.gd`, `res://features/settings/pane_kit.gd`;
   `godot/client/features/devices/lighting_consoles_panel.gd` is a good small example.
6. **Every write is complete and compiles** — the owner's client runs from this tree.
7. **Never write to the real switcher while building.** `GET http://127.0.0.1:4200/api/pixelhue/studio/<resource>`
   reads the owner's real P20 and is allowed; a `POST` there changes it and is not.
8. **Checks:** `cd godot/client && HIGHASCG_TEST_ONLY=test_pixelhue_<area> GODOT=~/.local/opt/godot/godot ./run-client.sh --test`
   and `GODOT=~/.local/opt/godot/godot ./run-client.sh --check` (headless boot, no server: compiles every UI script).
9. **No git state operations** (add, commit, stash, checkout, reset, rm). No windowed Godot, no CasparCG, no pointer
   or keyboard automation on the box's display.
10. What Studio does through a file dialog or a raw upload (EDID files, gallery upload, layout save / load) is left
    out and listed in the hand-back.
