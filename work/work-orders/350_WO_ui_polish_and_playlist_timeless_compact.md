# WO-350 — UI polish (bars/heights) + timeless duration in the Playlists compact

**Status: DONE (2026-07-27)** · Source: todos27.07.26 additions (owner, mid-day).

## Items

1. **Compose preview top bar → half height.** `.preview-panel__header` padding 6→2 px, toggle
   button 28→18 px, compose-layout button compacted, and the Reset button — which had NO css
   rule at all and rendered at browser-default height as the tallest child — got a compact
   `.preview-panel__grab` rule. ~41 px → ~23 px.
2. **Progress bar above that bar: too much top air.** `.scenes-rundown-playback` (the PGM
   top-layer playback timer slot) padding 8px→2px top, min-height 2.5rem→1.5rem.
3. **Screen's looks-list top bar too high.** `.scenes-deck-col__head` bottom padding 4→2 px.
4. **Mix/duration/tween group full-width → small, right-adjusted.** The stretch came from three
   grow factors: `.scenes-toolbar__transition-group` `flex:1 1 280px`, toolbar-scoped
   `.scenes-look-transition` `flex:1 1 220px`, and the hint's `flex:1 1 200px`. Group now
   `flex:0 1 auto; margin-left:auto`, hint hidden in the toolbar scope (kept in the look editor).
5. **Playlists compact: timeless-items duration + "Set all".** New row in
   playlist-control-panel.js — number input + Set all button; patches every timeless item of the
   selected playlist via `sceneState.patchLayer` (same mechanism as the inspector control).
   Timeless detection + display value extracted to shared `client/lib/playlist-timeless.js`
   (client mirror of the engine's isTimelessPlaylistItem).
6. **Bug: input resets to 20 s after Apply.** The inspector's "Timeless items (s)" input had
   `value="20"` hard-coded, so every rerender snapped back. Both the inspector and the panel now
   show `timelessSecsOf(playlist)` — the duration already set (first timeless item wins), 20
   only as a true default. The panel additionally bridges the live-playlist poll gap (engine
   keeps old durations until the next take) with a per-playlist `appliedSecs` overlay that
   clears once the server reports the applied value, and never overwrites the field while the
   operator is typing in it.

## Verification

build:client clean, lint 0 errors, test:ci 1530/0, 500-line gate 0 violations; kiosk reloaded.
Visual sign-off pending (owner): bar heights, right-adjusted transition group, panel Set all.
