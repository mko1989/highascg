# godot/spikes/m0 — sweep 29.10.2026 (batch 047)

Files: 10 · lines: 1036 · findings: 0 BUG-HIGH, 2 BUG, 4 DEAD, 2 RISK, 3 QUALITY

Context: WO-595 is `SUPERSEDED IN PRACTICE (2026-10-21)`: the M0 spike ran on the box and the port continued as `godot/client`. The spike is a fossil, but it is still wired in three places: `godot/extensions/hshm/build.sh:25` installs `libhshm` into it, `caspar/modules/shm/README.md:10,38` and `tools/hshm-bridge/hshm_bridge.py:11` document it as the GDScript reference reader / runbook, and `work/work-orders/595*.md` says "later deleted or kept as a fixture". No CI or `tools/ci` file references `spikes/` (grep `spikes` in `tools/ci package.json .github` → nothing). Deleting it needs `build.sh` and those two docs repointed.

## godot/spikes/m0/main.gd
- `DEAD` godot/spikes/m0/main.gd (whole spike) — superseded by `godot/client` (`video/shm_native.gd` is byte-identical, `video/shm_reader.gd` and `video/shm_texture.gd` are newer supersets). grep `spikes/m0` across the repo: `build.sh`, docs/WOs and the spike's own files only; nothing loads it at runtime. Safe to delete once `build.sh:25` and the two doc mentions are repointed.
- `QUALITY` godot/spikes/m0/main.gd:86,130 — pressing Esc twice runs `_finish()` twice; with `--screenshot` that is two `await`s and two PNG writes before quit. Spike-only.

## godot/spikes/m0/mode_atlas.gd
- `QUALITY` godot/spikes/m0/mode_atlas.gd:67-72 — the tiles draw the BGRA premultiplied texture with the default blend (no `BLEND_MODE_PREMULT_ALPHA` as `mode_canvas.gd:26` uses), so transparent regions render with wrong edges; invisible for the opaque test pattern. Spike-only.

## godot/spikes/m0/mode_canvas.gd
- `OK`

## godot/spikes/m0/mode_previs.gd
- `OK`

## godot/spikes/m0/run-spike.sh
- `RISK` godot/spikes/m0/run-spike.sh:20-25 — Godot lookup list is `/opt/godot/godot`, the macOS app, `godot`, `godot4`. On this box none exists (`/opt/godot` is absent, no `godot` on PATH; the real binary is `~/.local/opt/godot/godot`) → the script exits "Godot not found" unless `GODOT=` is exported. `tools/e2e/*.sh` already use `${GODOT:-$HOME/.local/opt/godot/godot}`. Fix: add that path to the list.
- `RISK` godot/spikes/m0/run-spike.sh:31 — `>` overwrites `.godot/extension_list.cfg`, while `build.sh:31` appends. The spike project has one extension, so harmless; they would fight if a second were added.

## godot/spikes/m0/shm_native.gd
- `DEAD` godot/spikes/m0/shm_native.gd — identical copy of `godot/client/video/shm_native.gd` (diff empty). Used only by the spike's `main.gd`.

## godot/spikes/m0/shm_reader.gd
- `BUG` godot/spikes/m0/shm_reader.gd:71-72,82 — reopen is keyed only on `generation`, not on geometry or the file. A restarted Caspar `shm_unlink`s and recreates the segment, and `hshm_writer.h` attach starts a fresh file at `generation = 1` (`previous_generation` is 0), the same value the old segment had whenever it was never re-attached in place (the usual case). Failing case: channel 5 runs 1920x1080 (generation 1, cached `width`, `stride`, `_slot_offsets`), Caspar restarts in 1280x720 → new segment has generation 1 → the check at line 71 passes, the reader keeps the 1080p `_slot_offsets` and `stride*height`, every slot seq check at line 83 reads the wrong offset → `lapped` increments forever and the picture never recovers (NO SIGNAL stuck) until the spike is restarted. The native `HshmSource` does not have this (hshm_reader.h:`poll` also compares `width`/`height`). Same flaw in `godot/client/video/shm_reader.gd:76` (the client's GDScript fallback path used when the extension is not loaded; outside this batch).
- `BUG` godot/spikes/m0/shm_reader.gd:96-97 — after a restart with an equal generation the new writer counts frames from 1: `_last_seq` = 5000, new `n` = 1 → `n != _last_seq + 1` → `gaps += 1 - 5000 - 1`, so `gaps` goes negative (-5000). Same line in `godot/client/video/shm_reader.gd:101-102`. 
- `DEAD` godot/spikes/m0/shm_reader.gd — superseded by `godot/client/video/shm_reader.gd`, which adds the pixel-format / slot-count / file-size checks this copy lacks (`hshm_reader.h` open refuses those, this one accepts them).

## godot/spikes/m0/shm_texture.gd
- `DEAD` godot/spikes/m0/shm_texture.gd — older subset of `godot/client/video/shm_texture.gd` (no RGBA / `update_rgba` path). Used only by the spike's `main.gd`.

## godot/spikes/m0/stats.gd
- `QUALITY` godot/spikes/m0/stats.gd:15-18 — the `_all_*` arrays grow without bound (one float per frame, 4 arrays): about 50 fps × 4 × 8 B ≈ 5 MB/hour. Fine for the minutes-long runs it is built for.

## godot/spikes/m0/tools/make_test_stage.gd
- `OK`
