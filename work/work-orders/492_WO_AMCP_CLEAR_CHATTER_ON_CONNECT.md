# WO-492 — AMCP CLEAR chatter on connect/start: what still fires and why

**Status: DONE (12.08 — investigation, then all three findings fixed on owner go-ahead; 9 new smokes, suite 1995/1993/0, eslint 0 errors) — NOT deployed: needs a `highascg` restart, owner's call on an on-air box**

Owner 12.08: *"investigate amcp chatter. the thing that most stands out to me is a cg clears on
multiple layers on connection or start. this shouldnt happen."*

Headline: **the 90-layer blanket sweep the owner remembers was already fixed on 11.08 by
[WO-482](./482_WO_CG_ORPHAN_SWEEP_CLEARS_THE_WHOLE_BAND.md) and now reports `cleared=0` on almost
every connect.** What is still on the wire is (1) a residual *blind* path in that same sweep, which
does still emit 90 clears per channel and even fires while AMCP is disconnected, and (2) an
unrelated, undocumented per-apply `CG n-999 CLEAR` burst that is the thing actually appearing in the
log all day.

## 1. Evidence

highascg does not log AMCP wire commands at info level; the wire truth is CasparCG's own log
(`log/caspar_2026-08-12.log` — every `Received message from 127.0.0.1` is highascg).

CLEAR-family tally for 12.08, one day, box mostly idle:

```
16 CG 1-999 CLEAR     13 MIXER 1-999 CLEAR    8 CLEAR 2
14 CG 3-999 CLEAR     11 MIXER 3-999 CLEAR    4 MIXER 4-10..14 / 5-10..14 CLEAR
 9 CG 2-999 CLEAR      9 MIXER 2-999 CLEAR    0 CG n-7xx CLEAR   ← band sweep silent
```

Orphan-sweep journal, full retained history (`journalctl -u highascg.service`). The before/after is
unambiguous — every pre-WO-482 connect swept the whole band, every post-fix connect with INFO XML
sweeps nothing:

```
Aug 06 15:56:46  [template-cg-orphan-sweep] ch=1   cleared=90 declared=0   ← pre-WO-482, ×6 that day
Aug 06 16:11:14  [template-cg-orphan-sweep] ch=1   cleared=90 declared=0
   … (every connect that day: cleared=90) …
Aug 10 13:40:14  [template-cg-orphan-sweep] ch=    cleared=0  declared=0
Aug 11 15:49:02  [template-cg-orphan-sweep] ch=    cleared=0  declared=0
Aug 11 15:50:00  [template-cg-orphan-sweep] ch=1,3 cleared=0 declared=0
Aug 11 15:53:42  [template-cg-orphan-sweep] ch=1,3 cleared=0 declared=0
Aug 11 15:54:13  [warn] [template-cg-orphan-sweep] clear batch failed: Not connected
Aug 11 15:54:13  [template-cg-orphan-sweep] ch=1,3 cleared=0   declared=0 (no INFO xml for 2 channel(s) — full band swept there)
Aug 11 15:54:41  [template-cg-orphan-sweep] ch=1,3 cleared=180 declared=0 (no INFO xml for 2 channel(s) — full band swept there)
Aug 11 15:55:30  [template-cg-orphan-sweep] ch=1,3 cleared=0 declared=0
Aug 12 10:31:04 / 10:35:06 / 11:26:05 / 11:29:27 / 11:37:10   all cleared=0
```

Two blind runs in the entire retained history, both inside one 30-second reconnect window on 11.08 —
so the residual in §2 is rare, but it is reachable and it is loud when it fires (180 clears).

So: WO-482's occupancy gate works (`cleared=0` everywhere it has data), and the two blind runs are
the exception — including one that tried to send **while AMCP was down**, and one that emitted
**180 `CG CLEAR`s** (90 hosts × 2 channels). Note 15:55:30, 49 s later, had XML and cleared nothing:
the blind sweep bought nothing that the next run would not have done correctly.

## 2. Finding A — the sweep's blind fallback (residual of WO-482)

`src/engine/template-cg-orphan-sweep.js:73-83`: the occupancy check is inside `if (types)`, so when
`types` is null the loop queues all 90 hosts for that channel:

```js
if (!types) sweptBlind++
for (let host = 700; host <= 789; host++) {
    if (declaredHosts.has(`${ch}-${host}`)) continue
    if (types) { const t = String(types[String(host)] || ''); if (!t || t === 'empty') continue }
    clearLines.push(`CG ${ch}-${host} CLEAR`)
}
```

Fed by `appCtx.gatheredInfo?.channelXml || {}` (`src/bootstrap/caspar-info-ready.js:82`), which is
empty when the connect gather has not populated yet — i.e. exactly on a fast reconnect.

**This is deliberate, and that matters.** WO-482 wrote the rationale into the code
(`template-cg-orphan-sweep.js:57-59`): *"Fallback is deliberate: with no XML for a channel (INFO not
gathered yet, parse failure) the old blanket sweep runs for that channel. An orphan left on air is
worse than a redundant clear, so uncertainty must fail toward sweeping."* That is a sound on-air
safety argument and **must not be silently reversed** — so the policy is untouched; only the
parts with no safety argument behind them were changed (see §7.1).

What is *not* covered by that argument, and is plainly wrong:

- It runs **while AMCP is not connected** (`clear batch failed: Not connected`). Blind-sweeping a
  dead socket cannot clear an orphan; it is pure noise.
- It does not **retry**. The evidence shows the very next run had XML. Sweeping blind immediately,
  rather than re-gathering INFO and sweeping accurately a moment later, is the noisy branch of a
  choice that has a quiet branch.

**Done (§7.1):** bail when `amcp` is not connected. The re-gather-INFO-before-falling-back idea was
NOT taken — it changes when the deliberate blind sweep runs, and the disconnected guard already
removes the observed noise.

## 3. Finding B — `CG n-999 CLEAR` on EVERY multiview apply (undocumented)

`src/engine/multiview-apply.js:172-186`:

```js
if (!ctx._ledTestPatternActive) {
    ... collect routed PGM/PRV channels from the layout's route:// cells ...
    await clearLedTestLayerOnChannels(ctx.amcp, [...routed], ctx.log?.bind(ctx))
}
```

`clearLedTestLayerOnChannels` (`src/bootstrap/startup-led-test-pattern.js:256-278`) issues
`CG ch-999 CLEAR` + `MIXER ch-999 CLEAR` + `MIXER ch COMMIT` per channel, **unconditionally — it
never checks whether anything is on 999.** `_ledTestPatternActive` false is the steady state, so this
runs on every apply, forever. Multiview apply runs at boot, on every reconnect
(`src/config/routing-setup.js:169-175` → `multiview-reapply.js`), and on every layout change.

Measured: at 10:36 the triple `CG 1-999 / CG 3-999 / CG 2-999 CLEAR` repeated **10 times in 50
seconds**, each preceded by `Multiview BG layer 10: color #000000 via CG ADD` — one per apply. This
is the bulk of today's 39 CG clears + 33 MIXER clears on a near-idle box, and it is what "a CG clear
on multiple layers on connection or start" looks like in the log.

**Recommended:** apply WO-482's own technique — gate on occupancy via
`parseLayerFgProducerTypesFromChannelXml` (WO-482's live check literally observed `999=html`), or
latch a per-channel "card was painted here" flag and clear once on the active→inactive edge instead
of on every apply. **Done (§7.2)** — occupancy gate plus a per-channel cache.

## 4. Finding C — the multiview "surgical CLEAR" is dead code

`src/engine/multiview-apply.js:201-222` computes a precise layer list, logs it as *surgical*, then
discards it:

```js
if (occupiedList != null) {
    for (const L of occupiedList) if (!needed.has(L)) layersToClear.push(L)
    if (layersToClear.length > 0) ctx.log('debug', `Multiview: surgical CLEAR on ch ${ch} layers ${layersToClear.join(', ')} ...`)
} else { ... ctx.log('debug', `Multiview: broad CLEAR on ch ${ch} ...`) }
if (layersToClear.length > 0) {
    ctx.log('debug', `Multiview: CLEAR ${ch} (was ${layersToClear.length} per-layer slot(s) in 10–60)`)
    await clearCasparChannel(ctx.amcp, ch, ctx)      // ← whole-channel CLEAR, both branches
}
```

`layersToClear` is only ever read for `.length` and for the log string. Both branches converge on
`clearCasparChannel`, a single whole-channel `CLEAR <ch>` (`src/engine/caspar-channel-clear.js:42-51`).
Not destructive — the multiview channel (ch 4 here) is entirely app-owned — but the debug line
**misreports what went on the wire**, which is how this kind of thing stays hidden.

**Done (§7.3):** emit per-layer clears for `layersToClear` in the `occupiedList != null`
branch (batched, as `scene-exit-layers.js:167-173` already does), keeping `clearCasparChannel` for
the no-XML fallback — or, at minimum, stop the log claiming "surgical".

## 5. Checked and NOT defects

- **`CLEAR 2` (8×)** — channel 2 is a PRV bus; whole-channel clear there is explicitly sanctioned
  (`caspar-channel-clear.js:7`, `scene-exit-layers.js:243-247`).
- **Startup card `CG n-999 CLEAR→ADD→PLAY→UPDATE` ×3 in 30 s at boot** — the deliberate CEF-warmup
  replay (`startup-led-test-pattern.js:231-234`, `replayDelays = [4000, 10000]`).
- **Operator-GUI route-hole hygiene** (`src/system/operator-gui-channel.js:200-213`) — `STOP` +
  `MIXER CLEAR` over a bounded, owned layer range. Observed: 5 FILLed at 10:35:54, same 5 cleared at
  10:35:57. Correct.
- **`REMOVE FAILED` flood (114 in one day, `src/audio/meter-null-consumer.js:89`)** — already
  classified as WO-415 reconcile noise by WO-468. Loud, not a defect.

## 6. Verification of this report

Findings A, B and C were each re-read in the live source by hand, and the journal and
`log/caspar_2026-08-12.log` tallies above were re-run directly rather than taken on trust.
No files were changed.

---

# 7. What was done (owner: "do those", 12.08)

All three findings fixed. The one thing deliberately **not** touched is WO-482's blind-fallback
*policy* (§2): with a live connection and no INFO XML it still sweeps the full band, because
"uncertainty fails toward sweeping" remains the right on-air call. Only the parts with no safety
argument behind them were changed.

## 7.1 Finding A — `src/engine/template-cg-orphan-sweep.js`

Early return when `amcp.isConnected === false`, before any line is built:

```js
if (amcp.isConnected === false) {
    log?.('debug', '[template-cg-orphan-sweep] skipped — AMCP not connected (the reconnect sweep will run it)')
    return { clearedCount: 0, declaredCount: 0 }
}
```

`=== false`, not falsy: the existing test doubles omit the getter entirely and must keep sweeping.
A sweep against a dead socket cannot clear an orphan — the reconnect that follows re-runs it with
INFO in hand, which is the run that does the work (proven by the 11.08 15:54:13 → 15:55:30 pair).

## 7.2 Finding B — new `src/bootstrap/led-test-layer-999.js`

`clearLedTestLayerOnChannelsIfPresent(ctx, amcp, channels, log)` probes layer 999 and skips channels
that are provably empty, caching the result per channel so the probe runs **once**, not once per
apply; `markLedTestLayerPainted(ctx)` drops the cache whenever the card is (re)painted (both the
initial paint and the CEF replay). `multiview-apply.js` now calls this instead of the unconditional
`clearLedTestLayerOnChannels`.

The probe uses `listOccupiedStageLayersInRange`, **not** `foregroundProducerOnLayer` — the latter
returns `null` for *both* "layer is empty" and "XML is unparseable" (its own doc warns against
reading that as absent), and that is exactly the distinction this gate turns on. `null` (unknown)
still falls through to clearing, so uncertainty fails toward clearing, same as WO-482.

Split into its own module because the additions pushed `startup-led-test-pattern.js` to 514 lines,
over the CI limit. `STARTUP_LED_TEST_LAYER` now lives in the new module and the old one imports it,
so the two cannot become circular.

## 7.3 Finding C — `src/engine/multiview-apply.js`

The `occupiedList != null` branch now actually emits what it computed —
`CG ch-L CLEAR` / `STOP ch-L` / `MIXER ch-L CLEAR` per stale layer via `batchSend` + one commit,
the same shape `scene-exit-layers.js:167-173` uses — and records a `playbackTracker.recordStop` per
cleared layer, because the whole-channel path used to drop the channel from the playback matrix and
per-layer clears would otherwise leave ghosts. `clearCasparChannel` is now only what it always
should have been: the fallback for when INFO could not be read (and a catch-fallback if the batch
throws). The "surgical CLEAR" debug line is finally true.

## 7.4 Verified

- `tools/smoke/smoke-wo492-amcp-clear-chatter.test.js` — **9 tests, all passing**, registered in the
  curated CI list:
  - **A** disconnected AMCP queues nothing; connected AMCP still emits all 90 lines (the guard is
    not a kill-switch); a double without the getter is unaffected.
  - **B** an empty 999 is probed once and never cleared, and stays silent over repeated applies
    (cache); an occupied 999 *is* cleared; a repaint re-probes; an unreadable INFO clears.
  - **C** with INFO only layers 30/31 get `CG`/`STOP`/`MIXER` clears and **no** whole-channel CLEAR
    fires, and a layer this apply needs (11) is not cleared; without INFO the whole-channel CLEAR
    still fires.
- Two real bugs in the first draft were caught by these tests before commit: the probe used
  `foregroundProducerOnLayer` (which cannot distinguish empty from unparseable, so every channel
  fell through to clearing), and the first test mock returned `{ text }` where
  `infoResponseToXml` reads `res.data`.
- Full offline gate → **1995 tests, 1993 pass / 0 fail / 2 skip** (was 1986/1984 — the 9 new tests,
  nothing regressed; `smoke-multiview-apply-lock` / `smoke-multiview-reapply` exercise the changed
  clear path and still pass). `check-max-file-lines` → 0 over 500. eslint → 0 errors (2 pre-existing
  unused-import warnings in `multiview-apply.js:19-20`, present in HEAD before this change).

**NOT deployed.** These are `src/**` changes, so they need
`kill -TERM $(systemctl show -p MainPID --value highascg)`. That drops AMCP and re-runs startup — an
owner call on a live box. The restart is also the natural QA for A: the reconnect is the exact path
that used to sweep blind, and `journalctl -u highascg.service | grep orphan-sweep` should keep
reading `cleared=0`, with no `CG n-999 CLEAR` triple following the multiview apply.
