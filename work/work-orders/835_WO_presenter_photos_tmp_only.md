# WO-835 — Presenter photos live in /tmp only

**Status: DONE (30.10, smoke 22/0 incl. 5 new, Godot 22969/0; live node restart pending) — boot starts empty and wipes leftovers, shutdown wipes, dir outside tmp refused; consent text now true**
**Source:** REPORT §5 Tracking; owner 30.10: *"they were supposed to be uploaded and used from /tmp meaning they have no
chance of surviving reboot."*
**Related:** WO-675 (presenter recognition), WO-708.

## 1. Investigation

The intake page (`src/tracking/presenter-intake.html`) tells the presenter the photo is deleted when the server restarts,
but WO-675 reloads the roster on boot. The owner chose the behaviour, not the text: photos (and anything derived from
them, e.g. face embeddings) must be stored only under /tmp.

## 2. What was done

Findings: the files were ALREADY under tmp (`os.tmpdir()/highascg-presenters`, env override `HIGHASCG_PRESENTERS_DIR`);
the contradiction was only that `load()` re-read `roster.json` (name, mic, note, on_enter/on_exit, face + body
features) after a node restart, while the page said "deleted when the server restarts". This box: `/tmp` is tmpfs
(`findmnt /tmp`), `highascg.service` has `PrivateTmp=no` and no `HIGHASCG_PRESENTERS_DIR`, so before this WO a reboot
cleared everything but a service restart did not.

- `src/tracking/presenters.js`: `load()` removed. Constructing the roster starts EMPTY and wipes leftover presenter
  files (`roster.json[.tmp]`, `pN.jpg`; own names only) in the dir. New `dispose()` (shutdown) deletes them too.
  A dir outside `os.tmpdir()` / `/dev/shm` (env or `deps.dir`) is refused with a warning and replaced by the default
  tmp dir (`underTmp()`), so nothing can persist to repo/data/projects/~.
- `src/tracking/register.js`: `onShutdown` calls `_presenters.dispose()`; comment updated (file now exactly 500 lines).
- `src/tracking/presenter-intake.html`: consent text now "It is kept only in the box's temporary memory and is deleted
  when the server restarts or the box reboots." (true: wipe on boot + on shutdown + tmpfs).
- Non-photo data (name, mic, note, on_enter/on_exit) goes with the photos. Entries only exist to be matched to their
  photo's features; without a photo they can never be suggested, and name + features are personal data. Keeping them
  would mean a "ghost" roster of photo-less entries after every restart. The operator re-does intake per show.
- Godot `presenters_section.gd`: photos cached in memory only (no `user://`). Cache key changed from `id` to
  `id:created`, since ids restart at p1 after a wipe and a stale texture would show the previous person's photo.
- Smokes: `smoke-wo675-presenters` restart test and `smoke-wo675-bodies` restart assertion repointed to "starts
  empty"; new `tools/smoke/smoke-wo835-presenter-photos-tmp.test.js`.

## 3. Verified

- `node --test` wo835 + wo675-presenters + wo675-bodies + wo708: all pass (41/0). eslint clean, 500-line check clean.
- `godot --headless -s tests/run_tests.gd`: 22969 passed, 0 failed.
- Persisted presenter photos found on the box: none (`/tmp/highascg-presenters` absent; no roster.json / pN.jpg in
  repo, config, projects or ~). Only source copies exist under /var/cache/highascg/updates and /home/eggs/mnt.
