# WO-619 — Settings → Defaults never persisted (editor defaults reverted on every save)

**Area:** devices-config, godot-client
**Status: DONE (2026-10-19, offline smoke + box: Godot Settings → Defaults saves survive the reload and a server restart) — owner-QA: change a Defaults-tab value in the browser client, reload, check that it stuck. Found while porting Settings ([WO-608](./608_WO_godot_port_shell_settings_web_surfaces.md)). Two related findings are recorded below and left open.**

## Investigation

- Symptom (box, 19.10): the new Godot Settings tab ticked "Timeline — new clips → Loop always". The status line said
  "Saved", `config/editor_defaults.json` was rewritten at the save time, but it still held `loopAlways: false`.
  The GET after the save returned false and the box went back to unticked.
- A direct POST shows the bug is in the server, not the client:
  `curl -XPOST /api/settings -d '{"editorDefaults":{…"timeline":{"loopAlways":true…}}}'` → `{"ok":true}`, but the
  file and the GET still read false.
- Cause: `src/api/settings-post.js:88-90` normalises the patch onto `ctx.config.editorDefaults`. The config it then
  saves (`newConfig`, line 383) lists each section by hand, and `editorDefaults` was not in that list, so
  `newConfig` carried `cur.editorDefaults` (the stored value) unchanged. `configManager.save` emits `change`, and
  `index.js` `configManager.on('change')` → `syncRuntimeConfigFromManager()` copies the stale value back over
  `ctx.config`. So no Defaults change has ever stuck, from the web modal or anywhere else. History: the
  `editorDefaults` branch arrived with the June restore (`e41b845e`) without the matching `newConfig` key.
- Second cause, same symptom: `src/config/editor-defaults.js` `CONTENT_FITS` held only `native` / `stretch`. The
  client enum (`client/lib/scene-content-fit.js`) and the layer / clip code also have `fill-canvas`, `horizontal`
  and `vertical`. The Defaults pane offers all five, so a saved "Fit canvas" default normalised back to `native`.
  The server's own new-layer route (`routes-scene-new-layer.js:77`) uses the client's 5-value merge.
- Same file, same kind of bug, **not changed here**: `cfg.gpuPhysicalTopologyOperatorSaved = true`
  (settings-post.js:183) is also missing from `newConfig`. It gates GPU auto-mapping
  (`gpu-physical-map.js:264`, `gpu-topology-xrandr.js:229`), and `system-hardware-gpu-ports.js:39` has its own save
  path. Persisting it from a settings save would change Devices behaviour, so it is left for the owner to decide.
- Related web bug, **open**: GET `/api/settings` redacts every key that matches `password|token|secret|auth…`
  (`src/support/redact-settings.js`), including the boolean `ui.nuclearRequirePassword`. The web modal hydrates
  that as unticked (`settings-modal-logic.js` `hydrateSettings`). Its whole-object autosave then posts
  `nuclearRequirePassword: false` plus the redacted `nuclearPasswordHash`. So any web settings save silently turns
  off the nuclear password requirement. Box probe: posting `{"ui":{"nuclearRequirePassword":"[REDACTED]",
  "nuclearPasswordHash":"[REDACTED]"}}` stored the literal `"[REDACTED]"` strings in `config/ui.json`; it was
  restored straight after. The Godot client avoids this: it posts only the sections that changed and drops the
  placeholders (WO-608 slice 1).

## What was done

- `src/api/settings-post.js:383` — `newConfig` now includes `editorDefaults: normalizeEditorDefaults(cfg.editorDefaults)`.
  An absent patch keeps the stored value, because `cfg` is the live config.
- `src/config/editor-defaults.js` — `CONTENT_FITS` now holds the client's five values.
- `tools/smoke/smoke-wo619-settings-editor-defaults-persist.test.js` (new, added to the curated CI list) calls
  `handlePost` against a fake config manager. It checks three things:
  - a Defaults patch reaches the saved config, merged with the stored values;
  - a save without `editorDefaults` keeps the stored ones;
  - every client content-fit value survives `normalizeEditorDefaults`, using the client enum itself.

## What was VERIFIED

- The smoke test fails 0/2 with the `newConfig` key removed and passes 2/2 with it; the third case was added after.
  `smoke-editor-defaults.test.js` still passes. Offline suite: 2675 tests, 2672 pass, 2 skipped, 1 fail. The
  failure is `smoke-wo577-shader-controls` "junk-named controls", which reads the box's gitignored `data/shaders/`
  runtime library; it is unrelated to this change.
- Box, after `kill -TERM` of the node service:
  - Godot Settings → Loop always → `config/editor_defaults.json` `loopAlways: true`; the GET agrees and the
    checkbox stays ticked after the post-save reload.
  - Scene content sizing "Fit canvas" → `contentFit: "fill-canvas"` stored and returned.
  - Both were restored over the same endpoint; `editor_defaults.json` matches the pre-test snapshot.
- Side observation (not caused by this change): the first settings save rewrote the stale stored
  `screen_count: 0` to the resolved 1. `resolveMainScreenCount` returns 1 for the pre-test snapshot as well, so any
  web save does the same. `osc.json` gained the default `wsDeltaBroadcast: false` from `pickOscForPersistence`.
