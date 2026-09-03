# WO-559 — after taking a timeline look, it stayed on preview too, blocking the outgoing look

**Status: FIXED in repo (03.09.2026). 6 new smokes, 5 pre-existing tests across 3 files updated
(their assertions pinned the exact "both channels" behavior this WO deliberately changes — updated
comments and expectations, not weakened). Full offline suite 2394/2392/0/2, all green. Server
restarted and live. Owner QA owed.**
**Priority:** High — the last piece of today's timeline/look-switching chain (WO-546 through 558);
owner confirmed WO-558 as "almost perfect" with this as the one remaining gap.
**Source:** owner, confirming WO-558: *"YES! almost perfect. the only thing missing is that after
transitioning to a timeline look, the outgoing look needs to be called into preview. now the
timeline looks ends up both on pgm and prv."*
**Related:** [WO-549](./549_WO_PREVIEW_ONLY_TIMELINE_ROUTING.md) (established the "always both
channels" design this WO revises), [WO-553](./553_WO_LOOK_TIMELINE_OPACITY_FLASH.md) (the timeline
band sits above both look banks — the fact that makes this bug a visible block, not just a stray
routing flag), [WO-558](./558_WO_TICK_CACHE_CLEAR_HITS_PERSISTING_CHANNEL.md) (this morning's prior
fix, confirmed still correct and unaffected)

---

## 1. Investigation

`startSceneTimelineLayer` (`timeline-take.js`) routed with `preview: true` UNCONDITIONALLY on every
call, restricted or not — a deliberate WO-549 design choice ("the normal case of a single PGM/PRV
pair"). A normal look's own content never behaves this way: nothing in `buildTakeJobs` auto-routes
an incoming look's layers onto preview — only the separate pgm/prv flip-flop
(`previewExchangePromise` in `routes-scene-take.js`) explicitly puts the OUTGOING look there. A
timeline-containing look broke that symmetry: after a real take, the timeline stayed on `preview:
true` forever (nothing ever revoked it, matching the exact class of gap WO-555/558 fixed for OTHER
call sites), and since the timeline band sits above BOTH look banks (WO-553), it visually blocked
whatever the flip-flop placed underneath — the outgoing look was correctly there in the AMCP layers,
just invisible.

Confirms a design inconsistency already flagged by the codebase's OWN prior art:
`runTimelineDirectTake` — the Timeline Editor's own "Take" button, a separate direct-take path that
bypasses the look/scene system — already only ever claims `{ preview: false, program: true }`. It
never had this bug. `startSceneTimelineLayer` (the look-embedded-timeline path) was the one
remaining place still forcing both channels.

## 2. What was done

`timeline-take.js`, `startSceneTimelineLayer`: `preview` is now computed the same way `program`
already was (WO-555) — symmetric, not identical:
```js
const program = opts.restrictToPreview ? !!eng._sendToFor(tlId)?.program : true
const preview = !!opts.restrictToPreview
```
A restricted call (staging, preview-only, preview-exchange) still always claims preview — that
remains its entire purpose, unchanged. An unrestricted call (the real take) now claims program
ONLY, leaving preview free for `previewExchangePromise` to route the outgoing look there — matching
`runTimelineDirectTake` and matching how a normal look's content already behaves.

Given the full pgm/prv take sequence (staging → real take → preview-exchange, all same-`tlId`-aware
per WO-546/549/554/555/556/558), the real take's own `setSendTo` transition (`preview: true → false`)
is what revokes the staging call's brief preview claim — WO-555's differential stop (only removed
channels) means this cleanly clears just the timeline's own physical layers on the dropped preview
channel, leaving the flip-flop's concurrent write of the outgoing look's own (different) physical
layers on that same channel completely undisturbed.

## 3. What was VERIFIED

- `tools/smoke/smoke-wo559-timeline-take-leaves-preview-for-flipflop.test.js` — 6 tests: a fresh
  unrestricted call routes program-only; the full staging→real-take sequence ends with preview
  false (explicitly asserting the REVOKE, not just the end state); a restricted call is unaffected
  (still always claims preview); a regression test pinning the old unconditional-`true` formula;
  two source-level wiring pins (the new formula, and that it now matches
  `runTimelineDirectTake`'s pre-existing claim).
- Five pre-existing tests (in `smoke-wo549`, `smoke-wo554`, `smoke-wo555`, `smoke-wo556`,
  `smoke-wo558`) pinned the exact old "both channels" behavior this WO deliberately changes — their
  assertions and setup were updated to the new, intended behavior (not weakened): where a test's
  setup relied on an unrestricted call to establish a both-buses precondition it still needed to
  test (the release/flash/tick-cache tests in WO-556/558), that precondition is now established
  explicitly via a direct `setSendTo` call instead, so those tests keep testing what they always
  tested. `smoke-wo554`'s "every channel gets a PLAY line" test now correctly expects only program
  to get one, since preview is deliberately left unclaimed.
- Full offline suite: `node tools/ci/run-offline-tests.js` → 2394 tests, 2392 pass, 0 fail, 2 skip
  (pre-existing). Every prior timeline WO (546 through 558) still green.
- Server restarted, live. Live wire-capture re-verification (the technique WO-558 used to confirm
  its own fix before reporting done) is the next step this session.
