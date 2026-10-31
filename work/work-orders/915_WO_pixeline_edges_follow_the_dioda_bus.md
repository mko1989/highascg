# WO-915 — PixelLines on the Dioda wall's edges: mappings follow the bus, the previs shows them

**Area:** mapping, lighting
**Status: DONE (31.10.26 — offline suite 5105/0, smoke 11/11, sandbox GUI e2e 07_pixel_map 9/9; live: 896 mappings on the Dioda bus = independent shm average = engine DMX = previs, pixel order + left/right checked on the glass; DMX master stays off = owner QA on the real rig)**

Owner, 31.10.26:
> I want you to map the pixeline fixtures to edges of the dioda screen relative to the fixtures position, do end to end
> tests with it and leave the done config so I will be able to see the mapping work.

Builds on [WO-807](807_WO_region_to_fixture_pixel_mapping.md) (region → fixture pixel, the automatic edge proposal) and
[WO-868](868_WO_gui_channel_and_monitor_first.md) (operator GUI first: ch1 = GUI, ch2/3 = Dioda PGM/PRV).

## Investigation (31.10, Opus)

**1. The applied mapping is broken — the channels moved under it.** Live project "mhp harder" (rev 569): 896 stored
mappings (`GET /api/fixtures/pixelmap`), all `channelNo: 1` — accepted 29.10 when ch1 was PGM 1. WO-868 then put the
operator GUI on ch1 (1920×1080) and the Dioda PGM on ch2 (`channelMap.programChannels [2, 4]`, ch2 = 3840×1792).
Result: 628 mappings report `rect … is not inside channel 1 (1920×1080)`; the other 268 (x < 1920, y < 1080) are
"fine" and sample the **operator GUI** instead of the wall. Nothing told anyone: `channelNo` is an absolute Caspar
channel (`src/fixtures/pixel-map-model.js:76`, checked `:116-122`), while the walls it was made from are bound by bus
role (`previs.stage.objects[].source.role = "pgm1"`, resolved per call in `pixel-map-proposal.js:30-37`, `:105-106`).
The proposal service noticed (its signature includes each wall's channelNo): `GET /api/fixtures/pixelmap/proposal` has
a pending proposal from 30.10 17:12 on channelNo 2 — never accepted.

**2. The proposal itself is right for this rig** (checked independently, `scratchpad/geomcheck.py`: PSN pose → Godot
(x, z, −y), wall frame from position / yaw / panels × panel_mm, nearest of the 4 edges as a 3-D distance to the edge
segment): **56/56** PixelLines get the same wall + edge as the proposal (wall 1 left ×14 / right ×7, wall 2 left ×7 /
right ×7, wall 3 left ×7 / right ×14), the strip x (`x0+50` left, `x0+w−90` right) and the vertical centre of the
16-cell run = the bar's height on the wall (e.g. 1042 at 0.5 m → cy 1664 of 1792). Distances differ ≤ 11 mm (the
proposal measures from the pixel cells, the check from the pose centre). Pixel 1 is the top cell (y rises with pixel
index), as the GDTF rig places it (WO-807: roll −90 → pixel 1 on top).

**3. Nothing would be visible even with a good mapping.**
- The previs draws a fixture from the bytes the engine wrote (`follow-service.js:259-268` `visual()` → `engine.frameOf`),
  sent only while a client watches the rig (`src/tracking/fixtures-watch.js`, WO-797). The buffers are built and the
  pixel map writes into them whether or not the DMX master sends (`follow-engine.js:277-301`).
- But the sampler **idles** unless a mapped head is on the wire or the Godot pixel-map editor polled `/live` in the last
  5 s (`pixel-map-service.js:30-33`, `:84-85`, `:215-221`). The MHP DMX master is off (`fixtures.dmx.enabled false`,
  `universes []`) → no head is on the wire → the sampler idles → the previs shows stale / black cells.
- **Dimmer default 0.** Pixel Line IP `Mode11 70DMX` ch1 = Dimmer (GDTF default 0); the map writes colour channels only
  (WO-807 decision). `GET /api/tracking/fixtures` for 1042: every beam `i: 0`. Shutter1/2 at 0 = "Open" (GDTF channel
  sets, `projects/_gdtf/6ad826d14d1b.gdtf`), so the dimmer is the only thing holding the bars dark. Programmer values
  are in memory only (`follow-engine.js:62`); the patch's `fixed "ch=value"` is the persisted "held open" field
  (`follow-patch.js:21`, `:87`; written by `writeFixture` after the GDTF defaults, `follow-ik.js:94`). All 56 heads have
  `fixed: ""`.

## Plan

1. Mappings bind to the **bus** they were made on: an optional `role` (`pgmN` / `prvN`) on a mapping; the sampler resolves
   it to the bus's current channel on every resolve (so WO-868 on / off, or a channel reorder, keeps them on the wall).
   `channelNo` stays (the editor and older clients use it); a POST whose `channelNo` differs from the bus's current
   channel is an operator's move → the mapping leaves the bus (role dropped). Proposals emit `role` from the wall's
   `source.role`; `isApplied` compares roles when both have one.
2. The previs watching the rig counts as a reader: `visual()` marks the pixel map watched, so the cells follow the
   picture in the 3D view with the DMX master off.
3. Live project: accept the proposal (replace), hold Dimmer open on the 56 PixelLines (`fixed "1=255"`), DMX master left
   off (nothing on the wire from this box; the owner switches it on for the real rig).
4. End-to-end tests: offline smokes for the role binding + the watch; on the box a known pattern on the Dioda PGM →
   sampled values = an independent average of the shm frame → engine DMX bytes → the previs visual.

## What was done (31.10, Opus)

- `src/fixtures/pixel-map-model.js`: optional `role` on a mapping (`pgm1…4` / `prv1…4`, anything else dropped);
  `channelForRole` moved here from the proposal service (re-used there); `bindRole(m, map)` = the mapping on its bus's
  channel of now (0 + problem "bus pgmN has no Caspar channel" when the bus has none). `validateMappings` with
  `env.channelMap`: a role without a channel gets the bus's; a posted channel other than the bus's current one is an
  operator's move (the Godot editor copies a mapping and only rewrites `channelNo` when a region moves,
  `pixel_map_model.gd:245`) → the role is dropped and the mapping stays where it was put. Godot untouched.
- `src/fixtures/pixel-map-service.js`: `resolve()` binds every mapping before checking it (so `mappings()`/`live()`
  report the live channel, the surface role stays `pgm1`); `set()` validates with the channel map. `watch()` (also used
  by `/live`). When the only reason to sample is someone looking (nothing on the wire), at most one sample per 100 ms
  (`WATCH_SAMPLE_MS`): with the previs open, 896 strips at 48/s took ~33 % of a core (6.8 ms each); at 10 Hz ~6 %.
  With a head on the wire it samples every frame as before.
- `src/fixtures/follow-service.js`: `visual()` (the previs drawing the rig, WO-797 — runs only while a client watches,
  or on GET /api/tracking/fixtures) calls `pixelMap.watch()`.
- `src/fixtures/pixel-map-propose.js` / `pixel-map-proposal.js`: the wall carries its bus (`wallOf(…, { role })`, never a
  chN), every proposed mapping carries it; `isApplied` compares buses when either side has one (a renumbered bus is
  still applied; the old unbound ch1 copy is not).
- `tools/smoke/smoke-wo915-pixel-map-bus.test.js` (new, 11 tests, curated list): role normalise / bind / POST rules,
  the service following a WO-868 flip (bus mapping → ch2 + pgm1 lease, a plain ch1 mapping reads the GUI channel), idle
  with the master off, `watch()` sampling with the master off, the 100 ms cap, the `visual()` pin, wall/proposal role,
  `isApplied`.

**Live project ("mhp harder"; backup of the file + autosave before any write: `~/.highascg/backup/wo915-20261031T203254/`):**
- Accepted a fresh proposal (`POST …/proposal/accept {"mode":"average"}` — the stored pending one predates the role):
  **896 mappings, 56 PixelLines, all `channelNo 2` + `role pgm1`, 0 problems**; proposal record `accepted`
  (sig ba0fe628561adc29), rev 570.
- The 56 Pixel Line IP heads' patch `fixed` = `1=255 53=0 … 68=0` (rev 572, through `POST /api/project/autosave` so the
  running client reloads): Dimmer held open, the 16 white segments held at 0. Found in the previs check: the W segments
  (GDTF default 255, not mapped — they sit on the same LEDs as the RGB cells) added full white over every bar as soon
  as the dimmer was open. Shutters default "Open" (0). Remove the `fixed` text in the patch to give the console back
  dimmer / white.
- DMX master unchanged (off, no universes): nothing goes on the wire from this box (the heads' dest is
  255.255.255.255). The previs shows the mapping; for the real rig switch the DMX master on for Art-Net 13–18.

## Verified (31.10)

- Offline: smoke-wo915 11/11; pixel-map smokes (wo807 ×3, wo893, wo897, wo719 sandbox guards) 70/70 → with wo915 76/76;
  full offline suite in a clean worktree **5117 tests, 5105 pass, 0 fail, 12 skipped**; line limit 0 over 500; eslint
  0 errors; prettier tools/ci clean; unwired-exports baseline shrank by one (`normalizeMapping` now used); check-wos OK.
- Sandbox GUI e2e (WO-807 `07_pixel_map`, the editor path through the throttled `/live`): **9/9 passed**, exit 0.
- Live, node restarted on the code, scratchpad `e2e_dioda.py` (a known picture on the Dioda PGM: AMCP `PLAY 2-90 BLUE`
  FILL top half, `PLAY 2-91 RED` bottom half; later `PLAY 2-92 GREEN` FILL left half), every one of the 896 mappings:
  **independent average of the pgm1 shm frame (3840×1792, seqlock-checked) = `/live` rgb = the engine's universe bytes
  at the mapping's slots (`/api/fixtures/dmx/frame`) — 0 mismatches**; the previs visual (`/api/tracking/fixtures`) has
  every mapped RGB cell lit (dimmer 255) in its cell's colour and the W segments at 0. **Pixel order:** the 8 bars
  across the blue/red line read `BBBBBBBBRRRRRRRR` (pixel 1 = top). **Left / right:** with green on x < 1920 the strips
  x 50 / 934 / 1074 are green (224 / 112 / 112), x 2726 / 2866 / 3750 stay blue-red — the columns sample their own
  wall's edge. Independent geometry (`geomcheck.py`, PSN pose → wall frame): 56/56 same wall + edge + strip x +
  vertical centre as the proposal.
- On the glass (owner GUI, Previs tab, ffmpeg x11grab, screenshots read): the bar columns at the wall edges show blue
  over red with the colour line at the walls' line, and green exactly on the columns beside the green half
  (`scratchpad/wo915/previs1*.png`, `previs2_walls.png`); with the real program (a ring mid-wall 2) the edge strips
  are black and so are the bars (`previs3_walls.png`). Test layers cleared and their mixers reset (`MIXER 2-9x CLEAR`);
  ch2 back to layer 1 only; GUI back on the Live tab.
- CPU (node, 10 s windows): previs open 86 % → 69 % of a core after the 10 Hz cap (sampling 9/s × 6.7 ms = 6 %; the
  rest is the WO-797 rig decode); Live tab 27 %.

**NOT verified / owner QA:** real PixelLines following the wall (DMX master off; the shop has no MHP rig on the wire).
Caveat (WO-807, unchanged): with the master on, sampling runs every frame at ~6.8 ms for 896 strips (~33 % of a core of
node's event loop) — if that shows up as UI or AMCP lag on a show, the sampler is the candidate for a worker thread.
