# WO-141 — Commit partitioning, stash resolution, mirror push, status docs

**Status:** Done except mirror push (2026-07-07) — backup box 192.168.0.25 unreachable/powered off; run `DEPLOY_RSYNC_EXCLUDE='media/.replication-*,**/*.tmp' bash work/run-deploy-mirror-tmux.sh --attach` when it's up, then the remote bootstrap per the script header. Everything else complete: main fast-forwarded to the 6-commit partition + hygiene commits, gates green, stash resolved, status docs updated. Note: `config/*.json` (7 files) is live runtime churn, deliberately uncommitted; `docs/wiki-site` also self-regenerates with timestamps — consider gitignoring both classes (owner decision).
**Priority:** High (integration step — closes the stabilization)
**Date:** 2026-07-07
**Depends on:** WO-138, WO-139, WO-140 all accepted.

---

## 1. Problem

The Jul 5–7 work (~170 files) lives only in the WIP snapshot; it must land on `main` as coherent, reviewable commits. One stale git stash exists (`stash@{0}: On main: local fixes before pull`). The offsite mirror to the backup box (192.168.0.25) is stale since 2026-06-27 and last exited with rsync code 23 (vanished replication temp file mid-transfer + node_modules delete conflict).

## 2. Tasks

### Commit partitioning
- [ ] T141.1 `git switch -c stabilize/2026-07-07` from the WIP branch, then `git reset --soft 89b1e68` (tree keeps final state; stage in chunks).
- [ ] T141.2 Commit in order (after each: `npm run verify:repo-integrity && npm run lint`; full `npm run test:ci` after A and F):
  - **A** — WO-122 server refactor (modified `src/` aggregators, deletion of `src/engine/timeline-playback-amcp.js`, refactor-only untracked helpers, split-related smoke edits)
  - **B** — WO-122 client refactor (modified `client/components/*` + `client/lib/*` splits + untracked split helpers)
  - **C** — TDZ chunk-cycle fix (`vite.config.js` + dependency-inversion moves) — own commit, independently revertable
  - **D** — Feature: host live inputs (`src/api/host-live-{ndi,decklink}.js`, `routes-host-live.js`, `src/config/ndi-playback.js`, `host-live-sources.js`, client inspectors, `smoke-host-live-*.test.js`)
  - **E** — Feature: timeline take + compose preview (`src/engine/timeline-take.js`, `timeline-playback-runtime.js`, `routes-timeline.js`, `client/lib/timeline-compose-preview.js`, `timeline-program-canvas.js`, timeline smokes, WO-139 fixes)
  - **F** — Config review (diff each `config/*.json`; `git restore` machine-local runtime state like `device_graph.json`, `screen_destinations.json`; commit only deliberate default changes)
  - **G** — Docs/housekeeping (WO files, code-audit files, `from_client/` → `work/deprecated/` move, `lt-engine copy.js` deletion; regenerate wiki via `npm run wiki:build`)
- [ ] T141.3 `git switch main && git merge --ff-only stabilize/2026-07-07`. Keep WIP branch + tag until mirror push succeeds.

### Stash
- [ ] T141.4 Archive: `git stash show -p stash@{0} > work/archive/stash0-local-fixes-pre-pull.patch` (create dir if needed). Diff its files (`src/api/system-hardware-gui.js`, lt-engine moves) against the current tree; lt-engine part looks superseded by Jul 4 commits. Apply any unique hunks, then `git stash drop stash@{0}`.

### Mirror push
- [ ] T141.5 After main is green: `DEPLOY_RSYNC_EXCLUDE='media/.replication-*,**/*.tmp' bash work/run-deploy-mirror-tmux.sh --attach`. Pause replication during the run if possible. Do NOT exclude `node_modules` (backup box is offline; mirror mode ships it intentionally). rsync 23 = partial; check log tail and re-run once.
- [ ] T141.6 Verify on 192.168.0.25 and run `work/bootstrap-remote-after-sync.sh` per the push script's epilogue.

### Status docs
- [ ] T141.7 Update `work/work-orders/project_status.md`: rows for WO-122 and new WO-138…148; touch WO-59/60/63 rows if advanced.
- [ ] T141.8 Append a dated addendum to `work/work-orders/PROJECT_TRIAGE_2026-07-03.md`: TDZ incident + root cause, stabilization branch, WO-122 re-scope, stash disposition, mirror result.

## 3. Acceptance criteria

- [ ] A141.1 `git status --short` empty on `main`; commits A–G in history; `git stash list` empty.
- [ ] A141.2 All gates green on `main` (output in work log).
- [ ] A141.3 Mirror push exit 0 (or documented-benign partial on volatile media); remote bootstrap run.
- [ ] A141.4 Status docs updated.

## 4. Work log

- 2026-07-07 — WO created. Snapshot: `wip/2026-07-07-pre-stabilize` @ `4caa156`, tag `wip-snapshot-2026-07-07`.
