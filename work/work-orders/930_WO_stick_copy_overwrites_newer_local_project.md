# WO-930 — A stick-booted box overwrites a newer local project with the stick's older, larger copy on every read

**Area:** engine, os-iso
**Status: DONE (02.11.26 — smoke 6/6 incl. two new cases, offline suite; found live on .31 during the WO-929 follow-up round. Reaches .31 with the next ISO)**

## Investigation

- Found during the backup-playout round with .31 (WO-929 follow-up). .31 boots the 02.11 ISO from a Ventoy stick with
  the HIGHASCGEXF exFAT mounted, so the `usb-projects` pair is active (`direction: to_project`, `bootPrefer: exfat`).
- Shared show on, this box master. .31 committed the master's show "New project 1" (rev 600, with the new WO929 PGM
  destination and a look) at 09:57:01.98.
- 0.1 s later both `projects/new_project_1.json` and `projects/_autosave/new_project_1.json` on .31 held the stick's
  copy from 23.10:
  - 24607 bytes, rev 25, destination `dst_mvjz5wlw_1`;
  - mtime 2026-10-23 12:30:04 (preserved by the copy), **ctime 2026-11-02 09:57:02.079**, so the files were replaced
    right then;
  - .31's in-memory project and its `web_project` mirror still held rev 600, so the loss shows on the next load.
- Cause, `src/engine/project-volume-sync.js` `copyIfSrcNewer`:
  ```js
  if (stDst && stDst.mtimeMs >= stSrc.mtimeMs && stDst.size >= stSrc.size) return false
  ```
  - It skips only when the local file is newer **and** at least as large.
  - So any older source that is larger wins. The rev-600 save was smaller than the 23.10 stick copy, which was overwritten.
- Callers, both on the read path:
  - `pullProjectSlugFromUsbIfNewer(slug)`, called by `project-store.js` `readProjectFile`;
  - `pullAutosaveSlugFromVolumesIfNewer(slug)`, called by `readAutosaveFile` (USB or bridge).
  So any read of a project on a stick-booted box can revert it, not only in a cluster. A show that got shorter
  (layers, cues or looks deleted) is reverted to the stick's last larger version.
- The size clause came in with `7e039d3e` ("Restore autosave from USB/bridge on reboot…", 08.06.26). The commit gives no
  reason for it. The likely aim was a tie-break on FAT's 2 s mtime resolution.
- Side observation, not diagnosed: twice during rapid edits on the master, .31 logged `local edits the master never had
  kept as projects/_cluster/new_project_1.diverged-…json`, although nobody edited on .31. The two backups hold .31's revs
  598 and 599 (earlier master versions). Nothing was lost, and both boxes were `in_sync` on the same hash afterwards.
  Candidates: a write by .31's own GUI client or layout sync between commits.

## What was done

- `copyIfSrcNewer`:
  - a source more than 2 s older than the destination never copies;
  - within ±2 s (FAT-family mtime resolution) the copies count as the same save, and only a larger source wins;
  - a source more than 2 s newer copies, as before.
  - The 2 s window is the constant `MTIME_TIE_MS`.
- `tools/smoke/smoke-project-volume-sync.test.js` (already curated), two new cases:
  - a 10-day-old, larger stick file does not replace a newer, smaller local one. This fails on the old line.
  - inside the tie, an equal-size source is skipped and a larger one is copied.

## What was VERIFIED

- `node --test tools/smoke/smoke-project-volume-sync.test.js`: 6/6.
- Offline suite and gates: see the commit.
- On .31: still the old code (live ISO). It gets the fix with the next ISO build. Until then, a load of `new_project_1` on .31
  reads the stick copy. The round re-pushed the show to it (WO-929 follow-up).
