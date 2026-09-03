# WO-555 — previewing a timeline look could take PROGRAM off the air; PRV never let go of an old timeline

**Status: FIXED in repo (03.09.2026), two bugs. 12 new smokes (regression-proven by reverting the
fix and confirming the load-bearing tests fail — see §3). Full offline suite 2377/2375/0/2, all
green (including every prior WO-546..554 timeline test). Server restarted and live. Owner QA
still owed. Issue 3 (no clean mix, still reported) and the header warning-triangle question are
NOT resolved by this WO — see §5.**
**Priority:** Critical — a routine preview click could silently take program off the air.
**Source:** `work/work-orders/todos02.09.26`, owner live QA of WO-554 the same morning (03.09):
1. *"the preview is blocked on the timeline look after playing it. so the pgm and prv show the
   same thing until i specificaly click empty space to clear the prv. clicking other looks doesnt
   have an effect."*
2. *"when the timeline look is playing and i click it to prv it, it changes to another random look
   on pgm!!!! very bad."*

**Related:** [WO-546](./546_WO_PREVIEW_EXCHANGE_KILLS_CONCURRENT_TIMELINE_TAKE.md),
[WO-549](./549_WO_PREVIEW_ONLY_TIMELINE_ROUTING.md),
[WO-550](./550_WO_PREVIEW_ONLY_CALL_NEVER_KILLS_PROGRAM.md) (this WO's Bug A is the mechanism WO-550
was one step short of — it stopped a preview call from *deciding* to tear a program-live timeline
down, but the routing call underneath it could still do so as an unguarded side effect),
[WO-554](./554_WO_TIMELINE_LOOK_DOUBLE_PLAY_AND_STUCK_PRV.md) (this morning's prior fix; found
during its own live QA)

---

## 1. Investigation

### Bug A (report 2) — previewing a live timeline's own look stops PROGRAM

`startSceneTimelineLayer` (`timeline-take.js`) computed routing unconditionally:
```js
eng.setSendTo({ preview: true, program: !opts.restrictToPreview, screenIdx }, tlId, { skipAmcpApply: true })
```
Clicking to preview a look goes through `routes-scene-take.js`'s `previewOnly` path, which sets
`restrictTimelineToPreview: true` — correct when the look's timeline is new, wrong when it is the
EXACT timeline already live on program: this forces `program: false` on a timeline that is
genuinely still supposed to be there.

`TimelineEngine.setSendTo` reacts to any routing change on the current air timeline (`routingChanged`)
by STOPping every physical layer on the OLD channel list, unconditionally:
```js
for (const ch of oldCh) { ...amcp.stop(ch, caspLayer)... }
```
`oldCh` was `{preview:true, program:true}`'s two channels. A preview click that only meant to
affect preview genuinely, directly issued `STOP` to program's own physical layers. The timeline
sits above both look banks (WO-553), so stopping it revealed whatever was still sitting underneath
— read by the owner as "changes to another random look on pgm".

### Bug B (report 1) — PRV never reclaimed after the operator moves to a different look

`resolveActiveTimelineIdToFadeOut`'s WO-550 guard (`scene-take-lbg-timeline-guard.js`) protects a
program-live timeline from a preview-scoped call's teardown by returning `null` — doing nothing.
But "nothing" also means the timeline's PREVIEW claim is never released when the operator instead
previews a DIFFERENT, timeline-free look: `startSceneTimelineLayer` only runs for a timeline that
IS part of the incoming scene, and a look with no timeline layer never reaches it. The old
timeline's `sendTo` therefore never changes — it keeps rendering on preview indefinitely. Only the
owner's manual "clear PRV" (click empty deck-header space, WO-342) fixes it, because that path uses
a blunt whole-channel `CLEAR` (`scene-exit-layers.js` line ~243: *"one CLEAR wipes looks, timeline
(200+), and CG"*) instead of the normal orphan-layer sweep, which deliberately excludes the timeline
band (`isLookPhysicalLayer` only covers 1-99/110-199, `scene-exit-layers.js`).

## 2. What was done

Three changes, in dependency order:

1. **`timeline-playback-runtime.js`, `setSendTo`** — the routing-change STOP now only targets
   channels being REMOVED (`oldCh.filter(c => !newCh.includes(c))`), never a channel present in
   both the old and new routing. This is the foundational fix: it makes it safe to shrink a
   timeline's routing (drop program, or drop preview) without silently killing output on a channel
   that is still wanted. Previously "stop everything in `oldCh`, then reapply to `newCh`" only
   self-healed for a caller that also reapplies — every caller in this codebase that touches a
   timeline already on air passes `skipAmcpApply: true` (WO-553), so the reapply never ran and a
   persisting channel was left stopped with nothing to restart it.
2. **`timeline-take.js`, `startSceneTimelineLayer`** — a preview-restricted call now preserves
   whatever `program` claim already exists (`opts.restrictToPreview ? !!eng._sendToFor(tlId)?.program
   : true`) instead of unconditionally overwriting it to `false`. It can only ADD a preview claim,
   never remove an existing program one. Fixes Bug A directly (no more `program: true → false`
   transition on a preview click), and change 1 above means even if it did change, program's
   physical layers would now be safe regardless.
3. **`scene-take-lbg-timeline-guard.js`** (new `resolveTimelineIdToReleaseFromPreview`) +
   **`scene-take-lbg.js`** wiring — when a preview-scoped call's own incoming content does not want
   a timeline that is currently on BOTH buses, release just its PREVIEW claim:
   `self.timelineEngine.setSendTo({ preview: false, program: true, screenIdx }, releaseId)`. Safe
   only because of change 1: dropping preview here can no longer reach program's physical layers,
   since program is present in both the old and new channel sets.

## 3. What was VERIFIED

- `tools/smoke/smoke-wo555-timeline-preview-routing-corruption.test.js` — 12 tests across 4
  `describe` blocks: the engine's differential-stop behavior (direct `TimelineEngine` + mock AMCP,
  asserting the persisting channel is never in the stop list), `startSceneTimelineLayer`'s
  program-preservation (both the "already on program" and "genuinely new" cases, the latter pinning
  WO-549's original behavior is unchanged), `resolveTimelineIdToReleaseFromPreview`'s four decision
  branches, and source-level pins for all three wiring points.
- **Reverted both engine files** (`git checkout --`) and reran the suite: the differential-stop
  test, the program-preservation test, and both `wired end-to-end` source-pin tests for those files
  failed cleanly (confirmed a real diff against a passing baseline, not a tautology) — then restored
  the fix via the saved patch and reran clean.
- Full offline suite: `node tools/ci/run-offline-tests.js` → 2377 tests, 2375 pass, 0 fail, 2 skip
  (the 2 skips are pre-existing, CI-only). Every prior timeline WO (546, 548, 549, 550, 551/552,
  553, 553b, 554) still passes — no regression in the existing routing/fade-out protections.
- Server restarted (`kill -TERM $(systemctl show -p MainPID --value highascg)`) — live on the box.

## 4. What was NOT done

- Live AMCP wire capture during an actual reproduction on the box — the mechanism is confirmed at
  the engine-unit level (real `TimelineEngine`, mocked AMCP transport) but not cross-checked against
  a live `log/caspar_*.log` capture the way WO-546/551/553 did. Owner QA on real PGM/PRV is the next
  verification step.

## 5. What remains open (NOT fixed by this WO)

- **Report 3, "no clean mix" when switching away from a timeline look**, is unaddressed here. It
  may be a downstream consequence of Bug A/B's routing corruption (a take running against an
  already-corrupted `sendTo`/`_airTimelineId` could plausibly make `resolveActiveTimelineIdToFadeOut`
  compute the wrong exit-fade for the REAL take too) rather than an independent third defect — worth
  re-testing after this fix before opening a new investigation from scratch.
- **The header warning-triangle** ("in the gui there is also in top left corner a warning triangle
  that sends the timeline to prv. what the hell is that for??!!") — confirmed to exist by screenshot
  (appears near the app logo, top-left, correlated with a timeline being live) but its exact source
  file, trigger condition, and click behavior were NOT identified: it is not `.header__title`'s own
  children, not caught by a `MutationObserver` watching `document.body`, not caught by polling
  `elementFromPoint` at its screen position, and the literal `⚠` glyph does not appear anywhere in
  the built client bundle at all three of its actual occurrences (all elsewhere, unrelated). Likely
  either extremely transient (sub-poll-interval) or rendered with `pointer-events: none` in a way
  that also evades `elementFromPoint`. Needs the owner to reproduce it live with devtools open, or a
  precise description of the control that's clicked right before it appears.
