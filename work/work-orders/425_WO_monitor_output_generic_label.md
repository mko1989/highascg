# WO-425 — Monitor audio output is a plain "Audio 2" + Monitor tickbox, and fresh systems ship no audio outputs

**Status: DONE (2026-08-04 — relabeled + live-verified via /api/settings; factory config proven clean functionally; smoke green; suite 1826/0/2)**

Owner: "i dont like that the second audio output (the monitor one) is called usb audio
headphones. it should be audio 1 or 2 and the tickbox with the monitor bus enabled. also it
shouldn't be already in the default project."

## Investigation

"USB headphones" was never a code default — zero hits in `src/`. It lived only in THIS box's
config (`config/audio_outputs.json` id `audio_monitor_usb` + the matching `device_graph.json`
connector), written back in the WO-406 era and re-committed with the post-produce baseline.
The audio-output inspector (`device-view-inspector-audio.js`) already works exactly as asked:
free-text label + the WO-406 "Monitor / headphone bus" checkbox (`role: 'monitor'`), and
`monitor-bus.js` resolves purely by role — never by id or label.

Fresh systems: verified FUNCTIONALLY that `buildFactoryModularConfig()` (what
`write-iso-default-config.js` writes before every produce) emits NO `audioOutputs` key and no
monitor role anywhere — a new install starts with zero audio outputs; the user adds "Audio N"
outputs and ticks Monitor on one.

## What was done

Box config only: both labels `USB headphones` → `Audio 2` (ids kept — nothing references
them, but renaming ids buys nothing). Role/device (`system-audio` / `sc60mon`) untouched, so
the monitor bus resolves identically (verified via `resolveMonitorBus` before restart and
`/api/settings` after).

## What was VERIFIED

- Live after restart: `/api/settings` carries `"label": "Audio 2"`; monitor bus unchanged.
- Smoke (`smoke-wo425-427-audio-fps-decklink.test.js`): no "USB headphones" in config, the
  monitor-role entry matches `Audio N`, and the factory config ships zero audio outputs.
