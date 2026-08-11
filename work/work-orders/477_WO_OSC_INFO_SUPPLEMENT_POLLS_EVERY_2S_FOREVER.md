# WO-477 — the OSC INFO supplement polls AMCP every 2s forever

**Status: DONE (11.08.2026, verified: new gate smoke 7/7, offline suite 1957/1955 pass/0 fail/2 skip)
— owner QA: watch the Caspar log on .28; INFO should appear only when a clip changes**

## 1. Investigation

Owner 11.08: *"there is also info amcp going every 2s. why? this was already established millions of
times to keep the amcp communication to minimum as to not spam it unnecessarily."*

The journal on .28 shows the pattern exactly — forever, two per cycle:

```
12:06:14 Received message from 127.0.0.1: INFO 1
12:06:14 Received message from 127.0.0.1: INFO 3
12:06:16 Received message from 127.0.0.1: INFO 1
12:06:16 Received message from 127.0.0.1: INFO 3
```

Channels 1 and 3 are that box's program channels.

**Source: the OSC INFO supplement, added by WO-252** (`src/utils/periodic-sync.js`,
`runOscPlaybackInfoSupplementOnce`). Its reason is real — the 2.6-dev binary omits `file/time` for
some clips over OSC, so timer bars had no duration — but its trigger was a **fixed heartbeat**:

- `resolveOscInfoSupplementMs()` → `osc_info_supplement_ms`, else `HIGHASCG_OSC_INFO_MS`, else
  **2000ms**, and this box sets neither.
- The only gate was `playbackTracker.isOscPlaybackActive(self)`, which is
  `!!(ctx && ctx.oscState && typeof ctx.oscState.getSnapshot === 'function')` — i.e. *"an OSC
  listener exists"*, **not** "something is playing". It is true from boot to shutdown.

So an idle box with OSC enabled sends two INFOs every two seconds, indefinitely. The
`[sync] periodic AMCP poll off (OSC listener active)` line in the log is a **different** timer
(`periodic_sync_interval_sec`) and is genuinely off — which is why this one hid in plain sight.

The duration this supplement exists to fetch is a property of the **clip**. Asking again two
seconds later, with the same clip on the same layer, cannot return anything new.

## 2. What was done

New `src/utils/periodic-sync-osc-info-gate.js` (a separate module — `periodic-sync.js` was at 487
of its 500 allowed lines):

- `oscClipSignatureForChannel()` — the clip/template/type per layer from the OSC aggregate, ignoring
  `time`/`frame`, so it changes exactly when the content does.
- `shouldSendOscInfoSupplement()` — opens only on a signature change, then allows
  `MAX_TRIES_PER_CLIP = 2` (one immediate, one retry for a Caspar that has not parsed the file yet).
  An empty channel is never polled at all, and clears its gate entry so a re-load asks again.
- `resetOscInfoSupplementGate()` runs from `clearOscPlaybackInfoSupplement()`, so a reconnect or
  teardown re-arms.

`runOscPlaybackInfoSupplementOnce()` filters its tick channel list through the gate. Everything
else — the in-flight guard, the 30s timeout backoff, the stagger, `osc_info_supplement_ms: 0` to
disable outright — is unchanged.

Cost per clip change: **2 INFOs on that channel.** Cost while a clip plays: **0.** Cost idle: **0.**
Previously: 30 INFOs per channel per minute, forever.

## 3. What was verified

- `tools/smoke/smoke-osc-info-supplement-gate.test.js` (registered in the curated `FILES` list) —
  7/7: idle never polls; 60 ticks of one clip cost exactly 2; a new clip reopens the gate; channels
  are independent; going empty shuts and re-arms it; the signature ignores timing noise; and the
  supplement is actually wired to the gate.
- Offline suite **1957 tests, 1955 pass, 0 fail, 2 skip**; eslint 0 errors; 0 files over 500 lines.

**Not verified live:** the fix is not deployed to .28 (that box is mid-incident). Owner QA: after a
deploy, `INFO n` should appear in the Caspar log only around a clip change.
