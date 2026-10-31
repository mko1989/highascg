# WO-886 — MagicQ does not open from the operator dock: the launch ignored the .desktop `Path=`

**Area:** godot-client, os-iso
**Status: DONE (31.10, smokes 35/35 (WO-886 3 + WO-387 + WO-628); the catalog launch spawned from ~ opened MagicQ on a
private Xvfb and the dock's class search found its windows; live after the next node restart)**

Owner, 31.10: *"i cant run the installed magicq normally from the apps in the dock."*

## 1. Investigation

- Journal: `[dock] app:magicq: launched /opt/magicq/runmagicq.sh` at 11:18:59 — the spawn happened, nothing opened.
- `/usr/share/applications/magicq.desktop`: `Exec=/opt/magicq/runmagicq.sh`, `Path=/opt/magicq/`. The script compares
  `$(pwd)` to `/opt/magicq`; anywhere else it assumes a portable copy, finds no `./bin/mqqt` and exits 1 ("The current
  directory must be set to the same location as this script").
- `spawnGuiDetached` (`src/api/system-hardware-gui.js`) spawned app entries without `cwd`, so the child inherited the
  node's working directory; the catalog (`src/utils/desktop-app-catalog.js`) never read `Path=`.
- Focus-or-launch (WO-628) searches the entry's window classes; for MagicQ that was only `runmagicq.sh`. The window MagicQ
  maps is `WM_CLASS "mqqt", "MagicQ"` (xprop on a private Xvfb), so a second click would have started a second MagicQ.

## 2. What was done

- `desktop-app-catalog-parse.js` `workingDir(entry)`: `Path=` when absolute and free of `..`, else null; the catalog
  stores it as `cwd`, `resolveAppLaunch` returns it, `spawnGuiDetached` passes `cwd` to `spawn`.
- `deriveWindowClasses`: an Exec that is a `.sh` launcher also yields the first word of `Name` (MagicQ, MagicQ
  MultiWindows → `MagicQ`; MagicVis / MagicHD likewise). Binaries keep their old candidates.
- Smoke `tools/smoke/smoke-wo886-dock-app-working-dir.test.js` (curated list 2).

## 3. What was verified

- `node --test` WO-886 3/3, WO-387 and WO-628 smokes: 35/35.
- `resolveAppLaunch('app:magicq')` → `{bin: /opt/magicq/runmagicq.sh, cwd: /opt/magicq/, classes [runmagicq.sh, MagicQ]}`;
  spawned with those options from `~` on Xvfb :88 → `mqqt` running, `xdotool search --class 'runmagicq\.sh|MagicQ'` finds
  its windows. MagicQ and the Xvfb stopped afterwards.
- Not run: a dock click on the owner's display (`:0`) — the node loads this at its next restart.
