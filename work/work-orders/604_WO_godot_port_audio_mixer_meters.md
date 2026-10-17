**Status: OPEN (2026-10-17) — investigation + port plan written; nothing implemented. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599, WO-600 (live inputs L).**

# WO-604 — Godot port: audio mixer, meters, cross-screen audio routing

## Investigation

Inventory (Haiku): [`timeline-audio-media-secondary.md` §2](../godot-port/inventory/timeline-audio-media-secondary.md).
Scope: **26 JS files, 3,352 LOC + 1,201 CSS**.

- Operator features: master faders (MIXER master volume) in the inspector section or full mixer tab,
  per-layer faders per program channel (dblclick / Ctrl+click → 0 dB), solo (`POST /api/audio/solo`),
  stop audio-only layers (`POST /api/scene/audio-only/stop`), auto-mix policy for live inputs
  (`POST /api/settings` `casparServer.audio_auto_mix`), cross-screen routing matrix
  (`audio-cross-screen-apply.js` → `route://`), meters distinguishing no-data / silence / signal.
- Rendering: DOM only; faders are native `<input type="range" 0..100>`; meters are `div` fills.
- **Meter behaviour (✔ read in `client/lib/audio-mixer-meter-loop.js`):** `setInterval` tick
  (`:138`), level → bar `(level + 60) / 60` clamped (`:103`), fall smoothing `SMOOTH_FALL = 0.45`
  per tick (`:43`, comment `:40` derives it from the old 0.18/frame @ 60 fps), clip colour above
  −1 dBFS. **No visual peak-hold in the meter loop** (correction to `work/NATIVE_GUI_PROPOSITIONS.md`
  §1, which called the 617 LOC "peak-hold logic"); a `peakHoldMs: 2000` setting exists for OSC
  (`client/lib/settings-state.js:52`).
- Fader taper: piecewise dB table (`audio-volume-scale.js`, pure). Also pure: `audio-input-meter-map.js`,
  `audio-routes.js`, `audio-cross-screen-routing.js`.
- No Web Audio, no `<audio>`: audio is Caspar-side; the client only reads levels.

## Port plan

- `ChannelStrip` scene: `VSlider` with the ported taper, dblclick/Ctrl reset, solo/stop buttons.
- `Meter` control: `_draw()` per frame (vsync) from the latest level, same mapping + smoothing
  (time-based so it is independent of frame rate), clip colour; optional peak-hold as a later
  owner-requested feature (the setting already exists).
- Cross-screen matrix: `GridContainer` of toggle buttons; same apply path.

## Acceptance

- Parity checklist `work/godot-port/parity/audio.md`, owner-ticked.
- Side-by-side meter comparison web vs Godot on the same program audio: same levels and ballistics.

## What was done / What was VERIFIED

Nothing yet. Meter constants verified by hand (refs above).
