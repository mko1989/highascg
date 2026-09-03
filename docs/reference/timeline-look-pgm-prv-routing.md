# Timeline-in-a-look PGM/PRV routing — how to get it right

Fixed across a 14-work-order chain in one day (WO-546 through WO-559, 02–03.09.2026), each one
finding a bug the previous fix had left behind. This document is the distilled rule set — read it
BEFORE touching anything in `timeline-take.js`, `timeline-playback-runtime.js`,
`scene-take-lbg.js`, `scene-take-lbg-timeline-guard.js`, or the pgm/prv block in
`routes-scene-take.js`. Getting any one of these five rules wrong reproduces a bug this chain
already found, fixed, and wire-verified.

See also [amcp-pgm-look-take-pipeline.md](./amcp-pgm-look-take-pipeline.md) (the general look-take
command order — this document only covers what's different when a layer's source is a timeline).

## The shape of the problem

A normal look's layers are dumb: `buildTakeJobs` writes them to whatever physical channel this
particular `runSceneTakeLbg` call targets, and nothing else ever touches them. A timeline is not
dumb — it is a single, engine-owned, **global** object (`TimelineEngine`, one instance per server)
that can be simultaneously routed to a program channel, a preview channel, both, or neither, and
that keeps *ticking* on its own independent timer the whole time it's live, regardless of what
takes are or aren't in flight.

A single PGM/PRV take of a look is not one `runSceneTakeLbg` call — it's three, run concurrently on
purpose (`routes-scene-take.js`):

1. **staging** — stages the incoming look on the PRV bus first, so the operator sees it appear
   there immediately.
2. **pgmTakePromise** — the real, unrestricted take, onto the actual program channel.
3. **previewExchangePromise** — flips the *previous* PGM look onto PRV, for operator reference.

They cannot be serialized (that reintroduces WO-150 B150.1 — see the comments at the call site).
Every one of these three calls can independently reach `startSceneTimelineLayer` for the exact same
timeline `id` whenever that timeline is part of either the incoming or the outgoing scene. That's
the whole problem: three call sites, one shared mutable object, all firing within milliseconds of
each other.

## The five rules

### 1. Routing (`sendTo.program` / `sendTo.preview`) is symmetric with how a normal look behaves

A normal look's own content never auto-claims preview — only the flip-flop
(`previewExchangePromise`) explicitly puts something there. A timeline must follow the identical
rule:

- An **unrestricted** call (the real take) claims **program only**. Never preview — preview is left
  for the flip-flop to route the outgoing look there. (WO-559)
- A **restricted** call (`restrictToPreview: true` — staging, the standalone preview-only path,
  preview-exchange) claims **preview only**, and must **preserve** whatever program claim already
  exists rather than overwriting it — it has authority to *add* a preview claim, never to *remove*
  an existing program one. (WO-555)

```js
// timeline-take.js, startSceneTimelineLayer
const program = opts.restrictToPreview ? !!eng._sendToFor(tlId)?.program : true
const preview = !!opts.restrictToPreview
eng.setSendTo({ preview, program, screenIdx: opts.screenIdx }, tlId, { skipAmcpApply: true })
```

`runTimelineDirectTake` (the Timeline Editor's own "Take" button, a separate direct-take path) has
followed this shape from the start — if you're adding a new call site, copy that one, not history.

### 2. A call whose job is reference/bookkeeping must never call `eng.play()`

`startSceneTimelineLayer` unconditionally called `eng.play(id, pos, { restart: true })` regardless
of which of the three call sites invoked it. That's correct for the call that's actually supposed
to start this timeline (the real take) — and wrong for a caller that's just making sure routing is
correct for a timeline that's already correctly playing, or already correctly stopped:

- **Staging**, followed moments later by the real take for the *same* `tlId`: the real take's own
  `play()` supersedes it — a second `play()` here is a genuine duplicate restart on the wire.
  (WO-554)
- **Preview-exchange**, when the *outgoing* look also contained a timeline: that timeline is either
  mid exit-fade or already stopped — never something this call should be starting. (WO-556)

Both cases pass `deferPlay: true` (threaded as `deferTimelinePlay` through
`buildTakeJobs`/`runSceneTakeLbg`/`routes-scene-take.js`). With it set, `startSceneTimelineLayer`
returns right after the routing call, never touching playback:

```js
if (opts.deferPlay) return []
```

If you add a fourth call site that reaches a timeline it doesn't intend to start or restart, it
needs this flag too.

### 3. Any `setSendTo` call that changes routing without an immediate reapply must pass `skipAmcpApply: true`

`TimelineEngine.setSendTo`, when NOT told to skip, fires its own unprotected, instant, un-faded
reapply of the clip's raw mixer state (`_applyAt(force: true)`, no `takeFade`) — full FILL /
OPACITY / VOLUME / effects-neutral reset. If this races ahead of the caller's own preset-then-fade
sequence, it's a literal flash of full opacity for one AMCP round-trip. (WO-553, WO-556)

Every routing-only `setSendTo` call in this codebase passes `{ skipAmcpApply: true }`. If you write
a new one, it does too — unless you specifically want the instant reapply (rare; you'd know).

### 4. `setSendTo`'s bookkeeping must only ever touch the channels actually being ADDED or REMOVED

Two failure classes here, both from the same root cause: `_prevKey` / `_lastKfValues` /
`_lastKfSegment` are **shared** maps keyed `${channel}-${caspLayer}[...]` — not one map per channel.

- **STOP.** On a routing change, only STOP the physical layers on channels being *removed*
  (`oldCh.filter(c => !newCh.includes(c))`) — never every channel in the old routing. A channel
  present in both the old and new routing is not being removed, and stopping it anyway is a direct,
  unprotected kill of live output on a channel nothing was supposed to touch. This is exactly how a
  plain preview action could take program off the air. (WO-555)
- **Cache invalidation.** When you do clear cached transport/mixer state after a routing change,
  clear it *only* for the channels being removed, filtering by the channel segment of each cache
  key. Wiping the whole map also drops the still-valid state for a channel that wasn't touched — and
  the next **independent** regular tick (`_tick()`, an unrelated `setInterval` firing every
  `TICK_MS`, NOT triggered by your call) reads the missing entry as "transport never started" and
  force-restarts that untouched channel, full mixer reset included. This is the subtlest bug in the
  whole chain: it doesn't happen in the call that changed routing, it happens **on the next
  unrelated timer tick**, ~1-40ms later. (WO-558 — found only by reproducing live with a running
  wire capture; every unit test up to that point asserted on the synchronous call and never advanced
  a tick, so the whole suite was blind to it.)

```js
const removedCh = oldCh.filter((c) => !newCh.includes(c))
// STOP only removedCh's physical layers.
// Then, if removedCh.length: delete only cache entries whose key starts with a removed channel.
```

### 5. `resolveActiveTimelineIdToFadeOut`'s "protect program" guard needs a release-from-preview companion

A preview-scoped call correctly declining to fade/stop a timeline that's still legitimately on
program (`previewOnlyCall && pbNow.sendTo.program`) must not also mean the timeline's PREVIEW claim
is never released. If the operator then previews a *different*, timeline-free look, nothing else
will ever touch that old timeline's routing (only a timeline layer *present in the incoming scene*
reaches `startSceneTimelineLayer` at all) — it renders on preview forever, until a manual whole-
channel clear. `resolveTimelineIdToReleaseFromPreview` (`scene-take-lbg-timeline-guard.js`) is the
companion: when a preview-scoped call's own incoming content doesn't want a timeline that's
currently on both buses, release just the preview claim (`setSendTo({preview:false, program:true},
id, {skipAmcpApply:true})`) — safe only because of rule 4's differential stop. (WO-555 Bug B)

## Debugging checklist

If a report in this area shows up again:

1. **Reproduce live with a running wire capture first** (`log/caspar_<date>.log`, tail it while you
   click through the repro on the real box). Every fix in this chain that skipped this step and
   shipped from a unit test alone turned out to have missed something a live capture would have
   shown immediately (WO-555 → WO-556 → WO-558, three rounds in one morning). The capture format is
   `[timestamp] Received message from 127.0.0.1: <AMCP command>`.
2. Identify which of the three concurrent call sites (staging / pgmTakePromise / previewExchange)
   is producing the unwanted line, by channel number and by whether the command targets a normal
   look's physical layer (1-99 / 110-199) or the timeline's band (`210+`, WO-553).
3. Check the five rules above in order — in practice every bug so far was exactly one of these five
   rules not yet applied to one particular call site.
4. Grep `work/work-orders/` for `WO-546` through `WO-559`, in order — each one's Investigation
   section has the exact wire evidence and reasoning for its piece of this.

## The chain, for context

WO-546 (concurrent staging call kills a legitimate concurrent take) → WO-548 (retaking the identical
look kills itself) → WO-549 (preview-exchange re-takes an old timeline onto program) → WO-550
(preview-only call kills a program-live timeline) → WO-551/552 (client-side stray stop call — the
one bug in this chain that wasn't in this routing code at all) → WO-553 (opacity flash + double-ramp
cut) → WO-554 (duplicate PLAY, `deferPlay` introduced) → WO-555 (preview action could take program
off air; differential stop introduced) → WO-556 (WO-555's own fix flashed program; `deferPlay`
extended to preview-exchange) → WO-558 (WO-555's cache clear corrupted the next tick) → WO-559
(timeline squatted on preview after every take, blocking the flip-flop).
