# WO-503 — The CG orphan sweep still swept blind on every reconnect; 180 CLEAR lines drowned the log

**Status: DONE in repo (13.08.2026 — 4 new smokes incl. a regression guard that fails on the blind
sweep; suite 2061/2059/0, eslint 0, prettier clean). NOT deployed — needs a `highascg` restart.**
**Priority:** Medium-High (the log is the diagnostic tool for everything else)
**Source:** owner 13.08, pasting hundreds of `CG 1-7xx CLEAR` / `CG 3-7xx CLEAR` lines at
13:36:00.143: *"this still happens … making checking logs imposible."*
**Related:** [WO-482](./482_WO_CG_ORPHAN_SWEEP_CLEARS_THE_WHOLE_BAND.md) (added the XML-aware path),
[WO-492](./492_WO_AMCP_CLEAR_CHATTER_ON_CONNECT.md) (declared the residual blind path fixed),
[WO-207](./207_WO_CG_ORPHAN_SWEEP.md) (the sweep itself).

---

## 1. Root cause — a snapshot read before it is filled

`src/bootstrap/caspar-info-ready.js:83` hands the sweep a **snapshot**:

```js
channelXml: appCtx.gatheredInfo?.channelXml || {},
```

`gatheredInfo.channelXml` is populated by `src/utils/periodic-sync.js:196-197,390`. On the
**connect** path the sweep is scheduled before periodic-sync has run, so the map is empty for every
channel. `template-cg-orphan-sweep.js` then takes its deliberate fallback:

```js
if (!types) sweptBlind++
for (let host = 700; host <= 789; host++) { … clearLines.push(`CG ${ch}-${host} CLEAR`) }
```

90 hosts × N program channels = **~180 `CG n-7xx CLEAR` lines on every startup and every Caspar
reconnect**, for layers that are almost always empty. Caspar logs every one at info level, and the
owner's log is unreadable for ~200 lines around each reconnect.

**WO-482 and WO-492 were not wrong, they were incomplete.** WO-482 added the XML-aware path and
WO-492 verified it silent — but WO-492's evidence was a *day's* tally on a box whose reconnects had
already happened, so it measured the steady state and not the connect race. The comment in the sweep
even asserts "the connect gather has already run INFO on each channel"; on this path it has not.

## 2. Fix — ask, do not guess

`src/engine/template-cg-orphan-sweep.js`: when a channel has no XML in the snapshot, fetch it:

```js
if (!types && amcp?.isConnected) {
    try {
        const info = await amcp.info(ch)
        const xmlNow = typeof info?.data === 'string' ? info.data : Array.isArray(info?.data) ? info.data.join('\n') : ''
        if (xmlNow.trim()) types = await parseLayerFgProducerTypesFromChannelXml(xmlNow)
    } catch { types = null }
}
```

**One `INFO <ch>` replaces 90 `CLEAR`s, and it is strictly more accurate than sweeping blind.**
Only a genuine INFO failure now reaches the fallback, which preserves WO-482's deliberate
fail-toward-sweeping (an orphan left on air is worse than a redundant clear).

Deliberately *not* done: removing the blind fallback, or fixing the population order in
`caspar-info-ready.js`. The fallback is correct as a last resort, and re-ordering the bootstrap to
guarantee the gather lands first is a larger change with more ways to go wrong than a one-call
lookup at the point of use.

## 3. What was VERIFIED

`tools/smoke/smoke-wo502-wo503-gpu-texture-and-blind-sweep.test.js` — 4 WO-503 tests against the
**real** sweep with an AMCP double:

- **the regression guard**: empty `channelXml` (the connect-path reality) must produce
  `INFO 1`, `INFO 3` and **zero** `CG n-7xx CLEAR` lines. This test fails on the old code.
- an occupied host (`layer_705` = html) is still cleared — and *only* that host, one line.
- a genuine INFO throw still emits all 90 CLEARs for that channel (WO-482 intent preserved).
- a channel whose XML is already in the snapshot causes **no** INFO round-trip.

Full offline gate **2061 tests, 2059 pass / 0 fail / 2 skip**; eslint 0 errors; prettier clean;
0 files over 500 lines.

**NOT verified:** the live effect. That needs the restart in §4 and one Caspar reconnect, after
which `grep -c 'CG .-7.. CLEAR'` on the day's caspar log should stop growing.

## 4. Owner action

`kill -TERM $(systemctl show -p MainPID --value highascg)` (systemd restarts it). Then trigger a
Caspar reconnect and confirm the band sweep is silent:

```bash
grep -c 'CG .-7[0-9][0-9] CLEAR' ~/highascg/log/caspar_$(date -u +%Y-%m-%d).log
```

## 5. Work log

- 2026-08-13 — Opened, root-caused to the snapshot/populate race on the connect path, fixed by
  fetching INFO at the point of use, 4 smokes incl. a guard that fails on the old behaviour.
