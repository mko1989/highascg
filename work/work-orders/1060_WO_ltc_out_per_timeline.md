# WO-1060 — LTC out only on the timelines the operator chooses

**Area:** engine, godot-client
**Status: IN PROGRESS (13.11 — built; server path proven on the box; the click in the owner's GUI not yet seen)**

Owner, 13.11: *"the ltc timecode is being generated for all timelines. i want it to only play on the timelines i choose."*

## Investigation

- `src/timecode/ltc-service.js` `airPlayhead()` returned the playhead of whatever timeline is on air
  (`eng._airTimelineId`); `ltc-output.js` `targetFramesAt` runs the encoder whenever that playhead is playing. No
  per-timeline condition existed.
- The WO-1059 transport read-out toggled the GLOBAL `ltc.output.enabled`.
- `TimelineEngine.create()` whitelists timeline fields (`src/engine/timeline-engine.js`), so a new flag must be listed
  there or a server start drops it; `update()` passes fields through.

## What was done

- Timeline field `ltcOut: true` (project data). `ltcOutPlayhead(eng)` in `ltc-service.js` returns null unless the
  on-air timeline carries it → the encoder stays stopped (silence) for every other timeline. `create()` keeps the flag.
- Godot: the transport read-out (`timeline_ltc.gd`) click now chooses / unchooses the SHOWN timeline (saved through
  the transport's `edited`), and turns the global output on if it was off. `ltc_model.gd readout(d, timeline_on)`
  shows `LTC off` for a timeline that is not chosen. The read-out is its own item of the controls row
  (`timeline_tab.gd`, `[transport, transport.ltc, dest]`) so it wraps instead of being cut off.
- Default: no timeline is chosen — existing timelines are silent until clicked (what "only the ones I choose" means).

## Verified

- `tools/smoke/smoke-wo1060-ltc-per-timeline.test.js` (6) + LTC smokes; offline suite 6175 pass.
- Box 13.11: timeline "krakow" played unchosen → `/api/ltc` output `running: false`; with `ltcOut` set through
  `PUT /api/timelines/:id` → `running: true, tc 00:05:06:12` at 306.5 s, silent on pause. Flag removed afterwards.
- Mistake caught on the way: the first commit of `timeline_ltc.gd` did not compile (`var on :=` on a Variant compare);
  the unit tests do not load that script, `run-client.sh --check` does — fixed in dd71b99a, `--check` boot OK.
- Not seen: the click in the owner's running GUI.
