# WO-831 — Dead code removal (sweep §6)

**Status: OPEN (30.10)**
**Source:** REPORT §6 and the per-batch DEAD findings. Owner 30.10: *"delete anything dead."*
**Related:** WO-807 (deprecated `src/sampling`), WO-495, WO-273.

Each row of §6 is re-proven dead by grep (client, src, godot, tools, scripts, CI, string-concat requires, npm scripts)
before deletion, and the offline suite runs after each row. Smoke-pinned text is live unless the pin only guards the dead
file itself, in which case the smoke goes too.

## 1. Investigation

See REPORT §6.
