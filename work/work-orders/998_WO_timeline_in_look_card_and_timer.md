# WO-998 — A look holding a timeline: its deck card is blank, and the deck timer and compose times never show
**Area:** godot-client
**Status: DONE (07.11.26, 30 new headless assertions, Godot suite 26029 / 0; on the box: Look 21 re-taken on PGM, times ran 0:06 → 0:12 in the deck bar and the PGM/PRV rows, end-hold shows 0:44 / 0:45; the card cover was checked by its URL and the served frame, not yet on glass)**

Owner, 07.11: *"i added a timeline into a look. first it doesnt show anything in the looks card. second there is no
progress bar and times for it"*

## Investigation

- **The look.** In project `a&s`, "Look 21" (`fee329ee…`) has one layer: layer 10 with
  `source {type: "timeline", value: "tmw3u7epoydr", label: "Timeline"}`.
  - That timeline holds one 45.03 s clip, `INTRO DO WYSTĄPIEŃ/wss-szufnara.mp4`, on its "Layer 1".
  - When it was taken, `/api/state` showed `timeline.playback = {position: 44993, playing: false, endHeld: true,
    timelineId: tmw3u7epoydr, sendTo: {program: true, screenIdx: 0}}`.
  - The clip itself played on **PGM ch 2, layer 210** (`playback.matrix["2-210"]`). That is the timeline bank of
    the WO-160 layer scheme.
- **The blank card.**
  - `look_thumb_math.gd:15-30` `thumb_path` resolves only media/file sources (`/api/thumbnail/<file>`) and DeckLink
    input routes. Every other type returns `""`.
  - `look_thumb.gd:80-93` then draws a 45 %-alpha box with the source label. For this look that is the word
    "Timeline" on a near-black card, which reads as empty.
  - The web does the same (`client/lib/thumbnail-url.js:125`: timeline → `null`;
    `scenes-compose-layer-thumb.js:18`: a "Timeline" placeholder). So this is a missing feature in both clients,
    not a Godot port gap.
- **No progress bar or times.** Two views show times, and neither can see a timeline:
  - **Deck timer** (`pgm_timer_view.gd:45-87`, the bar above the look cards): `pgm_timer_model.gd`
    `pick_top_layer` only scans layers 10-99 (bank a) or 110-199 (bank b). The timeline's clips sit at 210+, so
    the bar falls back to the idle label of the look's own layer. That layer is a route or empty, so the bar shows
    nothing.
  - **Compose window rows** (`compose_times_model.gd:13-35`, Live 2D PGM/PRV windows): one row per look layer, read
    from OSC at that layer's number (10 or 110). The timeline layer has no producer there, so its row has no time
    and no bar.
  - **The right clock is the engine's timeline position, not one clip's OSC.** A timeline can chain several clips
    on several layers.
    - The server sends `timeline.playback` (play, pause, stop, end-hold, sendTo; `index.js:337`).
    - While playing it also sends `timeline.tick {timelineId, position}`, throttled to about 150 ms
      (`timeline-playback-runtime.js:448-455`).
    - On stop, `sendTo.program` is reset to false (`:242-249`). A timeline is therefore on PGM exactly while
      `sendTo.program` is true and it is playing or end-held.
  - In the Godot client only the Timeline tab listens to `timeline.tick` (`timeline_transport.gd:76`). The Live
    tab never sees the position.

## What was done

- **`features/live/timeline_clock.gd`** (new) — the on-air timeline's clock for the Live tab:
  - `listen()` subscribes once to `timeline.tick` and `timeline.playback`, which record `{timelineId, position}`
    and the time they arrived.
  - `on_air(pb, timelines, pgm, main, now)` returns `{id, name, elapsed, duration, playing}`, but only when
    `sendTo` names that bus and screen and the timeline is playing or holding its end. The rules:
    - The position runs on from the last tick while playing.
    - It wraps on a looping timeline and clamps at the end otherwise.
    - Ticks for another timeline, or malformed ones, are ignored.
    - Before any tick, the playback snapshot's position is used.
  - Autoloads (`Ws`, `Store`) are looked up by name, the `audio_console_ctl.gd` pattern, because this script is
    preloaded by headless tests where those identifiers do not compile.
- **Deck timer bar** (`pgm_timer_view.gd`): a timeline on PGM wins over the layer scan. It plays above every look
  layer, so it is the top running thing. The bar and times come from the clock, and the label is the timeline's
  name. The drawing moved into `_show()`, shared by both paths. The header status timer uses the same view, so it
  shows the timeline as well.
- **Compose window rows** (`compose_times_model.gd` `rows(…, timeline := {})`, wired in `compose_tiles.gd`): a
  layer whose source is the timeline on that bus gets its elapsed/duration and the timeline's name. Any other
  timeline layer keeps its label and gets no time.
- **Card picture** (`look_thumb_math.gd` `timeline_cover`, used through `look_thumb.gd` `_path()`):
  - A timeline layer draws the thumbnail of its earliest-starting clip that has one, through the same
    `/api/thumbnail` path as a media layer, placed at the look layer's FILL rect.
  - Clips with no picture (templates, buses…) are skipped.
  - A timeline with no such clip keeps the label box.
  - The look editor backdrop uses the same drawer, so it gets the picture too.
- **The web client is unchanged.** It shows a "Timeline" placeholder too, and the owner works in the Godot client.
- **`tests/test_timeline_in_look_times.gd`** (new, auto-discovered), 30 assertions covering:
  - bus, screen and play/end-hold gating;
  - tick run-on, clamp, loop wrap, pause, foreign and malformed ticks;
  - the compose row on, off, and with another timeline on air;
  - the cover choice (a template at 0 s is skipped; the clip at 2 s wins over one at 9 s) and its thumbnail URL.

## What was VERIFIED

- **Godot:** `run-client.sh --check` boots clean. `--test`: **26029 passed, 0 failed**, 30 more than before.
  - The first run caught a compile error: `Ws` is not an identifier in a test run. Fixed with the lookup by name.
- **On the box.** The operator GUI was relaunched on the new code.
  - **End-held** (as found): the deck bar shows "Timeline 0:44 / 0:45 (−0:00)" with a full bar, the PGM window row
    shows "L10 Timeline 0:44 / 0:45", and the header timer shows the same. Before the relaunch, the same state showed
    the row with no time and no bar.
  - **Playing:** I re-took Look 21 with `POST /api/scene/take-look` on main 0. Screenshots 6 s apart show **0:06 /
    0:45 (−0:38)** and then **0:12 / 0:45 (−0:32)**, with growing green bars in the deck bar and both the PGM and
    PRV rows. During playback the engine had `sendTo {program: true, preview: true}`, and `/api/state` positions
    were 6036 and 12188 ms.
  - **Card cover:** `GET /api/thumbnail/INTRO%20DO%20WYST%C4%84PIE%C5%83%2Fwss-szufnara.mp4?hq=1&w=960&t=0` →
    200 PNG, a real frame (the speaker title card). Look 21's card sits below the visible part of the deck, and I did
    not scroll the owner's live client, so the card itself is not yet confirmed on glass.
- **The tick path is live.** The Store's `timeline.playback` only changes on play, pause and stop, so times
  advancing between those events show that `timeline.tick` reaches the clock. That path goes through the static
  `note` Callable registered with `Ws.on`.
- **Left as found:**
  - The timeline played out to its end-hold on PGM.
  - PRV was cleared again (`POST /api/scene/live/preview/clear`, which is what the owner had done). The screenshot
    matches the state before the test: PGM end-held, PRV black.
  - One leftover: the take left the timeline's persisted `sendTo.preview` true (it was false). That flag only
    routes the timeline to PRV the next time it plays from the Timeline tab.

Rollback: revert the commit. The views fall back to the label box and no times.
