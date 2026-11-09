# WO-1023 — Web-UI update "FAILED" on boxes without the drop-update volume (and no Caspar swap on a re-apply)
**Area:** os-iso, caspar-build
**Status: DONE (09.11 — owner ran the one-time mkdir on 5867; release 2026-11-09_142521 applied twice: helpers refreshed, then the re-apply swapped Caspar to 5c3373ec5, verified)**

Found 09.11 while checking why 5867 (192.168.0.10) never swapped to the WO-1022 Caspar after updating to release
2026-11-09_133601.

## Investigation

- **What 5867 shows:**
  - It runs release 133601, but `casparcg` is still f04acf2f (2476644c4).
  - No `bin/caspar-swap.state`.
  - `/var/log/highascg/update-*.log` (unit `highascg-update-<stamp>.service`) ends both 09.11 runs with
    `update FAILED (exit 1)` **after** the merge. Older logs back to at least 07.11 end the same way.
- **The cause:** `/usr/local/lib/highascg/highascg-apply-server-drop.sh` (the root copy, dated 03.11) writes
  `${drop_root}/.applied-stamp` unguarded under `set -e`.
  - `drop_root` = `/home/casparcg/exfat/drop-update`. The wrapper `highascg-webui-server-update.sh` hard-codes
    `EXFAT_ROOT="/home/casparcg/exfat"`.
  - On 5867 `~/exfat` is an empty root-owned directory: no stick, no fstab mount.
  - So the stamp write fails, and the script exits 1 after the new tree is already in place.
- **The effect:**
  - The update looks like it worked, because the files are new.
  - But the wrapper's `refresh_installed_helpers`, which runs after a successful apply, never ran.
  - So the root helpers in `/usr/local/lib/highascg/` stay frozen at 03.11.
  - The WO-1022 Caspar swap step lives in the **new** apply script, so it never runs.
  - This box can never pull itself onto a fixed helper. Only a root install breaks the loop.
- **A second gap (WO-1022 assumption):**
  - WO-1022 said "a second update swaps".
  - But a re-apply of the already-installed release takes the stamp-unchanged early path, which skipped the swap step.
  - So even with fresh helpers, an unchanged release would not swap until the next release.
- **Sudo on 5867:** NOPASSWD covers `/usr/local/lib/highascg/highascg-webui-server-update.sh` only, with no mkdir
  or install. So the bootstrap needs the owner.

## What was done (`scripts/exfat/highascg-apply-server-drop.sh`)

- **`record_applied root stamp user grp`:** `mkdir -p` + write. If that fails it logs
  `WARN: could not record the applied stamp in <root>/ (no drop-update volume?) — continuing` and the apply goes on.
  Both stamp writes use it.
- **The archive copy** is guarded with `mkdir -p … 2>/dev/null`, and `write_drop_readme` with `|| true`. Both are
  best-effort writes to the same missing volume.
- **The WO-1022 block moved into `caspar_swap_step dest user`.** Its pinned strings are unchanged, so the WO-1022
  smokes still match. The stamp-unchanged path calls it too, so a re-apply of the installed release swaps Caspar.

## What was verified

- **`tools/smoke/smoke-server-update-retain.test.js`, +2 tests:**
  - "retain mode survives an unwritable drop-update root (no stick)": exit 0, and the warning appears on stderr;
  - "a re-apply of the installed release still runs the Caspar swap step": the `HIGHASCG_CASPAR_SWAP_SH` stub marker
    is written.
- **With the `smoke-wo1022-*` files:** 26/26 pass.
- **Full gate loop:** green (verify:script-paths, max-lines, unwired exports, `--no-http`, lint, format, audit,
  offline suite).
- **Not verified:** a live 5867 update with the fixed helper. Once a release carries it:
  1. The owner runs once on 5867:
     `sudo mkdir -p /home/casparcg/exfat/drop-update && sudo chown casparcg: /home/casparcg/exfat/drop-update`.
     The old helper then succeeds and refreshes itself.
  2. Update 5867. The helpers refresh to the fixed copies.
  3. Update again. The re-apply runs the swap: f04acf2f → 40115da4 (5c3373ec5).
  4. Check VERSION, `bin/caspar-swap.state` and the sweep's `caspar.pinned`.

## Verified live on 5867 (09.11, ~15:30)

1. The owner ran the `sudo mkdir … && sudo chown …` bootstrap.
2. The push 8b8a3f3e went out, CI was green, and release **2026-11-09_142521** was published.
3. **First apply** (`POST /api/system/update/apply`, still the old 03.11 helper):
   - `retain mode: drop left at …`;
   - `refreshed /usr/local/lib/highascg/highascg-apply-server-drop.sh`, and the installed copy now has `caspar_swap_step`;
   - `web UI update complete`.
4. **Second apply** (same release, new helper):
   - `stamp unchanged (2026-11-09T142521Z) — skip rsync`;
   - `[highascg-caspar-swap] swapped bin/casparcg → 2.5.1 5c3373ec5 Stable (backup …casparcg.pre-20261109T143135Z)`;
   - restart, then the detached verify;
   - `bin/caspar-swap.state`: `result=verified`, `reason=VERSION 2.5.1 5c3373ec5 Stable`, candidate sha 40115da4…,
     previous f04acf2f….
5. **AMCP `VERSION` on 5867** (via `/api/amcp/raw`): `2.5.1 5c3373ec5 Stable`. The service's casparcg process runs from
   `~/highascg/bin/casparcg`.
