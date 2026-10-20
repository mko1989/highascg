**Status: IN PROGRESS (2026-10-20) — slice 1 DONE and box-verified (server mixer store bbb3bf42, Godot models 953f9d5b, Audio tab 5c47b389); later slices open (below). Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599, WO-600 (live inputs L).**

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

## Slice 1 (2026-10-20) — console, faders, mute, solo, meters

### Investigation

- **The web console's state lived in the browser.** Strip gains, mutes and solos came from
  `localStorage` `casparcg_audio_mixer_v1` (`client/lib/audio-mixer-state.js:12,28`). A second
  client (the Godot client, or another browser) saw a different console, and that breaks the owner's
  D rule ("anything that happens in casparcg is composed in the node server"). Look-layer
  volume/mute already lived in scene data, so only the strips no look owns were affected (masters,
  dedicated inputs, non-look layers).
- **Unmute never restores exact unity, in the web or in a straight port.** The fader is
  `0..100` with step 1 (`audio-mixer-console-live-inputs.js:91`), and 0 dB falls between two steps.
  Unmute reads the gain back from the fader position (`:221`), so it sends 0.98629 (−0.12 dB). The
  box showed the same thing from the first Godot build: `MIXER 7-4 VOLUME 0.9862925671576818`.
- **The double-click reset ends with a write of the snapped value.** Godot's `Slider` emits
  `drag_ended` on the release of the reset click, even though it never saw that click's press (the
  reset handler consumed it). The first build's reset sent `VOLUME 1` and then `VOLUME 0.98629`
  (Caspar log).
- **GDScript `==` between a bool and a String throws** (`enabled == "false"` on a settings bool).
  Every comparison against external JSON in the row and meter models had to be type-guarded.

### What was done

- **Server (bbb3bf42):**
  - `src/audio/mixer-state.js` stores the mixer state as `audioMixer` in `.highascg-state.json`, keyed
    by the web strip keys `pgm:N` / `prv:N` / `input:N` / `pgm:N:layer:L`.
  - `GET /api/audio/mixer` returns that state.
  - `/api/audio/volume` and the new `/api/audio/mute` take an optional `key`. Mute sends 0; unmute
    restores the stored gain.
  - `/api/audio/solo` takes `{keys}`.
  - Every change is broadcast as a WS `change` on `audioMixer`.
- **Godot models (953f9d5b):**
  - `audio_rows.gd` ports the web's row collection (program rows, live inputs, audio-only looks,
    timeline rows, bus width).
  - `audio_meter_model.gd` ports the meter loop's per-key reads and smoothing.
  - Both are golden-tested against the web modules run under Node.
- **Godot UI (5c47b389):** `features/audio/`
  - `meter_bank.gd`: bars drawn with `_draw()`.
  - `audio_strip.gd`: meters, a scale, a fader with the web taper, double-click/Ctrl reset,
    SOLO/MUTE, and "no signal".
  - `audio_actions.gd`: request shapes and look/live patches, as pure functions.
  - `audio_tab.gd`, the console itself:
    - a "Live inputs" bay, PGM groups and masters with bus bars;
    - rebuilds only when the row signature changes, otherwise updates values in place;
    - debounced (80 ms) server writes while dragging, plus an immediate write on release;
    - meters at 20 Hz.
  - Look-layer faders also patch the look, like the web `patchLayer`.
  - `main.gd` now forwards WS `timeline.playback` to the Store, which the timeline rows need.
- **Fixes over the web behaviour:**
  - `Strip.gain()` returns the stored value while the fader still shows it, so unmute and the reset
    send exactly 1.
  - `drag_ended` writes only after a real `drag_started`.

### What was VERIFIED

- **Tests:**
  - Godot suite: 15927 passed, 0 failed. This includes the golden row, meter, volume-payload and solo
    cases, plus `test_strip_gain_keeps_exact_stored_value`. With the `if dragging` guard mutated
    away, that test fails (`got [[0.2511…, true]]`).
  - Offline suite: 2797 pass, 1 fail. The failure is the pre-existing `smoke-wo577` (the untracked
    `sh-sa-fluidic-space` shader), unrelated to this slice. `smoke-wo604-audio-mixer-state` passes.
  - Line limit: 0 files over. Prettier: clean.
- **Box, Godot client on the Audio tab:**
  - **Layout:** the Live inputs group shows DeckLink 1–4, and DeckLink 4's meter is green from ch7's
    real audio. The `PGM 1 (ch 1) Inputs` group shows `L10 · 00_In…` and the audio-only `Look_8`.
    The PGM 1 and PRV 1 masters each show 2 bus bars (screenshots in the session scratchpad).
  - **Master fader drag:** `MIXER 1 MASTERVOLUME 0.48752…` (once debounced, once on release). The
    store held `{"gains":{"pgm:1":0.48752…}}`.
  - **DeckLink 4 MUTE:** `MIXER 7-4 VOLUME 0`, store `muted:{"input:7":true}`, button red. After the
    fix, UNMUTE sends `MIXER 7-4 VOLUME 1` and clears the flag.
  - **L10 (look layer) drag:** a run of `MIXER 1-10 VOLUME …` with no `key` (the look owns it). The
    store was unchanged, as intended.
  - **Double-click reset, after the fix:** `MIXER 1-10 VOLUME 1` and `MIXER 1 MASTERVOLUME 1` as the
    last writes, with no trailing 0.98629.
  - **SOLO:** the server refuses it on this box with `Audio preview not enabled (set audioPreview or
    monitor channel)`, because the box has no monitor channel configured. The tab shows that error
    in its status line and rolls the optimistic SOLO state back. Solo routing to a monitor channel
    is still owner-QA on a box that has one; key toggling matches the web (golden).
  - **Restore:** all strips back to unity, unmuted, no solos (`{"gains":{"pgm:1":1},"muted":{},"solos":[]}`).
    Config md5 is byte-identical before and after. The only other `.highascg-state.json` changes
    are the 16:40:41 server restart's re-normalisation of the PRV live scene and the operator-GUI
    layout save; neither came from the Audio tab.

### Still open (later slices)

- Cross-screen / stereo-pair routing matrix (`audio-cross-screen-*`, `route://`).
- Live-input PGM route buttons and START, audio-only look STOP (`/api/scene/audio-only/stop`).
- Click a live-audio strip to inspect it. Add-input modal. Auto-mix policy toggle.
- Switch the web console from `localStorage` to the server store, so both clients share one console.
- Side-by-side meter ballistics check web vs Godot, and the parity checklist (owner).
