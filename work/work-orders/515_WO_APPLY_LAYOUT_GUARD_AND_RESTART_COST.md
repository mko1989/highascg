# WO-515 — Apply now warns on impossible layouts; and where the long restart actually goes

**Status: DONE in repo (13.08.2026 — guard + restart cadence, suite 2127/2125/0, eslint 0, prettier clean, client rebuilt). NOT deployed.**
**Priority:** High (a silent Apply produced a black operator screen)
**Source:** owner 13.08: *"add the guard."* and *"check the long restart issue."*
**Related:** [WO-507](./507_WO_DECKLINK_OUTPUT_ON_AN_INPUT_CARD_RESTART_LOOP.md) (whose warnings were dead — §2), [WO-483](./483_WO_SCREEN_CONSUMER_PLACED_BY_OPENBOX_NOT_CONFIG.md), [WO-243](./243_WO_OPERATOR_GUI_CHANNEL.md)

## 1. What went wrong, measured on the dev box

Owner replicated the .37 config onto the dev box and *"lost the gui"*. Read off the running config
and `xrandr`:

```
desktop:  DP-0 0..1920 | DP-2 0..1920 | DP-4 1920..3840 | DP-6 3840..5760 (primary)  → 5760x1080
windows:  ch1 device 1  x 0..6144  y 0..1536  always-on-top=TRUE
          ch3 device 2  x 1920..3840
          ch4 device 1  x 3840..5760   ← the operator GUI, underneath ch1
```

A **6144x1536 always-on-top window on a 5760x1080 desktop**. Wider than the whole desktop, taller
than every output, pinned on top — it blanketed the operator GUI. The GUI was never lost, it was
covered. **Apply produced this silently**, which is the actual defect: the operator had a black
screen and nothing anywhere said why.

## 2. The guard

`src/config/screen-layout-guard.js`, called from the Apply plan (`device-view-apply.js`), reports:

- a screen consumer rectangle extending past the physical desktop;
- two screen consumers overlapping **on the same X device** (different devices have different
  coordinate spaces, so cross-device overlap is not reported);
- a screen or pixel-map tile bound to a DeckLink configured as an **input**;
- one DeckLink claimed by two targets.

**Warnings, not blockers.** Overlapping windows are a legitimate setup — the operator GUI sits under
a PGM hole by design (WO-243) — and a wrong geometry probe must not strand a box. The whole call is
inside a `try/catch`: a guard that throws must never break an Apply that would otherwise work. The
desktop extent comes from the saved layout plan, not a fresh `xrandr` fork on the request path
(WO-401 F6); when it is unknown the extent check is **skipped rather than guessed**.

**It also re-homes WO-507's warnings, which were dead code.** They were written to
`config.__generatorWarn` — a channel I invented and nothing ever set, so they never fired once. The
guard itself worked and the config came out correct, but a dropped SDI output with no explanation is
precisely the silent-config failure the guard exists to prevent. Same computation, real channel, and
the dead hook is deleted.

## 3. The long restart — where the time actually goes

Measured from source, not guessed:

| cost | value | where |
|---|---|---|
| AMCP reconnect poll | **5000 ms fixed** | `node_modules/casparcg-connection/dist/connection.js:188` — `_triggerReconnect` sets a single 5 s timer and only re-arms if still disconnected. **There is no fast first retry**: even if Caspar is back in 1 s, nothing reconnects for 5 s. |
| AMCP settle before `VERSION` | 600 ms | `HIGHASCG_AMCP_CONNECT_SETTLE_MS`, `connection-manager.js:49` |
| screen placement | **1500 + 4000 ms** | `caspar-info-ready.js:55` — sleeps then re-checks, breaking early only when `res.missing === 0` |
| watchdog nudge floor | 15 s (5 s poll) | `caspar-amcp-watchdog.js:66` `clientNudgeMs` — a backstop, not the primary path |
| post-connect serial work | unmeasured | INFO per channel, routing setup, meter consumers, CG orphan sweep, multiview re-apply, screen timers — all on the connect path |

So a Caspar restart costs **~5 s of deliberate nothing before the first reconnect attempt**, plus up
to **5.5 s** of placement sleeps, before any of the post-connect work starts.

**Changed (WO-516) — see §3b. What follows was the reasoning before that.**

**Originally left alone:** The obvious win — attempt immediately, then back off to 5 s — lives in
`node_modules`, so it needs either a `ConnectionManager`-level early nudge or a vendor patch, and the
placement sleeps exist to let X settle (WO-483's territory) so shortening them blind risks
mis-placed windows. Both want a measurement of the real end-to-end restart on the box first, which
needs the owner's hardware and a stopwatch, not more source reading.

**Cheapest safe candidate for next session:** have `ConnectionManager` fire one immediate reconnect
attempt when the AMCP port is observed listening, instead of waiting out the library's 5 s timer —
the watchdog already knows how to detect exactly that (`isAmcpPortListening`), it just does not act
until 15 s.

## 3b. WO-516 — what was actually changed

Owner: *"do the fixes."* Two cadence defaults, no vendor patch:

- **`clientNudgeMs` 15 000 → 1 000.** 15 s was a backstop from when this only caught a *hung* Caspar.
  It was also the floor on recovering from an **ordinary** restart — which happens on every Apply — so
  the operator waited 15 s+ for the UI to return after a routine config change. Once the AMCP port is
  listening again, waiting buys nothing.
- **Adaptive poll: 5 s healthy, 500 ms while down** (`HIGHASCG_AMCP_WATCHDOG_DOWN_POLL_MS`). The loop
  is now self-scheduling rather than `setInterval`, choosing its next delay from the tick result. A
  fixed 5 s interval meant a restart cost up to a full poll before we even *looked*, on top of the
  library's own 5 s timer.

WO-398's fork-loop lesson is respected: `isAmcpPortListening` forks `ss`, so a permanent 500 ms poll
would be ~170k forks/day. The fast cadence exists **only** while disconnected; healthy steady state is
unchanged at 5 s.

The library's hardcoded 5 s reconnect timer is still there and still untouched — the nudge now
overtakes it rather than waiting for it. That is the whole win, and it needs no vendor patch.

**Still not done:** shortening the 1500+4000 ms screen-placement sleeps. They exist to let X settle
(WO-483) and shortening them blind risks mis-placed windows; that one wants an on-box measurement.

## 4. What was VERIFIED

`tools/smoke/smoke-wo515-apply-layout-guard.test.js` — 11 tests: the dev box's exact geometry
reproduced (desktop overrun + same-device overlap both reported), cross-device overlap NOT reported,
unknown desktop skips the check, a fitting layout warns about nothing, input-bound DeckLink reported,
one card claimed twice reported, a sane layout silent, the guard is wired into the plan and cannot
block or throw an Apply, and `__generatorWarn` is gone.

Gate **2123 tests, 2121 pass / 0 fail / 2 skip**; eslint 0; prettier clean; 0 files over 500.

**NOT verified:** the warnings on the glass. They reach the Apply plan's `warnings` array; whether
the Device View surfaces that array prominently enough for the operator to notice is owner QA.

## 5. Work log

- 2026-08-13 — Guard written and wired; WO-507's dead warning channel found and re-homed; restart
  cost measured from source and left unchanged pending an on-box measurement.
