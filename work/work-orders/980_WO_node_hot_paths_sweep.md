# WO-980 — Optimization sweep: node server hot paths (polled project reads, findmnt spawns, media sort)

**Area:** engine, process, media
**Status: DONE (07.11.26 — 3 fixes live after a node restart; 60–90 s windows on the box: node 6.5 % → 5.3 % CPU, event-loop p99 17.6 → 7.0 ms, /api/playlist/state 23.3 → 6.2 ms, /api/replication/status 16.6 → 2.8 ms; smoke 3/3, offline 5450/5450)**

Owner, 07.11.26: *"run an optimazation sweep where you check code for possible optimazation tweaks."* This WO covers the
node server (systemd unit `highascg`, :4200). Godot idle CPU is WO-798, take / project / autosave paths WO-981, the
load HighAsCG puts on Caspar WO-982, code health WO-984. Prior art read first: `performance/README.md` + PF-01…05,
WO-401 (round 1), WO-405, WO-715 (OSC handled twice).

## Investigation

### Method (no restart, no second server)

- **CPU**: `/proc/<pid>/task/*/stat` deltas over 30–90 s windows (`scratchpad/wo980/cpuwin.sh`). Nearly all of it is
  the main thread; the V8 workers are under 0.1 %.
- **Where the CPU goes**: `kill -USR1 <MainPID>` opens the inspector on 127.0.0.1:9229 inside the live process. A
  CDP client (`cdpprof.js`) took 30 s sampling profiles at 500 µs. Inclusive and self time were grouped by caller
  chain (`callers.js`, `children.js`). Nothing restarts, and the process keeps serving.
- **Who calls what**: I prepended an extra `'request'` listener on the live HTTP server (CDP `Runtime.evaluate`). It
  counts requests per route and times each one to `res.finish`. I also turned on
  `perf_hooks.monitorEventLoopDelay` (5 ms resolution) for event-loop lag. Both were removed when the node restarted.
- **WS**: a passive WS client (`wscap.js`) counted messages and bytes per type, skipping the first 2 s of bootstrap.
  `wsdelta-est.js` estimated what the OSC delta mode would send.
- **In-process micro-timings**: CDP `Runtime.evaluate` ran the real functions against the live ctx (reached through
  `replication-service-runtime.getReplicationCtx()`), 10–20 iterations each. All of them are read-only paths.

### Baseline (07.11 ~00:45, idle on Live, project a_s, Godot + Companion connected, other agents testing)

| metric | value |
|---|---|
| node CPU (60 s, /proc) | **6.5 %** of one core (contract baseline: 10 %) — 99 % on the main thread |
| profile (30 s) | 7.1 % busy |
| RSS / heap | 314–335 MB RSS; heapUsed 94 MB of 187 MB total (new_space 43 MB); flat, no leak |
| event loop (monitorEventLoopDelay, 60 s) | p50 5.08 ms (= the 5 ms resolution), **p99 17.6 ms**, max 37 ms |
| WS per client | 184–204 KB/s: `osc` 21–23 msg/s × 8.8–9.1 KB = 182–202 KB/s, `change` 1.6 KB/s, `variable_update` 0.8 KB/s |
| OSC in | 950 msg/s (WO-715 number; one bundle per channel per frame) |
| journal | ~30 lines/min, mostly other agents' takes; not a cost |

Steady HTTP pollers (in-process counter, 21–60 s windows):

| route | rate | avg latency (sync, blocks the loop) | caller |
|---|---|---|---|
| `GET /api/screens/pgm-layer` | 2.0/s | 0.5 ms | Godot |
| `GET /api/playlist/state` | **1.5/s** | **23–25 ms** | Companion `playlist-poller.js` (1 s) + Godot `playlists_panel.gd` (2 s) |
| `GET /api/replication/status` | 0.4/s | **16.6–18 ms** | Godot `header_badges.gd` (2.5 s) |
| `GET /api/timers/list` | 0.5/s | 0.2 ms | Godot |

### Ranked findings (share of one core, from the 30 s profile)

**1 — Polled routes re-read the whole project from disk, and every read spawns `findmnt` three times: ~3.5 % of a
core, half of node's CPU.**

- `handleStateGet` (`src/api/routes-playlist.js:21`) takes **3.14 %**, `buildReplicationStatus`
  (`src/replication/replication-service-status.js:71`) 0.54 %, and the follow self-loop guard `reevaluateGuard`
  (`src/fixtures/follow-service.js:198`) 0.50 %. All three call `loadFullProject()`
  (`src/engine/project-scenes-load.js:57`): `/api/playlist/state` for the defined playlists (`:73`), replication
  status for `hotBackup` (`:207`), and the guard through `resolveArtnetPatch` → `loadProjectScenesFromDisk`
  (`src/artnet/artnet-slot-config.js:97`).
- `loadFullProject` reads `projects/a_s.json` and `_autosave/a_s.json` (77 KB each), so it does 2 × JSON.parse plus
  `adaptProjectOnRead`. **On top of that:** `readProjectFile` → `pullProjectSlugFromUsbIfNewer` → `usbAutoSync` →
  `isVolumeMountedSync`, and `readAutosaveFile` → `pullAutosaveSlugFromVolumesIfNewer` → `isVolumeMountedSync`
  twice (usb + bridge). Each one is an `execFileSync('findmnt', …)` (`src/engine/project-volume-sync.js:29`).
  - `spawnSync` under `isVolumeMountedSync` = **2.57 %** of a core; spawn is the top self-time entry (2.84 %).
  - Timed in-process: findmnt spawnSync **3.0–3.5 ms** per call (1.2 ms from bash, so forking the 300 MB node costs
    the rest). `readProjectFile` 3.3 ms, `readAutosaveFile` 6.9 ms, `loadFullProject` **13.8 ms**, of which about
    8.5 ms is the three spawns.
  - That is about 7 spawns/s at idle: playlist 1.5/s × 3, replication 0.4/s × 3, and the guard every 5 s × 2 reads
    × 3. Each one blocks the event loop for about 3 ms while OSC and WS wait. This is the 17.6 ms p99.
- The guard is described as a "cheap key" (`follow-service.js:223`). It called `inputPortAddress` **and**
  `inputUniverse`, and each one does its own `resolveArtnetPatch`, so it ran two full project reads every 5 s.

**2 — `localeCompare` with options builds an ICU collator per comparison: 0.83 % of a core.**

- `dedupeMediaList` (`src/utils/media-browser-dedupe.js:145`, and the tie-break at `:106`) sorts about 976 rows
  (459 CLS + 517 disk scan) with `localeCompare(b, undefined, { sensitivity: 'base' })`. V8 caches a collator only
  for the no-options form. That comparator is the top self-time JS function (0.60 %).
- `mediaIndexFor` → `getRawMediaCatalog` runs on every `/api/playlist/state` (`routes-playlist.js:24`), every
  `/api/media`, and every take's missing-media check (`media-index.js:20`).
- Micro-benchmark on the live rows (`bench-dedupe.js`): **5.19 ms → 0.18 ms** per sort. The order is identical: all
  952,576 ordered pairs have the same comparison sign. By the spec, `localeCompare(that, locales, options)` is
  `new Intl.Collator(locales, options).compare`.

**3 — OSC ingest: ~1.5 % of a core.** It is dominated by osc.js decode (`readPacket` 0.81 %), then routing
(`handleOscMessage` 0.38 %). The 20 Hz full snapshot clone, the WS stringify and the fan-out cost only **0.04–0.08 %**.
WO-401 F1/F2 and WO-715 already took the big wins here. What is left is the third-party decoder → proposal P3.

**4 — WS `osc` stream: 202 KB/s per client, all 5 channels in every frame.** Delta mode is **off**
(`config/osc.json` `"wsDeltaBroadcast": false`; WO-401 had turned it on through `.env`, and that line is gone). A
plain JSON diff of consecutive frames changes every channel in about 97 % of frames. But the only things that change
on silent or idle channels are `_lastOscAt` / `peakAge` / profiler noise / frame counters, and WO-401 F3-revised's
value-aware dirty marking already ignores those. Leaving those keys out of the diff, only ch 3 (the playing clip)
changes. The estimate is **9.1 KB → 1.9 KB per frame (−79 %)**. Every consumer merges deltas: Godot `osc_mirror.gd:23`,
web `client/lib/osc-client.js`, and the multiview templates `template/multiview_{master,overlay}.js:60/70`.
Proposal P1: it is a config default, so it is not changed here.

**5 — Smaller, measured, left alone**

- `getRawMediaCatalog` calls `ctx.state.getState()`, which deep-clones channels, media, templates, osc and audio,
  just to read `.media`: 0.5 ms per call, 0.13 %. Using the shared refs would be safe except when there are 0–1 media
  rows: `dedupeMediaList` then returns the filtered array with the original row objects, and `/api/media` enrichment
  could mutate state. → P4.
- `lsblk` every 2 s (`usb-drives.js:110`): 0.25 %. This is WO-401 F13, an owner-visible USB latency tradeoff, left
  as is.
- One-off slow GETs on client open: `/api/system/dock` 235 ms, `/api/system/network` 72 ms, `/api/cluster` 47 ms.
  They are async and not polled.

## What was done

1. **`src/engine/project-volume-sync.js` `isVolumeMountedSync`** (outside the 980 lane, in the project / volume
   area: a tiny hunk, listed for 981/984). It now reads `/proc/self/mountinfo` and compares field 5 (mount point,
   octal escapes decoded) with `path.resolve(target)`, instead of `execFileSync('findmnt', ['-n','-o','TARGET','-T',
   target])` + equality. The unused `execFileSync` import was removed.
   - findmnt reads the same table, so the answer is the same. A symlinked path stays false: mountinfo lists the
     canonical path, and findmnt canonicalised it into a different string. A path that is not a mount point stays
     false, and so does a missing path.
   - The one difference, from the equivalence run over all 37 mounts plus 12 edge paths: a **stacked** mount
     (`/proc/sys/fs/binfmt_misc`, autofs + binfmt) was false before, because findmnt prints two lines and the
     equality fails, and is true now. For the stick and bridge mounts that is the more correct answer, and the old
     answer was an accident of the multi-line output.
   - It also no longer `stat`s the target, so a hung exFAT/FUSE mount cannot block the event loop.
   - Why not a TTL cache over findmnt: a cache would still spawn and would add staleness. Reading the table is exact
     and costs 0.03 ms instead of 1.3 ms (standalone) or 3 ms (in the live node).
2. **`src/utils/media-browser-dedupe.js`**: one module-level `ID_COLLATOR = new Intl.Collator(undefined,
   { sensitivity: 'base' })`, used by both id sorts (the merge tie-break and the final sort). Same order (above).
3. **`src/fixtures/follow-service.js`**: the guard key uses a new internal `inputPatchPair(ctx)`. It calls
   `resolveArtnetPatch` once and returns `[portAddress, universe]` with the semantics of `inputPortAddress` /
   `inputUniverse`: `[null, null]` when the input is off, `[0, 0]` on error. Those two functions stay as they were
   for `isSelfLoop`. `inputPatchPair` is not exported.
4. **Test** `tools/smoke/smoke-wo980-node-hot-paths.test.js` (in `tools/ci/offline-test-files-3.js`):
   - the mountinfo lookup against a stubbed table: `\040` / `\134` escapes, trailing slash, parent and child paths
     are not mount points, `/proc` read failure → false; plus real `/`;
   - the dedupe order equals the old `localeCompare` order on Polish, accented, `ß`, numbered and folder-scoped ids;
   - `inputPatchPair` (pulled out of the source) makes exactly one `resolveArtnetPatch` call and agrees with
     `inputPortAddress` for on, off and error;
   - source pins: no `execFileSync('findmnt'`, the `ID_COLLATOR` line, the `guardKey` line.

## What was VERIFIED

- Gates:
  - smoke 3/3;
  - offline suite **5450 pass / 0 fail / 5 skipped** (5455 tests);
  - `check-max-file-lines`: 0 files over 500 (project-volume-sync.js 483, follow-service.js 342);
  - eslint clean on the 5 touched JS files;
  - prettier `--check` clean on `tools/ci/offline-test-files-3.js`;
  - `check-unwired-exports`: no new orphans (it reports 2 baseline entries that are no longer orphaned; those are
    not from this WO).
- Equivalence: `eq-mount.js` (old findmnt vs new) over 49 paths gives 1 mismatch, the stacked binfmt_misc mount
  explained above.
- Box: node restarted under box2.lock (`kill -TERM`, pid 502291 → 630999, API up after 6 s, no warnings in the
  journal, Godot reconnected). Measured once it had settled:

| metric | before | after |
|---|---|---|
| node CPU (/proc) | 6.48 % (60 s) | **5.33 %** (90 s) |
| profile busy (30 s) | 7.09 % | 5.77 % (this window included the client's reconnect burst: network/wifi/device-view/thumbnails) |
| `handleStateGet` inclusive | 3.14 % | **0.94 %** |
| `buildReplicationStatus` | 0.54 % | 0.11 % |
| `reevaluateGuard` | 0.50 % | 0.05 % |
| `isVolumeMountedSync` | 2.57 % | 0.07 % |
| `loadFullProject` (all callers) | 2.95 % | 0.40 % |
| `dedupeMediaList` | 0.83 % | 0.27 % |
| `loadFullProject` in-process | 13.8 ms | **1.14 ms** |
| `isVolumeMountedSync` in-process | 2.6–3.0 ms | 0.03 ms |
| `/api/playlist/state` (live avg over 1.5 req/s) | 23.3 ms | **6.2 ms** |
| `/api/replication/status` (live avg) | 16.6 ms | **2.8 ms** |
| event loop p99 / max | 17.6 / 37 ms | **7.0** / 40 ms (the max is a one-off, not the polled paths) |
| findmnt spawns from node | ~7 /s | 0 |
| WS per client | 184–204 KB/s | unchanged (P1 not taken) |

- PGM untouched: no AMCP was sent, and no project load happened. The node restart is the only disruptive step.
- Not proven: Companion's playlist variables and the Godot playlists panel were not checked on glass. The response is
  unchanged (same code path; the first post-restart GET returned the same playlist list).

## Proposals (not built)

- **P1 — turn the OSC WS delta mode on** (`osc.wsDeltaBroadcast: true`, Settings → OSC or `config/osc.json`).
  Measured estimate: 202 → ~42 KB/s per client, and the server and every client stop stringifying, parsing and
  merging 4 unchanged channels at 20 Hz. All current consumers merge deltas (see finding 4). It needs the owner's or
  coordinator's go, because it is a live config default. Rollback is the same switch. Verify with `wscap.js` and on
  glass (meters, timers, multiview overlay).
- **P2 — memoise the project read per file stat** (WO-981 lane: `project-store.js` / `project-scenes-load.js`). Key it
  on `mtimeMs` + `size` for both files and hand out a `structuredClone`. Callers mutate the result
  (`migrateEnvelopeLookLayerNumbers` renumbers in place), so a shared object is not safe. Saves about 1 ms per polled
  call now, which is less than before because the spawns are gone. Low value after fix 1.
- **P3 — OSC decode fast path**: about 0.8 % of a core in osc.js `readPacket`. A purpose-built decoder for Caspar's
  bundle shape, or dropping unrouted addresses before arg decode (WO-401 F10), would roughly halve it. It is risky
  (the float-endian latch in `src/osc/osc-float-endian.js` runs on the raw bytes first; nested bundles) for a sub-1 % win, so it should wait for a quiet day.
- **P4 — `getRawMediaCatalog` reads `getStateShared().media`** instead of the deep-cloning `getState()`: 0.5 ms per
  call. First copy the rows in `dedupeMediaList` when `media.length < 2`, so no caller can mutate state rows.
- **P5 — push instead of poll for `/api/playlist/state`**: Companion polls it every 1 s and Godot every 2 s. A WS
  `playlist_state` broadcast on change would remove 1.5 req/s. That is a client and module change (Godot,
  companion-module), out of this lane.

## Box hygiene

- The inspector (`SIGUSR1`, 127.0.0.1:9229), the request-counter listener and the event-loop histogram existed only in
  the measured processes. A final node restart under box2.lock (pid 630999 → 643219) cleared them: 9229 is no longer
  listening, the API was up after 6 s, Godot reconnected, and there was no warn/error in the journal.
- Measurement scripts are in the scratchpad: `wo980/{cpuwin.sh,cdpprof.js,cdpeval.js,callers.js,children.js,wscap.js,
  wsdelta-est.js,bench-dedupe.js,eq-mount.js}` and the profiles `before.cpuprofile` / `after.cpuprofile`.
