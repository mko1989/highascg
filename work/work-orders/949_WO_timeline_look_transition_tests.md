# WO-949 — Timeline / look transition tests (frame-accurate on PGM): "auto" mixes ran 12 frames, timeline looks took to black after a server restart

**Area:** engine
**Status: DONE (05.11.26 — live on the second dev box with a frame probe on PGM, every case below; smokes 2/2 + 2/2, WO-598 parity 4/4, offline suite 5292 pass / 4 fail (3 box-dependent + 1 timing flake that passes alone, both also on HEAD) / 15 skip) — owner QA: the mix length change (§4)**

Owner 05.11: *"do tests including timeline and going from timeline playout back to looks and check if timeline inside a look plays fine."*

Related: [WO-553](./553_WO_LOOK_TIMELINE_OPACITY_FLASH.md) (timeline-look flash / cut), [WO-556](./556_WO_PREVIEW_FLASH_AND_TIMELINE_EXIT_RESTART.md) (PRV staging blink, timeline restart on exit), [WO-139](./139_WO_TIMELINE_TAKE_SMOOTHNESS.md), [WO-834](./834_WO_timeline_end_holds_last_frame.md) (end hold), [WO-598](./598_WO_client_contract_and_thin_client.md) (server-built take payload).

---

## 1. Method

- **Driven like an operator:** `tools/test-agent/ui start --live` — its own Godot client on an Xvfb display, real clicks by label, against the live server; the owner's own screen untouched.
- **Measured per frame:** a temporary SHM consumer on PGM (`ADD 2-749 SHM NAME zzprobe`) read by `tools/test-live/pgm_probe.py` (every published frame, a 12×6 grid inside the clip's rectangle, seqlock-checked; 50 / 50 fps, 0 gaps in every run) and summarised by `pgm_probe_report.py` (single-frame jumps = cut / flash, red going back on the ramp = restart).
- **Media that encodes time:** `zz_tl_ramp.mp4` (10 s, blue base, red = 25 × t) — the colour is the playhead; `zz_look_green.mp4`, `zz_look_white.mp4` solid. Looks made by dropping the clips on the deck, the timeline by New timeline + drag + trim, the timeline look by dragging the timeline from Sources ▸ Timelines onto the deck.

## 2. Results

| # | Case | Result |
|---|---|---|
| A | Timeline tab **Take** (MIX 25) onto a PGM with no look | **mix, 25 frames** (blue 0 → 208 in even steps), then plays, 0 gaps ✓ — a first run that looked like a cut was the clip dropped at 646 ms: the fade ran before the clip entered (correct behaviour) |
| B | Timeline playing on PGM → click a look (PRV) → **TAKE** | staging: PGM untouched ✓; take: green mixes in, the ramp keeps advancing, **no restart** ✓ — but **11 frames** for a "MIX auto 25 fr" look ✗ |
| C | Look → stage the **timeline look** (PRV) → TAKE; while it plays stage another look → TAKE | staging (both): PGM untouched ✓ (WO-556 A holds); take in: mix, no full-opacity flash, starts at 0 ✓ (WO-553 A/B hold); take out: mix, **no restart** (red kept rising 171 → 198 through the mix) ✓ (WO-556 B holds) — both mixes **12 frames** ✗ |
| D | After a **server restart**, take the timeline look | **PGM black for the whole look** ✗ — node: `[Timeline] play(tmw3a9eous12): timeline not on server` |
| E | (after the fixes) restart → timeline look in → play to the end → look out | loaded from the project ✓; mix in **26 frames** ✓; plays 10 s; **end holds the last frame** (255,36,203 for 7 s) ✓; held frame → white mix **26 frames** ✓ |

## 3. Defects and fixes

**3.1 "auto" transitions ran 12 frames.** A look's stored transition is `{type:'MIX', duration:12}`; 12 is the sentinel for "auto: half the project fps" (`client/lib/transition-duration.js`, `godot/client/features/live/transitions.gd`) and the look card shows "MIX auto 25 fr". The server-built take (`POST /api/scene/take-look`, the Godot client's path, WO-598) passed the 12 through (`scene-transition.js` `normalizeTransition`), so Caspar got `MIXER 2-110 OPACITY 1 12 linear` — half the shown length on a 50 fps screen. The old web builder sent the raw 12 too (WO-598 parity), only the deck default was resolved (`scene-state.js:125`).
- `src/engine/scene-take-payload.js` `buildServerIncomingScene`: `resolveAutoDuration` — the look's transition and every layer's `transition` / `playlistTransition` get `resolveTransitionDuration(d, fps)` of the main's screen (50 when unknown); a CUT stays 0, a typed duration other than 12 stays. Before the PGM-only normalisation (which keeps the length).
- `tools/smoke/smoke-wo598-take-payload-parity.test.js`: the web side gets the same resolution (`wo949Auto`) before the strict comparison — the only intended difference; still deepStrictEqual.

**3.2 A timeline look took to black after a server restart.** The timeline engine is filled only by `POST /api/timelines` (a client pushing a timeline it edits or shows in its Timeline tab — `timeline_transport.gd` `_read_state` → `sync_to_server`) and replication; nothing loads the stored project's timelines. After a node restart the engine was empty, and the look's take cleared the old look and played nothing.
- `src/engine/timeline-playback-runtime.js`: `play()` and `playForTake()` call `_hydrate(id)` when the engine lacks the timeline — the stored project's copy (`project-scenes-load.js` `loadFullProject().timelines.timelines`) is created in the engine (logged "loaded from the stored project"); an id the project does not have is refused as before.

## 4. What was verified

- Live, box: the table above (cases A–E), with the AMCP on the wire read back from Caspar's log for each finding (`OPACITY 1 12` before, `OPACITY 1 25` after; no `PLAY 2-210` before, the timeline playing after).
- `tools/smoke/smoke-wo949-take-auto-transition.test.js` **2/2** (auto → 25 at 50 fps, 15 at 30; typed 20 and CUT untouched; layer transitions; PGM-only keeps the length), `smoke-wo949-timeline-hydrate.test.js` **2/2** (play / playForTake hydrate from the project; unknown id and no project still refused), `smoke-wo598-take-payload-parity` **4/4**, take smokes WO-601 / 663 / 813 green.
- Offline suite 5311: 5292 pass, 4 fail — REAL ffmpeg frame rates, WO-40a multiview head, graph-bound 3-head layout (box-dependent, fail on clean HEAD) and `smoke-wo570` recordPause (timing: passes 3/3 alone, and on HEAD).
- **Owner QA — behaviour change:** every look whose transition is "auto" now mixes over half the project fps (25 frames at 50 fps) instead of 12. Looks with a typed duration are unchanged.

## 5. Seen, not chased

- The test client's Inspector kept showing a timeline clip's old Position (00:00:00:16 / 646 ms) after it was typed to 0 and the server held `startTime: 0`.
- FTB clears every layer including a Visuals send on PGM layer 1 (by design); the owner's Visuals send was cleared by these tests and needs Send again.
- Left in the project: timeline "ZZ ramp" and `media/zz_tl_ramp.mp4` (no delete-timeline button in the GUI — same note as test card 02).
