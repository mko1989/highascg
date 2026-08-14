# WO-540 — Channel 1 drifts to half rate at runtime, so every transition on it is torn down mid-fade

**Status: ROOT CAUSE PROVEN by measurement and intervention (§2–§4). The software consequence is fixable here (§6); the hardware trigger is the owner's call (§5).**
**Priority:** High — it is the answer to *"going back to a look from timeline does a cut instead of mix"*, and a channel at half rate is a playout-quality fault in its own right
**Source:** owner 14.08, answering [WO-537](./537_WO_TIMELINE_IN_A_LOOK_RESUMES_INSTEAD_OF_STARTING.md) §4's probe step 0: *"pgm1 channel 1 screen"*, plus *"the box is not on air now, you can do what you want"* — which is what made the measurements below possible.
**Related:** [WO-537](./537_WO_TIMELINE_IN_A_LOOK_RESUMES_INSTEAD_OF_STARTING.md) (part 2 — this closes it),
WO-406 (a 25-vs-50 mismatch that really did chop audio here), WO-447 (vsync), WO-407/444 (GL sync)

---

## 1. The reported symptom, reproduced on the wire

Timeline live on PGM ch1, then a look taken over it with a plain 25-frame MIX
(`POST /api/scene/take`, `forceCut:false`). What went out:

```
21:58:03.232  MIXER 1-210 OPACITY 0 25 linear DEFER     ← timeline fade-out, queued
21:58:03.232  MIXER 1-211 OPACITY 0 25 linear DEFER
21:58:03.232  MIXER 1-212 OPACITY 0 25 linear DEFER
21:58:03.453  MIXER 1 COMMIT                            ← fade starts here
21:58:03.454  MIXER 1-110 OPACITY 1 25 linear           ← look fades in
21:58:04.076  STOP 1-210                                ← +623 ms
21:58:04.082  STOP 1-211
21:58:04.129  STOP 1-212
```

Both ramps are issued. The teardown waits. On paper this is a correct crossfade — which is exactly
why reading the source could not find it (WO-537 §4 ruled out the obvious paths and stalled here).

**The wait is the bug, because 623 ms is not long enough.** Sampling the live mixer through the same
take shows the fade still running well past the STOP:

```
 t(ms)   1-210 (timeline)   1-110 (incoming look)
   244        1                  0        ← preset
   481        1                  0.12     ← ramps begin
   740      ~0.72               ~0.28     ← the STOPs land HERE
  1446        0                  1        ← the fade actually finishes
```

The producers are destroyed at roughly 62 % of the dissolve. **The mixer numbers keep counting down
afterwards** — `STOP` removes the producer, not the transform — which is why this is invisible to
anything that only reads opacity, and why it looks like a clean fade in the log.

## 2. Why 623 ms was wrong: channel 1 runs at half its declared rate

`fadeMs = (fadeDur / framerate) * 1000` with the **declared** framerate. Channel 1 declares 50:

```
INFO 1 → <format>6144x1536</format> <framerate>50</framerate> <framerate>1</framerate>
```

So 25 frames "is" 500 ms, teardown waits that plus a 3-frame margin ≈ 560 ms, and STOPs. But the
channel was ticking at 25, so 25 frames really needed **1000 ms**.

Measured directly, with no take machinery involved — set a layer's opacity to 0, ramp it to 1 over a
known frame count, time it:

| channel | mode | consumers | declared | 50 frames took | effective |
|---|---|---|---|---|---|
| **1** | 6144×1536 | screen + **decklink** | 50 | **2012 ms** | **24.9 fps** |
| 2 | 6144×1536 | *(none)* | 50 | 1033 ms | 48.4 fps |
| 3 | 1080p5000 | screen | 50 | 1019 ms | 49.1 fps |
| 4 | 1080p5000 | screen | 50 | 999 ms | 50.1 fps |
| 5 | 1080p5000 | *(none)* | 50 | 999 ms | 50.1 fps |

Exactly 2×, and it scales: 100 frames took 3996 ms. Not jitter, not load — a clean halving.

**Channel 2 is the control that matters.** Same 6144×1536 mode, same box, same moment — 48.4 fps. So
the resolution is not too big and the GPU is not the limit. Only channel 1 was slow.

That also explains why the owner sees this *"at least on ch1"*: screen 1 is ch3, which ticks
correctly, so its transitions are fine.

## 3. Proven by intervention

```
REMOVE 1 DECKLINK 1   → 202 REMOVE OK
ch1: 50 frames took 1006 ms  → 49.7 fps      (was 24.9)
```

One command, and the channel doubled. The DeckLink output consumer was pacing it.

## 4. But it is a RUNTIME DRIFT, not a configuration mismatch

The obvious conclusion from §3 — *"the 4K50 DeckLink output can't keep up, change the mode"* — is
**wrong**, and worth recording so nobody acts on it. Caspar was then restarted (killed; the `run.sh`
supervisor respawns it from the same XML), bringing the DeckLink consumer back exactly as configured:

```
22:07:26  DeckLink 8K Pro [1-1|2160p5000] && DeckLink 8K Pro [2|2160p5000]   ← restored
ch1: 50 frames took 1018 ms → 49.1 fps                                       ← and FAST
```

Same config, same consumer, full rate. So channel 1 does not start slow — **it degrades to half rate
at some point during a session**, and both re-initialising the consumer and restarting Caspar clear
it. That fits the owner's *"it seems slow"* and the intermittent, hard-to-pin quality of the reports.

**Prime suspect**, logged one line above the consumer's initialisation:

```
22:07:26.012  DeckLink 8K Pro [1-1|2160p5000] && DeckLink 8K Pro [2|2160p5000] Reference signal: not detected.
```

A 4K50 key+fill pair on devices 1+2 with no genlock reference. An output that free-runs against no
reference is a standard way to end up handing back one frame per two channel ticks. **Not proven** —
one observation of the degraded state, two of the healthy one — but it is where to look first, and
it is cheap to test (§5).

## 5. What the owner can settle

1. **Watch for the drift.** Re-run the measurement in §2 after a few hours of real use — the
   one-liner is `MIXER 1-900 OPACITY 0 0`, then `MIXER 1-900 OPACITY 1 50 linear`, and time how long
   `MIXER 1-900 OPACITY` takes to reach 1. 1000 ms = healthy, 2000 ms = degraded.
2. **Reference.** Is a genlock/blackburst feed meant to be present on the 8K Pro? If yes, it is not
   being detected. If no, does the drift still happen with the ch1 DeckLink output disabled for a
   session?
3. Until then, **restarting Caspar clears it** — worth knowing as a fallback if transitions start
   looking hard mid-show.

## 6. The software half — worth fixing regardless

Even with the hardware healthy, the take path trusts a number it does not check:

```js
const fadeMs = fadeDur > 0 ? (fadeDur / framerate) * 1000 : 0     // framerate = DECLARED
…
teardownWait = Math.max(0, fadeMs - (Date.now() - fadeClockStart))
await new Promise((r) => setTimeout(r, Math.ceil(teardownWait) + 5))
// then STOP / CLEAR the outgoing layers
```

If the channel is ever slower than it claims — for any reason, not just this one — the outgoing
content is destroyed mid-dissolve and the transition reads as a cut. The failure is silent and looks
correct in the log.

Options, smallest first:

**A. Widen the margin.** The existing `+3` frames is a jitter allowance, not a rate-error allowance.
Cheap, but it papers over a 2× error rather than surviving it.

**B. Wait on the observed value.** Poll the outgoing layer's `MIXER <ch>-<layer> OPACITY` until it
reaches 0 (bounded by a timeout of, say, 2 × fadeMs), then tear down. Correct by construction at any
tick rate, at the cost of a few AMCP round-trips per take. This is the one I would pick.

**C. Measure and cache the channel's effective rate** and feed the real number into `fadeMs`. Most
"correct", most machinery, and it needs a place to keep the measurement fresh.

Not implemented here: this is the live take path, WO-139 → WO-519 → WO-528 → WO-536 have each landed
a fix in it that needed another, and the choice between B and C is a design call rather than a
detail. With the hardware healthy the box is currently correct, so there is no rush to guess.

## 7. What this closes

[WO-537](./537_WO_TIMELINE_IN_A_LOOK_RESUMES_INSTEAD_OF_STARTING.md) part 2. Its §4 correctly ruled
out the decision logic, the DEFER ordering and the teardown's existence — the fade really is issued,
and the wait really does happen. What it could not see from source is that the wait is computed from
a framerate the channel was not honouring. §4b's collision guard (a look carrying the live timeline
queuing two ramps on one layer) stays a real, separate defect and remains fixed.

## 8. Work log

- 2026-08-14 — Owner answered probe step 0 (*"pgm1 channel 1 screen"*) and freed the box. Reproduced
  the take on the wire, sampled the live mixer through it, then measured every channel's effective
  tick rate: ch1 at exactly half, with ch2 on the identical mode as the control. `REMOVE 1 DECKLINK 1`
  doubled it; a Caspar restart with the consumer restored ALSO doubled it, which downgrades the
  static-config theory to a runtime drift and puts "Reference signal: not detected" at the top of the
  suspect list. Box restored and verified: 6 channels PLAYING, both DeckLink inputs up, Caspar
  connected.
