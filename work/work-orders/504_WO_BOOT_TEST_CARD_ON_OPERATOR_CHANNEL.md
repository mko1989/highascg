# WO-504 — The boot test card lands on the operator-GUI channel and never leaves

**Status: DONE in repo (13.08.2026 — 4 smokes, suite 2069/2067/0, eslint 0, prettier clean, client rebuilt). NOT deployed — needs a `highascg` restart.**
**Priority:** Medium-High (every reboot, covers the operator UI)
**Source:** owner `todos13.08.26`: *"after reboot the operator ch starts with a test card on. then needs me to enable and disable the tick for that screen in test card setup for it to disapper. shouldnt happen at all."*
**Related:** [WO-243](./243_WO_OPERATOR_GUI_CHANNEL.md) (the operator-GUI channel), [WO-411](./411_WO_TEST_PATTERN_OUTPUT_LINE_AND_BUMP_BOX.md), [WO-492](./492_WO_AMCP_CLEAR_CHATTER_ON_CONNECT.md) §B (layer-999 module split)

## 1. Root cause

`src/bootstrap/startup-led-test-pattern.js` chose its targets with:

```js
function channelsForLedTestOutput(channels) {
	return channels.filter((c) => c.hasScreen || c.hasDecklinkOutput)
}
```

The operator-GUI channel is a CEF surface presented **through a screen consumer** (WO-243 — the web
UI over routed preview holes), so `hasScreen` is true for it and it received the boot
identification card on layer 999 exactly like a program output.

It then never came down. `tryClearStartupLedTestForWebUi` is a deliberate no-op:

```js
appCtx.log?.('info', `[Startup LED test] Skipping auto-clear on Web UI connection (manual toggle enabled).`)
```

That is correct for real outputs — the card must survive until an operator dismisses it — but on the
operator channel it means the card sits on top of the UI after every reboot until the owner ticks
and un-ticks that screen in test-card setup, which is what they were doing.

## 2. What was done

`channelsForLedTestOutput(channels, config)` now takes the config and skips
`getChannelMap(config).operatorGuiChannels`. Fail-open by design: with no config, or if the map
throws, nothing is excluded and the pre-WO-504 behaviour stands — a missing card on a real output is
worse than a stray one, and this runs during boot when config availability is exactly what is least
certain.

The auto-clear no-op is **left alone**. It is the owner's chosen behaviour for real outputs, and the
manual tick remains their way to put a card on the operator screen deliberately.

## 3. What was VERIFIED

`tools/smoke/smoke-wo504-no-boot-card-on-operator-channel.test.js` — 4 tests against the real
exported function:

- the operator channel (derived from `getChannelMap`, not hardcoded) is never selected — the
  regression guard, which fails on the old code;
- every other real output is still selected, expectation **derived** from the map so the test cannot
  pass by pinning a fixture-specific index;
- no config → nothing excluded (pre-WO-504 behaviour preserved);
- a config with no `operator_gui` destination excludes nothing.

Full gate **2069 tests, 2067 pass / 0 fail / 2 skip**; eslint 0 errors; prettier clean; 0 files over
500 lines.

**NOT verified:** the live reboot. That is the acceptance test and it needs §4.

## 4. Owner action

`kill -TERM $(systemctl show -p MainPID --value highascg)`, then reboot and confirm the operator
screen comes up clean while real outputs still show their identification card.

## 5. Work log

- 2026-08-13 — Opened, root-caused, fixed, 4 smokes.
