# WO-813 — Look layer "Clip start point" → Custom: scrub slider on PRV + Trim in / Trim out

**Status: IMPLEMENTED (29.10 — smokes + offline suite + Godot tests + boot check; live: the route and the real client
scrubbed PRV 2-10 through the scrub gate; screenshot of the Inspector; owner QA = drag the slider, trim, take).
29.10 second pass: the Custom option is removed (trim works under both start options; a stored "custom" loads and takes
as "beginning"), Trim is a collapsible compact row, right-click resets. Third pass: Ctrl / Cmd+click and a ↺ per point
reset in both clients; the web client has the same compact Trim row and no Custom (dist-web rebuilt) — see the last
section.**

Owner, 29.10:
> in a layers inspector inside a look there is clip start point with a drop down. add there custom, where it opens
> additional trim settings with a slider and trim in trim out points buttons. should display the slider moves on the
> prv channel (if present) similar to how the timeline seek does it now.

Parents: [WO-576](./576_WO_look_clip_start_point_two_options.md) (the two-option drop-down),
[WO-570](./570_WO_look_layer_media_transport_trim.md) (layer `trimInMs` / `trimOutMs`, take SEEK / IN / LENGTH),
[WO-601](./601_WO_godot_port_inspector.md) (Godot layer inspector), [WO-787](./787_WO_timeline_preview_and_smooth_scrub.md)
/ [WO-790](./790_WO_timeline_scrub_paced_and_faster_seek.md) (paced scrub seek).

## Investigation

- **The drop-down**: `godot/client/features/live/layer_inspector.gd:20` `STARTS` = `beginning` ("Start from beginning"),
  `relativeToPrevious` ("Relative to the clip playing on this layer"); row at `:52`, written as
  `{"startBehaviour": …}` through the inspector's `patch` signal → `look_editor.gd` `_apply_layer` (merge into the
  show document → `preview_pusher.gd` → deck sync + `/api/scene/preview-push` → autosave). Web twin:
  `client/components/inspector-scene-layer.js:258-275`.
- **Trim fields already exist** (WO-570): `layer.trimInMs` / `layer.trimOutMs`. The take reads them in
  `src/engine/scene-play-seek.js` `resolvePlaySeekFramesForSceneLayer` (beginning → SEEK at trim-in) and
  `src/engine/scene-take-lbg-jobs.js:236-252` (IN = trim-in, LENGTH from trim-out). The Godot layer inspector had no
  UI for them.
- **Whitelists drop unknown start values**: `src/engine/scene-take-payload.js:81` (server take payload) and
  `client/components/scenes-shared.js:318` (web) only pass `beginning` / `relativeToPrevious`; the web layer logic
  (`client/lib/scene-state-layer-logic.js`, `scene-state-helpers.js` `migrateScene`) normalised everything else to
  `beginning`. `resolveEffectiveStartBehaviour` fell back to the timeline clip / `beginning` for anything else.
- **Timeline seek path**: `src/engine/timeline-scrub-gate.js` `scrubSeek(engine, ch, layer, caspFrame, chFps)` — one
  `CALL ch-l SEEK` per layer in flight, released by OSC `file/time`, newest target next; gate map on the timeline engine
  (`engine._scrubGate`, `engine.self.amcp` / `oscState`). The Godot side keeps one request in flight with the newest
  position next (`timeline_transport.gd` `seek`). SEEK counts channel frames on this build.
- **The look's PRV copy**: `live-scene-state` per channel (`getChannel(prvCh).sceneId`); PRV has no A/B bank, so the
  physical layer is the look layer number (`routes-scene-layer-tools.js` `handleLayerReload`).
- A trim / start change is not in the preview-push compare key (`client/lib/scenes-preview-snapshot.js`), so pressing
  Trim in / out is a nudge on PRV, not a re-take: the scrubbed position stays.

## What was done

- **Server**
  - New `src/api/routes-scene-layer-scrub.js`: `POST /api/scene/layer-scrub {sceneId, mainIdx, layerNumber, ms}`. Resolves
    the main's PRV channel; seeks only when PRV holds this look with the same clip on that layer, otherwise answers
    `{onPrv:false, reason: not_on_prv | clip_not_staged | pgm_only | not_a_clip}` and sends nothing. Seeks through
    `scrubSeek` on the timeline engine's own gate map (a timeline drag and a look scrub on one layer never stack), frame
    = ms × channel fps. Also rebases the WO-570 playback tracker like `/api/seek`. PGM is never a target.
  - `routes-scene.js`: route registered (needs AMCP).
  - `scene-play-seek.js`: `custom` is a valid start; a Custom layer starts at its trim-in before the timeline-clip and
    live-playhead branches. Trim-out → LENGTH is unchanged (lbg-jobs).
  - `scene-take-payload.js:81`: `custom` passes the take whitelist.
  - `docs/wiki/api/contract/http.md` regenerated (`node tools/dev/gen-api-contract.js`; +1 route; the file already held
    another session's pixel-map rows).
- **Godot**
  - New `features/live/clip_trim_model.gd` (pure): ms ↔ frame, snap, shown in / out, `set_in` / `set_out` (in before
    out by at least a frame, both clamped into the clip; in at 0 and out at the end stored as null like the web),
    `scrub_note`.
  - New `features/live/clip_trim_section.gd`: slider (0 … clip duration, a frame per step, timecode beside it), Trim in /
    Trim out, "In … Out …" under them, and a status line (PRV channel, or "Look not on PRV — the slider only picks the
    points for the next take"). Duration / fps from the `/api/media` row (CINF fallback). One scrub request in flight,
    newest next. When the start point is not Custom but a trim is stored, one muted line says it still applies.
  - `layer_inspector.gd`: third option "Custom (trim in / out)" saved as `startBehaviour: "custom"`; the section sits
    in the grid right under the drop-down; its patches go through the same `patch` signal as every other field.
  - Dev probes for the screenshot (no pointer automation): `--probe-select=<layer index>` (`live_tab.gd`, after
    `--probe-edit` opened the editor), `--probe-custom-start=<ms>` (shows Custom without saving it and scrubs once).
    `look_editor.gd` is at 500 lines, so the select hook lives in `live_tab.gd`.
- **Web (source only, `dist-web` not rebuilt — other sessions have uncommitted `client/` edits)**: the normalisers and
  whitelist keep `custom`, the web drop-down gained the option, so a web edit no longer turns Custom back into
  "beginning" once rebuilt.
- Semantics kept from WO-570: a stored trim still applies under "Start from beginning" (trim-in) and under every option
  (trim-out → LENGTH); switching away from Custom keeps the points.

## Verified

- `smoke-wo813-look-custom-clip-start.test.js` (8 tests, registered in `offline-test-files-2.js`): seek frame math; on
  PRV → one seek at (PRV ch, look layer, ms × ch fps); not on PRV / other clip / no PRV bus → nothing sent; the real gate
  holds the newest target; take: Custom → trim-in frame even with a timeline clip on the layer index; IN / SEEK /
  LENGTH = 25 / 25 / 75 for 1 s / 4 s @ 25; payload + web normalisers keep `custom`; Godot source pins.
- Offline suite: 3546 tests, 3543 pass, 1 fail (the API contract doc, then regenerated: smoke-wo598 3/3), 2 skipped.
  WO-570 / WO-576 smokes pass. No file over 500 lines.
- Godot: `--test` 22457 passed / 0 failed (new `test_clip_trim_model.gd`); `run-client.sh --check` boot OK.
- Live (dev mode, node restarted), look "Intro" already on PRV ch 2 (INTRO_v3.mov, L10), nothing taken:
  - single scrub to 30 s → `{"onPrv":true,"channel":2,"layer":10,"frame":1500,"chFps":50}` in 9 ms; OSC showed PRV at
    30.00 s 376 ms later.
  - API drag 30 → 40 s (61 requests as the client sends them): 27 `CALL 2-10 SEEK` lines (the gate coalesced), 24
    distinct PRV positions during the drag, last SEEK 2000 = 40 s, PRV at 40.2 s after release (playing).
  - PGM ch 1 kept counting through its 10 s loop; no `CALL 1-*` in the journal.
  - The real client (`--probe-edit=<Intro> --probe-select=0 --probe-custom-start=20000`) sent `CALL 2-10 SEEK 1000`.
  - The stored Intro layers stayed `beginning`, no trim (the probe shows Custom without saving).
- Screenshots (scratchpad `custom_start/`): `probe_custom_start.png` — Inspector: Clip start point "Custom (trim in /
  out)", slider at 0:20.00, Trim in / Trim out, "In 0:00.00  Out 1:03.08", "Scrubbing PRV (channel 2) — PGM is not
  touched"; `relaunch_tab0.png` — the owner's client relaunched on Live (`--autostart --tab=0`).

## Not verified / owner QA

- Dragging the slider by hand and how it feels; pressing Trim in / Trim out in the GUI (the patch path is the one every
  inspector field uses, but no button was clicked: no pointer automation on :0).
- A real take of a Custom layer on air (in / out honoured by Caspar). SEEK past a PRV copy that was taken with a LENGTH
  (trim-out) is not tested.
- The web drop-down until `npm run build:client`.

## Trim-out playout (29.10, Opus)

Owner, 29.10: "i tried trimming and it has no effect on the actual playout. tried the clip to 9 s without the black frame at
the end and the clip is being played out fully."

### Investigation (before any change)

- **What the node sends.** `src/engine/scene-take-lbg-jobs.js:247-252` turns `trimOutMs` into `LENGTH` (channel frames,
  measured from IN); `:239-243` sends IN = trim-in, SEEK = start. The look (`projects/mhp_harder.json`, scene
  `a35b9460…`, layer 10: `loop: true`, `startBehaviour: "custom"`, `trimOutMs: 9360`, no `trimInMs`) went out as
  `LOADBG 1-10 / 1-110 / 2-10 "…W SPODNIACH CZY W SUKIENCE DIODA" LOOP IN 0 SEEK 0 LENGTH 468` (Caspar log 14:30:10,
  14:30:41; 468 = 9.36 s × 50 fps channel). The take plays with a bare `PLAY ch-l` (lbg-jobs `:256-261`), so the
  pre-rolled LOADBG producer — with its LENGTH — is the one that plays.
- **What Caspar 2.5.1 does with LENGTH** (`~/caspar-build/src-v2/src/modules/ffmpeg/producer/`):
  - `ffmpeg_producer.cpp:305-318` parses `SEEK`, `IN` (defaults to SEEK), `LENGTH` → `out = in + LENGTH`, `OUT`
    overrides; `:336-338` `duration = out - in` → `AVProducer(start, seek, duration, loop)`.
  - `av_producer.cpp:925-945` (decode loop): `end = start + duration`; once the next frame's time ≥ `end`,
    `buffer_eof_` is set — **with LOOP it `seek_internal(start)` (wraps to IN), without LOOP it stops decoding and
    `next_frame` (`:1083-1096`) keeps returning the last frame (holds on the out point)**. So LENGTH limits playout
    itself; it is not just a duration hint for a later PLAY/SEEK. `CALL … LENGTH/OUT` (`ffmpeg_producer.cpp:154-165`)
    changes it on a running producer.
  - `av_producer.cpp:1045` reports the window as OSC `file/clip` = [in s, length s]; `file/time` stays
    [file position s, **file** duration s].
- **Measured on air (read-only, nothing sent):** `INFO 1` → layer 110 `<clip>0</clip><clip>9.36</clip>`; OSC sniff
  (UDP :6250) of `/channel/1/stage/layer/110/foreground/file/time`, 21 s, 1046 samples: **max 9.34 s, wraps
  9.34 → 0.00 twice** (9.34 = frame 467, the last of 468). `file/clip` = `[0.0, 9.36]`. PGM honours the trim-out.
- **Q2 (does the node stop the clip itself?)** No timer, no `end` handler: the node relies on the producer's LENGTH,
  which (above) is enforced by Caspar. That is correct, not the bug.
- **Q3 (PGM take / PRV copy):** every take path in the log carries the LENGTH: PRV pre-stage `LOADBG 2-10 … LENGTH 468`
  (14:30:10.680, 14:30:41.184), PGM `1-10`/`1-110 … LENGTH 468`. The pgm→prv exchange after a take restages the
  OUTGOING PGM snapshot, so it carries that snapshot's trim (`LENGTH 498` at 14:30:10.879 = the previous 9.96 s trim;
  no LENGTH at 14:29:13.261 = the pre-trim version) — by design, not a lost trim.
- **Where the black frame really is.** `ffprobe`: HAP (`Hap1`, rgb0, no alpha), 25 fps, 250 frames = 10.00 s.
  `signalstats` YAVG per frame: **frames 0, 1, 2 = 16.0 (black)**, frame 3 onwards 33.5–38.4, last frame 249 = 35.3 —
  there is **no** black at the end. Tile of frames 0–4 + 249 (scratchpad `head_tail.png`) shows it. With `loop: true`
  the layer wraps from the out point to IN = 0, so those three head frames (6 channel frames, 120 ms) flash black at
  every loop point — it looks like "a black frame at the end", and cutting the tail (9.96 s, then 9.36 s) cannot remove
  it. **Trim in at 0.12 s (file frame 3)** does: `IN 6 SEEK 6 LENGTH 462`, loop window 0.12 – 9.36 s.
- **What did not follow the trim (node side):** the OSC state ignores `file/clip`
  (`src/osc/osc-state-layer.js:195-` `_routeLayerFile` has no `clip` branch), so `file.remaining` / `file.progress`
  (`:256-266`, `osc-state-timing.js:39-53`) are computed against the FILE duration. Consequences for a trimmed clip:
  the Godot PGM timer (`godot/client/features/live/pgm_timer_view.gd:63-74`) shows `0:09 / 0:10 (−0:00.66)` at the
  out point and never reaches 0 — the clip reads as "played out fully" — and the look's fade-on-end
  (`src/state/playback-tracker-osc.js:57-98` `getOscClipEndFadeDelayMs`, uses `f.remaining`) of a non-looping trimmed
  clip would start at the FILE end, i.e. after the clip has already frozen on its out point.

### What was done

- **No playout change.** Caspar enforces LENGTH (above) and every take path sends it, so nothing in the take
  (`scene-take-lbg-jobs.js`, `scene-play-seek.js`) or Caspar needed changing. The owner's black frame is the clip's own
  head (frames 0–2): set **Trim in to 0.12 s** (Custom → slider to 0:00.12 → Trim in) and retake; the take then sends
  `LOOP IN 6 SEEK 6 LENGTH 462` (pinned in the new smoke).
- **The node now follows the trim window in its timing** (what made the trim look ineffective in the GUI):
  - `src/osc/osc-state-layer.js` `_routeLayerFile`: new `file/clip` branch → `f.clipIn` / `f.clipLength` (sanity-clamped
    like `file/time`); `clearOscFileTiming` drops them on a clip change; the `file/time` branch calls `applyClipWindow`.
  - `src/osc/osc-state-timing.js` `applyClipWindow(f)`: when the window is narrower than the file, `remaining` =
    out point − position, `progress` inside the window, `f.outPoint` = out point (s); `elapsed` / `duration` stay
    file-absolute (scrub slider, WO-570 tracker and the scrub gate keep their meaning). Untrimmed: no change.
  - `src/osc/osc-state.js` `applyInfoTimingSupplement`: same call, so the INFO fallback agrees.
  - Effect: the Godot PGM timer's countdown / tier colour and the fade-on-end delay (`getOscClipEndFadeDelayMs` reads
    `f.remaining`) count to the trim-out.
  - `godot/client/features/live/pgm_timer_view.gd`: the duration shown is `outPoint` when present (`0:09 / 0:09`, not
    `/ 0:10`). Needs a client relaunch to show.
  - Web client (`client/`) not changed or rebuilt.

### Verified (29.10)

- **PRV (real take path):** `POST /api/scene/preview-push {sceneId: a35b9460…}` (target PRV, forceCut; mode `take`,
  previewChannel 2) → Caspar log 14:38:09.130 `LOADBG 2-10 "…W SPODNIACH CZY W SUKIENCE DIODA" LOOP IN 0 SEEK 0
  LENGTH 468`, `PLAY 2-10`. OSC sniff of `/channel/2/stage/layer/10/foreground/file/time`, 21 s, 1050 samples: **max
  9.34 s, three wraps 9.34 → 0.00** — the PRV copy ends at the trim-out.
- **PGM (read-only, nothing sent to ch 1):** `INFO 1` layer 110 clip `[0, 9.36]`; OSC 21 s, 1046 samples, max 9.34,
  wraps 9.34 → 0.00 ×2; `file/clip` = `[0.0, 9.36]`.
- **Node timing after the change** (node restarted 14:41:47, dev mode): `/api/state` OSC for 1-110 — `duration 10`,
  `outPoint 9.36`, `remaining` = 9.36 − position (e.g. el 8.94 → rem 0.42, then wraps to el 0.46 / rem 8.90).
- New `tools/smoke/smoke-wo813-trim-out-osc-window.test.js` (7 tests, registered in `offline-test-files-2.js`):
  window remaining / progress, trim in + out, untrimmed unchanged, clip change drops the window, fade-on-end delay to
  the out point, take commands for this clip (`LENGTH 468`; with trim-in 120 ms `IN 6 SEEK 6 LENGTH 462`), Godot pin.
- Offline suite: **3555 tests, 3553 pass, 0 fail, 2 skipped** (baseline 3548 + 7). No file over 500 lines.
  Godot `run-client.sh --check`: boot OK.
- Side effects of the node restart (normal restart behaviour, noted): Caspar `REMOVE 1-98 / 1-741 / 1-700` (helper
  layers) and the owner's client restaged its looks on PRV 2 and 4 on reconnect (14:41:59). PGM 1-110 kept playing
  (OSC position continuous).

### Not verified / owner

- Trim in 0.12 s on this look and a retake (an owner data change — not done here). The PGM timer's `/ 0:09` needs a
  Godot client relaunch (not done: the owner's client is running). No PGM take was needed: PGM was measured read-only.
- No Caspar change, so no Caspar restart is needed.

## Compact trim, reset, no Custom (29.10, Opus)

Owner, 29.10: "right clicking on trim in or trim out in the inspector should reset the value to default (of that clip of
course). actually we dont need the custom trim in out in the dropdown, as trim should be possible for both existing
options. i need you to compact the trim section, it takes too much space, also make the trim a collapsible section,
default collapsed."

### Investigation

- **"No trim" is null** (`clip_trim_model.gd` `set_in` / `set_out`, web `inspector-media-transport.js`): an in at 0 and an
  out at the clip end are stored as `trimInMs` / `trimOutMs` = null; `look_editor.gd` merges the patch, the server
  payload drops null (`scene-take-payload.js` `l.trimInMs != null`). So a reset writes null through the same `patch`.
- **Trim already works under both options** on the server: `scene-take-lbg-jobs.js:236-252` sends IN = trim-in and
  LENGTH (from IN) for every start option; "beginning" seeks to the trim-in (`scene-play-seek.js`), "relativeToPrevious"
  keeps SEEK = the running clip's position with IN / LENGTH = the trim window
  (`smoke-scene-relative-seek-in-point.test.js` pins it, including "trim-out before a relative start → no LENGTH").
  The only Custom-specific server code was the `sb === 'custom'` branch in `resolvePlaySeekFramesForSceneLayer` and the
  payload whitelist entry.
- **The layer-scrub route is not Custom-specific**: it is the trim slider's PRV seek (`clip_trim_section.gd` `_scrub`);
  nothing else calls it. Kept.
- **Stored data**: one look carries a legacy Custom — `W spodniach czy w sukience dioda` (`a35b9460…`, L10:
  `startBehaviour: "custom"`, `trimInMs: 240`, `trimOutMs: 9360`). The web twin (`client/`, not rebuilt) still has the
  Custom option and still writes `custom`.

### What was done

- **Start options**: `clip_trim_model.gd` `STARTS` = `beginning`, `relativeToPrevious` (pure, so a test can read it);
  `layer_inspector.gd` `const STARTS` = that. A stored `"custom"` matches no option → the drop-down shows "Start from
  beginning"; nothing is rewritten in the project (the value changes only when the operator picks an option).
- **Server**: `scene-play-seek.js` `resolveEffectiveStartBehaviour` maps `custom` → `beginning` (also over a timeline
  clip's own start); the Custom-only branch in `resolvePlaySeekFramesForSceneLayer` is removed, so a legacy Custom
  layer starts at its trim-in exactly like "beginning" and ends at its trim-out (LENGTH, unchanged). `scene-take-payload.js`
  sends a stored `custom` as `beginning` (trim kept). `routes-scene-layer-scrub.js`: comment only (route kept).
- **Trim row** (`clip_trim_section.gd`, rewritten): `header` "▸ Trim" / "▾ Trim" sits in the inspector grid's label
  column (`layer_inspector.gd` adds `_trim.header` then `_trim`); the value cell holds either the folded summary
  ("Full clip" or "0:00.06 – 0:09.09") or the compact editor: `[Trim in] [in] [Trim out] [out]` on one row, the slider
  with a small position timecode in one thin row below. No note line any more: scrub / refusal notes go to the look
  editor's status line (new `status` signal) and the slider tooltip. Folded on every new layer / clip, after the
  inspector shows nothing (`forget()`), when the section re-enters the tree or comes back into view; never saved. Hidden
  for templates, routes and stills (`mixer_math.supports_loop`).
- **Right-click** on Trim in / Trim out (`gui_input`, secondary button, event accepted) → `clip_trim_model.reset_in` /
  `reset_out`: patch `trimInMs: null` / `trimOutMs: null` (the clip's start / end). `reset_in` also clears an out stored
  below one frame, `reset_out` also clears an in at or past the clip's last frame (a point kept from a longer clip), so
  a reset never leaves in ≥ out. Tooltips: "Set In to the slider position / Right-click to reset to the clip's start"
  (Out: "…end"). Left-click unchanged (slider position, snapped, in before out by a frame, both in the clip).
- **Fields** are timecodes and editable: Enter / focus-out parses `m:ss.ff` (`.ff` = frames, as `format_timecode`
  writes) or plain seconds with + - * / (RULES.md), then the same `set_in` / `set_out` clamping; garbage keeps the point.
  Shown points are clamped (`points()`: in ≤ out, both inside the clip).
- **Probe**: `--probe-custom-start` is gone; `--probe-trim[=closed|open|<ms>]` (with `--probe-edit=<look id>
  --probe-select=<layer index>`) opens the section (and scrubs PRV once to `<ms>`), then prints the header / section
  sizes. Nothing is saved.

### Verified (29.10)

- Godot `--test`: **22685 passed, 0 failed** (other sessions' tests moved the baseline 22516 → 22685; a deliberate
  failing assertion appended to `test_clip_trim_model.gd` showed up as the one failure, then removed). The file alone:
  67 assertions — new: `points` clamping, `reset_in` / `reset_out` (incl. in < out after each reset), `parse_tc`,
  `summary`, and `STARTS` = exactly `beginning` + `relativeToPrevious`.
- `smoke-wo813-look-custom-clip-start.test.js` updated (8 tests): legacy custom → `beginning` (also with a timeline
  clip on the layer index: same frames as beginning), the `sb === 'custom'` branch is gone; IN / SEEK / LENGTH for
  legacy custom, beginning (25 / 25 / 75) and relativeToPrevious (25 / 50 / 75); `buildServerIncomingScene` sends
  custom as beginning with its trim; Godot pins (two options, header in the grid, fold on a new layer, right-click →
  `_reset`, tooltips, reset patches null, slider still posts `/api/scene/layer-scrub` one in flight). WO-570, WO-576,
  WO-598 parity, relative-seek and trim-out smokes pass (39 tests in that set).
- Offline suite: **3561 tests, 3559 pass, 0 fail, 2 skipped**. `check-max-file-lines.js`: none of these files is near
  500 (the one file over is `godot/export/web-demo/index.js`, another session's). `run-client.sh --check`: boot OK.
- Real client on :0 (owner's client stopped, probe instances, then relaunched `--autostart --tab=0`; no pointer or
  keyboard automation), look `W spodniach czy w sukience dioda` (the legacy Custom one), `--probe-edit=a35b9460…
  --probe-select=0`:
  - `--probe-trim=closed`: "Clip start point: Start from beginning", "▸ Trim  0:00.06 – 0:09.09"; header row 19 px.
  - `--probe-trim=5000`: open row 51 px (Trim in 0:00.06, Trim out 0:09.09, slider at 0:05.00); status "Scrubbing PRV
    (channel 2) — PGM is not touched"; journal `AMCP → CALL 2-10 SEEK 250` (5 s × 50), no `CALL 1-*`. PRV only.
  - The stored look stayed `custom` / 240 / 9360 (the probes save nothing).
  - Screenshots (scratchpad `trim_compact/`): `probe_collapsed.png`, `probe_expanded.png`, `probe_expanded_zoom.png`,
    `relaunch_tab0.png` (owner's client back on Live).

### Not verified / owner

- The owner's eye on the compact row; a real right-click / left-click / typed point on the glass (no pointer automation).
  The reset and set paths are the model functions the tests cover, emitted through the inspector `patch` every field uses.
- A take of the legacy Custom look after this change (server path covered by the smokes; no take was made).
- The web client still offers "Custom (trim in / out)" (`client/components/inspector-scene-layer.js`, outside this pass;
  dist-web not rebuilt). The server now treats its `custom` as `beginning`, so it stays harmless.

## Reset gesture and web trim (29.10, Opus)

Owner, 29.10: "add to web client as cmd or something click as i guess right clicks doesnt work in a web gui. rebuild the
webui. try on my screen."

### Investigation

- **Godot**: the reset was right-click only (`clip_trim_section.gd` `_button` → `gui_input`, secondary button). Control
  emits `gui_input` before the Button's own handling, so an event accepted there never becomes a `pressed` (the same
  mechanism the right-click used) — a Ctrl+click can be caught the same way without also setting the point.
- **Web** (`client/`): the start drop-down still offered "Custom (trim in / out)" (`inspector-scene-layer.js:268`).
  Trim lived in the "Media transport" group (`inspector-media-transport.js:310-377`): two drag sliders "Trim in (s)" /
  "Trim out (s)" plus "Set in / out ← playhead" — always open, no reset other than dragging to the ends, and a second
  trim UI unlike Godot's. The inspector re-renders on every layer patch (`inspector-panel.js` `sceneState.on('change')`
  / `softChange`, skipped while an input has focus), so an open / closed state has to live outside the DOM.
- No DOM test runner in the repo (no jsdom); the client modules import fine under `node --test` with a small fake
  `document` (the settings fetch at import is answered offline).

### What was done

- **Godot** `clip_trim_model.gd`: `is_reset_click(e)` = a press of Ctrl+left, Cmd(meta)+left or right. `clip_trim_section.gd`:
  `gui_input` on Trim in / Trim out uses it (accept, then `_reset(is_in)`); a small flat `↺` after each point's field
  (`_reset_btn`, no focus, enabled even with the length unknown — a reset needs none) calls the same `_reset(is_in)`.
  Row: `[Trim in] [in] ↺ [Trim out] [out] ↺`. Tooltips "Set In to the slider position / Ctrl+click or ↺ to reset to the
  clip's start" (Out: "…end"). Plain click unchanged; right-click unchanged. Stored value unchanged (null = no trim).
- **Web**:
  - `client/lib/clip-trim-model.js` (new, 149 lines): the Godot model's twin (frames, set / reset in / out, points,
    `m:ss.ff` format / parse with + - * /, summary, scrub note, `STARTS`, `isResetClick` = left button + ctrlKey or
    metaKey).
  - `client/components/inspector-clip-trim.js` (new, 236 lines): the compact Trim row in the "Look take (playback)"
    group under "Clip start point": "▸ Trim  Full clip" / "▸ Trim  0:00.06 – 0:09.09" folded; open = the same row as
    Godot plus a slider + timecode row. Ctrl / Cmd+click on Trim in / out, the ↺ and (where a browser delivers it)
    right-click call one `reset()` → `sceneState.patchLayer` (the patch path every web layer field uses). The slider
    scrubs PRV through `POST /api/scene/layer-scrub` (one in flight, newest next, like Godot); its note goes to the
    slider tooltip and once per change to a toast. Fields select on focus, commit on Enter / blur (RULES.md). Open state
    and slider position are kept per look / layer / clip across the re-renders; another layer or clip folds it again.
    Hidden for non-video sources and playlist mode. Length from the media scan, else `/api/media/cinf` once.
  - `inspector-scene-layer.js` (299 lines): Custom option removed; a stored legacy `custom` shows as "Start from
    beginning" and is not rewritten (the server already takes it as beginning); appends the Trim row.
  - `inspector-media-transport.js` (313 lines): its trim sliders / playhead buttons removed (one trim UI);
    `looksLikeVideoMedia` exported. CSS: `client/styles/05d2-inspector-clip-trim.css` (new, 73 lines, imported in
    `styles.css`); the dead `__trim-row` / `__trim-buttons` rules removed from `05d-inspector-fields.css` (433 lines).
- **Tests**: `godot/client/tests/test_clip_trim_model.gd` + 13 assertions (`is_reset_click` cases; the section read as
  text — it needs the app autoloads — Ctrl+click branch and ↺ both `_reset(is_in)`, one ↺ per point, tooltips).
  `tools/smoke/smoke-wo813-web-clip-trim.test.js` (new, 4 tests, in `offline-test-files-2.js`): model; folded by
  default / stays open over a re-render / folds after another layer; Ctrl+click, Cmd+click, ↺ and right-click give the
  identical patch (`{trimInMs: null}` / `{trimOutMs: null}`), plain click = the slider position, the slider posts
  layer-scrub; no Custom in the web drop-down, no second trim UI. `smoke-wo813-look-custom-clip-start.test.js`: the
  right-click-only pin repointed to `is_reset_click` + the ↺ wiring + the new tooltips (right-click still asserted in
  the model).

### Verified (29.10)

- Godot `--test`: **22698 passed, 0 failed** (baseline 22685 + 13 new). `run-client.sh --check`: boot OK.
- Offline suite: **3565 tests, 3562 pass, 1 fail, 2 skipped** (baseline 3561 + 4 new). The failure is a timing flake in
  `smoke-wo570-look-media-transport.test.js` "recordPause freezes elapsed" (5093 ms vs ~5000 under suite load; server
  playback-matrix code, untouched here); the file alone passed 8/8 three times. `check-max-file-lines.js`: 0 over 500.
- `npm run build:client`: built `dist-web/assets/main-BctS1bUA.js` / `main-s7LfcesA.css`. The node on 127.0.0.1:4200
  serves that index (same hashes); the served JS contains "Ctrl+click or ↺ to reset to the clip's start", the served CSS
  `.inspector-clip-trim__reset`, and no file in dist-web contains "Custom (trim in". No node restart was needed.
- Owner's Godot client stopped and relaunched normally (`--autostart --tab=0`): ws connected, no script errors, Live tab
  (screenshot `scratchpad/…/trim_reset_web/relaunch_tab0.png`). **No probe flag used**: `--probe-edit` opens the look
  editor, which stages the look on PRV (`look_editor.gd:146 pusher.schedule`) — not allowed in this pass (no PRV take).
  No pointer or keyboard automation.

### Not verified / owner

- The owner's eye on the row with the two ↺ (Godot and web); a real Ctrl+click / ↺ / plain click on the glass. The
  gestures are covered by the model tests and the web component run against a fake DOM, not by a click on screen.
- The web UI in a real browser: the layout of the compact row, the toast, and how the browser delivers Ctrl+click on a
  button (on macOS Ctrl+click may arrive as a context menu — the handler resets on that too; Cmd+click is the intended
  gesture there).
- A take after a reset (server path unchanged: null = no trim, covered by the earlier smokes).

