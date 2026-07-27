# WO-348 — Shader Live: per-param revert, reset-all recovery, two-column layout

**Source:** todos27.07.26 — "i messed with some parameters and now it stopped displaying at all.
it needs a revert back to default next to each parameter. list the parameters in two columns,
the sliders dont have to be this long."

**Status: DONE 2026-07-27: pristine-copy per-param ↺ revert + Reset all (wholesale source restore, CG UPDATE every pass — the broken-shader recovery), two-column grid, sliders capped 160px.**

## Fix
1. On shader load keep a PRISTINE copy of every pass source. Each param row gets a ↺ button
   restoring that param's original values (span-rewrite + live CG UPDATE). Param identity =
   scan index against the pristine scan (stable: our edits only change literal values).
2. A `Reset all` button restores the pristine sources wholesale (CG UPDATE every changed pass) —
   the recovery path for a shader broken by extreme values.
3. Layout: params container becomes a 2-column grid; slider flex capped (~160px) so rows stay
   compact.

## Acceptance
Breaking a shader with wild values is recoverable per-param and wholesale without retaking the
look; params render in two columns with short sliders.
