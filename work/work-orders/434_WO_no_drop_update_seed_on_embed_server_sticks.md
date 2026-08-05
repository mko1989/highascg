# WO-434 — Stop seeding drop-update/ on embed-server sticks

**Status: DONE (2026-08-05 — gate + stick-QA tolerance + smoke; proves out on the next flash)**

Owner 05.08: "why does it even seed the drop update on a fresh stick, it doesnt make
sense at all, its the latest version from the dev machine."

## Investigation — why the seed existed

`create-operator-stick-from-dd.sh` step 4/5 unconditionally ran
`seed-stick-drop-update-from-host.sh` (server + dist-web onto the stick's exFAT).
Reasons it exists, from WO-47/66 era:

1. **WO-47 exFAT-only ISOs** (`HIGHASCG_ISO_EMBED_SERVER=0`): the squashfs ships NO
   server tree — the stick's `drop-update/` IS the server, applied at every boot.
   Essential in that mode.
2. **Live-boot persistence**: on a live stick the RAM overlay forgets `~/highascg`;
   WebUI updates write into the stick's `drop-update/` and the boot pipeline re-applies
   each boot. The SEED itself is not needed for that — the update flow creates the drop.
3. **Side-effect**: sneakernet updates — insert the stick into an older field box and
   its drop updates it. No direction guard, so an OLD stick equally DOWNGRADES a newer
   box — the exact mechanism that poisoned the 13:46 produce (WO-433 addendum).

For the owner's actual flow (embed-server ISO → Calamares install to disk) the fresh
stick's drop is a byte-identical copy of the squashfs tree: pure dead weight that turns
into a downgrade grenade as the stick ages. The owner is right.

## What was done

- `create-operator-stick-from-dd.sh`: seed only when `HIGHASCG_ISO_EMBED_SERVER=0`
  (exFAT-only build) or `HIGHASCG_SEED_DROP_UPDATE=1` (explicit sneakernet update
  stick). Default embed-server flash prints a skip note. Re-flashing recreates the
  exFAT (finish-operator-stick), so re-flashed sticks carry NO stale drop at all.
- `tools/startup/stick-boot-test/tests/test-04-drop-update.sh`: a missing
  `drop-update/` is OK when `${PLAYOUT}/index.js` exists (embed-server stick);
  still fails when neither the drop nor the embedded server is present.
- **Committed the orphaned exFAT-rsync fix** in `seed-stick-drop-update-from-host.sh`
  (sat uncommitted in the working tree since an earlier session; matches the known
  exfat-rsync contract): exFAT gets `rsync -rLt --modify-window=2` (no `-a` — chown on
  exFAT aborts rsync with code 23), machine-local config JSONs excluded from sticks
  with `--delete-excluded`. The script stays in use for exFAT-only/explicit seeds.
- Smoke `smoke-wo434-no-drop-seed-embed-server.test.js` pins the gate, the QA
  tolerance, and the exFAT rsync/exclude lines; registered in the curated list.

NOT changed: insert-time apply behavior (`highascg-exfat-server-update`) — existing
old sticks still apply their drops on insert; that policy question stays open in
WO-433 (WO-415 ruled the config cousin intended).

## What was VERIFIED to work

- Smoke green; `bash -n` on both shell scripts; full suite/lint/prettier at commit.
- NOT yet proven: a real flash with the gate (next produce+flash — expect the
  "skip: embed-server ISO" line at step 4/5, and stick QA test-04 green without a drop).

## Owner QA

- [ ] Next flash: step 4/5 prints the skip; `run-stick-boot-tests.sh` test-04 passes
      with "no drop-update/ (embed-server stick)".
- [ ] If you ever WANT a walking-update stick: `HIGHASCG_SEED_DROP_UPDATE=1` on the
      flash command.
