# WO-482 — the CG orphan sweep clears 90 hosts per channel whether or not anything is on them

**Status: DONE (11.08.2026, verified: new smoke 6/6 incl. a fixture checked against a live INFO
response, offline suite 1966/1964 pass/0 fail/2 skip)**

## 1. Investigation

Owner 11.08: *"i also saw in logs that enabling test card does a fucking blanket cg clear on 52
layers one by one WTF???"*

**Not the test card.** `POST /api/led-test-card` touches layer 999 only — one `CG CLEAR`, one
`CG ADD/PLAY/UPDATE`, a `MIXER FILL`, a `MIXER COMMIT`. What the owner saw shares a log window with
it because on that box Caspar was restart-looping, and the burst fires on **startup and every
Caspar reconnect** — as does the startup LED test card.

The burst is the WO-207 template-CG orphan sweep. Counted in the box's own Caspar log:

```
186 × CG N-N CLEAR      ← hosts 700-789 on two program channels
 14 × MIXER N-N CLEAR
  1 × CLEAR N
```

preceded by `BEGIN`, so it is **already batched** — 3 AMCP round-trips, not 186 (the comment in the
sweep records the earlier incident where it was not, ~90s of saturated AMCP per reconnect). But
Caspar logs every line inside the batch, which is what "one by one" looked like, and the owner's
underlying objection is right: it was clearing 90 hosts per channel **without ever asking whether
anything was on them**.

Nothing needed to be guessed. The connect gather has already run `INFO` on each channel, and
`parseLayerFgProducerTypesFromChannelXml` (`live-scene-reconcile.js:108`) turns that into
layer → producer type — the same source WO-268 uses to decide whether a quarantined host survived a
reconnect.

## 2. What was done

`sweepTemplateCgOrphansOnCasparConnected` now takes `channelXml` and, per channel, clears only hosts
in 700-789 that are **occupied and undeclared**. `caspar-info-ready.js` passes
`appCtx.gatheredInfo.channelXml`.

Fallback is deliberate and logged: a channel with no usable XML (INFO not gathered yet, parse
failure) still gets the full band swept. An orphan left on air is worse than a redundant clear, so
uncertainty fails toward sweeping.

On a clean channel this is **zero commands** instead of 90.

## 3. What was verified

- Live check, not just a fixture: `INFO 1` pulled over AMCP from highascg0916 and fed through the
  real parser. It returned **one** layer — `999=html`, the LED test card — and **nothing in
  700-789**. So on that box the sweep now emits 0 CLEARs where it previously emitted 186. It also
  showed that Caspar reports only layers that EXIST, so "absent" and "present but `empty`" both have
  to be treated as empty; the smoke pins both shapes.
- `tools/smoke/smoke-cg-orphan-sweep-occupied-only.test.js` (registered in the curated list) — 6/6:
  clean channel costs nothing, the real INFO shape costs nothing, a present-but-empty layer is
  skipped, an occupied host is still cleared, no-XML falls back to all 90, and the send stays a
  single `forceBatch` chunked call (the WO-259 property the old comment protects).
- Offline suite **1966 tests, 1964 pass, 0 fail, 2 skip**; eslint clean.

**Not verified live:** not deployed — that box is mid-incident. Owner QA: after a deploy, a
reconnect should log `cleared=0` on a box with no template CG on air.
