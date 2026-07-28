# WO-361 — Companion module: dev-mode workflow

**Status: CORRECTED 2026-07-28 (was DONE) — the flag and the symlink were right, the WORKFLOW was not: dev and installed builds both declared `highpass-highascg@1.0.4`, so Companion's picker had one entry, nothing was marked as a dev build, and which copy loaded depended on scan order. The owner's report ("no dev to choose", checklist27 item 40) was correct and this WO's DONE was premature — verifying the flag is not verifying the loop. Superseded by [WO-372](./372_WO_companion_dev_module_not_selectable.md), which stamps a prerelease version at package time and makes `dev-mode.sh` refuse to finish on a version collision. Original claim below, kept for the record.** Companion 5.0.2 already runs with `--extra-module-path /home/casparcg/companion-module-dev` (systemd override); `tools/eggs/companion/dev-mode.sh` symlinks the module's pkg/ output into that dir, README in the module repo documents the edit → `npm run package:dev` → `sudo systemctl restart companion` loop and the way back to the packaged install. (README edit lives in the module repo, uncommitted — commit it there.) · Source: owner checklist note 27.07 (item 12): "the module needs work later.
it should also work in dev mode which would be easier to work on."

At pickup: make the HighAsCG Companion module runnable from a working tree (companion dev
modules path / `companion-module-dev` flow) instead of only via the packaged tgz install, so
module iteration doesn't need version-bump + repackage + reinstall each cycle. Document the
loop in the module repo README; keep the packaged path for the eggs image.
