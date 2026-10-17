**Status: OPEN (2026-10-17) — investigation + port plan written; nothing implemented. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599, WO-600, WO-601. Can be split per panel when started.**

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

## What was done / What was VERIFIED

Nothing yet. Haiku inventory only.
