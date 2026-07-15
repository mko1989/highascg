# WO-250 — Bank-aware playback timers (web UI "gibberish") + multiview progress bars restored

**Status:** OPEN
**Priority:** HIGH (both owner-reported, both display-side; NOT fixed by the pending service restart)
**Owner check:** A250.1

## Investigation findings (verified, file:line)

**Issue A — web-UI timers "fight between screens/layers":**
- Header PGM timer and scenes-rundown timer both use `mountPgmTopLayerPlaybackTimer` → `pickTopLayerStateForPlayback(channelState)` = highest layer number with file hints — `client/components/playback-timer.js:313-329` (hints test `:151-158`).
- Bank layers are distinct OSC keys (A: 10-99, B: 110-199; `src/osc/osc-state.js:114-131`) and stale layers linger up to 10 s (`_pruneStaleLayers` `src/osc/osc-state.js:322-339`, default `src/osc/osc-config.js:37`). After a take, the OLD bank's frozen layer (e.g. 110) outranks the live bank-A layer (10) in "highest wins", so the timer latches the stale clip, then snaps when pruned; the extrapolation clock re-seeds each flip (`playback-timer.js:369-370`) → jumping "gibberish".
- Secondary: `refresh()` re-resolves the channel per ingest including a switcher-bus remap `playback-timer.js:396-404` — a mid-transition bank-pointer change briefly points the widget at another channel.

**Issue B — MV progress bars gone:**
- Active template is `multiview_master.html` (canvas; `src/engine/multiview-layout-helper.js:204-228` prefers it; `multiview_overlay.js` is fallback).
- master draws the bar a full `rowStep` BELOW the label/time and separately gates `if (ty + 2 <= maxY)` (`template/multiview_master.html:473-488`, `maxY` at `:423`, `rowStep` at `:427`, loop `break` at `:433`) — with short docks or ≥2 rows the bar is clipped out while the digits survive. overlay.js keeps the bar inside the row (`template/multiview_overlay.js:354-364`) — a known master/overlay parity divergence class.
- Independent candidate: the new 2.6-dev binary may deliver `file/time` with duration 0/absent → `hasRuntime` false (`multiview_master.html:353-356`), which would also kill the digits. Frame→duration derivation pattern to copy: `src/state/playback-tracker-osc.js:131-138`.
- BOTH fixes are safe and correct regardless of which cause is active on the box — implement both.

## Tasks

**T250.1 — bank-aware top-layer pick** (`client/components/playback-timer.js`)
In `mountPgmTopLayerPlaybackTimer.refresh` / `pickTopLayerStateForPlayback` (`:313-418`):
- Resolve the active bank for the channel from state (`programLayerBankByChannel` — already read nearby at `:396-404`) and restrict the candidate layer range: bank 'a' → 10-99, bank 'b' → 110-199. PRV/bankless channels (no bank entry) → 10-99.
- Also skip layers whose OSC is stale relative to the snapshot clock — mirror `isStaleOscPlaybackLayer` from `template/multiview-playback-osc.js:24-29` (copy the logic client-side or import if reachable; templates aren't bundled with the client, so likely copy + comment the origin).
- Keep the function's signature/behavior for callers; timer band 980-989 and border 998 must remain excluded if they ever carry file hints (add the explicit exclusion — cheap insurance).

**T250.2 — MV master bar un-clipping** (`template/multiview_master.html` ONLY — do not touch overlay.js's working row layout, but keep visual parity in mind)
Draw the progress bar within the same row budget as its label/time (immediately under the time text at the SAME `ty` row, bar height included in `rowStep`), so a row that renders digits always renders its bar. Adjust `rowStep`/`maxY` math accordingly (`:423-491`). If the dock reserve needs +N px per row, adjust `chromeReserveForCellLayout` (`src/engine/multiview-layout-helper.js:157-174`) consistently — cite what you changed.

**T250.3 — duration fallback at the source** (`src/osc/osc-state.js:443-465`)
When `file/time` provides elapsed but duration is 0/absent, derive duration from the layer's `frameTotal/fps` when both are known (pattern: `src/state/playback-tracker-osc.js:131-138`). Guard against fps 0. Keep the WO-235 sanity clamp intact. Rollback-safe: when real duration is present, use it untouched.

**T250.4 — smoke** (`tools/smoke/smoke-wo250-timer-bank-mv-bars.test.js`, curated gate)
- pickTopLayerStateForPlayback (export or test via a thin harness): bank 'b' channel with stale L10 (bank A) + live L110 → picks 110; bank 'a' with lingering L110 → picks 10; timer band 985 excluded.
- osc-state duration fallback: elapsed present + duration 0 + frameTotal/fps known → derived; real duration wins when present; fps 0 → no crash, no derivation.
- Template parity assertion (static): both multiview_master.html and multiview_overlay.js contain a progress-bar render gated on the same duration condition (grep-level assertions, the established template-parity smoke style).

## Constraints (standard)
No git, no service ops, no AMCP, no HTTP to :4200/:5250, no vite build (orchestrator runs it for the client file), curated gate ONLY. node --check + eslint on touched JS; templates: validate master.html with a syntax pass (node --check on extracted script is not required — be careful, canvas math edits have broken MV before; keep the change minimal and show the before/after math in your report). Honest checkboxes.

- [x] T250.1 bank-aware + stale-aware timer pick (+ band exclusion)
- [x] T250.2 master bar inside the row budget
- [x] T250.3 duration fallback in osc-state
- [x] T250.4 smoke in gate
- [ ] A250.1 (owner) after deploy+restart+MV re-apply: timers stable across takes; bars visible on movie cells — NOT verified here (requires live box deploy/restart/MV re-apply, out of scope for this offline implementation pass; see constraints)
