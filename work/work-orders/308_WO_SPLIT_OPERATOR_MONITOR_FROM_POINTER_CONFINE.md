# WO-308 — Split "operator monitor" from "confine pointer to it"

**Status: OPEN** (offered to owner twice in todos21.07.26; no decision yet — build behind a setting)

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
