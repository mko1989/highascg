# WO-361 — Companion module: dev-mode workflow

**Status: OPEN** · Source: owner checklist note 27.07 (item 12): "the module needs work later.
it should also work in dev mode which would be easier to work on."

At pickup: make the HighAsCG Companion module runnable from a working tree (companion dev
modules path / `companion-module-dev` flow) instead of only via the packaged tgz install, so
module iteration doesn't need version-bump + repackage + reinstall each cycle. Document the
loop in the module repo README; keep the packaged path for the eggs image.
