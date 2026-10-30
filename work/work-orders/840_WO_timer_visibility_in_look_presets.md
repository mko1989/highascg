# WO-840 — Timer visibility lives in look presets (per screen), not in looks

**Status: OPEN (30.10)**
**Source:** WO-806 G3; owner 30.10: *"timers should be saved in looks presets as they are per screen not per look."*
RULES.md "Timers" rule 1.
**Related:** WO-806 (G3), WO-210 (T210.8: the web look save stores `timersVisibility`), `src/engine/screen-timers.js`,
`src/api/routes-scene-look-preset.js`.

## 1. Investigation (start)

The web client stores `timersVisibility` on each look save, and taking that look shows or hides those timers. Godot
never ported it. The owner's rule: timers are per screen, so their visibility belongs to the look preset.
