# WO-308 — Split "operator monitor" from "confine pointer to it"

**Status: DONE — 2026-07-21.**

Delivered per spec below. `evaluateOperatorPointerConfineDesire(config)` returns `{ desired,
reason }` (mirrors WO-290's evaluateMonitorPickerTrigger/formatTriggerLog split);
`isOperatorPointerConfineDesired` is now a thin boolean wrapper over it, so its contract at all
six existing call sites is untouched. UI control lives in Device View's GPU port inspector, next
to the "Operator monitor" checkbox it is about — the settings modal explicitly stopped hosting
this class of per-port-adjacent toggle on 2026-07-18, so it did not belong there.

Verified LIVE on this box (which has a real operator monitor configured, screen_3_operator_monitor):
posting `pointerConfine: 'off'` immediately stopped the running confine-pointer-barriers process
with journal line `[Pointer confine] SKIP — pointerConfine_off`; posting `'auto'` brought it back
with `RUN — operator_monitor_port_3`. Box restored to its normal 'auto' state afterward.

One thing caught while wiring the RUN log: the watchdog re-invokes startPointerConfine every 8s
while confine stays desired (a steady-state recheck, not a fresh decision) — an early draft logged
RUN on every one of those ticks. Moved the log to fire only past the "unchanged" early-return, so
it logs once per actual transition, not once per 8s forever. Guarded by its own test.

Gate: 1207 tests, 0 fail.

---

## Context
`screen_N_operator_monitor` currently implies pointer confinement:
isOperatorPointerConfineDesired() (x-display-session-layout.js:~234) returns true whenever a
flag port resolves. That coupling caused the 2026-07-21 lockout: a35c245 auto-set the flag from
cabling, which silently switched confinement on, and the stale-rect watchdog (fixed in e2ab1a8)
dragged the pointer off-screen. The flag is load-bearing for GUI placement, helper confinement
and the picker — confinement is a separate concern welded onto it.

## Task
- New setting `operatorTools.pointerConfine`: 'auto' (current behaviour, default) | 'on' | 'off'.
  'off' = operator monitor resolves for placement/helpers but no barriers ever start.
- pointer-confine.js isOperatorPointerConfineDesired consults it; settings UI checkbox next to
  the existing pointerConfineMultiview toggle.
- Journal one line on every decision (start/skip + why), mirroring the WO-290 verdict style.

## Acceptance
- Flag set + confine 'off' → GUI lands on the right monitor, zero confine-pointer-barriers
  processes, log says why.
- Default 'auto' behaviour byte-identical to today (existing smokes stay green).
