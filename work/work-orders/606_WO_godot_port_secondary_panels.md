**Status: 🟡 IN PROGRESS (2026-10-20) — Shader Live slices 1–2 done (node-side working copy + Godot panel, PGM stack, Templates audition); open: Shader FX modal (GLSL editor). Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599, WO-600, WO-601. Can be split per panel when started.**

# WO-606 — Godot port: Shader Live/FX, timers, CG/lower thirds, LED test/pixel map/fixtures, variables, streaming/recording/inputs

## Investigation

Inventory (Haiku): [`timeline-audio-media-secondary.md` §5–11](../godot-port/inventory/timeline-audio-media-secondary.md).

| Panel | JS files / LOC (+CSS) | Notes for the port |
|-------|----------------------|--------------------|
| Shader Live + Shader FX | 13 / 2,455 (+720) | Live overlay: per-param sliders/colour, wiggle, rename (`window.prompt`), wheel with 150 ms apply delay; manifest/presets/pin/hide (WO-577); PGM stack layers 10–20. FX modal: per-pass `<textarea>` GLSL, Shadertoy import, **preview `<iframe>`** of `/templates/shaders/{id}.html` (`shader-fx-modal.js:97,125,233`). Pure: `shader-param-scan/naming/describe.js`. |
| Timers / countdowns | 4 / 918 (+461) | Control panel; `timer-control-panel-display.js` pure. |
| CG / lower thirds / CG Studio / thumbs | 7 / 1,559 (+462) | CG Studio is an **iframe** of a separate web app (`cg-studio-tab.js`) → WO-608. LT operator UI lives in the inspector (WO-601). |
| LED test card / pixel map / fixtures / mapping state | 7 / 1,750 (+321) | Pixel map editor is Canvas 2D (fixture rects, 8 px handles, rotate) → `Control._draw`. `mapping-node-service.js` pure. |
| Variables | 2 / 182 | `variable_update` WS; trivial. |
| Streaming / recording / WebRTC monitor / vcam / V4L2 / DeckLink inputs | 11 / 1,501 | WebRTC monitor (`webrtc-client.js`, go2rtc) **not needed locally** (shm); forms otherwise. |
| Map explorer | 1 / 1,059 | **Developer tool, not ported.** |

## Port plan / decisions

- **Shader FX preview:** instead of an iframe, audition through Caspar (the WO-586/587
  `shader-live-audition.js` path to PRV) and show the result as an atlas slot — a *real* Caspar render,
  better than the browser preview. GLSL editing in `CodeEdit` with a GLSL `CodeHighlighter`.
- `window.prompt` / `alert` → Godot dialogs everywhere.
- Pixel map editor: custom Control (same hit-testing: rects, 8 px handles, rotate handle).
- Streaming/recording/inputs: forms on the shared inspector framework.

## Acceptance

Parity checklists per panel under `work/godot-port/parity/`, owner-ticked.

## Investigation (20.10) — what already exists in Godot

A grep of `godot/client/features` before starting: most rows above were ported under other WOs —
timers / countdowns (`screen_timer_panel.gd`, `countdown_section.gd`, WO-601), lower thirds
(`lower_third_section.gd`, `lt_roster_section.gd`), variables (Settings → Variables, WO-608), LED test card
(WO-629), pixel map / mapping (`mapping_panel.gd`, devices), stream / record / v4l2 / vcam (devices tab).
Nothing existed for **Shader Live / Shader FX** (the web's `shader-live-editor.js` 492 + controls panel 228 +
rows / stack / audition + 4 libs ≈ 2.4k LOC). That is this WO's remaining body.

## What was done

### Shader Live, slice 1 (20.10)

Directive D: the web editor kept the working copy in the browser, rewrote GLSL literals and pushed
`CG UPDATE` through `/api/raw`. Now the node does all of it:

- `src/shaderfx/shader-live-instances.js` — CJS mirror of `client/lib/shader-live-instances.js`: every shader
  live on any channel from the live scene state, bank B → +100, PRV stays bank A, PGM first; a running playlist
  on a program channel resolves to the item on air (`ctx.playlistActiveIndices`, the index
  `GET /api/playlist/state` reports) instead of the client polling it.
- `src/shaderfx/shader-live-session.js` — one working copy per shader id (an edited copy survives reopen; an
  unedited one re-reads the library). The scanner / control synthesis are the web's own ESM modules
  (`shader-controls.js`, `shader-param-scan.js`, `shader-param-naming.js`) loaded by dynamic import — one
  implementation, no CJS fork. Push = `CG UPDATE` to every live instance with the web's AMCP escaping; a 403
  (PLAY-hosted html after a MIX hop) re-hosts with `CG ADD` once and retries. `dirty` = edited values differ
  from the library (reverting the last change clears it — the web kept it set).
- `src/shaderfx/shader-live-ops.js` — set / macro / reset (one key, one control, all) / preset (apply,
  original, save, delete) / pin / hide / unhide / label / randomize / wiggle (PRV instances only, ~1.3 s,
  restore) / save (child `<root>-cN`, never overwrites). Curation persists with the library's pristine source.
- `src/api/routes-shader-live.js` (one `register` line in the 499-line router): `GET /api/shader-live`,
  `GET /api/shader-live/shaders/:id`, `POST /api/shader-live/shaders/:id/:op`, `POST /api/shader-live/mixer`
  (opacity / brightness / saturation / contrast, clamped). Ops serialize per shader.
- Godot: `features/live/shader_live_panel.gd` (bar: instance picker, ▶ Take = deck PRV→PGM for screen 1,
  dirty badge, Reset all, Save to library, ✕; presets bar; key controls by section; summary + restore hidden;
  Caspar-mixer rows; Advanced fold-away built only while open), `shader_live_controls.gd` (widgets — sliders
  apply on release or 150 ms after a wheel/key burst, colour pickers 250 ms after the last change, toggles,
  macro rides), `shader_live_model.gd` (pure). Opens from the header logo (web mascot) or the deck toolbar's
  **Shader Live** button; replaces the deck like the web overlay. `window.prompt` → `pane_kit.prompt`.
- Smoke `tools/smoke/smoke-wo606-shader-live-server.test.js` (5 tests, store stubbed); Godot
  `tests/test_shader_live_model.gd`.

### Shader Live, slice 2 (20.10) — PGM stack + audition

- `GET /api/shader-live?main=N` also returns `stack` (the main's PGM layers 10–20 + occupant basenames, web
  `occupantLabel`); land / clear ride the existing `POST /api/shader-stack` with the deck's resolved default
  transition (`live_tab.resolved_default_transition()`, split out of the toolbar sync).
- `POST /api/shader-live/audition { value, label, mainIndex }` — the web's `shader-audition-request` handler moved
  to the node: an ephemeral one-layer look (L10) through the normal `/api/scene/take` pipeline to the main's PRV;
  answers the instance key to select.
- Godot `shader_live_stack.gd` (right column; click = land the selected **PRV** instance, ✕ on occupied rows =
  fade off air), `source_list_panel.row_clicked` → `media_panel` auditions a clicked shader template while the
  panel is open (`ShaderLivePanel.current`).

## What was VERIFIED

- Smoke: instance resolution (bank B, PRV, playlist on air), literal rewrite + 3 pushes + 403 re-host with the
  on-air template path, `\\n` escaping, preset save → reset all → apply, curation keeps the pristine source,
  save → `sh-test-c2`, bad input 400, wiggle without PRV 409. Offline suite 2939 pass; Godot 16344 pass.
- Box (node + Godot GUI, `--shader-live-id=sh-audio-reactive-galaxy` dev arg: a library shader's view with no
  live instance, so nothing reached air): logo opens the panel on the Live tab; slider drag → server value
  15.37 + dirty badge + "Not on air" note; ↺ → back to library; ✎ rename → label persisted; Randomize (7
  values); + Preset "T1" → Original → T1 → × delete; ✕ hide → "restore 1 hidden" → restore; Advanced (48
  values, 4 groups); ★ pin (dissolves the 2-member Speed macro, as on the web); Save → child c2 created;
  Reset all → 0 changed; ≋ wiggle → "Load this shader on preview first"; ✕ → deck back. Library files restored
  byte-identical and the child deleted afterwards.

## Open

- Slice 2 on the box: the stack column shows `PGM stack ch1` with L10 = BAZA 2 (✕) and L11–20 empty; a row click
  with a non-PRV selection says "Select the PRV instance…" and posts nothing (PGM checked unchanged). Smoke 6/6
  (stack rows / occupant basename, audition 400). Landing, clearing and auditioning were NOT pressed (PGM/PRV).
- **Never driven against a shader on air** — no shader live on the box, GPU CEF off, PGM/PRV off limits
  (owner check in `work/checklist20.10.26_owner_checks.md`).
- Shader FX modal (GLSL `CodeEdit`, Shadertoy import, preview via PRV).
