# WO-361 — Companion module: dev-mode workflow

**Status: DONE 2026-07-28 — Companion 5.0.2 already runs with `--extra-module-path /home/casparcg/companion-module-dev` (systemd override); `tools/eggs/companion/dev-mode.sh` symlinks the module's pkg/ output into that dir, README in the module repo documents the edit → `npm run package:dev` → `sudo systemctl restart companion` loop and the way back to the packaged install. (README edit lives in the module repo, uncommitted — commit it there.)** · Source: owner checklist note 27.07 (item 12): "the module needs work later.
it should also work in dev mode which would be easier to work on."

At pickup: make the HighAsCG Companion module runnable from a working tree (companion dev
modules path / `companion-module-dev` flow) instead of only via the packaged tgz install, so
module iteration doesn't need version-bump + repackage + reinstall each cycle. Document the
loop in the module repo README; keep the packaged path for the eggs image.
