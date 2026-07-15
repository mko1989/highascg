# WO-235 — New Caspar (2.6-dev r253c16c) protocol compatibility: OSC timers erratic, playback matrix empty, interactive-display 400

**Status:** Planned | **Date:** 2026-07-15 | **Priority:** CRITICAL (new binary is running on the dev box now)
**Source:** owner post-swap: "first there is something wrong with osc/variables parsing as the timers in main ui and on mv are freaking out." + "HTTP 400: No interactive operator display configured (multiview or screen consumer)"

## Evidence so far
- New tree emits `state_["file/time"] = {time()/format_desc_.fps, file_duration()/format_desc_.fps}` (src-tree src/modules/ffmpeg/producer/av_producer.cpp:990) — dividing by CHANNEL fps; old binary (Jan-2026 lineage) may have emitted seconds directly or per-file fps → scale/jitter mismatch in our [src/osc/osc-state.js:384-392](../../src/osc/osc-state.js) which consumes vals[0]/vals[1] as seconds.
- Live: `playback.matrix` in /api/state is EMPTY (0 cells) while media plays — OSC either not arriving on the expected port/format, address scheme changed (`/channel/N/...` vs `/ch/N/...` — our normalizer handles /ch/), or arg TYPES changed (int vs float, our Number() should cope) — needs a raw OSC capture.
- `HTTP 400 No interactive operator display` from [src/api/host-operator-fullscreen.js:133](../../src/api/host-operator-fullscreen.js) — read what it detects (INFO XML? config channels?) — the new server's INFO XML schema likely differs (2.6 restructured INFO in upstream; our INFO consumers: cef-interactive-cdp.js line ~49 parses <foreground> blocks, scene reconcile, etc.).

## Tasks
- [ ] T235.1 RAW OSC capture: small throwaway UDP dump (node dgram bind on a free port + temporarily?? NO config changes) — better: instrument-read src/osc listener (find where highascg receives OSC: src/osc/osc-lifecycle.js — add a TEMPORARY debug log? prefer: write a 20-line standalone decoder attached via the same mechanism if it supports multiple listeners; otherwise log-sample inside osc-state handlePacket behind an env flag HIGHASCG_OSC_TRACE=1 — the flag lands permanently, default off). Capture 5s of addresses+args while media plays; document exact paths/units.
- [ ] T235.2 Fix osc-state.js parsing for the new schema (keep backward compat with the old binary for rollback: detect format or accept both — e.g. if elapsed advances at ~1.0/s it is seconds; scale handling explicit). Timers on MV + main UI become correct (owner check).
- [ ] T235.3 Playback matrix: find why cells stopped populating (playback-tracker-osc.js paths vs new addresses; layer numbering/paths; foreground/background nesting) and fix.
- [ ] T235.4 INFO consumers: diff old-vs-new INFO XML live (`curl POST /api/raw INFO 1` NOW and compare against the parser expectations in host-operator-fullscreen.js's detection + cef-interactive-cdp.js + any scene reconcile INFO use). Fix the interactive-display detection 400 (this blocks Arm Input/Mario).
- [ ] T235.5 Smokes: osc-state unit tests with BOTH old-format and new-format sample packets; INFO fixture tests for the detection. Gate; vite build n/a unless client touched.
- [ ] A235.1 owner: timers correct everywhere; Arm Input works; matrix-driven UI (mixer strips/thumbs) live again.
