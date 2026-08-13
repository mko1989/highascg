# WO-512 — Unanchored rsync excludes silently skipped `src/config/` and took the box down

**Status: DONE in repo (13.08.2026 — 5 smokes, suite 2106/2104/0, eslint 0, prettier clean). Owner already recovered .37 with the anchored command.**
**Priority:** HIGH (silent partial updates; this one produced a boot-loop)
**Source:** owner 13.08 — GUI update failed (WO-511), owner ran the manual procedure, then: *"after manual update it fails to start highascg"*, `Error: Cannot find module '../config/source-labels'`, restart counter 57.
**Related:** [WO-511](./501_WO_GUI_UPDATE_KILLED_BY_ITS_OWN_SERVICE_STOP.md) §5b (why the manual path was needed), [WO-509](./509_WO_TILED_SCREEN_CARVEOUT_BROKE_THE_GENERATOR.md) (fixes that, it turns out, never landed), [WO-430](./430_WO_decklink_kernel_module_ships_merged_usr.md) (same class: an exclude pattern matching more/less than intended)

## 1. Root cause

`tools/ci/HOW_TO_UPDATE_HIGHASCG.md` told the operator to run:

```bash
rsync … --exclude 'config/' … /tmp/hacg-new/ /home/casparcg/highascg/
```

**An rsync pattern without a leading `/` matches at ANY depth.** `config/` therefore excluded the
live `config/` (intended) **and `src/config/` (not intended)**.

The release contained both new files — verified by listing the tarball:

```
src/api/routes-sources.js     IN TARBALL
src/config/source-labels.js   IN TARBALL
```

`src/api/` synced, `src/config/` did not. The new `router.js` required `routes-sources.js`, which
required `../config/source-labels` — which never arrived. `MODULE_NOT_FOUND` at boot, systemd
restart loop, no operator UI.

**The damage is wider than the crash.** Because `src/config/` was skipped wholesale, *every* fix in
that directory silently failed to land while the rest of the update succeeded: WO-507's DeckLink
input-reservation guard, WO-509's tiled-screen release + pixel-format fix, WO-502's
`screen_N_gpu_texture` generator key. A crash is the lucky outcome — the same mechanism can deliver a
half-updated tree that boots fine and misbehaves.

## 2. The shipped excludes file had the same bug, live and unnoticed

`config/server-update-rsync-excludes.txt` — used by the real Web-UI apply path — carried the same
unanchored patterns. Checked against the actual tree:

| pattern | also matched | consequence |
|---|---|---|
| `media/` | **`src/media/`** | production code (`local-media-ffmpeg.js`, WO-497) skipped by every update |
| `lib/` | **`scripts/lib/`** | shipped scripts (`install-helpers-versions.sh`) skipped by every update |
| `data/`, `bin/`, `projects/` | nested dirs under excluded trees only | no live impact today, same trap tomorrow |

`config/` was **not** in that file (only `config/casparcg.config`), which is why the official path had
never produced this exact crash — luck, not design.

## 3. What was done

- **`config/server-update-rsync-excludes.txt`**: every single-component directory pattern anchored
  (`/media/`, `/lib/`, `/bin/`, `/data/`, `/projects/`, `/work/`, `/client/`, …). Patterns already
  containing a slash (`tools/eggs/`, `config/casparcg.config`) are matched against the full path by
  rsync and were already effectively anchored. **`node_modules/` and `.git/` deliberately keep
  any-depth matching** — never sync a dependency tree or a git dir, wherever it sits — and the file
  says so inline so nobody "fixes" them.
- **`tools/ci/HOW_TO_UPDATE_HIGHASCG.md`**: anchored command, a warning that states *why* the slashes
  matter, a verification section (a partial apply is silent), and the journal one-liner that
  distinguishes "skipped by an exclude" from "bad release".

## 4. What was VERIFIED

`tools/smoke/smoke-wo512-rsync-excludes-anchored.test.js` — 5 tests: every exclude is anchored,
path-qualified, or one of the two declared exceptions; `/media/` and `/lib/` specifically (the two
that were live-broken); the exceptions survive; no bare pattern names a directory that also exists
nested under shipped source; and the doc's **runnable block** contains only anchored forms — asserted
against the fenced bash only, because the prose above it quotes the broken form on purpose.

Gate **2106 tests, 2104 pass / 0 fail / 2 skip**; eslint 0; prettier clean.

**NOT verified:** that `/etc/highascg/server-update-rsync-excludes.txt` on .37 matches the repo. It is
root-owned and refreshed only by `install-exfat-systemd-units.sh` — the same staleness class as
WO-511. On .30 it matched. **Owner: check .37 and refresh if it differs.**

## 5. Owner action

Recovery (already run): re-rsync with anchored excludes, then `sudo systemctl start highascg`.

Because `src/config/` was skipped, **re-verify the WO-507/509/502 fixes actually landed** now:

```bash
ls -la ~/highascg/src/config/source-labels.js
grep -c 'WO-507' ~/highascg/src/config/config-generator-consumer-attach-screen.js
grep -c 'WO-509' ~/highascg/src/config/build-caspar-generator-config-decklink.js
```

## 6. Work log

- 2026-08-13 — Owner hit the boot loop; traced to unanchored `--exclude 'config/'`; found the same
  class already live in the shipped excludes file (`media/` → `src/media/`, `lib/` → `scripts/lib/`);
  anchored both, documented why, added a guard.
